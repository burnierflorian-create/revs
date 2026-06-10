import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Car, Heart, Layers, Loader2, MessageCircle, Search as SearchIcon, SlidersHorizontal, X, Zap } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  distanceMeters,
  timeAgo,
  xpForSpot,
  type Spot,
} from '../lib/spots'
import { categoryBadge } from '../lib/categoryStyle'
import { rarityBadge } from '../lib/rarityStyle'
import { SkeletonCard } from '../components/Skeleton'
import CommentsSheet from '../components/CommentsSheet'
import { hapticTap } from '../lib/haptic'
import { myPseudo, notifyPush } from '../lib/push'
import { onNewSpot } from '../lib/feedSync'
import FeedFiltersModal, {
  filtersActive,
  loadFeedFilters,
  saveFeedFilters,
  type FeedFilters,
} from '../components/FeedFiltersModal'
import PullIndicator from '../components/PullIndicator'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { BRANDS } from '../lib/brands'
import { bodyTypeFor } from '../lib/car-body-type'
import { isFounder } from '../lib/founders'

const PAGE = 10
const POOL_SIZE = 200

const SLIDES = [
  {
    img: 'https://images.unsplash.com/photo-1541348263662-e068662d82af?w=1200&q=80',
    title: 'Les supercars spottées près de toi en temps réel',
  },
  {
    img: 'https://images.unsplash.com/photo-1567808291548-fc3ee04dbcf0?w=1200&q=80',
    title: 'Like et commente les spots de la communauté',
  },
  {
    img: 'https://images.unsplash.com/photo-1617060219602-8cbf8f1eff8d?w=1200&q=80',
    title: 'Grimpe dans le classement',
  },
]

type Prof = {
  pseudo: string | null
  ville: string | null
  avatar: string | null
  title: string | null
  xp: number
}

// Burst grouping: consecutive spots of the SAME car (brand+model+color)
// posted < 5 min apart AND < 100 m apart collapse into one card. A
// different car in between breaks the run (the list is chronological).
const GROUP_WINDOW_MS = 5 * 60 * 1000
const GROUP_RADIUS_M = 100

function carKey(s: Spot): string {
  return [s.brand, s.model, s.color]
    .map((x) => (x ?? '').trim().toLowerCase())
    .join('|')
}

// Maps a spot to one of the modal's category buckets. Combines the
// stored spot.category enum with the body-type silhouette mapping plus
// model-name keyword detection for Coupés / Cabriolets.
function matchesCategory(s: Spot, cat: string): boolean {
  if (cat === 'Tout') return true
  if (cat === 'Supercars') {
    return s.category === 'supercar' || bodyTypeFor(s.brand, s.model, s.category) === 'supercar'
  }
  if (cat === 'Hypercars') {
    return s.category === 'hypercar' || bodyTypeFor(s.brand, s.model, s.category) === 'hypercar'
  }
  if (cat === 'JDM') {
    return s.category === 'JDM' || bodyTypeFor(s.brand, s.model, s.category) === 'jdm-sport'
  }
  if (cat === 'Berlines') {
    const bt = bodyTypeFor(s.brand, s.model, s.category)
    return bt === 'sedan' || bt === 'sport-sedan'
  }
  if (cat === 'SUV') {
    const bt = bodyTypeFor(s.brand, s.model, s.category)
    return bt === 'suv' || bt === 'suv-coupe' || bt === 'mini-suv'
  }
  if (cat === 'Coupés') {
    return /\bcoupe\b|\bcoupé\b/i.test(`${s.brand} ${s.model}`)
  }
  if (cat === 'Cabriolets') {
    return /\bcabriolet\b|\bconvertible\b|\bspider\b|\bspyder\b|\broadster\b|\btarga\b/i.test(
      `${s.brand} ${s.model}`,
    )
  }
  if (cat === 'Autre') {
    return s.category === 'other' || s.category === 'classic' || s.category === 'youngtimer'
  }
  return true
}

