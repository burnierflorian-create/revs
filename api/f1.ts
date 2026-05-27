import Anthropic from '@anthropic-ai/sdk'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// Unified F1 fact-sheet endpoint. Three modes dispatched by query string:
//   GET  /api/f1?refresh=1                → cron / manual batch refresh
//   POST /api/f1?type=team&body.slug=…    → team detail (auth required)
//   POST /api/f1?type=driver&body.slug=…  → driver detail (auth required)
//
// Consolidated into one file so the project stays within the 12 Serverless
// Functions cap of the Vercel Hobby plan. Splitting back into three files
// is a no-op refactor when we move to Pro.

const MODEL = 'claude-sonnet-4-6'

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const TTL_MS = 7 * 24 * 60 * 60 * 1000

// Vercel Hobby allows up to 300 s. The driver refresh path is the
// hottest call site — 10 drivers × Claude+web_search round-trips can
// take 70-90 s in aggregate. 300 s leaves plenty of head-room.
export const config = { maxDuration: 300 }

// ─────────────────────── Catalogue ───────────────────────

const TEAM_SLUGS: Record<string, string> = {
  'red-bull': 'Oracle Red Bull Racing',
  ferrari: 'Scuderia Ferrari',
  mercedes: 'Mercedes-AMG Petronas F1 Team',
  mclaren: 'McLaren F1 Team',
  'aston-martin': 'Aston Martin Aramco F1 Team',
  alpine: 'BWT Alpine F1 Team',
  williams: 'Atlassian Williams Racing',
  haas: 'MoneyGram Haas F1 Team',
  'racing-bulls': 'Visa Cash App Racing Bulls F1 Team',
  sauber: 'Stake F1 Team Kick Sauber',
}

const DRIVER_SLUGS: Record<string, string> = {
  verstappen: 'Max Verstappen',
  lawson: 'Liam Lawson',
  leclerc: 'Charles Leclerc',
  hamilton: 'Lewis Hamilton',
  russell: 'George Russell',
  antonelli: 'Andrea Kimi Antonelli',
  norris: 'Lando Norris',
  piastri: 'Oscar Piastri',
  alonso: 'Fernando Alonso',
  stroll: 'Lance Stroll',
  gasly: 'Pierre Gasly',
  doohan: 'Jack Doohan',
  albon: 'Alexander Albon',
  sainz: 'Carlos Sainz',
  hulkenberg: 'Nico Hülkenberg',
  bearman: 'Oliver Bearman',
  ocon: 'Esteban Ocon',
  tsunoda: 'Yuki Tsunoda',
  bortoleto: 'Gabriel Bortoleto',
  hadjar: 'Isack Hadjar',
}

const TEAM_FIELDS = [
  'fullName','shortName','nationality','base','foundedYear',
  'championships','totalWins','totalPoles','currentPosition','currentPoints',
  // Season 2026 — refreshed by the daily cron after each race.
  'seasonWins','seasonPodiums','seasonPoles',
  'lastRaceGp','lastRaceResults',
  'carName','engine','specs','history','highlights',
]

const DRIVER_FIELDS = [
  'fullName','birthDate','birthPlace','nationality','number','team',
  'championships','wins','poles','podiums','careerPoints',
  'currentPosition','currentPoints',
  // Season 2026 — refreshed by the daily cron after each race.
  'seasonWins','seasonPodiums','seasonPoles',
  'bio','highlights','drivingStyle',
]

