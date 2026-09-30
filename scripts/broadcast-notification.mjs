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
// Le push, lui, est envoyé une fois par abonnement (un utilisateur à deux
// téléphones reçoit deux bannières système, ce qui est le comportement
// attendu), mais UNE seule ligne dans son fil.
//
// USAGE
//   node scripts/broadcast-notification.mjs --dry-run
//   node scripts/broadcast-notification.mjs --apply

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
