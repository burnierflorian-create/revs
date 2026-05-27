import { supabase } from './supabase'

export type ReferralStats = {
  invite_code: string | null
  referred_count: number
  xp_from_referrals: number
}

export async function fetchMyReferralStats(): Promise<ReferralStats | null> {
  const { data, error } = await supabase.rpc('my_referral_stats').maybeSingle()
  if (error) {
    console.warn('[referrals] stats failed:', error.message)
    return null
  }
  if (!data) return null
  return data as ReferralStats
}

/** Claims a referral code as the freshly signed-up user. Returns true if
 *  the code was valid AND not already claimed by this account. */
export async function claimReferralCode(code: string): Promise<boolean> {
  const cleaned = code.trim().toUpperCase()
  if (cleaned.length !== 6) return false
  const { data, error } = await supabase.rpc('claim_referral', {
    p_code: cleaned,
  })
  if (error) {
    console.warn('[referrals] claim failed:', error.message)
    return false
  }
  return data === true
}

const PENDING_KEY = 'revs.pending-referral'

/** Held during the signup flow until the auth session is established,
 *  then redeemed once. Surviving across the email-confirmation hop
 *  is why this lives in localStorage rather than React state. */
export function stashPendingReferral(code: string) {
  const cleaned = code.trim().toUpperCase()
  if (cleaned.length !== 6) return
  try {
    localStorage.setItem(PENDING_KEY, cleaned)
  } catch {
    // ignore — private mode, etc.
  }
}

export function consumePendingReferral(): string | null {
  try {
    const c = localStorage.getItem(PENDING_KEY)
    if (c) localStorage.removeItem(PENDING_KEY)
    return c
  } catch {
    return null
  }
}
