// Full re-correction of EVERY spot: re-identify the car visually (Sonnet,
// from photo_url) and recompute the current market price (Haiku, text only,
// ~3x cheaper). Updates brand/model/year/color/category/rarity/confidence
// and estimated_price. Batches of 3 with a 2 s pause to stay under rate
// limits.
//
//   node scripts/fix-all-spots.mjs              # real run (ALL spots)
//   node scripts/fix-all-spots.mjs --dry-run    # list spots, no AI, no writes
//   node scripts/fix-all-spots.mjs --limit 9    # cap (testing)
//
// NOTE on columns: the spots table uses brand/model/year/color/category
// (NOT car_brand/car_model/…, which do not exist). This script writes the
// real column names.
//
// Reads VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY
// from .env.local without sourcing it. Service role bypasses RLS.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const VISION_MODEL = 'claude-sonnet-4-6'
const PRICE_MODEL = 'claude-haiku-4-5-20251001'
const BATCH = 3
const PAUSE_MS = 2000
const MIN_PRICE = 1000
const MAX_PRICE = 10_000_000
const VALID_RARITY = new Set([
  'standard',
  'premium',
  'performance',
  'exclusif',
  'supercar',
  'hypercar',
])

const VISION_PROMPT =
  'Tu es un expert automobile mondial. Identifie précisément cette voiture. ' +
  'Regarde attentivement : badge constructeur, forme des phares, calandre, ' +
  'silhouette, jantes, échappements. Réponds UNIQUEMENT en JSON : ' +
  '{brand, model, year, color, category, confidence, rarity}'

// ─────────────────────── Env parsing (no sourcing) ───────────────────────
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
const ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY ||
  pick(envText, 'ANTHROPIC_API_KEY', 'sk-ant-[A-Za-z0-9_-]+')

// ─────────────────────── Args ───────────────────────
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const LIMIT = (() => {
  const i = args.indexOf('--limit')
  const v = i >= 0 ? parseInt(args[i + 1], 10) : NaN
  return Number.isFinite(v) && v > 0 ? v : Infinity
})()

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fmtPrice = (n) =>
  n == null ? '—' : new Intl.NumberFormat('fr-FR').format(n)
const fmtCar = (b, m, y) => `${(b ?? '').trim()} ${(m ?? '').trim()}${y ? ` ${y}` : ''}`.trim() || '—'

function extractJSON(text) {
  const m = text && text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0])
  } catch {
    return null
  }
}
function lastText(r) {
  const blocks = (r?.content || []).filter((b) => b.type === 'text')
  return blocks.length ? blocks[blocks.length - 1].text : ''
}
function toInt(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v)
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

// ─────────────────────── Fetch every spot ───────────────────────
async function fetchAllSpots() {
  const out = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('spots')
      .select(
        'id, brand, model, year, color, category, rarity, confidence, estimated_price, photo_url',
      )
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) break
    if (out.length >= LIMIT) break
  }
  return out.slice(0, LIMIT)
}

// APPEL 1 — visual re-identification (Sonnet, image via photo_url).
async function reidentify(client, photoUrl) {
  if (!photoUrl) return null // no photo → caller keeps existing data
  const r = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 400,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: photoUrl } },
          { type: 'text', text: VISION_PROMPT },
        ],
      },
    ],
  })
  return extractJSON(lastText(r))
}

// APPEL 2 — market price (Haiku, text only).
async function marketPrice(client, brand, model, year) {
  const b = (brand ?? '').trim()
  const m = (model ?? '').trim()
  if (!b && !m) return null
  const prompt =
    `Donne le prix du marché actuel en euros pour une ${b} ${m} ${year ?? ''}`.trim() +
    ` en bon état en France. Réponds UNIQUEMENT avec le nombre entier. Exemples : ` +
    `Lamborghini Huracán 2020 = 195000, McLaren GT 2022 = 165000, ` +
    `Porsche 911 GT3 2021 = 175000, Ferrari 488 GTB 2019 = 165000`
  const r = await client.messages.create({
    model: PRICE_MODEL,
    max_tokens: 20,
    messages: [{ role: 'user', content: prompt }],
  })
  const n = toInt(lastText(r))
  return n != null && n >= MIN_PRICE && n <= MAX_PRICE ? n : null
}

