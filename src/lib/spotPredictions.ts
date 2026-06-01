import { supabase } from './supabase'
import type { Rarity, Spot } from './spots'

export type SpotScore = 'bon' | 'moyen' | 'mauvais'

export type PredictionResult = {
  message: string
  score_conditions: SpotScore
  generated_at: string
  cached: boolean
}

export type SpottingContext = {
  pseudo?: string
  spot_count?: number
  top_brands?: string[]
  level?: string
  last_car?: string
}

// Hits the consolidated car-info endpoint (?action=predict-spotting).
// The server caches per (user_id, city, date) so calling this on every
// Home mount is fine — the second call of the day is a Supabase round-
// trip, no Claude tokens spent. The optional `context` is woven into
// the prompt for a personalised single sentence.
export async function fetchSpottingPrediction(
  city: string,
  context?: SpottingContext,
): Promise<PredictionResult | null> {
  if (!city.trim()) return null
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return null
  // Best-effort detection of the user's local timezone so Claude reads
  // a meaningful "DATE LOCALE" line (otherwise it'd see UTC).
  let timezone = 'Europe/Paris'
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone
  } catch {
    /* fall through */
  }
  try {
    const res = await fetch('/api/car-info?action=predict-spotting', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ city, context, timezone }),
    })
    if (!res.ok) return null
    return (await res.json()) as PredictionResult
  } catch {
    return null
  }
}

// Rarity → numeric rank for client-side sorting (the SQL enum ordering
// is alphabetical and useless here).
const RARITY_RANK: Record<Rarity, number> = {
  standard: 1,
  premium: 2,
  performance: 3,
  exclusif: 4,
  supercar: 5,
  hypercar: 6,
}

export type RarestSpot = {
  spot: Spot
  window: 'today' | 'week'
  spotterPseudo: string
  spotterAvatar: string | null
  spotterTitle: string | null
  spotterXp: number
}

// Fetches the most remarkable spot of today (rarity desc → price desc
// → confidence desc → created_at desc). Falls back to the last 7 days
// when nothing was spotted today. Also resolves the spotter profile +
// XP so the caller doesn't have to chain.
export async function fetchRarestSpot(): Promise<RarestSpot | null> {
  // Reasonable cap — we only need the leader, but we sort client-side
  // because Postgres can't easily order an enum custom-numerically.
  const POOL = 40

  function rank(s: Spot): [number, number, number, number] {
    return [
      RARITY_RANK[(s.rarity ?? 'standard') as Rarity] ?? 0,
      s.estimated_price ?? 0,
      s.confidence ?? 0,
      new Date(s.created_at).getTime(),
    ]
  }

  async function topOf(spots: Spot[]): Promise<Spot | null> {
    if (spots.length === 0) return null
    return spots
      .slice()
      .sort((a, b) => {
        const ra = rank(a)
        const rb = rank(b)
        for (let i = 0; i < ra.length; i++) {
          if (ra[i] !== rb[i]) return rb[i] - ra[i]
        }
        return 0
      })[0]
  }

  const now = new Date()
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)

  // 1) Today first.
  const todayRes = await supabase
    .from('spots')
    .select('*')
    .gte('created_at', startOfDay.toISOString())
    .order('created_at', { ascending: false })
    .limit(POOL)
  const todaySpots = (todayRes.data ?? []) as Spot[]
  let chosen = await topOf(todaySpots)
  let windowSel: 'today' | 'week' = 'today'

  // 2) 7-day fallback when nothing today.
  if (!chosen) {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const weekRes = await supabase
      .from('spots')
      .select('*')
      .gte('created_at', sevenDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(POOL)
    const weekSpots = (weekRes.data ?? []) as Spot[]
    chosen = await topOf(weekSpots)
    windowSel = 'week'
  }

  if (!chosen) return null

  // Resolve spotter profile + xp in parallel.
  const [profRes, xpRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('pseudo, avatar, title')
      .eq('user_id', chosen.user_id)
      .maybeSingle(),
    supabase
      .from('xp_transactions')
      .select('amount')
      .eq('user_id', chosen.user_id),
  ])
  const prof = (profRes.data as {
    pseudo: string | null
    avatar: string | null
    title: string | null
  } | null) ?? null
  const xp = ((xpRes.data ?? []) as { amount: number }[]).reduce(
    (sum, r) => sum + r.amount,
    0,
  )
  return {
    spot: chosen,
    window: windowSel,
    spotterPseudo: prof?.pseudo ?? 'Spotter',
    spotterAvatar: prof?.avatar ?? null,
    spotterTitle: prof?.title ?? null,
    spotterXp: xp,
  }
}
