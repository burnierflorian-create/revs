// Backfill: recompute spots.rarity from REAL worldwide production volume
// (the 2026-06 rarity rule — price is no longer a criterion). Mirrors the
// web-grounded `refineRarityFromWeb` logic in api/identify-car.js, but
// runs once per distinct (brand, model) across the whole DB and updates
// every matching spot.
//
//   node scripts/backfill-rarity.mjs                 # PLAN ONLY (no AI,
//                                                    # no writes) — shows
//                                                    # distinct models +
//                                                    # current rarity mix
//   node scripts/backfill-rarity.mjs --apply         # real run: AI lookup
//                                                    # per model + UPDATE
//   node scripts/backfill-rarity.mjs --apply --limit 10   # cap models
//   node scripts/backfill-rarity.mjs --apply --delay 1500 # throttle (ms)
//
// Reads VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY
// from .env.local without sourcing it (regex pick). Service role bypasses
// RLS so we can update arbitrary rows.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-4-6'
const VALID_RARITY = new Set([
  'standard',
  'premium',
  'performance',
  'exclusif',
  'supercar',
  'hypercar',
])

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
const APPLY = args.includes('--apply')
const LIMIT = (() => {
  const i = args.indexOf('--limit')
  return i >= 0 ? parseInt(args[i + 1], 10) || Infinity : Infinity
})()
const DELAY = (() => {
  const i = args.indexOf('--delay')
  return i >= 0 ? parseInt(args[i + 1], 10) || 0 : 800
})()

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Pull every spot's (id, brand, model, year, rarity), paginated.
async function fetchAllSpots() {
  const out = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('spots')
      .select('id, brand, model, year, rarity')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return out
}

// Group spots by normalised brand|model. Keeps a representative
// (brand, model, year) and the full id list for the UPDATE.
function groupByModel(spots) {
  const groups = new Map()
  for (const s of spots) {
    const brand = (s.brand ?? '').trim()
    const model = (s.model ?? '').trim()
    if (!brand || !model) continue
    if (/indét|inconnu|unknown/i.test(model)) continue
    const key = `${brand.toLowerCase()}|${model.toLowerCase()}`
    let g = groups.get(key)
    if (!g) {
      g = { brand, model, year: s.year ?? null, ids: [], rarities: {} }
      groups.set(key, g)
    }
    g.ids.push(s.id)
    g.rarities[s.rarity] = (g.rarities[s.rarity] ?? 0) + 1
  }
  // Biggest groups first.
  return [...groups.values()].sort((a, b) => b.ids.length - a.ids.length)
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

// Same web-grounded, production-volume rarity rule as api/identify-car.js.
async function refineRarity(client, brand, model, year) {
  const yearPart = year ? ` ${year}` : ''
  const userMsg =
    `Recherche combien d'exemplaires de la ${brand} ${model}${yearPart} ont été ` +
    `produits au total dans le monde. Sources : site du constructeur, Wikipedia, ` +
    `presse auto. Si la production est en cours, donne le total cumulé connu.\n\n` +
    `Réponds UNIQUEMENT par ce JSON, sans markdown :\n` +
    `{"production": 499, "rarity": "supercar"}\n\n` +
    `Échelle de rareté à 6 niveaux — classe UNIQUEMENT selon le VOLUME DE ` +
    `PRODUCTION MONDIAL réel. Le prix n'entre JAMAIS en compte :\n` +
    `- "standard" : modèle premium classique de grande série (Mercedes CLA, BMW Série 2, Audi A3, VW Golf).\n` +
    `- "premium" : haut de gamme quotidien à fort volume.\n` +
    `- "performance" : grande série issue d'un département sportif officiel (Mercedes-AMG, BMW M, Audi RS, Porsche 718).\n` +
    `- "exclusif" : série limitée mondiale stricte < 500 exemplaires (édition spéciale / collector qui n'est pas une hypercar).\n` +
    `- "supercar" : production mondiale TOTALE < 5 000 unités (Ferrari 488 GTB, McLaren 570S, Audi R8 V10, Lamborghini Huracán).\n` +
    `- "hypercar" : série ultra-limitée < 500 exemplaires, sommet absolu (Bugatti Chiron, Pagani, Koenigsegg, McLaren P1).\n\n` +
    `Si la production exacte est inconnue, mets production: null mais TOUJOURS un rarity ` +
    `cohérent. En cas de doute, descends d'un cran. Aucun texte hors du JSON.`
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    messages: [{ role: 'user', content: userMsg }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
  })
  const text = r.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
  const parsed = extractJSON(text)
  const rarity = VALID_RARITY.has(parsed?.rarity) ? parsed.rarity : null
  let production = null
  const v = parsed?.production
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) production = Math.floor(v)
  else if (typeof v === 'string') {
    const n = parseInt(v.replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(n) && n > 0) production = n
  }
  return { production, rarity }
}

