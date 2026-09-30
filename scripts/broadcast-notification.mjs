// ═══════ DIFFUSION D'UNE NOTIFICATION SYSTÈME À TOUS LES UTILISATEURS ═══════
//
// Une ligne `notifications` par utilisateur, écrite côté serveur avec la clé de
// service. Jamais une boucle client : le client n'a aucune policy INSERT sur
// cette table, et c'est délibéré — le laisser écrire reviendrait à le laisser
// s'auto-décerner des badges.
//
// ── ANTI-DOUBLON ──
// `dedupe_key` porte l'identité du message (`update:2026-09-30`). L'index
// unique `(user_id, dedupe_key)` fait que relancer ce script ne produit RIEN de
// nouveau : c'est la garantie demandée qu'un utilisateur ne reçoive pas deux
// fois le même message, y compris s'il a plusieurs appareils — la notification
// appartient au COMPTE, pas à l'appareil.
//
// Le push suit la même règle : UN envoi par UTILISATEUR, pas par abonnement.
// `/api/send-push` arrose tous les appareils d'une personne, ce qui est juste
// pour un événement ponctuel (« Lucas a aimé ton spot » doit arriver sur le
// téléphone qu'on tient), mais pas ici : un message d'annonce affiché deux
// fois se lit comme un bug. On ne garde donc que l'abonnement le plus récent
// de chaque compte.
//
// USAGE
//   node scripts/broadcast-notification.mjs --dry-run
//   node scripts/broadcast-notification.mjs --apply           (in-app seul)
//   node scripts/broadcast-notification.mjs --apply --push    (in-app + push)
//
// Le push exige VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY dans .env.local. Elles
// ne vivent aujourd'hui que dans l'environnement Vercel : sans elles, le
// script fait l'in-app et dit clairement que le push n'a pas été tenté,
// plutôt que d'échouer à moitié en silence.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const pick = (k, re) =>
  (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]
const db = createClient(
  pick('VITE_SUPABASE_URL', '[^\\s]+'),
  pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+'),
  { auth: { persistSession: false } },
)

const APPLY = process.argv.includes('--apply')

// Le message. Il n'annonce QUE des fonctionnalités vérifiées en production.
const MESSAGE = {
  dedupe_key: 'update:2026-09-30',
  type: 'product_update',
  title: 'REVS vient de se mettre à jour 🚗',
  body:
    'Nouveau Garage, Spotter avec ou sans IA, plaques masquées avant publication, ' +
    'tutoriel de découverte. Ouvre les nouveautés pour tout voir.',
  link: '/notifications?tab=updates',
}

// Les destinataires : les comptes ayant un profil. Un compte créé mais jamais
// arrivé au bout de l'inscription n'a rien à recevoir.
const { data: profiles, error } = await db.from('profiles').select('user_id')
if (error) throw error

// Déduplication défensive : la table n'a qu'un index unique sur user_id, mais
// une ligne orpheline suffirait à produire deux insertions identiques.
const users = [...new Set(profiles.map((p) => p.user_id).filter(Boolean))]

const { count: alreadySent } = await db
  .from('notifications')
  .select('id', { count: 'exact', head: true })
  .eq('dedupe_key', MESSAGE.dedupe_key)

console.log(`profils           : ${profiles.length}`)
console.log(`destinataires     : ${users.length} (après déduplication)`)
console.log(`déjà notifiés     : ${alreadySent ?? 0}`)
console.log(`à notifier        : ${users.length - (alreadySent ?? 0)}`)
console.log(`\ntitre : ${MESSAGE.title}`)
console.log(`corps : ${MESSAGE.body}`)

if (!APPLY) {
  console.log('\n(essai à blanc — relance avec --apply)')
  process.exit(0)
}

const rows = users.map((user_id) => ({ user_id, ...MESSAGE }))
// `ignoreDuplicates` : l'index unique fait le travail, on ne veut pas écraser
// l'état « lu » de quelqu'un qui aurait déjà vu le message.
const { data: inserted, error: insErr } = await db
  .from('notifications')
  .upsert(rows, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
  .select('id')
if (insErr) throw insErr

const { count: total } = await db
  .from('notifications')
  .select('id', { count: 'exact', head: true })
  .eq('dedupe_key', MESSAGE.dedupe_key)

console.log(`\ninsérées maintenant : ${inserted?.length ?? 0}`)
console.log(`total en base       : ${total ?? 0} / ${users.length} destinataires`)

// ─────────────────────────── PUSH ───────────────────────────
if (!process.argv.includes('--push')) {
  console.log('\npush : non demandé (ajoute --push)')
  process.exit(0)
}

const VAPID_PUBLIC = pick('VAPID_PUBLIC_KEY', '[^\\s]+')
const VAPID_PRIVATE = pick('VAPID_PRIVATE_KEY', '[^\\s]+')
if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
  console.log(
    '\npush : IMPOSSIBLE — VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY absentes de\n' +
      '       .env.local (elles ne vivent que dans l’environnement Vercel).\n' +
      '       La notification in-app, elle, est bien partie.',
  )
  process.exit(0)
}

const { default: webpush } = await import('web-push')
webpush.setVapidDetails('mailto:contact@revs.app', VAPID_PUBLIC, VAPID_PRIVATE)

const { data: subs } = await db
  .from('push_subscriptions')
  .select('id, user_id, endpoint, p256dh, auth, created_at')
  .in('user_id', users)

// UN abonnement par compte — le plus récent. C'est la déduplication demandée :
// deux téléphones ne doivent pas produire deux fois la même annonce.
const byUser = new Map()
for (const s of subs ?? []) {
  const kept = byUser.get(s.user_id)
  if (!kept || String(s.created_at) > String(kept.created_at)) byUser.set(s.user_id, s)
}
const chosen = [...byUser.values()]
console.log(`\nabonnements en base : ${(subs ?? []).length}`)
console.log(`après déduplication : ${chosen.length} (un appareil par compte)`)
console.log(`sans abonnement     : ${users.length - chosen.length} (in-app uniquement — aucun échec)`)

const payload = JSON.stringify({
  title: MESSAGE.title,
  body: MESSAGE.body,
  url: MESSAGE.link,
})
let sent = 0
const dead = []
const failed = []
await Promise.all(
  chosen.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      )
      sent += 1
    } catch (e) {
      const code = e?.statusCode
      // 404/410 = l'abonnement n'existe plus côté navigateur. On le retire,
      // sinon chaque envoi ultérieur repaiera le même échec.
      if (code === 404 || code === 410) dead.push(s.id)
      else failed.push(`${s.user_id.slice(0, 8)} → ${code ?? ''} ${e?.body || e?.message || e}`)
    }
  }),
)
if (dead.length) await db.from('push_subscriptions').delete().in('id', dead)

console.log(`\npush envoyés        : ${sent}`)
console.log(`abonnements périmés : ${dead.length} (supprimés)`)
console.log(`échecs              : ${failed.length}${failed.length ? '\n  · ' + failed.join('\n  · ') : ''}`)
