// Static factual catalogue of 2026 F1 teams and drivers. Slugs are
// stable URL identifiers (used in /f1-team/:slug and /f1-driver/:slug
// AND as PKs in the f1_teams / f1_drivers Supabase tables — never
// rename one without a DB migration).
//
// All editorial content (team history, driver bios, palmares,
// anecdotes, current championship positions) is generated at runtime
// by Claude via web_search and cached in the DB. This file only
// carries the bare factual fields needed to render the list grids
// and to seed the API calls.

export type F1TeamSlug =
  | 'red-bull'
  | 'ferrari'
  | 'mercedes'
  | 'mclaren'
  | 'aston-martin'
  | 'alpine'
  | 'williams'
  | 'haas'
  | 'racing-bulls'
  | 'sauber'

export type F1Team = {
  slug: F1TeamSlug
  name: string // marketing name used on the grid card
  fullName: string // formal entry name (used in API prompts)
  color: string // primary livery color (hex)
  // Optional CDN logo URL — left undefined when no stable source is
  // known; the component falls back to a team-color wordmark.
  logo?: string
  // Optional Wikimedia URL for the 2026 car shot, displayed as the
  // grid card background (proxied via /api/image-proxy at render).
  carPhoto?: string
  // Lowercased substrings used to match a news article to the team
  // (title or summary). Multiple variants for naming drift.
  match: string[]
}

export type F1DriverSlug =
  | 'verstappen'
  | 'lawson'
  | 'leclerc'
  | 'hamilton'
  | 'russell'
  | 'antonelli'
  | 'norris'
  | 'piastri'
  | 'alonso'
  | 'stroll'
  | 'gasly'
  | 'doohan'
  | 'albon'
  | 'sainz'
  | 'hulkenberg'
  | 'bearman'
  | 'ocon'
  | 'tsunoda'
  | 'bortoleto'
  | 'hadjar'

export type F1Driver = {
  slug: F1DriverSlug
  name: string // "Max Verstappen"
  // Race number when stable / well-known; left null when uncertain
  // (Claude verifies via web_search and the API stores the truth).
  number: number | null
  // ISO 3166-1 alpha-2 country code, drives the flag emoji.
  country: string
  team: F1TeamSlug
  // Optional photo URL. When undefined, the detail page renders an
  // initials portrait on the team's livery colour.
  photo?: string
  match: string[]
}

// Wikipedia hosts driver portraits AND car shots on
// `commons/thumb/...`. Centralised here so both arrays can share it.
const WPT = 'https://upload.wikimedia.org/wikipedia/commons/thumb'