// ─────────────────────── Run ───────────────────────
console.log('Fetching all spots…')
const spots = await fetchAllSpots()
console.log(`${spots.length} spot${spots.length === 1 ? '' : 's'} to correct.\n`)

if (spots.length === 0) {
  console.log('No spots. ✅')
  process.exit(0)
}

if (DRY_RUN) {
  console.log('DRY RUN (no AI, no writes). Spots that would be corrected:')
  for (const s of spots) {
    console.log(
      `  Spot ${s.id} : ${fmtCar(s.brand, s.model, s.year)} | Prix ${fmtPrice(s.estimated_price)}€${s.photo_url ? '' : ' (pas de photo)'}`,
    )
  }
  console.log('\nRe-run without --dry-run to re-identify (Sonnet) + reprice (Haiku) + UPDATE.')
  process.exit(0)
}

if (!ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY in .env.local')
  process.exit(1)
}
const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

let visualUpdated = 0
let priceUpdated = 0
let failed = 0
let done = 0
const total = spots.length

async function correctSpot(s) {
  const oldCar = fmtCar(s.brand, s.model, s.year)
  const oldPrice = s.estimated_price

  // APPEL 1 — re-identify (keep existing on failure / inaccessible photo).
  let v = null
  try {
    v = await reidentify(client, s.photo_url)
  } catch (e) {
    console.log(`  Spot ${s.id} : photo inaccessible / vision error (${e?.message ?? e}) — données visuelles conservées`)
  }
  const update = {}
  let newBrand = s.brand
  let newModel = s.model
  let newYear = s.year
  if (v && (v.brand || v.model)) {
    newBrand = String(v.brand ?? s.brand ?? '').trim() || s.brand
    newModel = String(v.model ?? s.model ?? '').trim() || s.model
    newYear = toInt(v.year) ?? s.year
    update.brand = newBrand
    update.model = newModel
    if (newYear != null) update.year = newYear
    if (v.color && String(v.color).trim()) update.color = String(v.color).trim()
    if (v.category && String(v.category).trim())
      update.category = String(v.category).trim().toLowerCase()
    if (VALID_RARITY.has(v.rarity)) update.rarity = v.rarity
    const conf = toInt(v.confidence)
    if (conf != null) update.confidence = Math.max(0, Math.min(100, conf))
  }

  // APPEL 2 — market price from the (possibly updated) identity.
  let newPrice = null
  try {
    newPrice = await marketPrice(client, newBrand, newModel, newYear)
  } catch (e) {
    console.log(`  Spot ${s.id} : price error (${e?.message ?? e})`)
  }
  if (newPrice != null) update.estimated_price = newPrice

  if (Object.keys(update).length === 0) {
    console.log(`  Spot ${s.id} : ${oldCar} — rien à corriger`)
    done += 1
    return
  }

  const { error } = await supabase.from('spots').update(update).eq('id', s.id)
  if (error) {
    failed += 1
    console.log(`  Spot ${s.id} : DB error (${error.message})`)
    done += 1
    return
  }
  if (update.brand || update.model) visualUpdated += 1
  if (update.estimated_price != null) priceUpdated += 1
  done += 1
  const newCar = fmtCar(newBrand, newModel, newYear)
  console.log(
    `  [${done}/${total}] Spot ${s.id} : ${oldCar} → ${newCar} | ` +
      `Prix: ${fmtPrice(oldPrice)}€ → ${fmtPrice(newPrice ?? oldPrice)}€`,
  )
}

console.log(`Correcting ${total} spots (batch ${BATCH}, ${PAUSE_MS}ms pause)…\n`)
for (let i = 0; i < spots.length; i += BATCH) {
  const batch = spots.slice(i, i + BATCH)
  await Promise.all(batch.map(correctSpot))
  if (i + BATCH < spots.length) await sleep(PAUSE_MS)
}

console.log(
  `\nDone. ${total} spots traités · ${visualUpdated} ré-identifiés · ` +
    `${priceUpdated} prix mis à jour · ${failed} échecs.`,
)
