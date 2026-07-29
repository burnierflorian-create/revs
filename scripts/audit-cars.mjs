// Read-only audit of the car database before launch. Cross-checks every
// distinct car in `spots` against `car_renders` (showroom render library) and
// `car_specs` (stat library), and reports brand/model coherence, price
// plausibility, stats, render availability and colour.
//
//   node scripts/audit-cars.mjs            # full audit → terminal + audit-voitures.md
//   node scripts/audit-cars.mjs --limit 50 # cap distinct cars (testing)
//
// Reads VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local WITHOUT
// sourcing it (parses only the two needed vars, never echoes them). Service
// role bypasses RLS. NOTHING is written to the DB — pure SELECT.

import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// ─────────────────────── Env (no sourcing) ───────────────────────
function readEnvText(path) {
  try {
    return readFileSync(path, 'utf8')
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
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

const args = process.argv.slice(2)
const LIMIT = (() => {
  const i = args.indexOf('--limit')
  const v = i >= 0 ? parseInt(args[i + 1], 10) : NaN
  return Number.isFinite(v) && v > 0 ? v : Infinity
})()

// ─────────────────────── Reference knowledge ───────────────────────
// Famous model → the brand it actually belongs to. Catches "Ferrari Huracán".
const MODEL_BRAND = {
  huracan: 'lamborghini', huracán: 'lamborghini', aventador: 'lamborghini', gallardo: 'lamborghini',
  murcielago: 'lamborghini', urus: 'lamborghini', revuelto: 'lamborghini',
  '911': 'porsche', cayman: 'porsche', boxster: 'porsche', panamera: 'porsche', taycan: 'porsche', cayenne: 'porsche',
  '488': 'ferrari', f8: 'ferrari', 'sf90': 'ferrari', roma: 'ferrari', '296': 'ferrari', 'laferrari': 'ferrari', '812': 'ferrari', portofino: 'ferrari',
  chiron: 'bugatti', veyron: 'bugatti',
  'supra': 'toyota', gr86: 'toyota', 'ae86': 'toyota',
  gtr: 'nissan', 'gt-r': 'nissan', skyline: 'nissan', '350z': 'nissan', '370z': 'nissan',
  m3: 'bmw', m4: 'bmw', m5: 'bmw', i8: 'bmw',
  'golf': 'volkswagen', polo: 'volkswagen',
  'a45': 'mercedes', amg: 'mercedes', 'sls': 'mercedes',
  'rs6': 'audi', rs3: 'audi', r8: 'audi', 'e-tron': 'audi',
  mustang: 'ford', gt40: 'ford', focus: 'ford',
  corvette: 'chevrolet', camaro: 'chevrolet',
  'clio': 'renault', megane: 'renault', alpine: 'renault',
  '205': 'peugeot', '208': 'peugeot', '308': 'peugeot',
}
const KNOWN_BRANDS = [
  'ferrari', 'lamborghini', 'porsche', 'bugatti', 'mclaren', 'mclaren', 'audi', 'bmw', 'mercedes',
  'mercedes-benz', 'toyota', 'nissan', 'honda', 'ford', 'chevrolet', 'renault', 'peugeot',
  'volkswagen', 'vw', 'aston martin', 'bentley', 'rolls-royce', 'maserati', 'alfa romeo',
  'jaguar', 'land rover', 'tesla', 'koenigsegg', 'pagani', 'lotus', 'subaru', 'mazda', 'mini',
  'alpine', 'dodge', 'cadillac',
]
// Plausible market price band (€) per rarity — very wide, just to catch absurdities.
const PRICE_BAND = {
  standard: [1500, 120000],
  premium: [8000, 200000],
  performance: [15000, 500000],
  exclusif: [40000, 2000000],
  supercar: [80000, 4000000],
  hypercar: [300000, 30000000],
}
const GENERIC_COLORS = new Set(['', 'unknown', 'inconnu', 'inconnue', 'n/a', 'na', 'autre', 'other', '-'])

// ─────────────────────── Parsing helpers ───────────────────────
const norm = (s) => (s ?? '').toString().trim().toLowerCase()
const num = (s) => {
  const m = (s ?? '').toString().replace(',', '.').match(/-?\d+(\.\d+)?/)
  return m ? parseFloat(m[0]) : null
}
function statsFrom(spot, specByKey) {
  const ci = spot.car_info || {}
  const key = `${norm(spot.brand)}|${norm(spot.model)}|${spot.year ?? ''}`
  const key2 = `${norm(spot.brand)}|${norm(spot.model)}|`
  const sp = specByKey.get(key) || specByKey.get(key2) || null
  const spData = sp?.data || {}
  return {
    hp: num(ci.horsepower ?? spData.horsepower),
    accel: num(ci.zero_to_100 ?? spData.zero_to_100),
    vmax: num(ci.top_speed ?? spData.top_speed),
    fromSpec: !!sp && !ci.horsepower,
  }
}

// worst of a list of verdicts (✅ < ⚠️ < ❌)
const RANK = { '✅': 0, '⚠️': 1, '❌': 2 }
const worst = (arr) => arr.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), '✅')