// Team-car shot URLs sourced from the Wikipedia MediaWiki API
// (action=query&prop=pageimages) — these are the canonical Wikipedia
// infobox images for each 2025-2026 chassis page. Hot-linked through
// /api/image-proxy at render time to dodge any browser-side blockers.
export const F1_TEAMS: F1Team[] = [
  {
    slug: 'red-bull',
    name: 'Red Bull Racing',
    fullName: 'Oracle Red Bull Racing',
    color: '#1E3A8A',
    match: ['red bull', 'redbull'],
    carPhoto: `${WPT}/0/0d/FIA_F1_Austria_2025_Nr._1_Verstappen.jpg/500px-FIA_F1_Austria_2025_Nr._1_Verstappen.jpg`,
  },
  {
    slug: 'ferrari',
    name: 'Ferrari',
    fullName: 'Scuderia Ferrari HP',
    color: '#DC0000',
    match: ['ferrari', 'scuderia'],
    carPhoto: `${WPT}/b/b8/2025_Japan_GP_-_Ferrari_-_Lewis_Hamilton_-_FP1.jpg/500px-2025_Japan_GP_-_Ferrari_-_Lewis_Hamilton_-_FP1.jpg`,
  },
  {
    slug: 'mercedes',
    name: 'Mercedes',
    fullName: 'Mercedes-AMG Petronas F1 Team',
    color: '#00D2BE',
    match: ['mercedes', 'merc', 'amg petronas'],
    carPhoto: `${WPT}/d/d9/2025_Japan_GP_-_Mercedes_-_Kimi_Antonelli_-_FP2.jpg/500px-2025_Japan_GP_-_Mercedes_-_Kimi_Antonelli_-_FP2.jpg`,
  },
  {
    slug: 'mclaren',
    name: 'McLaren',
    fullName: 'McLaren F1 Team',
    color: '#FF8000',
    match: ['mclaren'],
    carPhoto: `${WPT}/6/64/2025_Japan_GP_-_McLaren_-_Lando_Norris_-_FP1.jpg/500px-2025_Japan_GP_-_McLaren_-_Lando_Norris_-_FP1.jpg`,
  },
  {
    slug: 'aston-martin',
    name: 'Aston Martin',
    fullName: 'Aston Martin Aramco F1 Team',
    color: '#006F62',
    match: ['aston'],
    carPhoto: `${WPT}/3/33/2025_Japan_GP_-_Aston_Martin_-_Fernando_Alonso_-_FP1.jpg/500px-2025_Japan_GP_-_Aston_Martin_-_Fernando_Alonso_-_FP1.jpg`,
  },
  {
    slug: 'alpine',
    name: 'Alpine',
    fullName: 'BWT Alpine F1 Team',
    color: '#0090FF',
    match: ['alpine'],
    carPhoto: `${WPT}/a/ae/FIA_F1_Austria_2025_Nr._10_Gasly.jpg/500px-FIA_F1_Austria_2025_Nr._10_Gasly.jpg`,
  },
  {
    slug: 'williams',
    name: 'Williams',
    fullName: 'Atlassian Williams Racing',
    color: '#005AFF',
    match: ['williams'],
    carPhoto: `${WPT}/2/2e/2025_Japan_GP_-_Williams_-_Carlos_Sainz_-_FP1.jpg/500px-2025_Japan_GP_-_Williams_-_Carlos_Sainz_-_FP1.jpg`,
  },
  {
    slug: 'haas',
    name: 'Haas',
    fullName: 'MoneyGram Haas F1 Team',
    color: '#B6BABD',
    match: ['haas'],
    carPhoto: `${WPT}/f/f8/FIA_F1_Austria_2025_Nr._87_Bearman.jpg/500px-FIA_F1_Austria_2025_Nr._87_Bearman.jpg`,
  },
  {
    slug: 'racing-bulls',
    name: 'Racing Bulls',
    fullName: 'Visa Cash App Racing Bulls F1 Team',
    color: '#2B4562',
    match: ['racing bulls', 'visa cash app', 'rb f1', 'alphatauri'],
    carPhoto: `${WPT}/b/b1/2025_Japan_GP_-_Racing_Bulls_-_Liam_Lawson_-_FP2.jpg/500px-2025_Japan_GP_-_Racing_Bulls_-_Liam_Lawson_-_FP2.jpg`,
  },
  {
    slug: 'sauber',
    name: 'Kick Sauber',
    fullName: 'Stake F1 Team Kick Sauber',
    color: '#52E252',
    match: ['sauber', 'kick', 'stake'],
    carPhoto: `${WPT}/9/9e/2025_Japan_GP_-_Sauber_-_Nico_Hulkenberg_-_FP1.jpg/500px-2025_Japan_GP_-_Sauber_-_Nico_Hulkenberg_-_FP1.jpg`,
  },
]

