import { supabase } from './supabase'

// ───────────────────────── Card Level-Up — shared model ─────────────────────────
// A "card" = the user's collection entry for one (brand, model). It levels
// up as the same model is spotted again (valid duplicates only — see the
// 12h/500m barrier in supabase/0044-card-progress.sql). Keep the thresholds
// and multiplier IN SYNC with that migration's card_level_for() /
// card_xp_multiplier().

export type CardLevel = 1 | 2 | 3 | 4 | 5

// Cumulative valid-spot count needed to REACH each level.
export const CARD_THRESHOLDS = [1, 3, 6, 11, 21] as const

export const CARD_LEVELS: {
  level: CardLevel
  name: string
  totalNeeded: number
}[] = [
  { level: 1, name: 'Rookie', totalNeeded: 1 },
  { level: 2, name: 'Challenger', totalNeeded: 3 },
  { level: 3, name: 'Veteran', totalNeeded: 6 },
  { level: 4, name: 'Legend', totalNeeded: 11 },
  { level: 5, name: 'Master', totalNeeded: 21 },
]

/** Cumulative valid-spot count → level. Mirrors SQL card_level_for(). */
export function cardLevelForCount(count: number): CardLevel {
  if (count >= 21) return 5
  if (count >= 11) return 4
  if (count >= 6) return 3
  if (count >= 3) return 2
  return 1
}

/** Permanent XP multiplier a card grants on future spots of its model.
 *  Mirrors SQL card_xp_multiplier(). */
export function cardXpMultiplier(level: number): number {
  if (level >= 4) return 1.5
  if (level >= 2) return 1.1
  return 1.0
}

export function cardLevelName(level: number): string {
  return CARD_LEVELS.find((l) => l.level === level)?.name ?? 'Rookie'
}

/** Spots still needed to reach the next level (null when already Master). */
export function cardSpotsToNext(count: number): number | null {
  for (const t of CARD_THRESHOLDS) {
    if (count < t) return t - count
  }
  return null
}

export type CardProgress = {
  brand_key: string
  model_key: string
  brand: string
  model: string
  valid_count: number
  level: CardLevel
  last_spot_at: string
  best_photo_url: string | null
  title: string | null
}

/** Stable map key for a (brand, model) card — matches SQL card_norm(). */
export function cardKey(brand: string, model: string): string {
  const norm = (s: string) =>
    (s ?? '').toLowerCase().trim().replace(/\s+/g, ' ')
  return `${norm(brand)}|${norm(model)}`
}

/** Loads the signed-in user's card collection, keyed by `${brand_key}|${model_key}`.
 *  Returns an empty map when logged out or on error (read-own RLS). */
export async function fetchMyCardProgress(): Promise<Map<string, CardProgress>> {
  const out = new Map<string, CardProgress>()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return out

  const { data, error } = await supabase
    .from('card_progress')
    .select(
      'brand_key, model_key, brand, model, valid_count, level, last_spot_at, best_photo_url, title',
    )
    .eq('user_id', user.id)
  if (error || !data) return out

  for (const row of data as CardProgress[]) {
    out.set(`${row.brand_key}|${row.model_key}`, row)
  }
  return out
}