function groupSpots(list: Spot[]): { primary: Spot; count: number }[] {
  const out: { primary: Spot; count: number }[] = []
  let cur: { primary: Spot; count: number; prev: Spot } | null = null
  for (const s of list) {
    const close =
      cur != null &&
      carKey(s) === carKey(cur.prev) &&
      Math.abs(
        new Date(cur.prev.created_at).getTime() -
          new Date(s.created_at).getTime(),
      ) <= GROUP_WINDOW_MS &&
      Number.isFinite(s.lat) &&
      Number.isFinite(s.lng) &&
      Number.isFinite(cur.prev.lat) &&
      Number.isFinite(cur.prev.lng) &&
      distanceMeters(cur.prev.lat, cur.prev.lng, s.lat, s.lng) <=
        GROUP_RADIUS_M
    if (cur && close) {
      cur.count += 1
      cur.prev = s
    } else {
      if (cur) out.push({ primary: cur.primary, count: cur.count })
      cur = { primary: s, count: 1, prev: s }
    }
  }
  if (cur) out.push({ primary: cur.primary, count: cur.count })
  return out
}

function EmptyCarousel({ onSpot }: { onSpot: () => void }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % SLIDES.length), 4000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="flex min-h-screen flex-col bg-bg px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
      <h1 className="py-4 font-display text-2xl font-bold text-fg">Fil</h1>
      <div className="relative flex-1 overflow-hidden rounded-3xl">
        {SLIDES.map((s, idx) => (
          <div
            key={idx}
            className="absolute inset-0 transition-opacity duration-700"
            style={{ opacity: idx === i ? 1 : 0 }}
          >
            <img src={s.img} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/30" />
            <div className="absolute inset-x-0 bottom-0 p-7">
              <p className="font-display text-2xl font-bold leading-tight text-white">
                {s.title}
              </p>
            </div>
          </div>
        ))}
        <div className="absolute left-0 right-0 top-5 flex justify-center gap-2">
          {SLIDES.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setI(idx)}
              className={`h-1.5 rounded-full transition-all ${
                idx === i ? 'w-6 bg-accent' : 'w-2 bg-fg/40'
              }`}
              aria-label={`Slide ${idx + 1}`}
            />
          ))}
        </div>
      </div>
      <button
        onClick={onSpot}
        className="mt-6 w-full rounded-full bg-accent py-4 text-sm font-semibold text-fg shadow-lg shadow-accent/40"
      >
        Sois le premier à spotter
      </button>
    </div>
  )
}

