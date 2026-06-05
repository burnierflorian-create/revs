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

// Adaptive per-user weekly challenges (migrations 0042/0043). Same row
// shape as the legacy get_active_challenges, but target_value is the
// caller's personally-scaled goal and the set is assigned per-user. XP is
// still awarded automatically by the spots trigger (now per-user), so
// there's no manual claim call here. The legacy get_active_challenges RPC
// stays in the DB for rollback.
export async function fetchActiveChallenges(): Promise<Challenge[]> {
  const { data, error } = await supabase.rpc('get_my_weekly_challenges')
  if (error) {
    console.warn('[challenges] fetch failed:', error.message)
    return []
  }
  return (data ?? []) as Challenge[]
}

export function challengePct(c: Challenge): number {
  if (c.target_value <= 0) return 0
  return Math.min(100, Math.round((c.progress / c.target_value) * 100))
}
