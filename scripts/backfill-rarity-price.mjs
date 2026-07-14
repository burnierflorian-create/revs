// Backfill: freeze rarity from MARKET VALUE (the 2026-07 price-threshold
// rule). Per distinct (brand, model): canonical value = median of its spots'
// estimated_price, rarity = rarityFromPrice(value). Updates every matching
// spot's rarity and seeds public.car_catalog so future spots read the frozen
// value/rarity — no AI, no recompute.
//
//   node scripts/backfill-rarity-price.mjs            # PLAN (no writes)
//   node scripts/backfill-rarity-price.mjs --apply    # UPDATE spots + seed catalog
//
// Reads VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local without
// sourcing it. Service role bypasses RLS. No AI calls.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// ── rarity = f(price) — mirror of src/lib/rarity.ts + api/identify-car.js ──
const RARITY_BANDS = [
  { rarity: 'standard', min: 0 },
  { rarity: 'premium', min: 20000 },
  { rarity: 'performance', min: 45000 },
  { rarity: 'exclusif', min: 90000 },
  { rarity: 'supercar', min: 130000 },
  { rarity: 'hypercar', min: 400000 },
]
const rarityFromPrice = (p) => {
  if (!p || p <= 0) return 'standard'
  let out = 'standard'
  for (const b of RARITY_BANDS) if (p >= b.min) out = b.rarity
  return out
}
const norm = (s) =>
  (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ')
const slugOf = (b, m) => `${norm(b)}|${norm(m)}`
const median = (arr) => {
  const a = arr.filter((n) => n != null && n > 0).sort((x, y) => x - y)
  if (!a.length) return null
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2)
}

// ── env ──
function readEnvText(p) {
  try {
    return readFileSync(p, 'utf8').replace(/\\n/g, '\n')
  } catch {
    return ''
  }
}
function pick(txt, name, re) {
  const rx = new RegExp(`${name}\\s*=\\s*['"]?\\s*(${re})`, 'g')
  let best = ''
  for (const m of txt.matchAll(rx)) if (m[1].length > best.length) best = m[1]
  return best
}
const env = readEnvText(new URL('../.env.local', import.meta.url))
const URL_ = process.env.VITE_SUPABASE_URL || pick(env, 'VITE_SUPABASE_URL', 'https://[^\\s\'"]+')
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || pick(env, 'SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+')
if (!URL_ || !KEY) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const sb = createClient(URL_, KEY, { auth: { persistSession: false } })
const APPLY = process.argv.includes('--apply')

// ── fetch all spots ──
async function fetchAll(table, cols) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

const spots = await fetchAll('spots', 'id,brand,model,estimated_price,rarity')

// ── group by (brand, model) ──
const groups = new Map()
for (const s of spots) {
  const k = slugOf(s.brand, s.model)
  if (!groups.has(k)) groups.set(k, { brand: s.brand, model: s.model, ids: [], prices: [], rarities: new Set() })
  const g = groups.get(k)
  g.ids.push(s.id)
  if (s.estimated_price != null) g.prices.push(s.estimated_price)
  g.rarities.add(s.rarity ?? 'standard')
}

const plan = []
for (const [slug, g] of groups) {
  const value = median(g.prices)
  const rarity = rarityFromPrice(value)
  const changed = [...g.rarities].some((r) => r !== rarity)
  plan.push({ slug, brand: g.brand, model: g.model, value, rarity, ids: g.ids, from: [...g.rarities], changed })
}
plan.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

console.log(`\n${spots.length} spots · ${plan.length} modèles distincts · seuils prix→rareté (2026-07)\n`)
console.log('valeur     rareté        (avant)        modèle')
console.log('─'.repeat(72))
for (const p of plan) {
  const v = p.value ? `${p.value.toLocaleString('fr')}€`.padStart(10) : '        —'
  const mark = p.changed ? '→' : ' '
  console.log(`${v}  ${mark} ${p.rarity.padEnd(11)} ${('[' + p.from.join(',') + ']').padEnd(14)} ${p.brand} ${p.model}`)
}
const nChanged = plan.filter((p) => p.changed).length
console.log(`\n${nChanged} modèle(s) changent de rareté · ${plan.length} entrées catalogue à écrire`)

if (!APPLY) {
  console.log('\n(PLAN uniquement — relance avec --apply pour écrire)')
  process.exit(0)
}

// ── apply: update spots.rarity per group + seed car_catalog ──
let updated = 0
for (const p of plan) {
  if (p.changed) {
    for (let i = 0; i < p.ids.length; i += 200) {
      const chunk = p.ids.slice(i, i + 200)
      const { error } = await sb.from('spots').update({ rarity: p.rarity }).in('id', chunk)
      if (error) console.error(`  spots update failed (${p.model}): ${error.message}`)
      else updated += chunk.length
    }
  }
  // Don't freeze unidentified models in the catalog (would poison future matches).
  if (/inconnu|unknown|non identif/i.test(p.model) || /inconnu|unknown/i.test(p.brand)) continue
  const { error: ce } = await sb.from('car_catalog').upsert(
    { slug: p.slug, brand: p.brand, model: p.model, market_value: p.value, rarity: p.rarity, updated_at: new Date().toISOString() },
    { onConflict: 'slug' },
  )
  if (ce) console.error(`  catalog upsert failed (${p.model}): ${ce.message}`)
}
console.log(`\n✓ ${updated} spots mis à jour · ${plan.length} modèles figés dans car_catalog`)
