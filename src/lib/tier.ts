import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type Tier = 'premium' | 'vip' | null

/** Returns the current user's subscription tier (or null when free /
 *  signed out). Cached for the lifetime of the component; refetches
 *  when auth state changes. Used for tier-aware theming + UI gates. */
export function useMyTier(): Tier {
  const [tier, setTier] = useState<Tier>(null)
  useEffect(() => {
    let active = true
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        if (active) setTier(null)
        return
      }
      const { data } = await supabase.rpc('user_tier', { p_user: user.id })
      if (active) setTier(((data as Tier) ?? null) as Tier)
    }
    void load()
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void load()
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])
  return tier
}
