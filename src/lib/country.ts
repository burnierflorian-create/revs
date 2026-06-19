// Detect the user's country as a French display name, for the "Mon Pays"
// leaderboard scope. Cheap + offline (browser locale region); defaults to
// France — the app's home market. Persisted onto the profile so the
// country_leaderboard can group users.

const REGION_TO_COUNTRY: Record<string, string> = {
  FR: 'France',
  BE: 'Belgique',
  CH: 'Suisse',
  CA: 'Canada',
  LU: 'Luxembourg',
  MC: 'Monaco',
  DE: 'Allemagne',
  IT: 'Italie',
  ES: 'Espagne',
  GB: 'Royaume-Uni',
  IE: 'Irlande',
  US: 'États-Unis',
  PT: 'Portugal',
  NL: 'Pays-Bas',
  MA: 'Maroc',
  TN: 'Tunisie',
  DZ: 'Algérie',
  SN: 'Sénégal',
  CI: "Côte d'Ivoire",
}

const FLAG_BY_COUNTRY: Record<string, string> = {
  France: '🇫🇷',
  Belgique: '🇧🇪',
  Suisse: '🇨🇭',
  Canada: '🇨🇦',
  Luxembourg: '🇱🇺',
  Monaco: '🇲🇨',
  Allemagne: '🇩🇪',
  Italie: '🇮🇹',
  Espagne: '🇪🇸',
  'Royaume-Uni': '🇬🇧',
  Irlande: '🇮🇪',
  'États-Unis': '🇺🇸',
  Portugal: '🇵🇹',
  'Pays-Bas': '🇳🇱',
  Maroc: '🇲🇦',
  Tunisie: '🇹🇳',
  Algérie: '🇩🇿',
  Sénégal: '🇸🇳',
  "Côte d'Ivoire": '🇨🇮',
}

export function detectCountry(): string {
  try {
    const langs = [navigator.language, ...(navigator.languages ?? [])]
    for (const l of langs) {
      const region = l?.split('-')[1]?.toUpperCase()
      if (region && REGION_TO_COUNTRY[region]) return REGION_TO_COUNTRY[region]
    }
  } catch {
    /* navigator unavailable */
  }
  return 'France'
}

export function countryFlag(country: string | null | undefined): string {
  return (country && FLAG_BY_COUNTRY[country]) || '🌍'
}

// All known countries (French names) — for the signup country dropdown.
export const COUNTRY_NAMES: string[] = Object.values(REGION_TO_COUNTRY).sort(
  (a, b) => a.localeCompare(b, 'fr'),
)

/** Reverse-geocode a GPS point to { city, country } via the Mapbox
 *  Geocoding API. Country is normalised to the app's French names when
 *  the ISO code is known, else the Mapbox label is used. Returns null on
 *  any failure (no token, network, no result) — callers fall back to
 *  manual entry. */
export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<{ city: string; country: string } | null> {
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
  if (!token) return null
  try {
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` +
      `?types=place&language=fr&limit=1&access_token=${token}`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = (await res.json()) as {
      features?: {
        text?: string
        context?: { id?: string; short_code?: string; text?: string }[]
      }[]
    }
    const f = json.features?.[0]
    if (!f) return null
    const city = (f.text ?? '').trim()
    const ctx = f.context ?? []
    const countryCtx = ctx.find((c) => (c.id ?? '').startsWith('country'))
    const iso = countryCtx?.short_code?.toUpperCase()
    const country =
      (iso && REGION_TO_COUNTRY[iso]) || countryCtx?.text || detectCountry()
    if (!city) return null
    return { city, country }
  } catch {
    return null
  }
}
