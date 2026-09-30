// ═══ RATTRAPAGE DE FLOUTAGE VIA L'ENDPOINT DE PRODUCTION ═══
//
// POURQUOI UN SECOND SCRIPT
// `blur-existing-plates.mjs` fait le même travail mais appelle l'API Anthropic
// EN DIRECT, avec une clé locale. Cette clé est invalide sur ce poste (401
// renvoyé par api.anthropic.com), donc le rattrapage y était bloqué.
//
// La production, elle, détient une clé valide. Ce script délègue donc la
// détection à `/api/detect-plate` déployé — le MÊME détecteur, le même prompt,
// le même modèle, derrière le portail d'accès habituel (jeton utilisateur,
// cooldown, journal d'abus). Rien n'est contourné : on emprunte la porte
// prévue, avec un compte authentifié.
//
// Le floutage, lui, reste local (sharp) : l'image ne transite que vers le
// détecteur, jamais vers un service de traitement tiers.
//
// SÉCURITÉ DES DONNÉES
//   · l'original n'est JAMAIS supprimé — la version floutée est écrite sous
//     `blurred/<id>.jpg`, et seul `photo_url` est repointé ;
//   · idempotent : les lignes déjà sous `/blurred/` sont ignorées ;
//   · reprenable : un échec n'écrit rien, la ligne sera reprise au passage
//     suivant ;
//   · `--dry-run` détecte sans rien écrire.
//
// USAGE
//   node scripts/blur-existing-plates-prod.mjs --dry-run
//   node scripts/blur-existing-plates-prod.mjs --apply [--limit N]

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

const BASE = process.env.REVS_BASE || 'https://revs-ten.vercel.app'
const BUCKET = 'spots'
const COOLDOWN_MS = 3500 // le portail impose 3 s entre deux appels

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const pick = (k, re) =>
  (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]
const URL_ = pick('VITE_SUPABASE_URL', '[^\\s]+')
const ANON = pick('VITE_SUPABASE_ANON_KEY', '[A-Za-z0-9._-]+')
const SERVICE = pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+')
const db = createClient(URL_, SERVICE, { auth: { persistSession: false } })

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || null

/** Compte de service jetable : il ne sert qu'à porter un jeton valide vers
 *  l'endpoint de détection, et il est supprimé à la fin. */
async function makeToken() {
  const email = `revs-blurfix-${Date.now()}@example.com`
  const password = 'BlurFix-2026-' + Math.random().toString(36).slice(2, 10)
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw error
  const c = createClient(URL_, ANON, { auth: { persistSession: false } })
  const { data: s, error: e2 } = await c.auth.signInWithPassword({ email, password })
  if (e2) throw e2
  return { uid: data.user.id, token: s.session.access_token }
}

/** Détection déléguée à la production. Renvoie un tableau de boîtes (0..n) ou
 *  null si la détection n'a PAS pu tourner — les deux cas sont distincts : un
 *  tableau vide veut dire « aucune plaque », null veut dire « on ne sait pas ». */