// ─────────────────────── Run ───────────────────────
console.log('Fetching spots…')
const spots = await fetchAllSpots()
const groups = groupByModel(spots)
console.log(
  `${spots.length} spots · ${groups.length} distinct (brand, model) models\n`,
)

// Current rarity distribution.
const dist = {}
for (const s of spots) dist[s.rarity] = (dist[s.rarity] ?? 0) + 1
console.log('Current rarity distribution:')
for (const [k, n] of Object.entries(dist).sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(k).padEnd(12)} ${n}`)
console.log('')

if (!APPLY) {
  console.log('PLAN ONLY (no AI, no writes). Top models by spot count:')
  for (const g of groups.slice(0, 25)) {
    const cur = Object.entries(g.rarities)
      .sort((a, b) => b[1] - a[1])[0]?.[0]
    console.log(
      `  ${String(g.ids.length).padStart(3)}×  ${g.brand} ${g.model}  [${cur}]`,
    )
  }
  console.log(
    `\nRe-run with --apply to recompute via AI + update the DB ` +
      `(${Math.min(groups.length, LIMIT)} model${groups.length > 1 ? 's' : ''}, ` +
      `~one web-grounded call each).`,
  )
  process.exit(0)
}

if (!ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY in .env.local (needed for --apply)')
  process.exit(1)
}
const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

let processed = 0
let changed = 0
let spotsUpdated = 0
const todo = groups.slice(0, LIMIT)
console.log(`Applying — ${todo.length} models…\n`)

for (const g of todo) {
  processed += 1
  const before = Object.entries(g.rarities).sort((a, b) => b[1] - a[1])[0]?.[0]
  let res
  try {
    res = await refineRarity(client, g.brand, g.model, g.year)
  } catch (e) {
    console.log(
      `  [${processed}/${todo.length}] ${g.brand} ${g.model} — AI error, skipped (${e?.message ?? e})`,
    )
    continue
  }
  const next = res.rarity
  if (!next) {
    console.log(`  [${processed}/${todo.length}] ${g.brand} ${g.model} — no rarity, skipped`)
    continue
  }
  const prodStr = res.production ? `${res.production} ex.` : 'prod inconnue'
  if (next === before) {
    console.log(
      `  [${processed}/${todo.length}] ${g.brand} ${g.model} — ${before} (unchanged · ${prodStr})`,
    )
  } else {
    // Update every spot in the group, in id batches.
    for (let i = 0; i < g.ids.length; i += 200) {
      const batch = g.ids.slice(i, i + 200)
      const { error } = await supabase
        .from('spots')
        .update({ rarity: next })
        .in('id', batch)
      if (error) throw new Error(error.message)
    }
    changed += 1
    spotsUpdated += g.ids.length
    console.log(
      `  [${processed}/${todo.length}] ${g.brand} ${g.model} — ${before} → ${next} ` +
        `(${g.ids.length} spot${g.ids.length > 1 ? 's' : ''} · ${prodStr})`,
    )
  }
  if (DELAY) await sleep(DELAY)
}

console.log(
  `\nDone. ${processed} models processed · ${changed} reclassified · ` +
    `${spotsUpdated} spots updated.`,
)
