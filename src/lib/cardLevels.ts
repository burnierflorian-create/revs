import { supabase } from './supabase'
import { colorKey } from './colorKey'

// ───────────────────────── Card Level-Up — shared model ─────────────────────────
// A "card" = the user's collection entry for one (brand, model, base colour).
// It levels up as the SAME car is spotted again (valid duplicates only — see the
// 12h/500m barrier in supabase/0065-evolutive-cards.sql). Keep thresholds, badge
// names and the XP schedule IN SYNC with that migration's card_level_for() /
// card_spot_xp_factor().

export type CardLevel = 1 | 2 | 3 | 4 | 5

// Cumulative valid-spot count needed to REACH each level.
export const CARD_THRESHOLDS = [1, 3, 5, 10, 20] as const

export const CARD_LEVELS: {
  level: CardLevel
  /** Mastery badge shown on the card. null at L1 (base card, no badge). */
  badge: string | null
  totalNeeded: number
}[] = [
  { level: 1, badge: null, totalNeeded: 1 },
  { level: 2, badge: 'Chasseur', totalNeeded: 3 },
  { level: 3, badge: 'Traqueur', totalNeeded: 5 },
  { level: 4, badge: 'Obsédé', totalNeeded: 10 },
  { level: 5, badge: 'Légende', totalNeeded: 20 },
]

/** Cumulative valid-spot count → level. Mirrors SQL card_level_for(). */
export function cardLevelForCount(count: number): CardLevel {
  if (count >= 20) return 5
  if (count >= 10) return 4
  if (count >= 5) return 3
  if (count >= 3) return 2
  return 1
}

/** Diminishing XP factor for the Nth valid spot of a card (1-based ordinal).
 *  Discovery pays full; repeats pay less but never nothing. Mirrors SQL
 *  card_spot_xp_factor(). 1 → 100%, 2-3 → 50%, 4-10 → 25%, 11+ → 10%. */
export function cardSpotXpFactor(ordinal: number): number {
  if (ordinal <= 1) return 1.0
  if (ordinal <= 3) return 0.5
  if (ordinal <= 10) return 0.25
  return 0.1
}

/** Mastery badge for a level, or null at L1 (base card). */
export function cardBadge(level: number): string | null {
  return CARD_LEVELS.find((l) => l.level === level)?.badge ?? null
}

/** Spots still needed to reach the next level (null when already Légende). */
export function cardSpotsToNext(count: number): number | null {
  for (const t of CARD_THRESHOLDS) {
    if (count < t) return t - count
  }
  return null
}

export type CardProgress = {
  brand_key: string
  model_key: string
  color_key: string
  brand: string
  model: string
  color: string | null
  valid_count: number
  level: CardLevel
  first_spot_at: string | null
  last_spot_at: string
  best_photo_url: string | null
  /** User-chosen hero photo; falls back to best_photo_url / first spot. */
  main_photo_url: string | null
  cumulative_xp: number
  title: string | null
}

/** Stable map key for a (brand, model, base-colour) card.
 *  Matches SQL `card_norm(brand)|card_norm(model)|color_key(color)`. */
export function cardKey(
  brand: string,
  model: string,
  color: string | null | undefined,
): string {
  const norm = (s: string) =>
    (s ?? '').toLowerCase().trim().replace(/\s+/g, ' ')
  return `${norm(brand)}|${norm(model)}|${colorKey(color)}`
}

/** Loads the signed-in user's card collection, keyed by cardKey().
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
      'brand_key, model_key, color_key, brand, model, color, valid_count, level, first_spot_at, last_spot_at, best_photo_url, main_photo_url, cumulative_xp, title',
    )
    .eq('user_id', user.id)
  if (error || !data) return out

  for (const row of data as CardProgress[]) {
    out.set(`${row.brand_key}|${row.model_key}|${row.color_key}`, row)
  }
  return out
}
