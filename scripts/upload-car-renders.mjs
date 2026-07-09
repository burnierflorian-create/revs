// Injecte des rendus réalistes dans la bibliothèque partagée `car_renders`
// (table de la migration 0056). Deux modes :
//
//  A) DOSSIER D'IMAGES (upload + insert) :
//     node scripts/upload-car-renders.mjs ./renders
//     → upload chaque image dans le bucket Storage `car-renders` (créé
//       automatiquement, public) puis upsert (make, model, render_url).
//     Convention de nom de fichier : `Make__Model.ext`
//       - `__` (deux underscores) sépare la marque du modèle
//       - un `_` simple devient une espace
//       Exemples : Ferrari__Roma.png            → Ferrari / Roma
//                  Mercedes-AMG__GT_63_S.webp   → Mercedes-AMG / GT 63 S
//                  Rolls_Royce__Ghost.png       → Rolls Royce / Ghost
//
//  B) MANIFEST JSON (URLs déjà hébergées) :
//     node scripts/upload-car-renders.mjs --manifest renders.json
//     renders.json = [{ "make": "...", "model": "...", "render_url": "..." }]
//
//  Options : --bucket <nom> (défaut car-renders) · --dry-run
//
// Lit VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY dans .env.local sans
// sourcer le fichier (le service role est requis : createBucket + upload +
// écriture de car_renders, qui est en RLS écriture service-role only).

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { extname, join, basename } from 'node:path'
import { createClient } from '@supabase/supabase-js'

// ── Env (parsing sûr, jamais affiché) ──
function readEnvText(path) {
  try {
    return readFileSync(path, 'utf8').replace(/\\n/g, '\n')
  } catch {
    return ''
  }
}
function pick(txt, name, valueRe) {
  const re = new RegExp(`${name}\\s*=\\s*['"]?\\s*(${valueRe})`, 'g')
  let best = ''
  for (const m of txt.matchAll(re)) if (m[1].length > best.length) best = m[1]
  return best
}
const envText = readEnvText(new URL('../.env.local', import.meta.url))
const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || pick(envText, 'VITE_SUPABASE_URL', 'https://[^\\s\'"]+')
const SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  pick(envText, 'SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+')

// ── Args ──
const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const BUCKET = (() => {
  const i = args.indexOf('--bucket')
  return i >= 0 && args[i + 1] ? args[i + 1] : 'car-renders'
})()
const MANIFEST = (() => {
  const i = args.indexOf('--manifest')
  return i >= 0 ? args[i + 1] : null
})()
const DIR = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--bucket' && args[i - 1] !== '--manifest')

if (!MANIFEST && !DIR) {
  console.error(
    'Usage :\n  node scripts/upload-car-renders.mjs ./dossier-images\n  node scripts/upload-car-renders.mjs --manifest renders.json\n  (options : --bucket <nom> --dry-run)',
  )
  process.exit(1)
}
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Manque VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY dans .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
const slug = (s) =>
  s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// filename "Make__Model.ext" → { make, model }
function parseName(file) {
  const stem = basename(file, extname(file))
  const idx = stem.indexOf('__')
  if (idx < 0) return null
  const make = stem.slice(0, idx).replace(/_/g, ' ').trim()
  const model = stem.slice(idx + 2).replace(/_/g, ' ').trim()
  if (!make || !model) return null
  return { make, model }
}

async function ensureBucket() {
  const { data } = await supabase.storage.getBucket(BUCKET)
  if (data) return
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true })
  if (error && !/already exists/i.test(error.message)) throw new Error(error.message)
  console.log(`Bucket "${BUCKET}" prêt (public).`)
}

// ── Build the list of {make, model, render_url} rows ──
let rows = []

if (MANIFEST) {
  const arr = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  rows = arr
    .filter((r) => r && r.make && r.model && r.render_url)
    .map((r) => ({ make: String(r.make).trim(), model: String(r.model).trim(), render_url: String(r.render_url).trim() }))
  console.log(`Manifest : ${rows.length} rendus.`)
} else {
  if (!existsSync(DIR) || !statSync(DIR).isDirectory()) {
    console.error(`Dossier introuvable : ${DIR}`)
    process.exit(1)
  }
  const files = readdirSync(DIR).filter((f) => MIME[extname(f).toLowerCase()])
  console.log(`${files.length} image(s) dans ${DIR}.`)
  if (!DRY) await ensureBucket()
  for (const f of files) {
    const parsed = parseName(f)
    if (!parsed) {
      console.log(`  ⚠️  ignoré (nom hors convention Make__Model) : ${f}`)
      continue
    }
    const ext = extname(f).toLowerCase()
    const objectPath = `${slug(parsed.make)}/${slug(parsed.model)}${ext}`
    if (DRY) {
      console.log(`  [dry] ${f} → ${parsed.make} / ${parsed.model} → ${BUCKET}/${objectPath}`)
      rows.push({ ...parsed, render_url: `(dry:${objectPath})` })
      continue
    }
    const buf = readFileSync(join(DIR, f))
    const up = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, buf, { upsert: true, contentType: MIME[ext] })
    if (up.error) {
      console.log(`  ❌ upload ${f} : ${up.error.message}`)
      continue
    }
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(objectPath)
    rows.push({ ...parsed, render_url: pub.publicUrl })
    console.log(`  ⬆️  ${parsed.make} / ${parsed.model}`)
  }
}

if (rows.length === 0) {
  console.log('Rien à insérer.')
  process.exit(0)
}
if (DRY) {
  console.log(`\nDRY RUN — ${rows.length} rendus seraient upsertés dans car_renders. Relance sans --dry-run.`)
  process.exit(0)
}

// ── Upsert into car_renders (unique make,model) ──
const { error } = await supabase
  .from('car_renders')
  .upsert(rows, { onConflict: 'make,model' })
if (error) {
  console.error('Upsert car_renders échoué :', error.message)
  process.exit(2)
}
console.log(`\n✅ ${rows.length} rendu(s) enregistrés dans car_renders.`)