export const F1_DRIVERS: F1Driver[] = [
  // Red Bull
  { slug: 'verstappen',  name: 'Max Verstappen',         number: 1,    country: 'NL', team: 'red-bull',    match: ['verstappen'],
    photo: `${WPT}/5/52/2024-08-25_Motorsport%2C_Formel_1%2C_Gro%C3%9Fer_Preis_der_Niederlande_2024_STP_3973_by_Stepro_%28medium_crop%29.jpg/500px-2024-08-25_Motorsport%2C_Formel_1%2C_Gro%C3%9Fer_Preis_der_Niederlande_2024_STP_3973_by_Stepro_%28medium_crop%29.jpg` },
  { slug: 'lawson',      name: 'Liam Lawson',            number: 30,   country: 'NZ', team: 'red-bull',    match: ['lawson'],
    photo: `${WPT}/5/53/Liam_Lawson_at_the_Red_Bull_Fan_Zone_%E2%80%93_Crown_Riverwalk%2C_Melbourne_%28028A7793%29.jpg/500px-Liam_Lawson_at_the_Red_Bull_Fan_Zone_%E2%80%93_Crown_Riverwalk%2C_Melbourne_%28028A7793%29.jpg` },
  // Ferrari
  { slug: 'leclerc',     name: 'Charles Leclerc',        number: 16,   country: 'MC', team: 'ferrari',     match: ['leclerc'],
    photo: `${WPT}/7/7b/2024-08-25_Motorsport%2C_Formel_1%2C_Gro%C3%9Fer_Preis_der_Niederlande_2024_STP_3978_by_Stepro_%28cropped2%29.jpg/500px-2024-08-25_Motorsport%2C_Formel_1%2C_Gro%C3%9Fer_Preis_der_Niederlande_2024_STP_3978_by_Stepro_%28cropped2%29.jpg` },
  { slug: 'hamilton',    name: 'Lewis Hamilton',         number: 44,   country: 'GB', team: 'ferrari',     match: ['hamilton'],
    photo: `${WPT}/d/d3/Prime_Minister_Keir_Starmer_meets_Sir_Lewis_Hamilton_%2854566928382%29_%28cropped%29.jpg/500px-Prime_Minister_Keir_Starmer_meets_Sir_Lewis_Hamilton_%2854566928382%29_%28cropped%29.jpg` },
  // Mercedes
  { slug: 'russell',     name: 'George Russell',         number: 63,   country: 'GB', team: 'mercedes',    match: ['russell'],
    photo: `${WPT}/7/7f/KingsLeonSilverstne040724_%2828_of_112%29_%2853838006028%29_%28cropped%29.jpg/500px-KingsLeonSilverstne040724_%2828_of_112%29_%2853838006028%29_%28cropped%29.jpg` },
  { slug: 'antonelli',   name: 'Andrea Kimi Antonelli',  number: 12,   country: 'IT', team: 'mercedes',    match: ['antonelli'],
    photo: `${WPT}/f/f3/Kimi_Antonelli_at_the_2025_US_Grand_Prix_in_Austin%2C_TX_%28cropped%29.jpg/500px-Kimi_Antonelli_at_the_2025_US_Grand_Prix_in_Austin%2C_TX_%28cropped%29.jpg` },
  // McLaren
  { slug: 'norris',      name: 'Lando Norris',           number: 4,    country: 'GB', team: 'mclaren',     match: ['norris'],
    photo: `${WPT}/9/90/2024-08-25_Motorsport%2C_Formel_1%2C_Gro%C3%9Fer_Preis_der_Niederlande_2024_STP_3968_by_Stepro_%28cropped2%29.jpg/500px-2024-08-25_Motorsport%2C_Formel_1%2C_Gro%C3%9Fer_Preis_der_Niederlande_2024_STP_3968_by_Stepro_%28cropped2%29.jpg` },
  { slug: 'piastri',     name: 'Oscar Piastri',          number: 81,   country: 'AU', team: 'mclaren',     match: ['piastri'],
    photo: `${WPT}/e/e5/2026_Chinese_GP_-_Oscar_Piastri_%28cropped%29_%28cropped%29.jpg/500px-2026_Chinese_GP_-_Oscar_Piastri_%28cropped%29_%28cropped%29.jpg` },
  // Aston Martin
  { slug: 'alonso',      name: 'Fernando Alonso',        number: 14,   country: 'ES', team: 'aston-martin', match: ['alonso'],
    photo: `${WPT}/9/97/Alonso-68_%2824710447098%29.jpg/500px-Alonso-68_%2824710447098%29.jpg` },
  { slug: 'stroll',      name: 'Lance Stroll',           number: 18,   country: 'CA', team: 'aston-martin', match: ['stroll'],
    photo: `${WPT}/4/4e/2025_Japan_GP_-_Aston_Martin_-_Lance_Stroll_-_Fanzone_Stage_%28cropped%29.jpg/500px-2025_Japan_GP_-_Aston_Martin_-_Lance_Stroll_-_Fanzone_Stage_%28cropped%29.jpg` },
  // Alpine
  { slug: 'gasly',       name: 'Pierre Gasly',           number: 10,   country: 'FR', team: 'alpine',      match: ['gasly'],
    photo: `${WPT}/f/fd/2022_French_Grand_Prix_%2852279065728%29_%28midcrop%29.png/500px-2022_French_Grand_Prix_%2852279065728%29_%28midcrop%29.png` },
  { slug: 'doohan',      name: 'Jack Doohan',            number: 7,    country: 'AU', team: 'alpine',      match: ['doohan'],
    photo: `${WPT}/4/42/Jack_Doohan_2023.jpg/500px-Jack_Doohan_2023.jpg` },
  // Williams
  { slug: 'albon',       name: 'Alexander Albon',        number: 23,   country: 'TH', team: 'williams',    match: ['albon'],
    photo: `${WPT}/c/c1/Alex_Albon_%28cropped%29.jpg/500px-Alex_Albon_%28cropped%29.jpg` },
  { slug: 'sainz',       name: 'Carlos Sainz',           number: 55,   country: 'ES', team: 'williams',    match: ['sainz'],
    photo: `${WPT}/c/ce/Formula1Gabelhofen2022_%2804%29_%28cropped2%29.jpg/500px-Formula1Gabelhofen2022_%2804%29_%28cropped2%29.jpg` },
  // Haas
  { slug: 'hulkenberg',  name: 'Nico Hülkenberg',        number: 27,   country: 'DE', team: 'haas',        match: ['hülkenberg', 'hulkenberg'],
    photo: `${WPT}/d/de/2019_Formula_One_tests_Barcelona%2C_Hulkenberg_%2840287128313%29.jpg/500px-2019_Formula_One_tests_Barcelona%2C_Hulkenberg_%2840287128313%29.jpg` },
  { slug: 'bearman',     name: 'Oliver Bearman',         number: 87,   country: 'GB', team: 'haas',        match: ['bearman'],
    photo: `${WPT}/9/9a/2025_Japan_GP_-_Haas_-_Oliver_Bearman_-_Thursday_%28cropped%29.jpg/500px-2025_Japan_GP_-_Haas_-_Oliver_Bearman_-_Thursday_%28cropped%29.jpg` },
  // Racing Bulls
  { slug: 'ocon',        name: 'Esteban Ocon',           number: 31,   country: 'FR', team: 'racing-bulls', match: ['ocon'],
    photo: `${WPT}/2/2e/Esteban_Ocon_2024_Suzuka_%28cropped%29.jpg/500px-Esteban_Ocon_2024_Suzuka_%28cropped%29.jpg` },
  { slug: 'tsunoda',     name: 'Yuki Tsunoda',           number: 22,   country: 'JP', team: 'racing-bulls', match: ['tsunoda'],
    photo: `${WPT}/a/a0/Yuki_Tsunoda_at_the_Melbourne_Walk_during_the_2026_Australian_Grand_Prix_%28028A8096%29.jpg/500px-Yuki_Tsunoda_at_the_Melbourne_Walk_during_the_2026_Australian_Grand_Prix_%28028A8096%29.jpg` },
  // Sauber
  { slug: 'hadjar',      name: 'Isack Hadjar',           number: null, country: 'FR', team: 'sauber',      match: ['hadjar'],
    photo: `${WPT}/7/75/Isack_Hadjar_at_the_Melbourne_Walk_during_the_2026_Australian_Grand_Prix_%28028A8753%29_%28cropped%29.jpg/500px-Isack_Hadjar_at_the_Melbourne_Walk_during_the_2026_Australian_Grand_Prix_%28028A8753%29_%28cropped%29.jpg` },
  { slug: 'bortoleto',   name: 'Gabriel Bortoleto',      number: null, country: 'BR', team: 'sauber',      match: ['bortoleto'],
    photo: `${WPT}/f/fe/Gabriel_Bortoleto_%28cropped%29.jpg/500px-Gabriel_Bortoleto_%28cropped%29.jpg` },
]