export default function Feed() {
  const navigate = useNavigate()
  const [spots, setSpots] = useState<Spot[] | null>(null)
  const [profiles, setProfiles] = useState<Record<string, Prof>>({})
  // Feed-only state — search + filters live entirely here and sort ONLY
  // the community post list. Filters persisted under their own key
  // (revs_feed_filters, distinct from the map's), restored on mount, so
  // nothing here ever touches the Carte.
  const [feedFilters, setFeedFilters] = useState<FeedFilters>(() =>
    loadFeedFilters(),
  )
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [feedSearchQuery, setFeedSearchQuery] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [geoMsg, setGeoMsg] = useState<string | null>(null)
  // Bumping this key re-runs the load effect — used by pull-to-refresh.
  const [refreshKey, setRefreshKey] = useState(0)

  // Pull-to-refresh handles its own touch listeners on the parent
  // .tab-pane. The promise it awaits is resolved after a fresh fetch
  // round-trip — give it a ~600ms minimum so the spinner has time to
  // be perceived even on instant cache hits.
  const { containerRef, pull, refreshing } = usePullToRefresh(async () => {
    setRefreshKey((k) => k + 1)
    await new Promise((r) => setTimeout(r, 600))
  })

  const pageRef = useRef(0)
  const poolRef = useRef<Spot[]>([])
  const likeCountsRef = useRef<Map<string, number>>(new Map())
  const userPosRef = useRef<{ lat: number; lng: number } | null>(null)
  const profilesRef = useRef<Record<string, Prof>>({})
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // Per-card interaction (like, double-tap, comments) now lives inside
  // <FeedCard /> — the feed no longer tracks a shared heart/nav timer.


  const mergeProfiles = useCallback(async (list: Spot[]) => {
    const ids = [
      ...new Set(
        list
          .map((s) => s.user_id)
          .filter((id) => !(id in profilesRef.current)),
      ),
    ]
    if (ids.length === 0) return
    // Parallel: profile fields + XP totals (used to derive the title chip).
    const [profsRes, xpRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('user_id, pseudo, ville, avatar, title')
        .in('user_id', ids),
      supabase
        .from('xp_transactions')
        .select('user_id, amount')
        .in('user_id', ids),
    ])
    const xpByUser = new Map<string, number>()
    for (const r of (xpRes.data ?? []) as { user_id: string; amount: number }[]) {
      xpByUser.set(r.user_id, (xpByUser.get(r.user_id) ?? 0) + r.amount)
    }
    const next = { ...profilesRef.current }
    for (const p of (profsRes.data ?? []) as {
      user_id: string
      pseudo: string | null
      ville: string | null
      avatar: string | null
      title: string | null
    }[]) {
      next[p.user_id] = {
        pseudo: p.pseudo,
        ville: p.ville,
        avatar: p.avatar,
        title: p.title,
        xp: xpByUser.get(p.user_id) ?? 0,
      }
    }
    // Mark every requested id as resolved so we don't refetch misses.
    for (const id of ids)
      if (!next[id])
        next[id] = { pseudo: null, ville: null, avatar: null, title: null, xp: 0 }
    profilesRef.current = next
    setProfiles(next)
  }, [])

  // Instant re-render — when a spot is published (NewSpot emits it the
  // moment the insert is confirmed), unshift it to the very top of the
  // feed so it's already there when the user switches back to the Fil.
  // Deduped by id; a later server fetch replaces the optimistic row.
  useEffect(() => {
    return onNewSpot((spot) => {
      poolRef.current = [
        spot,
        ...poolRef.current.filter((s) => s.id !== spot.id),
      ]
      setSpots((prev) => {
        const list = prev ?? []
        if (list.some((s) => s.id === spot.id)) return list
        return [spot, ...list]
      })
      void mergeProfiles([spot])
    })
  }, [mergeProfiles])

  const getPosition = useCallback(
    () =>
      new Promise<{ lat: number; lng: number } | null>((resolve) => {
        if (!navigator.geolocation) return resolve(null)
        navigator.geolocation.getCurrentPosition(
          (p) =>
            resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 },
        )
      }),
    [],
  )

  // Resolve the final filtered+sorted list from the in-memory pool.
  // The pool itself is always "the last 200 spots ordered by created_at
  // desc" — every filter operation works on top of that snapshot to
  // avoid round-trips when toggling feedFilters.
  const applyFilters = useCallback(
    (pool: Spot[], f: FeedFilters): Spot[] => {
      let out = pool
      // Category filter — combines spot.category enum with the body-
      // type silhouette mapping, so "SUV" / "Coupés" / "Cabriolets" /
      // "Berlines" all work even though those aren't stored categories.
      if (f.category !== 'Tout') {
        out = out.filter((s) => matchesCategory(s, f.category))
      }
      // Brand filter — fuzzy match against the brand's catalogue
      // patterns (case-insensitive substring of the brand's `match[]`).
      if (f.brand) {
        const brand = BRANDS.find((b) => b.slug === f.brand)
        if (brand) {
          out = out.filter((s) => {
            const needle = (s.brand ?? '').toLowerCase()
            return brand.match.some((m) => needle.includes(m))
          })
        }
      }
      // City filter — needs the resolved profile (ville). Falls back to
      // including spots where the profile hasn't loaded yet so the
      // user doesn't see an empty list during the resolve hop.
      if (f.city.trim()) {
        const needle = f.city.trim().toLowerCase()
        out = out.filter((s) => {
          const prof = profilesRef.current[s.user_id]
          if (!prof) return true
          return (prof.ville ?? '').toLowerCase().includes(needle)
        })
      }
      // Cette semaine — only spots from the last 7 days.
      if (f.sort === 'week') {
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
        out = out.filter((s) => new Date(s.created_at).getTime() >= cutoff)
      }
      // Sort
      if (f.sort === 'liked') {
        out = [...out].sort(
          (a, b) =>
            (likeCountsRef.current.get(b.id) ?? 0) -
            (likeCountsRef.current.get(a.id) ?? 0),
        )
      } else if (f.sort === 'nearby' && userPosRef.current) {
        const pos = userPosRef.current
        out = [...out]
          .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
          .sort(
            (a, b) =>
              distanceMeters(pos.lat, pos.lng, a.lat, a.lng) -
              distanceMeters(pos.lat, pos.lng, b.lat, b.lng),
          )
      }
      // 'recent' and 'week' both keep the chronological pool order.
      return out
    },
    [],
  )

  // (Re)load the pool from scratch whenever filters change. We keep the
  // pool of 200 most-recent spots cached and re-filter client-side, but
  // sort='nearby' needs the user position and sort='liked' needs an
  // aggregate count of likes per spot — both fetched lazily here.
  useEffect(() => {
    let active = true
    setSpots(null)
    setHasMore(true)
    setGeoMsg(null)
    pageRef.current = 0
    ;(async () => {
      // 1. Fresh pool fetch — same query every time, simple.
      const { data: poolData } = await supabase
        .from('spots')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(POOL_SIZE)
      if (!active) return
      const pool = (poolData ?? []) as Spot[]
      poolRef.current = pool

      // 2. Sort-specific side fetches in parallel.
      const sideFetches: Promise<unknown>[] = []
      if (feedFilters.sort === 'liked') {
        sideFetches.push(
          (async () => {
            const ids = pool.map((s) => s.id)
            if (ids.length === 0) return
            const { data: likeRows } = await supabase
              .from('spot_likes')
              .select('spot_id')
              .in('spot_id', ids)
            const m = new Map<string, number>()
            for (const r of (likeRows ?? []) as { spot_id: string }[]) {
              m.set(r.spot_id, (m.get(r.spot_id) ?? 0) + 1)
            }
            likeCountsRef.current = m
          })(),
        )
      }
      if (feedFilters.sort === 'nearby') {
        sideFetches.push(
          getPosition().then((p) => {
            userPosRef.current = p
            if (!p) {
              setGeoMsg(
                'Active la localisation pour trier par distance — tri par récence en attendant.',
              )
            }
          }),
        )
      }
      // City filter needs profiles to resolve villes — resolve them eagerly
      // so the initial filter pass doesn't miss matches.
      if (feedFilters.city.trim()) {
        sideFetches.push(mergeProfiles(pool))
      }
      if (sideFetches.length) await Promise.all(sideFetches)
      if (!active) return

      const filtered = applyFilters(pool, feedFilters)
      const slice = filtered.slice(0, PAGE)
      await mergeProfiles(slice)
      if (!active) return
      pageRef.current = 1
      setHasMore(filtered.length > PAGE)
      setSpots(slice)
    })()
    return () => {
      active = false
    }
  }, [feedFilters, refreshKey, applyFilters, getPosition, mergeProfiles])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || spots === null) return
    setLoadingMore(true)
    try {
      const filtered = applyFilters(poolRef.current, feedFilters)
      const shown = spots.length
      const next = filtered.slice(shown, shown + PAGE)
      await mergeProfiles(next)
      setSpots((cur) => [...(cur ?? []), ...next])
      setHasMore(shown + next.length < filtered.length)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, spots, feedFilters, applyFilters, mergeProfiles])

  const loadMoreRef = useRef(loadMore)
  loadMoreRef.current = loadMore
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreRef.current()
      },
      { rootMargin: '400px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [spots !== null])

  if (spots === null) {
    return (
      <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <h1 className="py-4 font-display text-2xl font-bold text-fg">Fil</h1>
        <div className="space-y-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    )
  }

  const allDefaults = !filtersActive(feedFilters)
  if (spots.length === 0 && allDefaults) {
    return <EmptyCarousel onSpot={() => navigate('/new-spot')} />
  }


  return (
    <div
      ref={containerRef}
      className="relative min-h-screen bg-bg pt-[max(1rem,env(safe-area-inset-top))]"
    >
      {/* Root is edge-to-edge (px-0) so feed photos touch the screen
          edges with NO overflow trick — the old -mx-4 was being clipped by
          the feed-card's content-visibility paint-containment. Horizontal
          breathing room is re-applied selectively (px-4) on text/icon rows
          only. */}
      <PullIndicator pull={pull} refreshing={refreshing} />
      <h1 className="display-xl px-4 py-5 text-fg">Fil</h1>

      {/* Search (~85%) + a single minimal slider icon that opens the
          filters panel. The old "Tout" / "Filtres" button row was removed
          2026-06-05 — resetting now lives inside the filters modal, and
          the whole header collapses to one clean line so the photos
          below own the screen. Glass + border resolve through CSS vars so
          the whole row auto-flips dark / light. */}
      <div className="mb-6 flex items-center gap-2 px-4">
        <div
          className="flex flex-1 items-center gap-2 rounded-full px-4 py-2.5"
          style={{
            background: 'var(--color-glass)',
            border: '1px solid var(--color-border)',
            backdropFilter: 'saturate(160%) blur(22px)',
            WebkitBackdropFilter: 'saturate(160%) blur(22px)',
          }}
        >
          <SearchIcon className="h-4 w-4 flex-none text-fg2" />
          <input
            type="text"
            value={feedSearchQuery}
            onChange={(e) => setFeedSearchQuery(e.target.value)}
            placeholder="Rechercher dans le fil…"
            style={{ fontSize: '16px' }}
            className="flex-1 bg-transparent font-medium tracking-tight text-fg/80 placeholder:text-fg2 outline-none"
          />
          {feedSearchQuery && (
            <button
              onClick={() => setFeedSearchQuery('')}
              aria-label="Effacer"
              className="tappable text-fg2 hover:text-fg"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          onClick={() => setFiltersOpen(true)}
          aria-label="Filtres"
          className="tappable relative flex h-11 w-11 flex-none items-center justify-center rounded-full"
          style={{
            background: allDefaults
              ? 'var(--color-glass)'
              : 'rgba(232,32,58,0.15)',
            border: allDefaults
              ? '1px solid var(--color-border)'
              : '1px solid rgba(232,32,58,0.40)',
            backdropFilter: 'saturate(160%) blur(22px)',
            WebkitBackdropFilter: 'saturate(160%) blur(22px)',
          }}
        >
          <SlidersHorizontal
            className={`h-[18px] w-[18px] ${allDefaults ? 'text-fg2' : 'text-accent'}`}
          />
          {!allDefaults && (
            <span
              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent"
              style={{ border: '2px solid rgb(var(--color-bg))' }}
            />
          )}
        </button>
      </div>

      <FeedFiltersModal
        open={filtersOpen}
        initial={feedFilters}
        onClose={() => setFiltersOpen(false)}
        onApply={(next) => {
          // Apply + persist to the feed's own key. onClose (fired by the
          // modal right after onApply) closes the sheet.
          setFeedFilters(next)
          saveFeedFilters(next)
        }}
      />

      {geoMsg && (
        <p className="mb-4 mx-4 rounded-xl bg-card px-4 py-3 text-xs text-fg/50">
          {geoMsg}
        </p>
      )}

      {spots.length === 0 ? (
        <div className="flex flex-col items-center px-8 py-16 text-center">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full"
            style={{
              background: 'rgba(232,32,58,0.12)',
              border: '1px solid rgba(232,32,58,0.35)',
            }}
          >
            <Car className="h-8 w-8 text-accent" />
          </div>
          <p className="mt-4 font-display text-lg font-extrabold tracking-tighter text-fg">
            {allDefaults
              ? 'Aucun spot pour l’instant'
              : 'Rien ne correspond'}
          </p>
          <p className="mt-1 text-sm text-fg2">
            {allDefaults
              ? 'Sois le premier à spotter une voiture iconique !'
              : 'Aucun spot ne correspond à ces filtres.'}
          </p>
        </div>
      ) : (
        <div>
          {(() => {
            const needle = feedSearchQuery.trim().toLowerCase()
            const filtered = needle
              ? groupSpots(spots).filter(({ primary: s }) => {
                  const p = profiles[s.user_id]
                  const hay = [
                    s.brand,
                    s.model,
                    p?.pseudo ?? '',
                    p?.ville ?? '',
                  ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase()
                  return hay.includes(needle)
                })
              : groupSpots(spots)
            if (filtered.length === 0) {
              return (
                <p className="px-8 py-12 text-center text-sm text-fg2">
                  Aucune voiture trouvée pour
                  <span className="text-fg"> « {feedSearchQuery} »</span>.
                </p>
              )
            }
            return filtered.map(({ primary: spot, count }) => (
              <FeedCard
                key={spot.id}
                spot={spot}
                prof={profiles[spot.user_id]}
                burstCount={count}
              />
            ))
          })()}

          <div ref={sentinelRef} className="h-1" />
          {loadingMore && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-fg/30" />
            </div>
          )}
          {!hasMore && spots.length > PAGE && (
            <p className="py-4 text-center text-xs text-fg/25">
              Tu as tout vu pour le moment.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────── FEED CARD ───────────────────────────────

/** One spot in the feed — Instagram-grade. Layers: spotter row, 4:5
 *  edge-to-edge photo (double-tap to like, never navigates), tools row
 *  (like + count, comment + count, XP badge), tappable title block (the
 *  only path to the detail page), and a quick-comment row that opens the
 *  comments sheet. All theme-aware. */
function FeedCard({
  spot,
  prof,
  burstCount,
}: {
  spot: Spot
  prof?: Prof
  burstCount: number
}) {
  const navigate = useNavigate()
  const meRef = useRef<string | null>(null)
  const busyRef = useRef(false)
  const lastTapRef = useRef(0)
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(0)
  const [commentCount, setCommentCount] = useState(0)
  const [heartPop, setHeartPop] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [myAvatar, setMyAvatar] = useState<string | null>(null)
  const [myInitial, setMyInitial] = useState('?')

  const pseudo = prof?.pseudo || 'Spotter'
  const ville = prof?.ville?.trim() || ''
  const founder = isFounder(spot.user_id)
  const cat = categoryBadge(spot.category)
  const rb = rarityBadge(spot.rarity)
  const title = [spot.brand, spot.model].filter(Boolean).join(' ') || 'Voiture'

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!active) return
      meRef.current = user?.id ?? null
      if (user) {
        supabase
          .from('profiles')
          .select('avatar, pseudo')
          .eq('user_id', user.id)
          .maybeSingle()
          .then(({ data }) => {
            if (!active) return
            const m = data as { avatar: string | null; pseudo: string | null } | null
            setMyAvatar(m?.avatar ?? null)
            setMyInitial(
              (m?.pseudo ?? user.email ?? '?').charAt(0).toUpperCase(),
            )
          })
      }
      const [likeC, likedRes, comC] = await Promise.all([
        supabase
          .from('spot_likes')
          .select('*', { count: 'exact', head: true })
          .eq('spot_id', spot.id),
        user
          ? supabase
              .from('spot_likes')
              .select('spot_id')
              .eq('spot_id', spot.id)
              .eq('user_id', user.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from('comments')
          .select('*', { count: 'exact', head: true })
          .eq('spot_id', spot.id),
      ])
      if (!active) return
      setLikeCount(likeC.count ?? 0)
      setLiked(!!likedRes.data)
      setCommentCount(comC.count ?? 0)
    })()
    return () => {
      active = false
    }
  }, [spot.id])

  async function setLikeState(next: boolean) {
    const uid = meRef.current
    if (!uid || busyRef.current || next === liked) return
    busyRef.current = true
    setLiked(next)
    setLikeCount((n) => Math.max(0, n + (next ? 1 : -1)))
    const op = next
      ? supabase.from('spot_likes').insert({ spot_id: spot.id, user_id: uid })
      : supabase
          .from('spot_likes')
          .delete()
          .eq('spot_id', spot.id)
          .eq('user_id', uid)
    const { error } = await op
    if (error) {
      setLiked(!next)
      setLikeCount((n) => Math.max(0, n + (next ? -1 : 1)))
    } else if (next && spot.user_id !== uid) {
      const who = await myPseudo()
      void notifyPush({
        user_id: spot.user_id,
        title: '❤️ Nouveau like',
        body: `${who} a liké ton spot ${spot.brand} ${spot.model}`,
        url: `/spot/${spot.id}`,
        type: 'likes',
      })
    }
    busyRef.current = false
  }

  // Single tap does nothing (per spec — the photo never navigates). A
  // second tap within 300 ms is a double-tap → like + spring heart pop.
  function onPhotoTap() {
    const now = Date.now()
    if (now - lastTapRef.current < 300) {
      lastTapRef.current = 0
      setHeartPop(true)
      hapticTap()
      window.setTimeout(() => setHeartPop(false), 380)
      void setLikeState(true) // double-tap always likes, never unlikes
    } else {
      lastTapRef.current = now
    }
  }

  return (
    // 8px gap between posts on the #0a0a0a page; each post's interactions
    // live on a clean #141414 block so they never bleed into the next one.
    <article className="feed-card" style={{ marginBottom: '8px' }}>
      {/* PHOTO 4:5 — full-bleed. Rarity badge top-right, 44px floating
          header, and the car identity over a bottom gradient that keeps
          the text legible on any photo. Double-tap likes; never navigates. */}
      <div onClick={onPhotoTap} className="relative cursor-pointer select-none">
        {spot.photo_url ? (
          <img
            src={spot.photo_url}
            alt={title}
            loading="lazy"
            className="aspect-[4/5] w-full rounded-none object-cover contrast-[1.03] brightness-[0.98]"
          />
        ) : (
          <div className="flex aspect-[4/5] w-full items-center justify-center bg-fg/5">
            <Car className="h-12 w-12 text-fg2/40" />
          </div>
        )}

        {/* Rarity badge — same identity as the Collection (gold + animated
            for the top tier). Top-right. */}
        <span
          className={`absolute right-3 top-3 z-20 overflow-hidden rounded-md px-2 py-1 text-[10px] font-extrabold ${
            rb.animated ? 'gold-shimmer' : ''
          }`}
          style={{
            background: rb.bg,
            color: rb.fg,
            border: `1px solid ${rb.border}`,
            letterSpacing: '0.06em',
          }}
        >
          {rb.label}
        </span>

        {/* Floating header — 44px avatar + pseudo on a semi-transparent
            pill so it reads on any photo. */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            navigate(`/u/${spot.user_id}`)
          }}
          className="absolute inset-x-0 top-0 z-20 flex min-w-0 items-center gap-2.5 px-3 pt-3 text-left"
          aria-label={`Profil de ${pseudo}`}
        >
          <div
            className="flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-full bg-black/35 text-[15px] font-extrabold text-white"
            style={{ border: '1.5px solid rgba(255,255,255,0.30)' }}
          >
            {prof?.avatar ? (
              <img
                src={prof.avatar}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              pseudo.charAt(0).toUpperCase()
            )}
          </div>
          <span
            className="inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1"
            style={{
              background: 'rgba(0,0,0,0.38)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
            }}
          >
            <span className="truncate text-[13px] font-semibold tracking-tight text-white">
              {pseudo}
            </span>
            {founder && (
              <span
                className="flex-none rounded uppercase tracking-wider text-white"
                style={{
                  background: 'rgba(239,68,68,0.6)',
                  padding: '1px 4px',
                  fontSize: '7px',
                  letterSpacing: '0.12em',
                }}
              >
                Fondateur
              </span>
            )}
          </span>
        </button>

        {/* Bottom legibility gradient — transparent → #0a0a0a over 120px. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0"
          style={{
            height: '120px',
            background:
              'linear-gradient(to top, #0a0a0a 0%, rgba(10,10,10,0.55) 45%, rgba(10,10,10,0) 100%)',
          }}
        />

        {/* Car identity — name + year · category · ville · time. Tapping
            this block opens the detail (the photo itself never navigates). */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            navigate(`/spot/${spot.id}`)
          }}
          className="absolute inset-x-0 bottom-0 z-10 px-4 pb-3 text-left"
          aria-label={`Voir ${title}`}
        >
          <p className="truncate text-[16px] font-bold text-white">{title}</p>
          <p className="mt-0.5 truncate text-[13px] text-white/70">
            {spot.year ? <>{spot.year} · </> : null}
            {cat ? (
              <>
                <span className="font-semibold" style={{ color: cat.color }}>
                  {cat.label}
                </span>
                {' · '}
              </>
            ) : null}
            {ville ? <>{ville} · </> : null}
            {timeAgo(spot.created_at)}
          </p>
        </button>

        {heartPop && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
            <Heart
              className="feed-double-heart h-28 w-28"
              style={{ color: '#FF2D46', fill: '#FF2D46' }}
            />
          </div>
        )}

        {burstCount > 1 && (
          <span
            className="absolute z-20 flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold text-white"
            style={{
              right: 12,
              top: 52,
              background: 'rgba(0, 0, 0, 0.45)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              backdropFilter: 'saturate(160%) blur(12px)',
              WebkitBackdropFilter: 'saturate(160%) blur(12px)',
            }}
          >
            <Layers className="h-3 w-3" />
            {burstCount}
          </span>
        )}
      </div>

      {/* Interactions block — own #141414 surface so likes / comments / XP
          + the comment bar clearly belong to THIS post. */}
      <div style={{ background: '#141414' }}>
        <div className="flex items-center gap-5 px-4 pt-3">
          <button
            onClick={() => setLikeState(!liked)}
            aria-label={liked ? 'Retirer le like' : 'Liker'}
            aria-pressed={liked}
            className="tappable flex items-center gap-1.5"
          >
            <Heart
              strokeWidth={1.2}
              className={`h-6 w-6 transition-colors ${liked ? 'fill-accent text-accent' : 'text-white'}`}
            />
            <span className="text-sm font-medium text-white">{likeCount}</span>
          </button>
          <button
            onClick={() => setSheetOpen(true)}
            aria-label="Commentaires"
            className="tappable flex items-center gap-1.5"
          >
            <MessageCircle strokeWidth={1.2} className="h-6 w-6 text-white" />
            <span className="text-sm font-medium text-white">{commentCount}</span>
          </button>
          <span className="ml-auto flex items-center gap-1 text-white/50">
            <Zap strokeWidth={1.2} className="h-[18px] w-[18px] text-accent" />
            <span className="text-xs font-medium tabular-nums">
              +{xpForSpot(spot.estimated_price, spot.rarity)} XP
            </span>
          </span>
        </div>

        {/* Comment bar — directly under the actions, inside the same block. */}
        <button
          onClick={() => setSheetOpen(true)}
          className="tappable mt-2 flex w-full items-center gap-2.5 px-4 pb-3.5 text-left"
          aria-label="Ajouter un commentaire"
        >
          <div className="flex h-7 w-7 flex-none items-center justify-center overflow-hidden rounded-full bg-white/10 text-[11px] font-extrabold text-white/70">
            {myAvatar ? (
              <img src={myAvatar} alt="" className="h-full w-full object-cover" />
            ) : (
              myInitial
            )}
          </div>
          <span className="text-[13px] text-white/45">Ajouter un commentaire…</span>
        </button>
      </div>

      <CommentsSheet
        spotId={spot.id}
        ownerId={spot.user_id}
        spotLabel={`${spot.brand} ${spot.model}`}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCountChange={setCommentCount}
      />
    </article>
  )
}
