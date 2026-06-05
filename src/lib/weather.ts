// Real weather for the "Météo des Supercars" home module. Uses
// Open-Meteo — keyless, CORS-enabled, no account — so we can resolve a
// city name to coordinates and read the current conditions entirely
// client-side without touching our Supabase budget or shipping an API
// key. Two hops:
//   1) geocoding-api.open-meteo.com  — ville -> lat/lon
//   2) api.open-meteo.com/forecast   — lat/lon -> current code + temp
//
// The output is intentionally binary: a supercar "sortie index" with
// only two states (optimal / humide), because that's the single
// decision the spotter cares about — is it worth going out today.

export type SupercarWeather = {
  tempC: number
  condition: 'optimal' | 'humide'
  /** Short headline, e.g. "Conditions Optimales" / "Temps Humide". */
  headline: string
  /** One-line guidance shown under the headline. */
  detail: string
  /** Resolved display city (may differ in casing from the input). */
  city: string
}

// WMO weather interpretation codes (Open-Meteo `current.weather_code`):
//   0 clear · 1-3 mainly clear → overcast · 45/48 fog · 51-57 drizzle
//   61-67 rain · 71-77 snow · 80-86 showers · 95-99 thunderstorm.
// We treat everything dry (code < 45) as a green light for supercars,
// and anything fog/precip (code >= 45) as a wet day → spots abrités.
function isDry(code: number): boolean {
  return code < 45
}

// Module-scope cache so revisiting the Home tab (or the Map sheet later)
// doesn't refire the two requests. Keyed by city + calendar day — the
// outing index only needs to move once a day.
const cache = new Map<string, SupercarWeather>()
function dayKey(ville: string): string {
  return `${ville.trim().toLowerCase()}|${new Date().toISOString().slice(0, 10)}`
}

type GeoHit = { latitude: number; longitude: number; name: string }

async function geocode(ville: string): Promise<GeoHit | null> {
  const url =
    'https://geocoding-api.open-meteo.com/v1/search?count=1&language=fr&format=json&name=' +
    encodeURIComponent(ville.trim())
  const res = await fetch(url)
  if (!res.ok) return null
  const json = (await res.json()) as { results?: GeoHit[] }
  return json.results?.[0] ?? null
}

/** Resolve the current supercar-outing weather for a city. Returns null
 *  on any failure (unknown city, network error) so callers can simply
 *  hide the module rather than show stale or fake data. */
export async function fetchSupercarWeather(
  ville: string,
): Promise<SupercarWeather | null> {
  const key = dayKey(ville)
  const hit = cache.get(key)
  if (hit) return hit

  try {
    const geo = await geocode(ville)
    if (!geo) return null

    const url =
      'https://api.open-meteo.com/v1/forecast?current=temperature_2m,weather_code' +
      `&latitude=${geo.latitude}&longitude=${geo.longitude}`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number }
    }
    const code = json.current?.weather_code ?? 0
    const tempC = Math.round(json.current?.temperature_2m ?? 0)
    const dry = isDry(code)

    const out: SupercarWeather = {
      tempC,
      condition: dry ? 'optimal' : 'humide',
      headline: dry ? 'Conditions Optimales' : 'Temps Humide',
      detail: dry
        ? 'Les supercars sortent aujourd’hui'
        : 'Sorties limitées · privilégier les spots abrités',
      city: geo.name,
    }
    cache.set(key, out)
    return out
  } catch {
    return null
  }
}