const TEAM_BY_SLUG = new Map(F1_TEAMS.map((t) => [t.slug, t]))
const DRIVER_BY_SLUG = new Map(F1_DRIVERS.map((d) => [d.slug, d]))

export function getF1Team(slug: string | undefined): F1Team | undefined {
  return slug ? TEAM_BY_SLUG.get(slug as F1TeamSlug) : undefined
}
export function getF1Driver(slug: string | undefined): F1Driver | undefined {
  return slug ? DRIVER_BY_SLUG.get(slug as F1DriverSlug) : undefined
}
export function driversByTeam(teamSlug: F1TeamSlug): F1Driver[] {
  return F1_DRIVERS.filter((d) => d.team === teamSlug)
}

// ISO alpha-2 country code → flag emoji (regional indicator letters).
export function flagEmoji(country: string): string {
  if (!country || country.length !== 2) return '🏁'
  const A = 0x1f1e6 - 0x41
  return String.fromCodePoint(
    A + country.toUpperCase().charCodeAt(0),
    A + country.toUpperCase().charCodeAt(1),
  )
}

// Same family of nationality labels used in driver bios — country
// code → French nationality. Falls back to the code when unknown.
export function nationality(country: string): string {
  const map: Record<string, string> = {
    NL: 'Néerlandais',
    NZ: 'Néo-Zélandais',
    MC: 'Monégasque',
    GB: 'Britannique',
    IT: 'Italien',
    AU: 'Australien',
    ES: 'Espagnol',
    CA: 'Canadien',
    FR: 'Français',
    TH: 'Thaïlandais',
    DE: 'Allemand',
    JP: 'Japonais',
    BR: 'Brésilien',
  }
  return map[country.toUpperCase()] ?? country
}