// 2026 calendar — passed into prompts so Claude knows which race to
// look up by `round`. Source of truth is src/lib/f1.ts (GP_2026), kept
// in sync manually because the calendar barely changes mid-season.
const GP_2026_CAL: Record<number, { name: string; country: string; date: string }> = {
  1: { name: "GP d'Australie", country: 'Australie', date: '2026-03-08' },
  2: { name: 'GP de Chine', country: 'Chine', date: '2026-03-15' },
  3: { name: 'GP du Japon', country: 'Japon', date: '2026-03-29' },
  4: { name: 'GP de Bahreïn', country: 'Bahreïn', date: '2026-04-12' },
  5: { name: "GP d'Arabie saoudite", country: 'Arabie saoudite', date: '2026-04-19' },
  6: { name: 'GP de Miami', country: 'États-Unis', date: '2026-05-03' },
  7: { name: 'GP du Canada', country: 'Canada', date: '2026-05-24' },
  8: { name: 'GP de Monaco', country: 'Monaco', date: '2026-06-07' },
  9: { name: "GP d'Espagne", country: 'Espagne', date: '2026-06-14' },
  10: { name: "GP d'Autriche", country: 'Autriche', date: '2026-06-28' },
  11: { name: 'GP de Grande-Bretagne', country: 'Royaume-Uni', date: '2026-07-05' },
  12: { name: 'GP de Belgique', country: 'Belgique', date: '2026-07-19' },
  13: { name: 'GP de Hongrie', country: 'Hongrie', date: '2026-07-26' },
  14: { name: 'GP des Pays-Bas', country: 'Pays-Bas', date: '2026-08-23' },
  15: { name: "GP d'Italie", country: 'Italie', date: '2026-09-06' },
  16: { name: 'GP de Madrid', country: 'Espagne', date: '2026-09-13' },
  17: { name: "GP d'Azerbaïdjan", country: 'Azerbaïdjan', date: '2026-09-27' },
  18: { name: 'GP de Singapour', country: 'Singapour', date: '2026-10-11' },
  19: { name: 'GP des États-Unis', country: 'États-Unis', date: '2026-10-25' },
  20: { name: 'GP de Mexico', country: 'Mexique', date: '2026-11-01' },
  21: { name: 'GP de São Paulo', country: 'Brésil', date: '2026-11-08' },
  22: { name: 'GP de Las Vegas', country: 'États-Unis', date: '2026-11-21' },
  23: { name: 'GP du Qatar', country: 'Qatar', date: '2026-11-29' },
  24: { name: 'GP d\'Abou Dabi', country: 'Émirats arabes unis', date: '2026-12-06' },
}

// ─────────────────────── Prompts ───────────────────────

const TEAM_FULL = `Tu es un journaliste F1 francophone. Pour l'écurie demandée, utilise web_search au moins UNE fois pour récupérer les chiffres 2026 actuels.

Règles strictes :
- web_search au moins une fois.
- Donnée introuvable → "N/A".
- Tout en FRANÇAIS, AUCUN markdown.

Réponds UNIQUEMENT par ce JSON :
{
  "fullName": "nom officiel complet",
  "shortName": "nom court",
  "nationality": "nationalité française",
  "base": "ville + pays",
  "foundedYear": "année (chiffre)",
  "championships": "titres constructeurs (chiffre)",
  "totalWins": "victoires totales (chiffre)",
  "totalPoles": "poles totales (chiffre)",
  "currentPosition": "classement 2026 (chiffre) ou N/A",
  "currentPoints": "points 2026 (chiffre) ou N/A",
  "seasonWins": "victoires 2026 (chiffre) ou N/A",
  "seasonPodiums": "podiums 2026 (chiffre) ou N/A",
  "seasonPoles": "poles 2026 (chiffre) ou N/A",
  "lastRaceGp": "nom du dernier GP couru 2026 (ex : GP d'Espagne) ou N/A",
  "lastRaceResults": "résultat des 2 pilotes au dernier GP, ex : 'Verstappen 1er · Lawson 8e' ou N/A",
  "carName": "désignation monoplace 2026",
  "engine": "moteur 2026",
  "specs": "1 phrase synthétique",
  "history": "3-4 PARAGRAPHES (séparés par \\\\n\\\\n) en français",
  "highlights": "2-3 phrases sur les moments marquants"
}`

const TEAM_PARTIAL = `Tu es un journaliste F1. Utilise web_search pour récupérer UNIQUEMENT les chiffres à jour 2026. Réponds par ce JSON :
{"championships":"…","totalWins":"…","totalPoles":"…","currentPosition":"… ou N/A","currentPoints":"… ou N/A","seasonWins":"… ou N/A","seasonPodiums":"… ou N/A","seasonPoles":"… ou N/A","lastRaceGp":"… ou N/A","lastRaceResults":"… ou N/A"}`

