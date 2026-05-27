import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Spot } from '../lib/spots'
import type { BadgeContext } from '../lib/badges'

/** Fetches everything needed to compute badge unlock status for the
 *  current user. Returns null while loading. Designed for the badges
 *  pages (gallery + detail) — Profile builds its own context inline
 *  from data it already fetches. */
export function useBadgeContext(): BadgeContext | null {
  const [ctx, setCtx] = useState<BadgeContext | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        if (active) setCtx(null)
        return
      }

      const [spotsRes, eventsRes, profRes, subRes, followersRes] =
        await Promise.all([
          supabase
            .from('spots')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('events')
            .select('id', { count: 'exact', head: true })
            .eq('organizer_id', user.id),
          supabase
            .from('profiles')
            .select('created_at')
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('subscriptions')
            .select('plan, status')
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('followers')
            .select('follower_id', { count: 'exact', head: true })
            .eq('following_id', user.id),
        ])

      // Rank fetch (separate because it needs a different aggregation).
      const { data: allUids } = await supabase.from('spots').select('user_id')
      let rank: number | null = null
      const spots = (spotsRes.data ?? []) as Spot[]
      if (allUids && spots.length > 0) {
        const counts = new Map<string, number>()
        for (const r of allUids as { user_id: string }[]) {
          counts.set(r.user_id, (counts.get(r.user_id) ?? 0) + 1)
        }
        const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
        const idx = sorted.findIndex(([uid]) => uid === user.id)
        rank = idx >= 0 ? idx + 1 : null
      }

      // Likes received on user's spots.
      let likesReceived = 0
      const myIds = spots.map((s) => s.id)
      if (myIds.length) {
        const { count } = await supabase
          .from('spot_likes')
          .select('spot_id', { count: 'exact', head: true })
          .in('spot_id', myIds)
        likesReceived = count ?? 0
      }

      // Early adopter — < 100 profiles created before me.
      const myCreated = (profRes.data?.created_at as string | undefined) ?? user.created_at
      let earlier = 999
      if (myCreated) {
        const { count } = await supabase
          .from('profiles')
          .select('user_id', { count: 'exact', head: true })
          .lt('created_at', myCreated)
        earlier = count ?? 999
      }

      const sub = subRes.data as { plan?: string; status?: string } | null
      const isActive = sub?.status === 'active' || sub?.status === 'trialing'

      if (!active) return
      setCtx({
        spots,
        hasEvent: (eventsRes.count ?? 0) > 0,
        plan: isActive ? (sub?.plan ?? null) : null,
        rank,
        followers: followersRes.count ?? 0,
        likesReceived,
        daysWithSpot: new Set(spots.map((s) => s.created_at.slice(0, 10))),
        earlyAdopter: earlier < 100,
      })
    })()
    return () => {
      active = false
    }
  }, [])

  return ctx
}
