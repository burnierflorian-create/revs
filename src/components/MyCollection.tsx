import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ImageOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Spot } from '../lib/spots'
import { fetchUserCardsMeta, type CardMeta } from '../lib/cardSpecs'
import {
  cardKey,
  fetchMyCardProgress,
  type CardProgress,
} from '../lib/cardLevels'
import CollectorCard, { rarityRank } from './CollectorCard'

/** One evolving card per unique (brand, model, base colour). Repeat spots of
 *  the same car collapse into a single card (count = "spotté X fois"); the
 *  hero photo is the user-chosen main_photo_url, else the first spot's photo.
 *  Levels come from card_progress. */
type Card = {
  key: string
  rep: Spot // representative spot (drives the hero photo + rarity/name)
  spots: Spot[] // all spots of this car, oldest first (history)
  count: number
  level: number
  firstAt: string
}

export default function MyCollection({ spots }: { spots: Spot[] }) {
  const navigate = useNavigate()
  const [meta, setMeta] = useState<Map<string, CardMeta>>(new Map())
  const [progress, setProgress] = useState<Map<string, CardProgress>>(new Map())

  // One RPC for all the user's cards (community stats) + the per-card
  // level/photo state. Re-run when the spots list shape changes.
  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const [m, p] = await Promise.all([
        fetchUserCardsMeta(user.id),
        fetchMyCardProgress(),
      ])
      if (!active) return
      setMeta(m)
      setProgress(p)
    })()
    return () => {
      active = false
    }
  }, [spots.length])

  // Group spots into cards by (brand, model, base colour).
  const cards = useMemo<Card[]>(() => {
    const groups = new Map<string, Spot[]>()
    for (const s of spots) {
      const key = cardKey(s.brand ?? '', s.model ?? '', s.color)
      const g = groups.get(key)
      if (g) g.push(s)
      else groups.set(key, [s])
    }
    return [...groups.entries()].map(([key, group]) => {
      const asc = group
        .slice()
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() -
            new Date(b.created_at).getTime(),
        )
      const cp = progress.get(key)
      const chosen = cp?.main_photo_url ?? cp?.best_photo_url ?? null
      const rep =
        (chosen && asc.find((s) => s.photo_url === chosen)) || asc[0]
      return {
        key,
        rep,
        spots: asc,
        count: group.length,
        level: cp?.level ?? 1,
        firstAt: asc[0].created_at,
      }
    })
  }, [spots, progress])

  // Card serial numbers: chronological discovery order (by first spot).
  const cardNumberFor = useMemo(() => {
    const map = new Map<string, number>()
    cards
      .slice()
      .sort(
        (a, b) =>
          new Date(a.firstAt).getTime() - new Date(b.firstAt).getTime(),
      )
      .forEach((c, i) => map.set(c.key, i + 1))
    return (key: string) => map.get(key) ?? 0
  }, [cards])

  // Display order: rarity desc, then most-recent spot first.
  const sorted = useMemo(() => {
    return cards.slice().sort((a, b) => {
      const r = rarityRank(b.rep.rarity) - rarityRank(a.rep.rarity)
      if (r !== 0) return r
      const bLast = a.spots[a.spots.length - 1].created_at
      const aLast = b.spots[b.spots.length - 1].created_at
      return new Date(aLast).getTime() - new Date(bLast).getTime()
    })
  }, [cards])

  // First-appearance reveal, now keyed by CARD (representative spot id): a
  // card flips in only the first time it appears after the baseline is set.
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
  const revealKeys = useMemo(() => {
    const seen = seenRef.current as Set<string>
    if (!baselineRef.current) return new Set<string>()
    return new Set(cards.filter((c) => !seen.has(c.key)).map((c) => c.key))
  }, [cards])
  useEffect(() => {
    const seen = seenRef.current as Set<string>
    for (const c of cards) seen.add(c.key)
    baselineRef.current = true
    try {
      localStorage.setItem('revs_seen_cards', JSON.stringify([...seen]))
    } catch {
      /* storage unavailable */
    }
  }, [cards])

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
      {sorted.map((c, i) => {
        const m = meta.get(c.rep.id)
        return (
          <div
            key={c.key}
            className="collector-enter"
            style={{ animationDelay: `${Math.min(i, 11) * 35}ms` }}
          >
            <CollectorCard
              spot={c.rep}
              cardNumber={cardNumberFor(c.key)}
              spotsCount={c.count}
              isFirstOnRevs={m?.is_first_on_revs ?? false}
              reveal={revealKeys.has(c.key)}
              showShare
            />
          </div>
        )
      })}
    </div>
  )
}