const DRIVER_FULL = `Tu es un journaliste F1 francophone. Pour le pilote demandé, utilise web_search au moins UNE fois pour récupérer les chiffres 2026 à jour.

Règles strictes :
- web_search au moins une fois.
- Donnée introuvable → "N/A".
- Tout en FRANÇAIS, AUCUN markdown.

Réponds UNIQUEMENT par ce JSON :
{
  "fullName": "nom complet",
  "birthDate": "YYYY-MM-DD",
  "birthPlace": "ville + pays",
  "nationality": "nationalité française",
  "number": "numéro de course 2026 (chiffre)",
  "team": "nom court de l'écurie 2026",
  "championships": "titres mondiaux (chiffre)",
  "wins": "victoires (chiffre)",
  "poles": "poles (chiffre)",
  "podiums": "podiums (chiffre)",
  "careerPoints": "points carrière F1 (chiffre)",
  "currentPosition": "classement pilotes 2026 (chiffre) ou N/A",
  "currentPoints": "points 2026 (chiffre) ou N/A",
  "seasonWins": "victoires 2026 (chiffre) ou N/A",
  "seasonPodiums": "podiums 2026 (chiffre) ou N/A",
  "seasonPoles": "poles 2026 (chiffre) ou N/A",
  "lastFiveGps": "[ {\\\\\"name\\\\\":\\\\\"GP d'Espagne\\\\\",\\\\\"position\\\\\":\\\\\"1\\\\\",\\\\\"points\\\\\":\\\\\"26\\\\\"} , … ] — tableau des 5 derniers GPs courus en 2026, du plus récent au plus ancien. position = chiffre brut ('1','2','DNF','N/A'). points = chiffre. Si moins de 5 GPs ont été courus, retourne ceux disponibles. Si aucun GP couru → [].",
  "bio": "3-4 PARAGRAPHES en français (séparés par \\\\n\\\\n) : enfance, karting, junior, F1",
  "highlights": "2-3 phrases sur les moments marquants",
  "drivingStyle": "2-3 phrases sur le style de pilotage"
}`

const DRIVER_PARTIAL = `Tu es un journaliste F1. Utilise web_search pour récupérer UNIQUEMENT les chiffres à jour. Réponds par ce JSON :
{"championships":"…","wins":"…","poles":"…","podiums":"…","careerPoints":"…","currentPosition":"… ou N/A","currentPoints":"… ou N/A","seasonWins":"… ou N/A","seasonPodiums":"… ou N/A","seasonPoles":"… ou N/A","lastFiveGps":[{"name":"…","position":"…","points":"…"}, …]}`

const RACE_FULL = `Tu es un journaliste F1 francophone. Pour le Grand Prix demandé (saison 2026, COURSE PASSÉE), utilise web_search au moins UNE fois pour récupérer les résultats officiels.

Règles strictes :
- web_search au moins une fois pour vérifier les résultats officiels FIA.
- Donnée introuvable → "N/A".
- Tout en FRANÇAIS, AUCUN markdown.

Réponds UNIQUEMENT par ce JSON :
{
  "podium": [
    {"driver":"Prénom Nom","team":"nom court écurie"},
    {"driver":"Prénom Nom","team":"nom court écurie"},
    {"driver":"Prénom Nom","team":"nom court écurie"}
  ],
  "pole": "Prénom Nom du poleman ou N/A",
  "fastestLap": {"driver":"Prénom Nom","time":"M:SS.mmm ou N/A"},
  "laps": "nombre de tours courus (chiffre)",
  "notableRetirement": "abandon notable si marquant (ex : 'Sainz, panne moteur au tour 12') ou N/A",
  "summary": "3 à 4 phrases en français : ce qui s'est passé, le moment clé, et si le résultat est attendu ou surprenant"
}`

// ─────────────────────── Helpers ───────────────────────

function extractJSON(text: string): Record<string, unknown> | null {
  const t = text.trim()
  try {
    return JSON.parse(t) as Record<string, unknown>
  } catch {
    /* try first {...} */
  }
  const m = t.match(/\{[\s\S]*\}/)
  if (m) {
    try {
      return JSON.parse(m[0]) as Record<string, unknown>
    } catch {
      /* fall through */
    }
  }
  return null
}

