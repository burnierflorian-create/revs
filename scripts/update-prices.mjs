// Backfill / correct spots.estimated_price for rows that are missing or
// obviously wrong (null, 0, < 1 000 €, or > 10 000 000 €). For each such
// spot we ask Claude — TEXT ONLY (brand + model + year, no image, minimal
// tokens, no web search) — for the current resale-market price, mirroring
// the market-price rule used by api/identify-car.js, then UPDATE the row.
//
//   node scripts/update-prices.mjs            # real run: AI lookup + UPDATE,
//                                             # up to 10 spots
//   node scripts/update-prices.mjs --dry-run  # show what would change, no AI,
//                                             # no writes
//   node scripts/update-prices.mjs --limit 5  # cap spots this run (default 10)
//   node scripts/update-prices.mjs --delay 1000  # throttle between calls (ms)
//
// Reads VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY
// from .env.local without sourcing it (regex pick). Service role bypasses
// RLS so we can update arbitrary rows.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

// Same model as api/identify-car.js (the production source of
// estimated_price) so backfilled prices stay consistent with new spots.
const MODEL = 'claude-sonnet-4-6'

// A price is "good enough to keep" only inside this window.
const MIN_PRICE = 1000
const MAX_PRICE = 10_000_000

// Cap per execution so a single run can't hammer the API / run away on cost.
const DEFAULT_LIMIT = 10

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
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_LIMIT
})()
const DELAY = (() => {
  const i = args.indexOf('--delay')
  return i >= 0 ? parseInt(args[i + 1], 10) || 0 : 600
})()

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ─────────────────────── Fetch the broken rows ───────────────────────
// estimated_price is null, 0, < MIN_PRICE, or > MAX_PRICE. (lt.MIN_PRICE
// already covers 0; null is matched explicitly since null comparisons are
// null, never true.) Capped at LIMIT so a run only ever touches ≤ LIMIT.
async function fetchBrokenSpots(limit) {
  const { data, error } = await supabase
    .from('spots')
    .select('id, brand, model, year, estimated_price')
    .or(
      `estimated_price.is.null,estimated_price.lt.${MIN_PRICE},estimated_price.gt.${MAX_PRICE}`,
    )
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).filter(
    (s) =>
      (s.brand ?? '').trim() &&
      (s.model ?? '').trim() &&
      !/indét|inconnu|unknown/i.test(s.model ?? ''),
  )
}

function extractJSON(text) {
  const m = text && text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0])
  } catch {
    return null
  }
}

// ─────────────────────── AI price lookup (text only) ───────────────────────
// Mirrors the market-price rule in api/identify-car.js: CURRENT resale
// value (argus / market quote) for the identified year — never the
// catalogue-new price for a car older than 2 years.
const SYSTEM =
  `Tu es un expert de la cote automobile. On te donne une marque, un modèle ` +
  `et une année. Donne le prix du MARCHÉ ACTUEL en euros — le prix de revente ` +
  `réel aujourd'hui (cote argus/marché), PAS le prix neuf catalogue. Donne le ` +
  `prix médian du marché actuel pour l'année indiquée. JAMAIS le prix neuf si ` +
  `la voiture a plus de 2 ans. Base-toi sur tes connaissances, sans recherche web.\n` +
  `Réponds UNIQUEMENT par ce JSON, sans markdown, sans aucun autre texte :\n` +
  `{"price_estimate": 165000}\n` +
  `price_estimate est un entier en euros, jamais 0 ni null.`

async function lookupPrice(client, brand, model, year) {
  const yearPart = year ? ` ${year}` : ''
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: 120,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `${brand} ${model}${yearPart}. Prix marché actuel en euros ?`,
      },
    ],
  })
  const text = r.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
  const parsed = extractJSON(text)
  let price = null
  const v = parsed?.price_estimate
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) price = Math.floor(v)
  else if (typeof v === 'string') {
    const n = parseInt(v.replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(n) && n > 0) price = n
  }
  return price
}

const fmt = (n) =>
  n == null ? '—' : new Intl.NumberFormat('fr-FR').format(n) + ' €'

// ─────────────────────── Run ───────────────────────
console.log(`Fetching spots with missing / invalid estimated_price (≤ ${LIMIT})…`)
const spots = await fetchBrokenSpots(LIMIT)
console.log(`${spots.length} spot${spots.length === 1 ? '' : 's'} to process.\n`)

if (spots.length === 0) {
  console.log('Nothing to do — every spot has a plausible price. ✅')
  process.exit(0)
}

if (DRY_RUN) {
  console.log('DRY RUN (no AI, no writes). Spots that would be re-priced:')
  for (const s of spots) {
    console.log(
      `  ${s.brand} ${s.model}${s.year ? ` (${s.year})` : ''} — current: ${fmt(s.estimated_price)}`,
    )
  }
  console.log('\nRe-run without --dry-run to look up market prices and UPDATE.')
  process.exit(0)
}

if (!ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY in .env.local')
  process.exit(1)
}
const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

let updated = 0
let skipped = 0
let failed = 0
const summary = []

for (let i = 0; i < spots.length; i += 1) {
  const s = spots[i]
  const label = `${s.brand} ${s.model}${s.year ? ` (${s.year})` : ''}`
  let price
  try {
    price = await lookupPrice(client, s.brand, s.model, s.year)
  } catch (e) {
    failed += 1
    summary.push({ label, status: 'AI error', detail: e?.message ?? String(e) })
    console.log(`  [${i + 1}/${spots.length}] ${label} — AI error: ${e?.message ?? e}`)
    if (DELAY) await sleep(DELAY)
    continue
  }

  // Refuse implausible results so we never replace one bad value with another.
  if (price == null || price < MIN_PRICE || price > MAX_PRICE) {
    skipped += 1
    summary.push({ label, status: 'skipped', detail: `out-of-range ${fmt(price)}` })
    console.log(`  [${i + 1}/${spots.length}] ${label} — skipped (got ${fmt(price)})`)
    if (DELAY) await sleep(DELAY)
    continue
  }

  const { error } = await supabase
    .from('spots')
    .update({ estimated_price: price })
    .eq('id', s.id)
  if (error) {
    failed += 1
    summary.push({ label, status: 'DB error', detail: error.message })
    console.log(`  [${i + 1}/${spots.length}] ${label} — DB error: ${error.message}`)
  } else {
    updated += 1
    summary.push({ label, status: 'updated', detail: `${fmt(s.estimated_price)} → ${fmt(price)}` })
    console.log(
      `  [${i + 1}/${spots.length}] ${label} — ${fmt(s.estimated_price)} → ${fmt(price)}`,
    )
  }
  if (DELAY) await sleep(DELAY)
}

console.log(
  `\nDone. ${updated} updated · ${skipped} skipped · ${failed} failed ` +
    `(out of ${spots.length}).`,
)
