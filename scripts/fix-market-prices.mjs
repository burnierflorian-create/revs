// Recompute estimated_price for EVERY spot using the current market (resale)
// price. Text-only Claude calls on Haiku (the cheapest model) — brand +
// model + year, no image — so this whole pass is ~80% cheaper than asking a
// vision model. Processes spots in batches of 5 with a 1 s pause between
// batches to stay clear of rate limits.
//
//   node scripts/fix-market-prices.mjs            # real run: update ALL spots
//   node scripts/fix-market-prices.mjs --dry-run  # list spots, no AI, no writes
//   node scripts/fix-market-prices.mjs --limit 20 # cap (testing)
//
// Reads VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY
// from .env.local without sourcing it. Service role bypasses RLS.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const PRICE_MODEL = 'claude-haiku-4-5-20251001' // cheapest, text only
const BATCH = 5
const PAUSE_MS = 1000
const MIN_PRICE = 1000
const MAX_PRICE = 10_000_000

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
const fmt = (n) =>
  n == null ? '—' : `${new Intl.NumberFormat('fr-FR').format(n)}€`

// ─────────────────────── Fetch every spot ───────────────────────
async function fetchAllSpots() {
  const out = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('spots')
      .select('id, brand, model, year, estimated_price')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) break
    if (out.length >= LIMIT) break
  }
  return out.slice(0, LIMIT)
}

// Exact text-only prompt the task specifies.
async function fetchMarketPrice(client, brand, model, year) {
  const b = (brand ?? '').trim()
  const m = (model ?? '').trim()
  if (!b && !m) return null
  const prompt =
    `Donne-moi le prix du marché actuel en euros pour une ${b} ${m} ${year ?? ''}`.trim() +
    ` en bon état. Réponds uniquement avec le nombre entier en euros, rien d'autre.`
  const r = await client.messages.create({
    model: PRICE_MODEL,
    max_tokens: 20,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = (r.content || [])
    .filter((x) => x.type === 'text')
    .map((x) => x.text)
    .join(' ')
  const n = parseInt(String(text).replace(/[^0-9]/g, ''), 10)
  if (Number.isFinite(n) && n >= MIN_PRICE && n <= MAX_PRICE) return n
  return null
}

// ─────────────────────── Run ───────────────────────
console.log('Fetching all spots…')
const spots = await fetchAllSpots()
console.log(`${spots.length} spot${spots.length === 1 ? '' : 's'} to reprice.\n`)

if (spots.length === 0) {
  console.log('No spots. ✅')
  process.exit(0)
}

if (DRY_RUN) {
  console.log('DRY RUN (no AI, no writes). Spots that would be repriced:')
  for (const s of spots) {
    console.log(
      `  Spot ID ${s.id} : ${s.brand} ${s.model} ${s.year ?? ''} → prix actuel ${fmt(s.estimated_price)}`,
    )
  }
  console.log('\nRe-run without --dry-run to look up market prices via Haiku and UPDATE.')
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

// Process in batches of BATCH, 1 s pause between batches.
for (let i = 0; i < spots.length; i += BATCH) {
  const batch = spots.slice(i, i + BATCH)
  await Promise.all(
    batch.map(async (s) => {
      const label = `${s.brand} ${s.model} ${s.year ?? ''}`.trim()
      let price
      try {
        price = await fetchMarketPrice(client, s.brand, s.model, s.year)
      } catch (e) {
        failed += 1
        console.log(`  Spot ID ${s.id} : ${label} → AI error (${e?.message ?? e})`)
        return
      }
      if (price == null) {
        skipped += 1
        console.log(`  Spot ID ${s.id} : ${label} → prix indisponible, ignoré`)
        return
      }
      const { error } = await supabase
        .from('spots')
        .update({ estimated_price: price })
        .eq('id', s.id)
      if (error) {
        failed += 1
        console.log(`  Spot ID ${s.id} : ${label} → DB error (${error.message})`)
        return
      }
      updated += 1
      console.log(
        `  Spot ID ${s.id} : ${label} → ancien prix: ${fmt(s.estimated_price)} → nouveau prix: ${fmt(price)}`,
      )
    }),
  )
  if (i + BATCH < spots.length) await sleep(PAUSE_MS)
}

console.log(
  `\nDone. ${updated} updated · ${skipped} skipped · ${failed} failed ` +
    `(out of ${spots.length}).`,
)