function stringify(v: unknown): string {
  if (v == null) return 'N/A'
  if (typeof v === 'string') return v.trim() || 'N/A'
  if (typeof v === 'number') return String(v)
  return 'N/A'
}

function normalize(raw: unknown, fields: string[]): Record<string, string> {
  const o = (raw ?? {}) as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const k of fields) out[k] = stringify(o[k])
  return out
}

// Driver data carries one structured field (lastFiveGps) alongside the
// scalar string fields. Kept as a separate normalisation so the JSONB
// column preserves the array shape end-to-end. The return type uses a
// `string | DriverGp[]` union for the value side because intersecting
// `Record<string, string>` with `{ lastFiveGps: DriverGp[] }` would
// require `lastFiveGps` to satisfy the string index signature too.
type DriverGp = { name: string; position: string; points: string }
function normalizeDriverFull(
  raw: unknown,
): Record<string, string | DriverGp[]> {
  const o = (raw ?? {}) as Record<string, unknown>
  const base = normalize(raw, DRIVER_FIELDS)
  const rawGps = Array.isArray(o.lastFiveGps) ? o.lastFiveGps : []
  const lastFiveGps: DriverGp[] = rawGps.slice(0, 5).map((g) => {
    const item = (g ?? {}) as Record<string, unknown>
    return {
      name: stringify(item.name),
      position: stringify(item.position),
      points: stringify(item.points),
    }
  })
  return { ...base, lastFiveGps }
}

type PodiumEntry = { position: 1 | 2 | 3; driver: string; team: string }
type RaceData = {
  podium: PodiumEntry[]
  pole: string
  fastestLap: { driver: string; time: string }
  laps: string
  notableRetirement: string
  summary: string
}
function normalizeRace(raw: unknown): RaceData {
  const o = (raw ?? {}) as Record<string, unknown>
  const rawPodium = Array.isArray(o.podium) ? o.podium : []
  const podium: PodiumEntry[] = rawPodium.slice(0, 3).map((p, i) => {
    const item = (p ?? {}) as Record<string, unknown>
    return {
      position: (i + 1) as 1 | 2 | 3,
      driver: stringify(item.driver),
      team: stringify(item.team),
    }
  })
  const flRaw = (o.fastestLap ?? {}) as Record<string, unknown>
  return {
    podium,
    pole: stringify(o.pole),
    fastestLap: {
      driver: stringify(flRaw.driver),
      time: stringify(flRaw.time),
    },
    laps: stringify(o.laps),
    notableRetirement: stringify(o.notableRetirement),
    summary: stringify(o.summary),
  }
}

async function callClaude(
  client: Anthropic,
  system: string,
  userMsg: string,
  maxTokens: number,
): Promise<Record<string, unknown> | null> {
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMsg }],
    tools: [
      // max_uses=2 is the sweet spot — gives Claude enough rope to
      // verify the live 2026 standings without ballooning the call
      // time past Vercel's 60 s function ceiling.
      { type: 'web_search_20250305', name: 'web_search', max_uses: 2 },
    ] as unknown as Anthropic.Messages.ToolUnion[],
  })
  const textBlocks = r.content.filter(
    (b): b is Anthropic.Messages.TextBlock => b.type === 'text',
  )
  const last = textBlocks[textBlocks.length - 1]
  return last ? extractJSON(last.text) : null
}

// Loose generics — overload inference on createClient broke after the
// supabase-js v2.45 generics refactor; we don't need schema typing here.
type Admin = SupabaseClient<any, any, any>

// ─────────────────────── DETAIL handlers ───────────────────────

