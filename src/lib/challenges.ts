import { supabase } from './supabase'

export type Challenge = {
  id: string
  title: string
  description: string
  type: 'spot_brand' | 'spot_count' | 'spot_category'
  target_value: number
  target_brand: string | null
  target_category: string | null
  xp_reward: number
  starts_at: string
  ends_at: string
  progress: number
  completed: boolean
  claimed: boolean
}

export async function fetchActiveChallenges(): Promise<Challenge[]> {
  const { data, error } = await supabase.rpc('get_active_challenges')
  if (error) {
    console.warn('[challenges] fetch failed:', error.message)
    return []
  }
  return (data ?? []) as Challenge[]
}

/** Claims a completed challenge. Returns true on first successful claim. */
export async function claimChallenge(challengeId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('claim_challenge', {
    p_challenge_id: challengeId,
  })
  if (error) {
    console.warn('[challenges] claim failed:', error.message)
    return false
  }
  return data === true
}

export function challengePct(c: Challenge): number {
  if (c.target_value <= 0) return 0
  return Math.min(100, Math.round((c.progress / c.target_value) * 100))
}
