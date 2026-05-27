import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ImageOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Spot } from '../lib/spots'
import { fetchUserCardsMeta, type CardMeta } from '../lib/cardSpecs'
import CollectorCard, { rarityRank } from './CollectorCard'

/** Renders the user's full spot collection as collector cards. Cards
 *  derive from `spots` directly + a single batched meta RPC for
 *  community stats (spots_count, is_first_on_revs). Card numbers
 *  come from the user's own chronological order — recomputed on
 *  each render so they stay stable as long as no spot is deleted. */
export default function MyCollection({ spots }: { spots: Spot[] }) {
  const navigate = useNavigate()
  const [meta, setMeta] = useState<Map<string, CardMeta>>(new Map())

  // One RPC for all the user's cards. Re-run when the spots list
  // shape changes (length is a good proxy) so newly-posted cards
  // get their meta on next mount.
  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const m = await fetchUserCardsMeta(user.id)
      if (active) setMeta(m)
    })()
    return () => {
      active = false
    }
  }, [spots.length])

  // Card numbers: chronological ASC index + 1 within the user's own
  // spots. Computed once per `spots` reference; used by the cards as
  // their serial display (#001, #002, …).
  const cardNumberFor = useMemo(() => {
    const map = new Map<string, number>()
    const asc = spots
      .slice()
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      )
    asc.forEach((s, i) => map.set(s.id, i + 1))
    return (id: string) => map.get(id) ?? 0
  }, [spots])

  const sorted = useMemo(() => {
    return spots.slice().sort((a, b) => {
      const r = rarityRank(b.rarity) - rarityRank(a.rarity)
      if (r !== 0) return r
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    })
  }, [spots])

  if (spots.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-white/5 bg-card px-6 py-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
          <ImageOff className="h-8 w-8 text-accent/70" />
        </div>
        <p className="mt-4 max-w-[16rem] font-medium">
          Poste ton premier spot pour obtenir ta première carte !
        </p>
        <button
          onClick={() => navigate('/new-spot')}
          className="tappable mt-5 rounded-full bg-accent px-6 py-3 text-sm font-semibold"
        >
          Spotter
        </button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {sorted.map((s, i) => {
        const m = meta.get(s.id)
        return (
          <div
            key={s.id}
            className="collector-enter"
            style={{ animationDelay: `${Math.min(i, 11) * 35}ms` }}
          >
            <CollectorCard
              spot={s}
              cardNumber={cardNumberFor(s.id)}
              spotsCount={m?.spots_count ?? 1}
              isFirstOnRevs={m?.is_first_on_revs ?? false}
            />
          </div>
        )
      })}
    </div>
  )
}