async function handleDetail(
  req: VercelRequest,
  res: VercelResponse,
  type: 'team' | 'driver',
) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée.' })
    return
  }
  if (!SUPABASE_URL || !SERVICE_ROLE || !process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Service indisponible — réessaie plus tard.' })
    return
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  })
  const authH = req.headers.authorization || ''
  const token = authH.startsWith('Bearer ') ? authH.slice(7) : ''
  const { data: u } = token
    ? await admin.auth.getUser(token)
    : { data: { user: null } }
  if (!u?.user) {
    res.status(401).json({ error: 'Non autorisé. Reconnecte-toi.' })
    return
  }

  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  const slug = String((body as { slug?: string }).slug ?? '').toLowerCase()
  const dict = type === 'team' ? TEAM_SLUGS : DRIVER_SLUGS
  const fields = type === 'team' ? TEAM_FIELDS : DRIVER_FIELDS
  const table = type === 'team' ? 'f1_teams' : 'f1_drivers'
  const displayName = dict[slug]
  if (!slug || !displayName) {
    res
      .status(400)
      .json({ error: type === 'team' ? 'Écurie inconnue.' : 'Pilote inconnu.' })
    return
  }

  const { data: cached } = await admin
    .from(table)
    .select('data, generated_at')
    .eq('slug', slug)
    .maybeSingle()
  if (cached?.data && cached.generated_at) {
    const age = Date.now() - new Date(cached.generated_at as string).getTime()
    if (age < TTL_MS) {
      res.status(200).json({
        data: cached.data,
        cached: true,
        generated_at: cached.generated_at,
      })
      return
    }
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  try {
    const parsed = await callClaude(
      client,
      type === 'team' ? TEAM_FULL : DRIVER_FULL,
      type === 'team' ? `Écurie : ${displayName}.` : `Pilote : ${displayName}.`,
      3000,
    )
    if (!parsed) {
      console.error(`[f1 ${type}] parse failed`)
      if (cached?.data) {
        res.status(200).json({
          data: cached.data,
          cached: true,
          stale: true,
          generated_at: cached.generated_at,
        })
        return
      }
      res.status(502).json({ error: 'Fiche indisponible — réessaie plus tard.' })
      return
    }
    const data =
      type === 'driver' ? normalizeDriverFull(parsed) : normalize(parsed, fields)
    const generated_at = new Date().toISOString()
    await admin
      .from(table)
      .upsert({ slug, data, generated_at }, { onConflict: 'slug' })
    res.status(200).json({ data, cached: false, generated_at })
  } catch (e) {
    console.error(`[f1 ${type}] failed:`, e)
    if (cached?.data) {
      res.status(200).json({
        data: cached.data,
        cached: true,
        stale: true,
        generated_at: cached.generated_at,
      })
      return
    }
    res.status(500).json({ error: 'Fiche indisponible — réessaie plus tard.' })
  }
}

// ─────────────────────── RACE (per-round results) ───────────────────────

// Race results never change after the GP — once cached the row is
// permanent. The TTL only matters for the small window between race-end
// and first lazy fetch when a partial result may have slipped through;
// 24 h is a safety net so we re-query Claude if the previously cached
// payload happened to be missing the podium.
const RACE_RECENT_REFRESH_MS = 24 * 60 * 60 * 1000

function shouldRefreshRace(data: unknown, generatedAt: string | null): boolean {
  if (!data || typeof data !== 'object') return true
  const d = data as Partial<RaceData>
  // Re-fetch if the previous run came back without a usable podium.
  const podiumOk =
    Array.isArray(d.podium) &&
    d.podium.length === 3 &&
    d.podium[0]?.driver &&
    d.podium[0].driver !== 'N/A'
  if (podiumOk) return false
  if (!generatedAt) return true
  const age = Date.now() - new Date(generatedAt).getTime()
  return age > RACE_RECENT_REFRESH_MS
}

