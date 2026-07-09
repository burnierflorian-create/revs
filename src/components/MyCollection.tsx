import { useEffect, useMemo, useRef, useState } from 'react'
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

  // First-appearance reveal: a card animates in (3D flip) only the first
  // time its id shows up AFTER the user's baseline collection has been
  // seen — never on the very first visit (that would flip every card at
  // once). `seen` is persisted so a freshly-posted card reveals once, then
  // renders plainly forever after.
  const seenRef = useRef<Set<string> | null>(null)
  const baselineRef = useRef(false)
  if (seenRef.current === null) {
    let set = new Set<string>()
    try {
      const raw = localStorage.getItem('revs_seen_cards')
      if (raw) {
        set = new Set(JSON.parse(raw) as string[])
        baselineRef.current = true
      }
    } catch {
      /* storage unavailable */
    }
    seenRef.current = set
  }
  const revealIds = useMemo(() => {
    const seen = seenRef.current as Set<string>
    if (!baselineRef.current) return new Set<string>()
    return new Set(spots.filter((s) => !seen.has(s.id)).map((s) => s.id))
  }, [spots])
  useEffect(() => {
    const seen = seenRef.current as Set<string>
    for (const s of spots) seen.add(s.id)
    baselineRef.current = true
    try {
      localStorage.setItem('revs_seen_cards', JSON.stringify([...seen]))
    } catch {
      /* storage unavailable */
    }
  }, [spots])

  if (spots.length === 0) {
    return (
      <div className="mx-4 flex flex-col items-center rounded-2xl border border-fg/5 bg-card px-6 py-12 text-center">
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
    // 2-col grid at 100% width with an 8px gutter — each card is exactly
    // 50% of the screen minus 4px. The parent profile tab is already
    // full-bleed, so no horizontal padding is added here.
    <div className="grid grid-cols-2 gap-2">
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
              reveal={revealIds.has(s.id)}
              showShare
            />
          </div>
        )
      })}
    </div>
  )
}