// Build a Postgrest .or() expression that matches a free-text column
// against every alias for a team/driver. Used to filter the `news`
// table on the detail pages.
export function newsIlikeOr(column: string, patterns: string[]): string {
  return patterns
    .map((p) => `${column}.ilike.%${p.replace(/,/g, '')}%`)
    .join(',')
}

// Route an external image URL through /api/image-proxy. Bypasses any
// CORS / referer / regional quirks that prevent the browser from
// loading Wikimedia thumbnails directly, AND lets the Vercel edge
// cache the bytes for 24 h so the same image only hits Wikimedia
// once per day.
export function proxyImage(url: string | undefined): string | undefined {
  if (!url) return undefined
  return `/api/image-proxy?url=${encodeURIComponent(url)}`
}

// Look up a driver by their full display name. Returns undefined if no
// catalogue entry matches — used by features that get a driver name
// back from Claude (race results, last-five-GPs) and want to enrich
// the row with a portrait or a profile link.
export function findDriverByName(name: string): F1Driver | undefined {
  if (!name) return undefined
  const needle = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  return F1_DRIVERS.find((d) => {
    const hay = d.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
    if (hay === needle) return true
    // Fall back to a last-name match so "Verstappen" alone still finds
    // the row even when the API gives "Max Verstappen".
    const lastName = hay.split(' ').pop() ?? ''
    return needle === lastName || needle.includes(lastName)
  })
}

// Extract the leading integer from a stat string returned by Claude.
// Some fields (championships, totalWins, …) sometimes come back as
// "8 (Constructeurs : 2014, 2016…)" — we want to surface the number
// prominently and keep the parenthetical context as a secondary line.
export function splitStatValue(raw: string | undefined): {
  number: string
  extra?: string
} {
  if (!raw || raw === 'N/A') return { number: '—' }
  const m = raw.trim().match(/^(\d+(?:[\s,. ]\d+)*)\s*[—:\-(]*\s*(.*)$/s)
  if (!m) return { number: raw.trim() }
  const number = m[1].replace(/[\s, ]/g, '')
  const extra = m[2]
    .replace(/\s*\)\s*$/, '')
    .trim()
  return { number, extra: extra || undefined }
}

// French thousands-separated formatting for stat values. "5018.5" →
// "5 018,5", "12345" → "12 345". Returns the input untouched when it
// isn't a parseable number (e.g. when Claude already returned text).
export function formatStatNumber(value: string): string {
  if (!value || value === '—' || value === 'N/A') return value || '—'
  const compact = value.replace(/[\s,]/g, '').replace(',', '.')
  const n = parseFloat(compact)
  if (!Number.isFinite(n)) return value
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n)
}

// Tailwind font-size class scaled to rendered length. The stat cards
// share a fixed 112px height — past 4 characters we step the font down
// in 4-px increments so even "5 018,5" or "12 345" fits cleanly.
export function adaptiveStatSize(value: string): string {
  const len = value.length
  if (len <= 4) return 'text-[32px]'
  if (len <= 6) return 'text-[26px]'
  if (len <= 8) return 'text-[22px]'
  return 'text-[18px]'
}