async function handleRace(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée.' })
    return
  }
  if (!SUPABASE_URL || !SERVICE_ROLE || !process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Service indisponible — réessaie plus tard.' })
    return
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  })
  const authH = req.headers.authorization || ''
  const token = authH.startsWith('Bearer ') ? authH.slice(7) : ''
  const { data: u } = token
    ? await admin.auth.getUser(token)
    : { data: { user: null } }
  if (!u?.user) {
    res.status(401).json({ error: 'Non autorisé. Reconnecte-toi.' })
    return
  }

  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  const round = Number((body as { round?: number }).round ?? 0)
  const gp = GP_2026_CAL[round]
  if (!round || !gp) {
    res.status(400).json({ error: 'Grand Prix inconnu.' })
    return
  }

  // Future GP → no results yet. We tell the client explicitly so it
  // skips the section entirely instead of showing an empty card.
  const gpDate = new Date(`${gp.date}T23:59:59Z`).getTime()
  if (Number.isFinite(gpDate) && gpDate > Date.now()) {
    res.status(200).json({ status: 'upcoming' })
    return
  }

  const { data: cached } = await admin
    .from('f1_race_results')
    .select('data, generated_at')
    .eq('round', round)
    .maybeSingle()

  if (cached?.data && !shouldRefreshRace(cached.data, cached.generated_at as string)) {
    res.status(200).json({
      status: 'past',
      data: cached.data as RaceData,
      cached: true,
      generated_at: cached.generated_at,
    })
    return
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  try {
    const parsed = await callClaude(
      client,
      RACE_FULL,
      `Grand Prix : ${gp.name} (${gp.country}), course du ${gp.date} — saison F1 2026, manche ${round}. Cherche les résultats officiels.`,
      2000,
    )
    if (!parsed) {
      console.error(`[f1 race ${round}] parse failed`)
      if (cached?.data) {
        res.status(200).json({
          status: 'past',
          data: cached.data as RaceData,
          cached: true,
          stale: true,
          generated_at: cached.generated_at,
        })
        return
      }
      res.status(502).json({ error: 'Résultats indisponibles — réessaie plus tard.' })
      return
    }
    const data = normalizeRace(parsed)
    const generated_at = new Date().toISOString()
    await admin
      .from('f1_race_results')
      .upsert({ round, data, generated_at }, { onConflict: 'round' })
    res
      .status(200)
      .json({ status: 'past', data, cached: false, generated_at })
  } catch (e) {
    console.error(`[f1 race ${round}] failed:`, e)
    if (cached?.data) {
      res.status(200).json({
        status: 'past',
        data: cached.data as RaceData,
        cached: true,
        stale: true,
        generated_at: cached.generated_at,
      })
      return
    }
    res.status(500).json({ error: 'Résultats indisponibles — réessaie plus tard.' })
  }
}

// ─────────────────────── REFRESH (cron) ───────────────────────

// Tier-2 has both an RPM limit (50/min) and an INPUT TOKEN limit
// (30 000 /min). Each web_search-enabled call inflates the input token
// count past expectations because Claude appends the tool-call results.
// 4 in parallel keeps us comfortably under 30 k / min even when the
// driver prompts (with lastFiveGps) come back heavy.
const BATCH = 4

async function refreshEntity(
  client: Anthropic,
  admin: Admin,
  table: 'f1_teams' | 'f1_drivers',
  slug: string,
  displayName: string,
  isTeam: boolean,
): Promise<string> {
  try {
  const { data: existing } = await admin
    .from(table)
    .select('data')
    .eq('slug', slug)
    .maybeSingle()

  if (!existing?.data) {
    const parsed = await callClaude(
      client,
      isTeam ? TEAM_FULL : DRIVER_FULL,
      isTeam ? `Écurie : ${displayName}.` : `Pilote : ${displayName}.`,
      3000,
    )
    if (!parsed) return 'failed:no-parse'
    const data = isTeam
      ? normalize(parsed, TEAM_FIELDS)
      : normalizeDriverFull(parsed)
    await admin
      .from(table)
      .upsert(
        { slug, data, generated_at: new Date().toISOString() },
        { onConflict: 'slug' },
      )
    return 'created'
  }

  const parsed = await callClaude(
    client,
    isTeam ? TEAM_PARTIAL : DRIVER_PARTIAL,
    isTeam ? `Écurie : ${displayName}.` : `Pilote : ${displayName}.`,
    1200,
  )
  if (!parsed) return 'failed:no-parse'
  const merged = { ...(existing.data as Record<string, unknown>) }
  // Scalar fields that the partial prompt is responsible for refreshing.
  const numericKeys = isTeam
    ? [
        'championships', 'totalWins', 'totalPoles',
        'currentPosition', 'currentPoints',
        'seasonWins', 'seasonPodiums', 'seasonPoles',
        'lastRaceGp', 'lastRaceResults',
      ]
    : [
        'championships', 'wins', 'poles', 'podiums', 'careerPoints',
        'currentPosition', 'currentPoints',
        'seasonWins', 'seasonPodiums', 'seasonPoles',
      ]
  for (const k of numericKeys) merged[k] = stringify(parsed[k])
  // Driver also carries the structured lastFiveGps array. Keep prior
  // value if the partial response didn't include it.
  if (!isTeam && Array.isArray(parsed.lastFiveGps)) {
    merged.lastFiveGps = parsed.lastFiveGps.slice(0, 5).map((g: unknown) => {
      const item = (g ?? {}) as Record<string, unknown>
      return {
        name: stringify(item.name),
        position: stringify(item.position),
        points: stringify(item.points),
      }
    })
  }
  await admin
    .from(table)
    .upsert(
      { slug, data: merged, generated_at: new Date().toISOString() },
      { onConflict: 'slug' },
    )
  return 'partial'
  } catch (e) {
    const msg =
      e instanceof Error
        ? `${e.name}: ${e.message}`
        : typeof e === 'string'
          ? e
          : 'unknown'
    console.error(`[f1 refresh ${slug}] ${msg}`)
    return `failed:${msg}`.slice(0, 240)
  }
}