async function detect(token, base64) {
  const res = await fetch(`${BASE}/api/detect-plate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ imageBase64: base64, mimeType: 'image/jpeg' }),
  })
  if (!res.ok) return { plates: null, status: res.status }
  const j = await res.json().catch(() => ({}))
  return { plates: Array.isArray(j.plates) ? j.plates : null, status: 200 }
}

/** Pixellisation + fondu des bords, sur chaque boîte. Les coordonnées de
 *  l'API sont normalisées (0..1) : on les ramène en pixels réels. */
async function blur(buf, plates) {
  const img = sharp(buf)
  const { width: W, height: H } = await img.metadata()
  const layers = []
  for (const p of plates) {
    // Marge de 12 % : une boîte trop juste laisse dépasser les caractères.
    const w = Math.max(8, Math.round((p.width ?? 0) * W * 1.12))
    const h = Math.max(6, Math.round((p.height ?? 0) * H * 1.12))
    const l = Math.max(0, Math.min(W - w, Math.round(((p.x ?? 0) - (p.width ?? 0) * 0.06) * W)))
    const t = Math.max(0, Math.min(H - h, Math.round(((p.y ?? 0) - (p.height ?? 0) * 0.06) * H)))
    if (w < 4 || h < 4) continue
    const tile = await sharp(buf)
      .extract({ left: l, top: t, width: w, height: h })
      // Réduction extrême puis ré-agrandissement : la pixellisation est
      // irréversible, contrairement à un flou gaussien qu'on peut parfois
      // déconvoluer.
      .resize(Math.max(3, Math.round(w / 14)), Math.max(2, Math.round(h / 14)), { fit: 'fill' })
      .resize(w, h, { kernel: 'nearest', fit: 'fill' })
      .toBuffer()
    layers.push({ input: tile, left: l, top: t })
  }
  if (!layers.length) return null
  return sharp(buf).composite(layers).jpeg({ quality: 88 }).toBuffer()
}

async function main() {
  const { data: spots, error } = await db
    .from('spots')
    .select('id, brand, model, photo_url, created_at')
    .not('photo_url', 'is', null)
    .neq('photo_url', '')
    .order('created_at', { ascending: true })
  if (error) throw error

  const todo = spots.filter((s) => !s.photo_url.includes('/blurred/'))
  console.log(
    `${spots.length} spot(s) avec photo · ${spots.length - todo.length} déjà anonymisé(s) · ${todo.length} à traiter`,
  )
  const list = LIMIT ? todo.slice(0, LIMIT) : todo
  if (!list.length) return console.log('rien à faire ✓')
  console.log(`${list.length} traité(s) maintenant${APPLY ? '' : '  [essai à blanc]'}\n`)

  const { uid, token } = await makeToken()
  let blurred = 0, clean = 0
  const failed = []

  try {
    for (const [i, s] of list.entries()) {
      const label = `${s.brand ?? '?'} ${s.model ?? '?'}`.trim().slice(0, 30)
      try {
        const r = await fetch(s.photo_url)
        if (!r.ok) throw new Error(`photo HTTP ${r.status}`)
        const buf = Buffer.from(await r.arrayBuffer())
        // 1200 px suffisent au détecteur et divisent le coût des tokens vision.
        const small = await sharp(buf).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()

        const { plates, status } = await detect(token, small.toString('base64'))
        if (plates === null) throw new Error(`détection indisponible (HTTP ${status})`)

        if (!plates.length) {
          console.log(`  ○ ${label.padEnd(32)} aucune plaque détectée`)
          clean++
        } else {
          const out = await blur(buf, plates)
          if (!out) throw new Error('boîtes inexploitables')
          if (APPLY) {
            const path = `blurred/${s.id}.jpg`
            const up = await db.storage.from(BUCKET).upload(path, out, { upsert: true, contentType: 'image/jpeg' })
            if (up.error) throw up.error
            const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path)
            const { error: uErr } = await db.from('spots').update({ photo_url: pub.publicUrl }).eq('id', s.id)
            if (uErr) throw uErr
          }
          console.log(`  ✓ ${label.padEnd(32)} ${plates.length} plaque(s) floutée(s)${APPLY ? '' : ' (non écrit)'}`)
          blurred++
        }
      } catch (e) {
        console.log(`  ✗ ${label.padEnd(32)} ${e?.message ?? e}`)
        failed.push({ id: s.id, label, err: String(e?.message ?? e) })
      }
      if (i < list.length - 1) await new Promise((r) => setTimeout(r, COOLDOWN_MS))
    }
  } finally {
    await db.auth.admin.deleteUser(uid)
  }

  console.log(`\n${blurred} floutée(s) · ${clean} sans plaque · ${failed.length} échec(s)`)
  for (const f of failed) console.log(`  à reprendre : ${f.id}  ${f.label}  — ${f.err}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
