// Détoure des rendus studio (fond gris uni) puis les injecte dans la
// bibliothèque partagée `car_renders` (migration 0056). Workflow showroom :
//
//   1. Dépose tes rendus dans  src/assets/car-renders/  nommés `Make__Model.ext`
//        __  (deux underscores)  sépare la marque du modèle
//        _   (underscore simple) devient une espace
//      Ex. Lamborghini__Huracan.jpg      → Lamborghini / Huracan
//          Mercedes-AMG__GT_63_S.png     → Mercedes-AMG / GT 63 S
//   2. node scripts/detour-car-renders.mjs
//        → retire le fond (@imgly/background-removal-node), recadre (sharp),
//          écrit un PNG transparent dans  src/assets/car-renders/detoured/,
//          l'upload dans le bucket Storage `car-renders` (public, auto-créé),
//          puis upsert (make, model, render_url) dans car_renders.
//   3. Le Showroom pose automatiquement la voiture détourée sur le sol.
//
// Options :
//   --dir <path>   dossier source        (défaut src/assets/car-renders)
//   --bucket <nom> bucket Storage        (défaut car-renders)
//   --dry-run      détoure + écrit le PNG local, SANS upload ni écriture DB
//   --force        redétoure même si le PNG détouré existe déjà
//
// Lit VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY dans .env.local sans
// sourcer le fichier (service role requis : Storage + car_renders sont en
// écriture service-role only).

import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { extname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { removeBackground } from '@imgly/background-removal-node'
import sharp from 'sharp'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

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
const envText = readEnvText(join(ROOT, '.env.local'))
const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || pick(envText, 'VITE_SUPABASE_URL', 'https://[^\\s\'"]+')
const SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  pick(envText, 'SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+')

// ── Args ──
const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const FORCE = args.includes('--force')
const flagVal = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const BUCKET = flagVal('--bucket', 'car-renders')
const SRC_DIR = join(ROOT, flagVal('--dir', 'src/assets/car-renders'))
const OUT_DIR = join(SRC_DIR, 'detoured')

const INPUT_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

const slug = (s) =>
  s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// "Make__Model.ext" → { make, model }
function parseName(file) {
  const stem = basename(file, extname(file))
  const idx = stem.indexOf('__')
  if (idx < 0) return null
  const make = stem.slice(0, idx).replace(/_/g, ' ').trim()
  const model = stem.slice(idx + 2).replace(/_/g, ' ').trim()
  if (!make || !model) return null
  return { make, model }
}

if (!existsSync(SRC_DIR) || !statSync(SRC_DIR).isDirectory()) {
  console.error(`Dossier source introuvable : ${SRC_DIR}`)
  process.exit(1)
}
if (!DRY && (!SUPABASE_URL || !SERVICE_ROLE)) {
  console.error('Manque VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY dans .env.local (ou --dry-run)')
  process.exit(1)
}
mkdirSync(OUT_DIR, { recursive: true })

const files = readdirSync(SRC_DIR).filter((f) => {
  if (!INPUT_EXT.has(extname(f).toLowerCase())) return false
  const full = join(SRC_DIR, f)
  return statSync(full).isFile() // ignore le sous-dossier detoured/
})
if (files.length === 0) {
  console.log(`Aucune image dans ${SRC_DIR}. Dépose des rendus nommés Make__Model.ext.`)
  process.exit(0)
}
console.log(`${files.length} rendu(s) à traiter dans ${SRC_DIR}\n`)

// ── Détourage : removeBackground → sharp (recadrage + PNG transparent) ──
async function detour(inputBuf, ext) {
  const blob = new Blob([inputBuf], { type: MIME[ext] || 'image/png' })
  const cut = await removeBackground(blob)
  const cutBuf = Buffer.from(await cut.arrayBuffer())
  // Recadre le vide transparent, borne la taille, ré-encode en PNG.
  return sharp(cutBuf)
    .trim({ threshold: 12 })
    .resize({ width: 1600, height: 1000, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

const rows = []
for (const f of files) {
  const parsed = parseName(f)
  if (!parsed) {
    console.log(`  ⚠️  ignoré (nom hors convention Make__Model) : ${f}`)
    continue
  }
  const ext = extname(f).toLowerCase()
  const outName = `${slug(parsed.make)}__${slug(parsed.model)}.png`
  const outPath = join(OUT_DIR, outName)

  let pngBuf
  if (!FORCE && existsSync(outPath)) {
    pngBuf = readFileSync(outPath)
    console.log(`  ♻️  ${parsed.make} / ${parsed.model} (détourage en cache)`)
  } else {
    const t0 = Date.now()
    try {
      pngBuf = await detour(readFileSync(join(SRC_DIR, f)), ext)
    } catch (e) {
      console.log(`  ❌ détourage ${f} : ${e.message}`)
      continue
    }
    writeFileSync(outPath, pngBuf)
    console.log(
      `  ✂️  ${parsed.make} / ${parsed.model}  (${((Date.now() - t0) / 1000).toFixed(1)}s, ${Math.round(
        pngBuf.length / 1024,
      )}KB) → detoured/${outName}`,
    )
  }

  const objectPath = `${slug(parsed.make)}/${slug(parsed.model)}.png`
  rows.push({ ...parsed, objectPath, pngBuf })
}

if (rows.length === 0) {
  console.log('\nRien de détouré.')
  process.exit(0)
}
if (DRY) {
  console.log(
    `\nDRY RUN — ${rows.length} PNG détouré(s) écrits dans ${OUT_DIR}.\nRelance sans --dry-run pour upload + car_renders.`,
  )
  process.exit(0)
}

// ── Upload Storage + upsert car_renders ──
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

async function ensureBucket() {
  const { data } = await supabase.storage.getBucket(BUCKET)
  if (data) return
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true })
  if (error && !/already exists/i.test(error.message)) throw new Error(error.message)
  console.log(`\nBucket "${BUCKET}" prêt (public).`)
}
await ensureBucket()

const dbRows = []
for (const r of rows) {
  const up = await supabase.storage
    .from(BUCKET)
    .upload(r.objectPath, r.pngBuf, { upsert: true, contentType: 'image/png' })
  if (up.error) {
    console.log(`  ❌ upload ${r.make}/${r.model} : ${up.error.message}`)
    continue
  }
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(r.objectPath)
  dbRows.push({ make: r.make, model: r.model, render_url: pub.publicUrl })
  console.log(`  ⬆️  ${r.make} / ${r.model}`)
}

if (dbRows.length === 0) {
  console.log('\nAucun upload réussi.')
  process.exit(2)
}
const { error } = await supabase.from('car_renders').upsert(dbRows, { onConflict: 'make,model' })
if (error) {
  console.error('Upsert car_renders échoué :', error.message)
  process.exit(2)
}
console.log(`\n✅ ${dbRows.length} rendu(s) détouré(s) enregistrés dans car_renders.`)
