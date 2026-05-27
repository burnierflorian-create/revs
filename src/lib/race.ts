import { supabase } from './supabase'

export type RaceOpponent = {
  brand: string
  model: string
  rarity: 'commun' | 'rare' | 'ultra_rare' | 'unique'
  horsepower: number
  /** Set when the server found a real spot for the opponent. Null
   *  on the synthetic fallback (DB has no photo-bearing spots). */
  photo_url: string | null
  spot_id: string | null
  year: number | null
}

export type RaceStake = {
  amount: number
  label: string
}

export type RaceStart = {
  race_id: string
  player_hp: number
  opponent: RaceOpponent
  stake_type: string
  stake_value: RaceStake
}

export type RaceTimingBucket = 'perfect' | 'good' | 'miss' | 'false_start'

export type RaceResult = {
  player_score: number
  opponent_score: number
  winner_is_me: boolean
  timing_bucket: RaceTimingBucket
  timing_mult: number
  reward_type: string
  reward_value: RaceStake
  xp_awarded: number
}

export type RaceStats = {
  wins: number
  losses: number
  perfect_starts: number
}

/** Picks an AI opponent + rolls the stake. Inserts a pending race
 *  row server-side; caller must finish with `resolveRace` to award
 *  XP or it'll dangle. Throws on auth / unknown card. */
export async function startRace(cardId: string): Promise<RaceStart | null> {
  const { data, error } = await supabase
    .rpc('start_race', { p_card_id: cardId })
    .maybeSingle()
  if (error || !data) {
    console.warn('[race] start failed:', error?.message)
    return null
  }
  return data as RaceStart
}

/** Submits the tap delta (ms after GO; negative = false start).
 *  Server clamps the value, computes both scores, writes the race
 *  row, applies XP. */
export async function resolveRace(
  raceId: string,
  tapDeltaMs: number,
): Promise<RaceResult | null> {
  const { data, error } = await supabase
    .rpc('resolve_race', {
      p_race_id: raceId,
      p_tap_delta_ms: Math.round(tapDeltaMs),
    })
    .maybeSingle()
  if (error || !data) {
    console.warn('[race] resolve failed:', error?.message)
    return null
  }
  return data as RaceResult
}

/** Aggregate counters used by the badges system + future history
 *  screen. Single round-trip; caller decides cadence. */
export async function fetchRaceStats(userId: string): Promise<RaceStats> {
  const { data, error } = await supabase
    .rpc('get_user_race_stats', { p_user: userId })
    .maybeSingle()
  if (error || !data) {
    return { wins: 0, losses: 0, perfect_starts: 0 }
  }
  return data as RaceStats
}
