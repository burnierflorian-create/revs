import { useEffect, useRef, useState } from 'react'
import { Heart } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { myPseudo, notifyPush } from '../lib/push'

type Props = {
  spotId: string
  // Detail page subscribes for a live counter; the feed stays optimistic
  // (one realtime channel per card would not scale).
  realtime?: boolean
  className?: string
}

export default function LikeButton({
  spotId,
  realtime = false,
  className = '',
}: Props) {
  const userIdRef = useRef<string | null>(null)
  const [count, setCount] = useState(0)
  const [liked, setLiked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [bump, setBump] = useState(false)

  async function refresh() {
    const uid = userIdRef.current
    const [{ count: c }, likedRes] = await Promise.all([
      supabase
        .from('spot_likes')
        .select('*', { count: 'exact', head: true })
        .eq('spot_id', spotId),
      uid
        ? supabase
            .from('spot_likes')
            .select('id')
            .eq('spot_id', spotId)
            .eq('user_id', uid)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    setCount(c ?? 0)
    setLiked(!!likedRes.data)
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!active) return
      userIdRef.current = user?.id ?? null
      await refresh()
    })()

    if (!realtime) return () => {
      active = false
    }

    const channel = supabase
      .channel(`spot_likes:${spotId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'spot_likes',
          filter: `spot_id=eq.${spotId}`,
        },
        () => {
          refresh()
        },
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotId, realtime])

  async function toggle() {
    const uid = userIdRef.current
    if (!uid || busy) return
    setBusy(true)
    setBump(true)
    setTimeout(() => setBump(false), 220)

    const wasLiked = liked
    // Optimistic.
    setLiked(!wasLiked)
    setCount((n) => Math.max(0, n + (wasLiked ? -1 : 1)))

    const op = wasLiked
      ? supabase
          .from('spot_likes')
          .delete()
          .eq('spot_id', spotId)
          .eq('user_id', uid)
      : supabase.from('spot_likes').insert({ spot_id: spotId, user_id: uid })

    const { error } = await op
    if (error) {
      // Revert on failure.
      setLiked(wasLiked)
      setCount((n) => Math.max(0, n + (wasLiked ? 1 : -1)))
    } else if (!wasLiked) {
      const { data: sp } = await supabase
        .from('spots')
        .select('user_id, brand, model')
        .eq('id', spotId)
        .maybeSingle()
      const s = sp as
        | { user_id: string; brand: string; model: string }
        | null
      if (s && s.user_id !== uid) {
        const who = await myPseudo()
        void notifyPush({
          user_id: s.user_id,
          title: '❤️ Nouveau like',
          body: `${who} a liké ton spot ${s.brand} ${s.model}`,
          url: `/spot/${spotId}`,
          type: 'likes',
        })
      }
    }
    setBusy(false)
  }

  return (
    <button
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        toggle()
      }}
      aria-label={liked ? 'Retirer le like' : 'Liker'}
      aria-pressed={liked}
      className={`tappable flex items-center gap-1.5 text-sm ${className}`}
    >
      <span className="relative inline-flex h-7 w-7 items-center justify-center">
        {bump && liked && (
          <span
            aria-hidden
            className="heart-ring absolute inset-0 rounded-full bg-accent/50"
          />
        )}
        <Heart
          strokeWidth={1.75}
          className={`relative h-6 w-6 transition-colors ${
            bump ? 'heart-pop' : ''
          } ${liked ? 'fill-accent text-accent' : 'text-fg2'}`}
        />
      </span>
      <span className={liked ? 'text-accent' : 'text-fg2'}>{count}</span>
    </button>
  )
}
