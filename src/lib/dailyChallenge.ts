import { supabase } from './supabase'

export type DailyChallenge = {
  objective: string
  xp_reward: number
  completed_at: string | null
  generated_at: string
  cached: boolean
}

export type DailyChallengeContext = {
  pseudo?: string
  city?: string
  top_brands?: string[]
  last_car?: string
  level?: string
}

// Fetch (or lazily generate) the user's daily challenge. The server
// caches per (user_id, date) so calling this on every Home mount is
// fine — only the first call of the day pays the Claude cost.
export async function fetchDailyChallenge(
  context?: DailyChallengeContext,
): Promise<DailyChallenge | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return null
  try {
    const res = await fetch('/api/car-info?action=daily-challenge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ context }),
    })
    if (!res.ok) return null
    return (await res.json()) as DailyChallenge
  } catch {
    return null
  }
}

// Single-shot RPC. Returns the awarded XP (0 if already claimed, in
// which case `ok` is false but `xp_reward` still carries the original
// value so the UI can keep showing the badge state).
export async function claimDailyChallenge(): Promise<{
  ok: boolean
  xp_reward: number
}> {
  const { data, error } = await supabase
    .rpc('claim_daily_challenge')
    .maybeSingle()
  if (error || !data) {
    console.warn('[daily-challenge] claim failed:', error?.message)
    return { ok: false, xp_reward: 0 }
  }
  const row = data as { ok: boolean; xp_reward: number }
  return { ok: !!row.ok, xp_reward: row.xp_reward ?? 0 }
}
