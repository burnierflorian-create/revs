import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Car, Filter as FilterIcon, Heart, Layers, Loader2, Search as SearchIcon, X, Zap } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  categoryLabel,
  distanceMeters,
  timeAgo,
  xpForSpot,
  type Spot,
} from '../lib/spots'
import { SkeletonCard } from '../components/Skeleton'
import LikeButton from '../components/LikeButton'
import FeedFiltersModal, {
  DEFAULT_FILTERS,
  filtersActive,
  type FeedFilters,
} from '../components/FeedFiltersModal'
import PullIndicator from '../components/PullIndicator'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { BRANDS } from '../lib/brands'
import { bodyTypeFor } from '../lib/car-body-type'
import { isFounder } from '../lib/founders'

const PAGE = 10
const POOL_SIZE = 200

// Distinct badge colour per category. `other` is omitted on purpose:
// when the spot is genuinely uncategorised we don't render any chip at
// all so the photo stays clean (instead of a meaningless grey "AUTRE").
const CAT_COLOR: Record<string, string> = {
  supercar: '#F59E0B',
  hypercar: '#8B5CF6',
  JDM: '#3B82F6',
  classic: '#A0522D',
  youngtimer: '#14B8A6',
}
// Twin-stop linear gradient per category — replaces the flat tint on
// the photo top-left badge. The lighter stop sits on the LEFT of the
// pill so the badge reads as a small highlighted jewel rather than a
// flat colour block (2026-06-02 Apple-style refinement).
const CAT_GRADIENT: Record<string, string> = {
  supercar: 'linear-gradient(90deg, #FBBF24 0%, #F59E0B 100%)',
  hypercar: 'linear-gradient(90deg, #A78BFA 0%, #8B5CF6 100%)',
  JDM: 'linear-gradient(90deg, #60A5FA 0%, #3B82F6 100%)',
  classic: 'linear-gradient(90deg, #C68642 0%, #A0522D 100%)',
  youngtimer: 'linear-gradient(90deg, #2DD4BF 0%, #14B8A6 100%)',
}

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
                idx === i ? 'w-6 bg-accent' : 'w-2 bg-white/40'
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
  const [filters, setFilters] = useState<FeedFilters>(DEFAULT_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
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

  // Double-tap-to-like state. tapStateRef tracks the last click time
  // and the navigation timer per spot so we can cancel navigation
  // when a second tap lands within the threshold. heartSpotId drives
  // the giant heart pop overlay (one at a time across the feed).
  const tapStateRef = useRef<
    Map<string, { lastTap: number; navTimer: number | null }>
  >(new Map())
  const [heartSpotId, setHeartSpotId] = useState<string | null>(null)

  /** Insert a spot_like row silently. Idempotent because the table's
   *  (spot_id, user_id) primary key turns a duplicate into a no-op.
   *  The card's LikeButton picks up the change via its realtime
   *  subscription, so the chip count + filled heart update on their
   *  own. */
  async function likeSilently(spotId: string) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    try {
      await supabase
        .from('spot_likes')
        .insert({ spot_id: spotId, user_id: user.id })
    } catch {
      /* duplicate or transient — ignore */
    }
  }

  /** Photo-area onClick handler: navigates on a single tap (after a
   *  250 ms debounce), but a second tap within the same window cancels
   *  the navigation and triggers a like + heart-pop overlay instead.
   *  iOS Instagram pattern. */
  function onPhotoTap(spotId: string) {
    const map = tapStateRef.current
    const entry = map.get(spotId) ?? { lastTap: 0, navTimer: null }
    const now = Date.now()
    if (now - entry.lastTap < 300) {
      // Double-tap: cancel pending navigation, fire like + heart.
      if (entry.navTimer != null) {
        clearTimeout(entry.navTimer)
      }
      map.set(spotId, { lastTap: 0, navTimer: null })
      setHeartSpotId(spotId)
      // Cleanup synced to the new 350 ms keyframe + 50 ms safety
      // buffer so the heart unmounts the moment the fade ends.
      window.setTimeout(() => {
        setHeartSpotId((cur) => (cur === spotId ? null : cur))
      }, 400)
      void likeSilently(spotId)
      return
    }
    // First tap: schedule navigation; the second tap (if any) will
    // cancel before this fires.
    if (entry.navTimer != null) clearTimeout(entry.navTimer)
    const navTimer = window.setTimeout(() => {
      navigate(`/spot/${spotId}`)
      map.set(spotId, { lastTap: 0, navTimer: null })
    }, 250)
    map.set(spotId, { lastTap: now, navTimer })
  }

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
  // avoid round-trips when toggling filters.
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
      if (filters.sort === 'liked') {
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
      if (filters.sort === 'nearby') {
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
      if (filters.city.trim()) {
        sideFetches.push(mergeProfiles(pool))
      }
      if (sideFetches.length) await Promise.all(sideFetches)
      if (!active) return

      const filtered = applyFilters(pool, filters)
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
  }, [filters, refreshKey, applyFilters, getPosition, mergeProfiles])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || spots === null) return
    setLoadingMore(true)
    try {
      const filtered = applyFilters(poolRef.current, filters)
      const shown = spots.length
      const next = filtered.slice(shown, shown + PAGE)
      await mergeProfiles(next)
      setSpots((cur) => [...(cur ?? []), ...next])
      setHasMore(shown + next.length < filtered.length)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, spots, filters, applyFilters, mergeProfiles])

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

  const allDefaults = !filtersActive(filters)
  if (spots.length === 0 && allDefaults) {
    return <EmptyCarousel onSpot={() => navigate('/new-spot')} />
  }


  return (
    <div
      ref={containerRef}
      className="relative min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))]"
    >
      <PullIndicator pull={pull} refreshing={refreshing} />
      <h1 className="display-xl py-5 text-fg">Fil</h1>

      {/* Search + filtres — glass premium. Background + border now
          resolve through CSS vars (--color-glass + --color-border)
          so the bar auto-flips when the user toggles dark / light
          from Settings. */}
      <div
        className="mb-3 flex items-center gap-2 rounded-full px-4 py-2.5"
        style={{
          background: 'var(--color-glass)',
          border: '1px solid var(--color-border)',
          backdropFilter: 'saturate(160%) blur(22px)',
          WebkitBackdropFilter: 'saturate(160%) blur(22px)',
          boxShadow: '0 4px 30px rgba(0, 0, 0, 0.40)',
        }}
      >
        <SearchIcon className="h-4 w-4 flex-none text-neutral-500" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Rechercher dans le fil…"
          className="flex-1 bg-transparent text-xs font-medium tracking-tight text-neutral-200 placeholder:text-neutral-500 outline-none"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            aria-label="Effacer"
            className="tappable text-neutral-500 hover:text-neutral-300"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mb-5 flex items-center gap-2">
        <button
          onClick={() => setFilters(DEFAULT_FILTERS)}
          className={`tappable flex-1 rounded-full px-4 py-2.5 text-xs font-bold transition-colors ${
            allDefaults
              ? 'bg-accent text-fg'
              : 'text-neutral-300 hover:text-white'
          }`}
          style={
            allDefaults
              ? undefined
              : {
                  background: 'var(--color-glass)',
                  border: '1px solid var(--color-border)',
                  backdropFilter: 'saturate(160%) blur(22px)',
                  WebkitBackdropFilter: 'saturate(160%) blur(22px)',
                }
          }
        >
          Tout
        </button>
        <button
          onClick={() => setFiltersOpen(true)}
          className={`tappable relative flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-bold transition-colors ${
            !allDefaults
              ? 'bg-accent/15 text-accent'
              : 'text-neutral-300 hover:text-white'
          }`}
          style={
            !allDefaults
              ? { border: '1px solid rgba(232,32,58,0.4)' }
              : {
                  background: 'var(--color-glass)',
                  border: '1px solid var(--color-border)',
                  backdropFilter: 'saturate(160%) blur(22px)',
                  WebkitBackdropFilter: 'saturate(160%) blur(22px)',
                }
          }
        >
          <FilterIcon className="h-3.5 w-3.5" />
          Filtres
          {!allDefaults && (
            <span className="ml-0.5 flex h-2 w-2 rounded-full bg-accent" />
          )}
        </button>
      </div>

      <FeedFiltersModal
        open={filtersOpen}
        initial={filters}
        onClose={() => setFiltersOpen(false)}
        onApply={setFilters}
      />

      {geoMsg && (
        <p className="mb-4 rounded-xl bg-card px-4 py-3 text-xs text-fg/50">
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
        <div className="space-y-5">
          {(() => {
            const needle = searchQuery.trim().toLowerCase()
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
                  <span className="text-fg"> « {searchQuery} »</span>.
                </p>
              )
            }
            return filtered.map(({ primary: spot, count }) => {
            const prof = profiles[spot.user_id]
            const pseudo = prof?.pseudo || 'Spotter'
            const catColor = CAT_COLOR[spot.category]
            const name = spot.model || spot.brand || 'Voiture'
            const sub = [spot.brand, spot.year].filter(Boolean).join(' · ')
            const founder = isFounder(spot.user_id)
            return (
              <article
                key={spot.id}
                className="overflow-hidden rounded-[38px] bg-card shadow-soft"
                style={{ border: '1px solid var(--color-border)' }}
              >
                {/* Photo card is a div+role=button so nested interactive
                    children (profile nav, LikeButton) remain valid HTML.
                    Keyboard activation mirrors a native <button>. */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onPhotoTap(spot.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onPhotoTap(spot.id)
                    }
                  }}
                  className="tappable relative block w-full cursor-pointer select-none"
                >
                  {spot.photo_url ? (
                    <img
                      src={spot.photo_url}
                      alt={`${spot.brand} ${spot.model}`}
                      loading="lazy"
                      className="aspect-[4/3] w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-[4/3] w-full items-center justify-center bg-white/5">
                      <Car className="h-12 w-12 text-fg2/40" />
                    </div>
                  )}

                  {/* Giant heart pop on double-tap. Overlay sits above
                      the gradient + chips, pointer-events: none so it
                      doesn't intercept further taps. */}
                  {heartSpotId === spot.id && (
                    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
                      <Heart
                        className="feed-double-heart h-28 w-28"
                        style={{ color: '#E8203A', fill: '#E8203A' }}
                      />
                    </div>
                  )}
                  {/* No badge for `other` — keeps the photo clean when
                      the category is genuinely undefined. */}
                  {catColor && (
                    <span
                      className="absolute left-4 top-4 z-20 rounded-full px-3 py-0.5 text-[9px] font-black uppercase tracking-widest text-black"
                      style={{
                        background:
                          CAT_GRADIENT[spot.category] ?? catColor,
                        boxShadow: `0 6px 16px ${catColor}40`,
                        letterSpacing: '0.14em',
                      }}
                    >
                      {categoryLabel(spot.category).toUpperCase()}
                    </span>
                  )}
                  {count > 1 && (
                    <span
                      className="absolute right-4 top-4 flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-bold text-white"
                      style={{
                        // Spec 2026-06-02 (later refinement): back to .50
                        // alpha for a slightly more transparent smoky
                        // glass per the latest UI directive.
                        background: 'rgba(0, 0, 0, 0.50)',
                        border: '1px solid rgba(255, 255, 255, 0.10)',
                        backdropFilter: 'saturate(160%) blur(12px)',
                        WebkitBackdropFilter: 'saturate(160%) blur(12px)',
                        boxShadow: '0 4px 14px rgba(0, 0, 0, 0.35)',
                      }}
                    >
                      <Layers className="h-3 w-3" />
                      {count}
                    </span>
                  )}
                  {/* Photo gradient — explicit h-44 (176px) per the
                      2026-06-02 satin spec so the fade hits a fixed
                      ramp regardless of brand/model text length and
                      keeps the identity row below it readable. */}
                  <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/95 via-black/40 to-transparent z-10 pointer-events-none" />
                  {/* Brand + model + XP overlay — sits above the identity
                      glass plate, riding the photo's bottom gradient. */}
                  <div className="absolute inset-x-0 bottom-16 z-20 px-4 text-left">
                    <div className="flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <h2
                          className="line-clamp-2 font-display font-extrabold leading-[1.05] tracking-tighter text-white"
                          style={{ fontSize: '22px', fontWeight: 800 }}
                        >
                          {name}
                        </h2>
                        {sub && (
                          <p className="mt-1 truncate text-[13px] text-white/55">
                            {sub}
                          </p>
                        )}
                      </div>
                      <span
                        className="flex flex-none items-center gap-1 rounded-full bg-black/55 px-2.5 py-1.5 text-[11px] font-extrabold tracking-wider text-white backdrop-blur"
                        style={{
                          border: '1px solid rgba(255,255,255,0.18)',
                          boxShadow:
                            '0 6px 18px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)',
                        }}
                      >
                        <Zap className="h-3 w-3 text-accent" />+
                        {xpForSpot(spot.estimated_price, spot.rarity)}
                      </span>
                    </div>
                  </div>

                  {/* Identity glass plate — own translucent strip at the
                      very bottom of the photo per the 2026-06-02 spec.
                      bg-black/40 + border-top white/5 + 12px blur so
                      the avatar/pseudo/Fondateur/time row reads on a
                      proper smoked-glass slate. Nested interactive
                      children use stopPropagation. */}
                  <div
                    className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-between gap-2 px-4 py-3"
                    style={{
                      background: 'rgba(0, 0, 0, 0.40)',
                      borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                      backdropFilter: 'saturate(160%) blur(12px)',
                      WebkitBackdropFilter: 'saturate(160%) blur(12px)',
                    }}
                  >
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate(`/u/${spot.user_id}`)
                        }}
                        className="tappable flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        aria-label={`Profil de ${pseudo}`}
                      >
                        <div
                          className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-full bg-neutral-900 text-sm font-extrabold text-white"
                          style={{
                            border: '1px solid rgba(255,255,255,0.10)',
                            boxShadow:
                              '0 4px 12px rgba(0,0,0,0.45)',
                          }}
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
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="truncate font-black tracking-tight text-white"
                              style={{ fontSize: '12px' }}
                            >
                              {pseudo}
                            </span>
                            {founder && (
                              <span
                                className="flex-none rounded font-black uppercase tracking-widest text-red-400"
                                style={{
                                  background: 'rgba(239, 68, 68, 0.10)',
                                  border:
                                    '1px solid rgba(239, 68, 68, 0.20)',
                                  padding: '2px 6px',
                                  fontSize: '8px',
                                  letterSpacing: '0.16em',
                                }}
                              >
                                Fondateur
                              </span>
                            )}
                          </div>
                          <p
                            className="truncate font-medium tracking-tight text-neutral-400"
                            style={{ fontSize: '10px' }}
                          >
                            {[prof?.ville, timeAgo(spot.created_at)]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                      </button>
                      <LikeButton spotId={spot.id} className="flex-none" />
                  </div>
                </div>
              </article>
            )
          })
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
