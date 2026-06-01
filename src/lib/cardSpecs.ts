import { supabase } from './supabase'

export type CardSpecs = {
  horsepower: string
  zero_to_100: string
  top_speed: string
  torque: string
  /** Engine layout + drivetrain in a single ultra-short label.
   *  Examples: "V8 BiTurbo / Transm. Intégrale",
   *            "Moteur Central Arrière / Propulsion".
   *  Surfaced as a mono fine-print line on the back of the card. */
  architecture: string
  fun_fact: string
}

export type CardMeta = {
  spot_id: string
  spots_count: number
  is_first_on_revs: boolean
}

/** Batched per-user lookup: returns one row per spot with community
 *  meta (count of same-(brand, model) spots on REVS + whether this
 *  spot is the earliest of that model). RPC declared in 0036. */
export async function fetchUserCardsMeta(
  userId: string,
): Promise<Map<string, CardMeta>> {
  const map = new Map<string, CardMeta>()
  const { data, error } = await supabase.rpc('get_user_cards_meta', {
    p_user: userId,
  })
  if (error) {
    console.warn('[cards] meta fetch failed:', error.message)
    return map
  }
  for (const row of (data ?? []) as CardMeta[]) {
    map.set(row.spot_id, row)
  }
  return map
}

/** Lazy-load specs for a single car (brand+model+year). Server caches
 *  per (brand, model, year) in `car_specs` so the Claude/web_search
 *  cost is paid once site-wide per model. Returns null on transport
 *  failure; the UI then renders "—" placeholders. */
export async function fetchCardSpecs(
  brand: string,
  model: string,
  year: number | null,
): Promise<CardSpecs | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return null
  try {
    const res = await fetch('/api/car-info?action=card-specs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ brand, model, year }),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { specs?: CardSpecs }
    return json.specs ?? null
  } catch {
    return null
  }
}
