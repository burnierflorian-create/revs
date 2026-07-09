// Full re-recognition of EVERY spot. For each spot it downloads the photo
// and re-runs the LIVE production endpoint /api/identify-car (which holds
// the valid Anthropic key AND the latest prompt), then updates
// brand/model/year/color/category/rarity/estimated_price in Supabase.
// Prints each spot: old value → new value.
//
//   node scripts/reprocess-all-spots.mjs             # real run (ALL spots)
//   node scripts/reprocess-all-spots.mjs --dry-run   # list only, no calls/writes
//   node scripts/reprocess-all-spots.mjs --limit 5   # cap (testing)
//   node scripts/reprocess-all-spots.mjs --endpoint http://localhost:3000/api/identify-car
//
// COLUMN NOTE: the spots table stores the brand under `brand` (there is NO
// `make` column). Reads VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from
// .env.local without sourcing it. Service role bypasses RLS.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const DEFAULT_ENDPOINT = 'https://revs-ten.vercel.app/api/identify-car'
const BATCH = 2
const PAUSE_MS = 1500
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const VALID_RARITY = new Set([
  'standard',
  'premium',
  'performance',
  'exclusif',
  'supercar',
  'hypercar',
])

function isGeneric(b) {
  const s = (b ?? '').trim().toLowerCase()
  return !s || s === 'voiture' || s === 'inconnu' || s === 'inconnue' || s.startsWith('voiture ')
}

// ─── Env parsing (no sourcing) ───
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
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  pick(envText, 'VITE_SUPABASE_URL', 'https://[^\\s\'"]+')
const SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  pick(envText, 'SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+')

// ─── Args ───
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const ENDPOINT = (() => {
  const i = args.indexOf('--endpoint')
  return i >= 0 && args[i + 1] ? args[i + 1] : DEFAULT_ENDPOINT
})()
const LIMIT = (() => {
  const i = args.indexOf('--limit')
  const v = i >= 0 ? parseInt(args[i + 1], 10) : NaN
  return Number.isFinite(v) && v > 0 ? v : Infinity
})()

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fmtPrice = (n) => (n == null ? '—' : new Intl.NumberFormat('fr-FR').format(n) + '€')
const fmtCar = (b, m, y) => `${(b ?? '').trim()} ${(m ?? '').trim()}${y ? ` ${y}` : ''}`.trim() || '—'

async function fetchAllSpots() {
  const out = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('spots')
      .select('id, brand, model, year, color, category, rarity, estimated_price, photo_url')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) break
    if (out.length >= LIMIT) break
  }
  return out.slice(0, LIMIT)
}

async function identifyViaEndpoint(photoUrl) {
  const img = await fetch(photoUrl)
  if (!img.ok) throw new Error(`photo HTTP ${img.status}`)
  let mime = (img.headers.get('content-type') || 'image/jpeg').split(';')[0].trim()
  if (!ALLOWED_MIME.has(mime)) mime = 'image/jpeg'
  const b64 = Buffer.from(await img.arrayBuffer()).toString('base64')
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: b64, mimeType: mime }),
  })
  if (!res.ok) throw new Error(`identify HTTP ${res.status}`)
  return res.json()
}

// ─── Run ───
console.log(`Endpoint : ${ENDPOINT}`)
console.log('Fetching ALL spots…')
const spots = await fetchAllSpots()
console.log(`${spots.length} spot${spots.length === 1 ? '' : 's'}.\n`)

if (spots.length === 0) {
  console.log('Aucun spot. ✅')
  process.exit(0)
}
if (DRY_RUN) {
  for (const s of spots)
    console.log(`  Spot ${s.id} : ${fmtCar(s.brand, s.model, s.year)} | ${fmtPrice(s.estimated_price)}${s.photo_url ? '' : ' (pas de photo)'}`)
  console.log('\nRelance sans --dry-run pour ré-identifier + UPDATE.')
  process.exit(0)
}

let updated = 0
let skipped = 0
let failed = 0
let done = 0
const total = spots.length

async function processSpot(s) {
  const oldCar = fmtCar(s.brand, s.model, s.year)
  const oldPrice = s.estimated_price
  done += 1
  const tag = `[${done}/${total}] Spot ${s.id}`

  if (!s.photo_url) {
    skipped += 1
    console.log(`  ${tag} : ${oldCar} — pas de photo, ignoré`)
    return
  }

  let v = null
  try {
    v = await identifyViaEndpoint(s.photo_url)
  } catch (e) {
    failed += 1
    console.log(`  ${tag} : ${oldCar} — erreur (${e?.message ?? e})`)
    return
  }

  if (!v || v.valid === false || isGeneric(v.brand)) {
    skipped += 1
    console.log(`  ${tag} : ${oldCar} — non identifié (${v?.brand ?? 'null'}), inchangé`)
    return
  }

  const update = { brand: String(v.brand).trim() }
  if (v.model && String(v.model).trim()) update.model = String(v.model).trim()
  if (Number.isFinite(v.year)) update.year = Math.floor(v.year)
  if (v.color && String(v.color).trim()) update.color = String(v.color).trim()
  if (v.category && String(v.category).trim()) update.category = String(v.category).trim().toLowerCase()
  if (VALID_RARITY.has(v.rarity)) update.rarity = v.rarity
  if (Number.isFinite(v.estimated_price)) update.estimated_price = v.estimated_price

  const { error } = await supabase.from('spots').update(update).eq('id', s.id)
  if (error) {
    failed += 1
    console.log(`  ${tag} : DB error (${error.message})`)
    return
  }
  updated += 1
  const newCar = fmtCar(update.brand, update.model ?? s.model, update.year ?? s.year)
  console.log(
    `  ${tag} : ${oldCar} → ${newCar} [${update.rarity ?? s.rarity}] | ${fmtPrice(oldPrice)} → ${fmtPrice(update.estimated_price ?? oldPrice)}`,
  )
}

console.log(`Reprocessing ${total} spots via l'endpoint (batch ${BATCH}, ${PAUSE_MS}ms pause)…\n`)
for (let i = 0; i < spots.length; i += BATCH) {
  await Promise.all(spots.slice(i, i + BATCH).map(processSpot))
  if (i + BATCH < spots.length) await sleep(PAUSE_MS)
}

console.log(`\nDone. ${total} traités · ${updated} mis à jour · ${skipped} inchangés · ${failed} échecs.`)
