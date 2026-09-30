// ═══════ GARAGE : DÉTOURER LA VRAIE PHOTO DE L'UTILISATEUR ═══════
//
// POURQUOI CE SCRIPT EXISTE
// Jusqu'au 30/09/2026, le Garage affichait, par ordre de préférence :
//   1. un rendu PARTAGÉ de la bibliothèque `car_renders` (51 images, une par
//      marque/modèle) — deux personnes ayant spotté la même 911 voyaient la
//      même image, et ce n'était la voiture ni de l'une ni de l'autre ;
//   2. à défaut seulement, la vraie photo, posée à plat dans un cadre.
//
// Le principe produit est l'inverse : le Garage montre les voitures réellement
// photographiées. Ce script fabrique donc, POUR CHAQUE SPOT, un PNG transparent
// découpé dans SA photo — puis le Showroom le pose sur le sol du studio avec le
// même traitement que recevaient les rendus catalogue.
//
// AUCUN APPEL RÉSEAU VERS UN TIERS
// `@imgly/background-removal-node` tourne en local (ONNX, hors ligne). Rien
// n'est envoyé à une API d'image, rien n'est téléchargé depuis Internet, et le
// coût marginal est nul — seulement du CPU.
//
// CONFIDENTIALITÉ
// La source est `spots.photo_url`, c'est-à-dire la version DÉJÀ FLOUTÉE écrite
// par NewSpot (le floutage des plaques a lieu sur le blob en mémoire AVANT
// l'upload). Le script ne connaît aucune autre URL et ne peut donc pas
// réintroduire une plaque lisible.
//
// USAGE
//   node scripts/detour-spot-photos.mjs              # traite tout ce qui reste
//   node scripts/detour-spot-photos.mjs --limit 5    # par petits lots
//   node scripts/detour-spot-photos.mjs --dry-run    # détoure sans rien écrire
//   node scripts/detour-spot-photos.mjs --force      # retraite même si déjà fait
//   node scripts/detour-spot-photos.mjs --spot <id>  # un spot précis
//
// IDEMPOTENT ET REPRENABLE : seules les lignes dont `garage_render_url` est
// NULL sont prises. Un passage interrompu se reprend là où il s'est arrêté ;
// relancer le script une fois terminé ne fait rien et ne coûte rien.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { removeBackground } from '@imgly/background-removal-node'
import sharp from 'sharp'

const BUCKET = 'garage-renders'

// ── Lecture de .env.local SANS le sourcer (le service role ne doit jamais
//    passer par un shell ni apparaître dans un log). ──
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const pick = (k, re) =>
  (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]

const URL_ = pick('VITE_SUPABASE_URL', '[^\\s]+')
const SERVICE = pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+')
if (!URL_ || !SERVICE) {
  console.error('VITE_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absent de .env.local')
  process.exit(1)
}
const db = createClient(URL_, SERVICE, { auth: { persistSession: false } })

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f) => {
  const i = args.indexOf(f)
  return i >= 0 ? args[i + 1] : null
}
const DRY = has('--dry-run')
const FORCE = has('--force')
const LIMIT = Number(val('--limit') || 0) || null
const ONE = val('--spot')

/**
 * Photo réelle → PNG transparent, cadré sur la voiture.
 *
 * `trim` retire le vide transparent laissé par le détourage : sans lui, la
 * voiture flotterait au milieu d'une zone vide et ne poserait pas ses roues sur
 * le sol du showroom. Le WebP avec alpha pèse 5 à 10 fois moins qu'un PNG sans
 * perte, ce qui compte sur une grille qu'on fait défiler.
 */
async function detour(buf, mime) {
  const cut = await removeBackground(new Blob([buf], { type: mime }))
  const cutBuf = Buffer.from(await cut.arrayBuffer())
  return sharp(cutBuf)
    .trim({ threshold: 12 })
    .resize({ width: 1100, height: 700, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 92, effort: 5 })
    .toBuffer()
}

async function ensureBucket() {
  const { data } = await db.storage.listBuckets()
  if (data?.some((b) => b.name === BUCKET)) return
  const { error } = await db.storage.createBucket(BUCKET, { public: true })
  if (error && !/already exists/i.test(error.message)) throw error
  console.log(`bucket « ${BUCKET} » créé`)
}

async function main() {
  let q = db
    .from('spots')
    .select('id, brand, model, photo_url, garage_render_url')
    .not('photo_url', 'is', null)
    .neq('photo_url', '')
    .order('created_at', { ascending: true })

  if (ONE) q = q.eq('id', ONE)
  else if (!FORCE) q = q.is('garage_render_url', null)
  if (LIMIT) q = q.limit(LIMIT)

  const { data: spots, error } = await q
  if (error) throw error
  if (!spots.length) {
    console.log('rien à traiter — tous les spots ont déjà leur rendu ✓')
    return
  }

  console.log(`${spots.length} spot(s) à détourer${DRY ? '  [essai à blanc]' : ''}\n`)
  if (!DRY) await ensureBucket()

  let ok = 0
  const failed = []

  for (const s of spots) {
    const label = `${s.brand ?? '?'} ${s.model ?? '?'}`.trim()
    try {
      const res = await fetch(s.photo_url)
      if (!res.ok) throw new Error(`photo HTTP ${res.status}`)
      const mime = res.headers.get('content-type') || 'image/jpeg'
      const src = Buffer.from(await res.arrayBuffer())

      const out = await detour(src, mime)
      const kb = Math.round(out.length / 1024)

      if (DRY) {
        console.log(`  ✓ ${label.padEnd(34)} ${kb} Ko  (non écrit)`)
        ok++
        continue
      }

      const path = `${s.id}.webp`
      const up = await db.storage
        .from(BUCKET)
        .upload(path, out, { upsert: true, contentType: 'image/webp' })
      if (up.error) throw up.error

      const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path)
      const { error: uErr } = await db
        .from('spots')
        .update({ garage_render_url: pub.publicUrl })
        .eq('id', s.id)
      if (uErr) throw uErr

      console.log(`  ✓ ${label.padEnd(34)} ${kb} Ko`)
      ok++
    } catch (e) {
      // Un échec ne bloque JAMAIS les suivants et n'écrit rien : la ligne reste
      // à NULL, donc le Garage retombe sur la photo (jamais sur une image
      // inventée) et le prochain passage la reprendra.
      console.log(`  ✗ ${label.padEnd(34)} ${e?.message ?? e}`)
      failed.push({ id: s.id, label, err: String(e?.message ?? e) })
    }
  }

  console.log(`\n${ok} réussi(s), ${failed.length} échec(s)`)
  if (failed.length) {
    console.log('à reprendre :')
    for (const f of failed) console.log(`  ${f.id}  ${f.label}  — ${f.err}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