async function handleRefresh(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET
  const isAuthed =
    !cronSecret || req.headers.authorization === `Bearer ${cronSecret}`
  if (!isAuthed) {
    res.status(401).json({ error: 'Non autorisé.' })
    return
  }
  if (!SUPABASE_URL || !SERVICE_ROLE || !process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Service indisponible.' })
    return
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  })
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const only = String(req.query.only ?? '')
  const doTeams = only !== 'drivers'
  const doDrivers = only !== 'teams'
  // Optional slice= splits each list in N parts so a single HTTP
  // call can stay within the 60s Vercel function ceiling even when
  // Claude+web_search calls run long. `slice=1of2` processes the
  // first half of the list, `slice=2of2` the second, etc.
  const sliceRaw = String(req.query.slice ?? '')
  const sliceMatch = sliceRaw.match(/^(\d+)of(\d+)$/)
  const sliceIdx = sliceMatch ? parseInt(sliceMatch[1], 10) - 1 : 0
  const sliceN = sliceMatch ? parseInt(sliceMatch[2], 10) : 1
  function pickSlice<T>(arr: T[]): T[] {
    if (sliceN <= 1) return arr
    const size = Math.ceil(arr.length / sliceN)
    return arr.slice(sliceIdx * size, (sliceIdx + 1) * size)
  }

  const teamResults: Record<string, string> = {}
  const driverResults: Record<string, string> = {}

  if (doTeams) {
    const entries = pickSlice(Object.entries(TEAM_SLUGS))
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH)
      const out = await Promise.allSettled(
        batch.map(([slug, name]) =>
          refreshEntity(client, admin, 'f1_teams', slug, name, true),
        ),
      )
      out.forEach((r, idx) => {
        teamResults[batch[idx][0]] =
          r.status === 'fulfilled' ? r.value : 'failed'
      })
    }
  }
  if (doDrivers) {
    const entries = pickSlice(Object.entries(DRIVER_SLUGS))
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH)
      const out = await Promise.allSettled(
        batch.map(([slug, name]) =>
          refreshEntity(client, admin, 'f1_drivers', slug, name, false),
        ),
      )
      out.forEach((r, idx) => {
        driverResults[batch[idx][0]] =
          r.status === 'fulfilled' ? r.value : 'failed'
      })
    }
  }

  res.status(200).json({ teams: teamResults, drivers: driverResults })
}

// ─────────────────────── Dispatch ───────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.query.refresh === '1') return handleRefresh(req, res)
  const type = String(req.query.type ?? '')
  if (type === 'team') return handleDetail(req, res, 'team')
  if (type === 'driver') return handleDetail(req, res, 'driver')
  if (type === 'race') return handleRace(req, res)
  res
    .status(400)
    .json({ error: 'Type invalide (team | driver | race | refresh).' })
}
