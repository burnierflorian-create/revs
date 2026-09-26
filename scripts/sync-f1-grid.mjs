// Syncs the live F1 grid (roster) from OpenF1 into Supabase:
//   node scripts/sync-f1-grid.mjs
//
// Reads OpenF1 /drivers?session_key=latest (free, no key) and upserts the
// current drivers + teams into public.f1_grid / public.f1_grid_teams. This
// is the single WRITER for those tables; the app reads them. Drivers no
// longer on the grid are marked active=false (never deleted) so any refs
// survive. Writes use the service-role key (bypasses RLS).
//
// Guardrails: if the fetch fails or returns an implausible roster
// (< 18 or > 26 mappable drivers), the script aborts WITHOUT writing, so a
// transient empty/odd session can never wipe the good grid.
//
// Credentials are safe-parsed from .env.local (never executed, never
// printed) — same pattern as scripts/apply-rls.mjs.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

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
const url =
  process.env.VITE_SUPABASE_URL ||
  pick(envText, 'VITE_SUPABASE_URL', 'https://[^\\s\'"]+')
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  pick(envText, 'SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+')

if (!url || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

// ─────────────────────── Mapping adapter ───────────────────────
// OpenF1 team_name → stable slug used everywhere else in the app. Ordered:
// "Racing Bulls" must win before the "red bull" rule, and Audi keeps the
// historical "sauber" slug (2026 decision — only the display name changes).
function teamNameToSlug(rawName) {
  const n = (rawName || '').toLowerCase()
  if (n.includes('racing bull') || n.includes('rb f1') || n.includes('visa cash'))
    return 'racing-bulls'
  if (n.includes('red bull')) return 'red-bull'
  if (n.includes('ferrari')) return 'ferrari'
  if (n.includes('mercedes')) return 'mercedes'
  if (n.includes('mclaren')) return 'mclaren'
  if (n.includes('aston')) return 'aston-martin'
  if (n.includes('alpine')) return 'alpine'
  if (n.includes('williams')) return 'williams'
  if (n.includes('haas')) return 'haas'
  if (n.includes('audi') || n.includes('sauber') || n.includes('kick') || n.includes('stake'))
    return 'sauber'
  if (n.includes('cadillac')) return 'cadillac'
  return null // unknown team → caller skips the driver with a warning
}

const deburr = (s) =>
  (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')

// Slug from the driver's last name — matches the existing f1team.ts slugs
// (verstappen, hulkenberg, …) so editorial bios keyed by slug line up.
function driverSlug(lastName, fullName) {
  const base = lastName || (fullName || '').split(' ').slice(-1)[0] || ''
  return deburr(base).toLowerCase().replace(/[^a-z0-9]/g, '')
}

// OpenF1 country_code is ISO alpha-3; the app uses alpha-2 for flag emoji.
const A3_TO_A2 = {
  NED: 'NL', GBR: 'GB', MON: 'MC', ITA: 'IT', ESP: 'ES', FRA: 'FR',
  AUS: 'AU', MEX: 'MX', FIN: 'FI', GER: 'DE', DEU: 'DE', THA: 'TH',
  JPN: 'JP', NZL: 'NZ', CAN: 'CA', USA: 'US', BRA: 'BR', ARG: 'AR',
  DEN: 'DK', DNK: 'DK', CHN: 'CN', BEL: 'BE', SUI: 'CH', CHE: 'CH',
  AUT: 'AT', NLD: 'NL', POL: 'PL', SWE: 'SE',
}
function toA2(code) {
  if (!code) return null
  const c = code.toUpperCase()
  if (c.length === 2) return c
  return A3_TO_A2[c] || c
}

function normHex(c) {
  if (!c) return null
  const v = String(c).trim()
  return v.startsWith('#') ? v.toUpperCase() : `#${v.toUpperCase()}`
}

// OpenF1 doesn't populate country_code, so nationality is enriched from
// Jolpica (Ergast successor), which exposes a demonym per driver.
const DEMONYM_TO_A2 = {
  Dutch: 'NL', French: 'FR', British: 'GB', Monegasque: 'MC', Italian: 'IT',
  Australian: 'AU', Spanish: 'ES', Canadian: 'CA', Argentine: 'AR',
  Argentinian: 'AR', Thai: 'TH', Brazilian: 'BR', German: 'DE',
  Mexican: 'MX', Finnish: 'FI', American: 'US', Japanese: 'JP',
  Danish: 'DK', Chinese: 'CN', Belgian: 'BE', Swiss: 'CH', Austrian: 'AT',
  Swedish: 'SE', Polish: 'PL', 'New Zealander': 'NZ', Kiwi: 'NZ',
}

// Returns { <deburred lowercase family name>: <ISO alpha-2> }. Best-effort:
// a Jolpica outage just leaves country null (the app falls back to its
// static catalogue), never aborts the sync.
async function fetchNationalities() {
  try {
    const r = await fetch(
      'https://api.jolpi.ca/ergast/f1/2026/drivers/?format=json&limit=100',
      { headers: { 'User-Agent': 'revs-app/1.0 (+f1-grid-sync)' } },
    )
    if (!r.ok) return {}
    const body = await r.json()
    const list = body?.MRData?.DriverTable?.Drivers || []
    const out = {}
    for (const d of list || []) {
      const key = deburr(d.familyName || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      const a2 = DEMONYM_TO_A2[d.nationality]
      if (key && a2) out[key] = a2
    }
    return out
  } catch {
    return {}
  }
}

const toInt = (v) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

// Real championship standings from Jolpica — points/position/wins. Keyed by
// the same slugs as the grid (team adapter + deburred family name). Best-
// effort: an outage just leaves the previous points in place.
async function fetchStandings() {
  const out = { teams: {}, drivers: {} }
  const opts = { headers: { 'User-Agent': 'revs-app/1.0 (+f1-grid-sync)' } }
  try {
    const [cr, dr] = await Promise.all([
      fetch('https://api.jolpi.ca/ergast/f1/2026/constructorstandings/?format=json', opts),
      fetch('https://api.jolpi.ca/ergast/f1/2026/driverstandings/?format=json', opts),
    ])
    if (cr.ok) {
      const list =
        (await cr.json())?.MRData?.StandingsTable?.StandingsLists?.[0]
          ?.ConstructorStandings || []
      for (const s of list) {
        const slug = teamNameToSlug(s.Constructor?.name)
        if (slug)
          out.teams[slug] = {
            points: toInt(s.points),
            position: toInt(s.position),
            wins: toInt(s.wins),
          }
      }
    }
    if (dr.ok) {
      const list =
        (await dr.json())?.MRData?.StandingsTable?.StandingsLists?.[0]
          ?.DriverStandings || []
      for (const s of list) {
        const key = deburr(s.Driver?.familyName || '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
        if (key)
          out.drivers[key] = {
            points: toInt(s.points),
            position: toInt(s.position),
          }
      }
    }
  } catch {
    /* best-effort */
  }
  return out
}

// 2026 race winners. Keyed by the REAL Jolpica round (the static GP_2026
// calendar has drifted, so we never map to it). Best-effort.
async function fetchResults() {
  try {
    const r = await fetch(
      'https://api.jolpi.ca/ergast/f1/2026/results/1/?format=json&limit=100',
      { headers: { 'User-Agent': 'revs-app/1.0 (+f1-grid-sync)' } },
    )
    if (!r.ok) return []
    const races = (await r.json())?.MRData?.RaceTable?.Races || []
    return races
      .map((race) => {
        const w = race.Results?.[0]
        const d = w?.Driver
        return {
          round: toInt(race.round),
          race_name: race.raceName,
          date: race.date || null,
          winner_slug: d
            ? deburr(d.familyName || '').toLowerCase().replace(/[^a-z0-9]/g, '')
            : null,
          winner_name: d ? `${d.givenName} ${d.familyName}`.trim() : null,
          winner_team_slug: teamNameToSlug(w?.Constructor?.name),
          season: 2026,
          updated_at: new Date().toISOString(),
        }
      })
      .filter((x) => x.round != null)
  } catch {
    return []
  }
}

// ─────────────────────── Fetch + build ───────────────────────
const nationalities = await fetchNationalities()
const standings = await fetchStandings()
const results = await fetchResults()
const res = await fetch('https://api.openf1.org/v1/drivers?session_key=latest')
if (!res.ok) {
  console.error(`OpenF1 fetch failed: ${res.status} — aborting, grid untouched`)
  process.exit(2)
}
const raw = await res.json()
if (!Array.isArray(raw) || raw.length === 0) {
  console.error('OpenF1 returned no drivers — aborting, grid untouched')
  process.exit(2)
}

const sessionKey = raw[0]?.session_key ?? null
const teams = new Map() // team_slug → { name, color }
const drivers = new Map() // driver_slug → row
const skipped = []

for (const d of raw) {
  const teamSlug = teamNameToSlug(d.team_name)
  if (!teamSlug) {
    skipped.push(`${d.full_name} (${d.team_name})`)
    continue
  }
  const color = normHex(d.team_colour)
  if (!teams.has(teamSlug)) {
    teams.set(teamSlug, { name: d.team_name, color })
  }
  const slug = driverSlug(d.last_name, d.full_name)
  if (!slug) {
    skipped.push(`${d.full_name} (no slug)`)
    continue
  }
  drivers.set(slug, {
    driver_slug: slug,
    name: d.full_name,
    number: d.driver_number ?? null,
    country: nationalities[slug] || toA2(d.country_code),
    team_slug: teamSlug,
    team_color: color,
    headshot_url: d.headshot_url ?? null,
    points: standings.drivers[slug]?.points ?? null,
    position: standings.drivers[slug]?.position ?? null,
    active: true,
    season: 2026,
    session_key: sessionKey,
    updated_at: new Date().toISOString(),
  })
}

if (skipped.length) console.warn(`⚠︎ skipped ${skipped.length}: ${skipped.join(', ')}`)

// Sanity gate — never overwrite a good grid with a broken snapshot.
if (drivers.size < 18 || drivers.size > 26) {
  console.error(
    `Implausible roster size (${drivers.size}) — aborting, grid untouched`,
  )
  process.exit(3)
}

// ─────────────────────── Write ───────────────────────
const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
})

const teamRows = [...teams].map(([team_slug, v]) => ({
  team_slug,
  name: v.name,
  color: v.color,
  points: standings.teams[team_slug]?.points ?? null,
  position: standings.teams[team_slug]?.position ?? null,
  wins: standings.teams[team_slug]?.wins ?? null,
  season: 2026,
  updated_at: new Date().toISOString(),
}))
const driverRows = [...drivers.values()]

const { error: teamErr } = await supabase
  .from('f1_grid_teams')
  .upsert(teamRows, { onConflict: 'team_slug' })
if (teamErr) {
  console.error('team upsert failed:', teamErr.message)
  process.exit(4)
}

const { error: drvErr } = await supabase
  .from('f1_grid')
  .upsert(driverRows, { onConflict: 'driver_slug' })
if (drvErr) {
  console.error('driver upsert failed:', drvErr.message)
  process.exit(4)
}

// Deactivate drivers no longer on the grid (kept, not deleted).
const currentSlugs = [...drivers.keys()]
const { data: existing } = await supabase
  .from('f1_grid')
  .select('driver_slug')
  .eq('active', true)
const toDeactivate = (existing || [])
  .map((r) => r.driver_slug)
  .filter((s) => !currentSlugs.includes(s))
if (toDeactivate.length) {
  await supabase
    .from('f1_grid')
    .update({ active: false, updated_at: new Date().toISOString() })
    .in('driver_slug', toDeactivate)
}

// 2026 race results (best-effort — never blocks the roster sync).
if (results.length) {
  const { error: resErr } = await supabase
    .from('f1_results')
    .upsert(results, { onConflict: 'round' })
  if (resErr) console.warn('results upsert failed:', resErr.message)
}

console.log(
  `✓ synced ${driverRows.length} drivers / ${teamRows.length} teams` +
    ` / ${results.length} results (session ${sessionKey})` +
    (toDeactivate.length ? ` · deactivated ${toDeactivate.join(', ')}` : ''),
)