// ─────────────────────── Fetch ───────────────────────
async function fetchAll(table, cols) {
  const out = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return out
}

console.log('Lecture de la base…')
const [spots, renders, specs] = await Promise.all([
  fetchAll('spots', 'id,brand,model,year,color,estimated_price,car_info,rarity,realistic_render_url,garage_image_url,photo_url'),
  fetchAll('car_renders', 'make,model,render_url'),
  fetchAll('car_specs', 'brand,model,year,data'),
])

// Render matching MUST mirror src/components/Showroom.tsx (resolveRender):
// same make key, and every token of the render's model is a subset of the
// spot's model tokens (most-specific wins). Exact string equality would
// wrongly flag "Huracán Spyder" as having no "Huracan" render.
const deburr = (s) => (s ?? '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const mkey = (s) => deburr(s).toLowerCase().replace(/[^a-z0-9]+/g, '')
const rtoks = (s) => deburr(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const renderLib = renders.map((r) => ({ make: mkey(r.make), toks: rtoks(r.model), raw: r }))
function resolveRender(brand, model) {
  const b = mkey(brand)
  const st = new Set(rtoks(model))
  let best = -1
  let hit = null
  for (const r of renderLib) {
    if (r.make !== b || r.toks.length === 0) continue
    if (!r.toks.every((t) => st.has(t))) continue
    if (r.toks.length > best) { best = r.toks.length; hit = r.raw }
  }
  return hit
}
const specByKey = new Map()
for (const s of specs) {
  specByKey.set(`${norm(s.brand)}|${norm(s.model)}|${s.year ?? ''}`, s)
  specByKey.set(`${norm(s.brand)}|${norm(s.model)}|`, s)
}

// Group spots by distinct (brand, model, year).
const groups = new Map()
for (const sp of spots) {
  const k = `${norm(sp.brand)}|${norm(sp.model)}|${sp.year ?? ''}`
  if (!groups.has(k)) groups.set(k, { rep: sp, count: 0, prices: [] })
  const g = groups.get(k)
  g.count++
  if (sp.estimated_price != null) g.prices.push(sp.estimated_price)
}

// ─────────────────────── Per-car audit ───────────────────────
const rows = []
for (const [, g] of groups) {
  const sp = g.rep
  const brand = norm(sp.brand)
  const model = norm(sp.model)
  const issues = []

  // 1 — brand / model coherence
  let vName = '✅'
  const PLACEHOLDER = /(mod[èe]le?\s*)?inconnu|unknown|modele inconnu|non identif|\?\?\?/i
  if (!brand || !model) {
    vName = '❌'; issues.push('Marque ou modèle vide')
  } else if (PLACEHOLDER.test(sp.model) || PLACEHOLDER.test(sp.brand)) {
    vName = '❌'; issues.push(`Modèle non identifié ("${sp.model}")`)
  } else {
    for (const [mdl, correct] of Object.entries(MODEL_BRAND)) {
      if (model.includes(mdl) && brand !== correct && !brand.includes(correct)) {
        vName = '⚠️'; issues.push(`"${sp.model}" est un modèle ${correct.toUpperCase()}, pas ${sp.brand}`)
        break
      }
    }
    const foreign = KNOWN_BRANDS.find((b) => model.includes(b) && !brand.includes(b) && b !== brand)
    if (vName === '✅' && foreign) { vName = '⚠️'; issues.push(`Le modèle contient une autre marque ("${foreign}")`) }
  }

  // 2 — price
  let vPrice = '✅'
  const p = sp.estimated_price
  const band = PRICE_BAND[sp.rarity ?? 'standard'] ?? PRICE_BAND.standard
  if (p == null) { vPrice = '❌'; issues.push('Prix marché absent') }
  else if (p === 0) { vPrice = '❌'; issues.push('Prix marché = 0') }
  else if (p < 1000) { vPrice = '⚠️'; issues.push(`Prix très bas (${p} €)`) }
  else if (p > 10_000_000) { vPrice = '⚠️'; issues.push(`Prix très haut (${p.toLocaleString('fr')} €)`) }
  else if (p < band[0]) { vPrice = '⚠️'; issues.push(`Prix ${p.toLocaleString('fr')} € bas pour rareté ${sp.rarity}`) }
  else if (p > band[1]) { vPrice = '⚠️'; issues.push(`Prix ${p.toLocaleString('fr')} € haut pour rareté ${sp.rarity}`) }

  // 3 — stats
  let vStats = '✅'
  const st = statsFrom(sp, specByKey)
  const miss = []
  if (st.hp == null) miss.push('puissance')
  if (st.accel == null) miss.push('0-100')
  if (st.vmax == null) miss.push('vmax')
  if (miss.length === 3) { vStats = '❌'; issues.push('Aucune stat (puissance/0-100/vmax)') }
  else if (miss.length) { vStats = '⚠️'; issues.push(`Stat(s) manquante(s) : ${miss.join(', ')}`) }
  else {
    const bad = []
    if (st.hp < 40 || st.hp > 1700) bad.push(`puissance ${st.hp} ch`)
    if (st.accel < 1.8 || st.accel > 30) bad.push(`0-100 ${st.accel} s`)
    if (st.vmax < 90 || st.vmax > 520) bad.push(`vmax ${st.vmax} km/h`)
    if (bad.length) { vStats = '⚠️'; issues.push(`Stat(s) irréaliste(s) : ${bad.join(', ')}`) }
  }

  // 4 — render
  let vRender = '✅'
  const hasRender = !!sp.realistic_render_url || !!resolveRender(sp.brand, sp.model)
  if (!hasRender) {
    if (sp.photo_url || sp.garage_image_url) { vRender = '⚠️'; issues.push('Pas de rendu showroom (fallback photo actif)') }
    else { vRender = '❌'; issues.push('Ni rendu ni photo') }
  }

  // 5 — color
  let vColor = '✅'
  if (GENERIC_COLORS.has(norm(sp.color))) {
    vColor = norm(sp.color) === '' ? '❌' : '⚠️'
    issues.push(`Couleur : "${sp.color || '(vide)'}"`)
  }

  rows.push({
    brand: sp.brand, model: sp.model, year: sp.year, count: g.count,
    priceRange: g.prices.length ? [Math.min(...g.prices), Math.max(...g.prices)] : null,
    rarity: sp.rarity ?? 'standard',
    v: { name: vName, price: vPrice, stats: vStats, render: vRender, color: vColor },
    overall: worst([vName, vPrice, vStats, vRender, vColor]),
    issues,
  })
}

// Sort: worst first, then most-spotted.
rows.sort((a, b) => RANK[b.overall] - RANK[a.overall] || b.count - a.count)
const shown = Number.isFinite(LIMIT) ? rows.slice(0, LIMIT) : rows

// ─────────────────────── Output ───────────────────────
const tot = rows.length
const cOK = rows.filter((r) => r.overall === '✅').length
const cWarn = rows.filter((r) => r.overall === '⚠️').length
const cBad = rows.filter((r) => r.overall === '❌').length
const usedRenders = new Set()
for (const [, g] of groups) {
  const hit = resolveRender(g.rep.brand, g.rep.model)
  if (hit) usedRenders.add(hit)
}
const orphanRenders = renders.filter((r) => !usedRenders.has(r))

const md = []
md.push('# Audit de la base voitures — REVS\n')
md.push(`_Lecture seule. ${spots.length} spots · ${tot} voitures distinctes · ${renders.length} rendus · ${specs.length} fiches specs._\n`)
md.push(`**Bilan : ✅ ${cOK} conformes · ⚠️ ${cWarn} à corriger · ❌ ${cBad} donnée fausse/manquante**\n`)
md.push('| Voiture | Année | Spots | Rareté | Nom | Prix | Stats | Rendu | Couleur | Détail |')
md.push('|---|--:|--:|---|:-:|:-:|:-:|:-:|:-:|---|')
for (const r of shown) {
  const price = r.priceRange
    ? r.priceRange[0] === r.priceRange[1]
      ? `${r.priceRange[0].toLocaleString('fr')} €`
      : `${r.priceRange[0].toLocaleString('fr')}–${r.priceRange[1].toLocaleString('fr')} €`
    : '—'
  md.push(
    `| ${r.overall} **${r.brand} ${r.model}** | ${r.year ?? '—'} | ${r.count} | ${r.rarity} | ${r.v.name} | ${r.v.price}<br>${price} | ${r.v.stats} | ${r.v.render} | ${r.v.color} | ${r.issues.join(' · ') || '—'} |`,
  )
}
if (orphanRenders.length) {
  md.push(`\n## Rendus orphelins (car_renders sans spot correspondant) — ${orphanRenders.length}\n`)
  for (const o of orphanRenders.slice(0, 40)) md.push(`- ${o.make} ${o.model}`)
}

const outText = md.join('\n')
writeFileSync(new URL('../audit-voitures.md', import.meta.url), outText + '\n')

// Terminal summary
console.log(`\n${'═'.repeat(64)}`)
console.log(`AUDIT VOITURES · ${spots.length} spots · ${tot} voitures distinctes`)
console.log(`✅ ${cOK} conformes   ⚠️ ${cWarn} à corriger   ❌ ${cBad} fausses/manquantes`)
console.log('═'.repeat(64))
for (const r of shown) {
  const price = r.priceRange
    ? (r.priceRange[0] === r.priceRange[1] ? `${r.priceRange[0]}€` : `${r.priceRange[0]}–${r.priceRange[1]}€`)
    : '—'
  console.log(
    `${r.overall}  ${(`${r.brand} ${r.model}`).padEnd(28).slice(0, 28)} ${String(r.year ?? '—').padStart(4)} ×${String(r.count).padStart(3)}  [${r.rarity}]  ${price}`,
  )
  if (r.issues.length) console.log(`     ${r.issues.join(' · ')}`)
}
if (orphanRenders.length) console.log(`\n⚠️ ${orphanRenders.length} rendus car_renders sans spot correspondant.`)
console.log(`\n→ Détail complet écrit dans audit-voitures.md`)
