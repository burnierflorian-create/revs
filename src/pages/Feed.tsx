import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Car, Layers, Loader2, MapPin } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  categoryLabel,
  distanceMeters,
  timeAgo,
  type Spot,
} from '../lib/spots'
import { SkeletonCard } from '../components/Skeleton'
import LikeButton from '../components/LikeButton'

const PAGE = 10

const FILTERS = [
  'Tout',
  'Près de moi',
  'Supercars',
  'Hypercars',
  'JDM',
  'Classics',
] as const
type Filter = (typeof FILTERS)[number]

const FILTER_CAT: Record<string, string | undefined> = {
  Supercars: 'supercar',
  Hypercars: 'hypercar',
  JDM: 'JDM',
  Classics: 'classic',
}

// Distinct badge colour per category.
const CAT_COLOR: Record<string, string> = {
  supercar: '#F59E0B',
  hypercar: '#8B5CF6',
  JDM: '#E63946',
  classic: '#14B8A6',
  youngtimer: '#3B82F6',
  other: '#6B7280',
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

type Prof = { pseudo: string | null; ville: string | null; avatar: string | null }

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
            <img src={s.img} alt="" className="h-full w-full object-cover" />
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
  const [filter, setFilter] = useState<Filter>('Tout')
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [geoMsg, setGeoMsg] = useState<string | null>(null)

  const pageRef = useRef(0)
  const poolRef = useRef<Spot[]>([])
  const profilesRef = useRef<Record<string, Prof>>({})
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const mergeProfiles = useCallback(async (list: Spot[]) => {
    const ids = [
      ...new Set(
        list
          .map((s) => s.user_id)
          .filter((id) => !(id in profilesRef.current)),
      ),
    ]
    if (ids.length === 0) return
    const { data } = await supabase
      .from('profiles')
      .select('user_id, pseudo, ville, avatar')
      .in('user_id', ids)
    const next = { ...profilesRef.current }
    for (const p of (data ?? []) as ({ user_id: string } & Prof)[]) {
      next[p.user_id] = {
        pseudo: p.pseudo,
        ville: p.ville,
        avatar: p.avatar,
      }
    }
    // Mark every requested id as resolved so we don't refetch misses.
    for (const id of ids) if (!next[id]) next[id] = { pseudo: null, ville: null, avatar: null }
    profilesRef.current = next
    setProfiles(next)
  }, [])

  const serverPage = useCallback(
    async (offset: number): Promise<Spot[]> => {
      const cat = FILTER_CAT[filter]
      const base = supabase.from('spots').select('*')
      const { data } = await (cat ? base.eq('category', cat) : base)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE - 1)
      return (data ?? []) as Spot[]
    },
    [filter],
  )

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

  // (Re)load from scratch whenever the filter changes.
  useEffect(() => {
    let active = true
    setSpots(null)
    setHasMore(true)
    setGeoMsg(null)
    pageRef.current = 0
    poolRef.current = []
    ;(async () => {
      if (filter === 'Près de moi') {
        const pos = await getPosition()
        if (!active) return
        if (!pos) {
          setGeoMsg(
            'Active la localisation pour trier par distance — tri par récence en attendant.',
          )
          const first = await serverPage(0)
          if (!active) return
          pageRef.current = 1
          setHasMore(first.length === PAGE)
          await mergeProfiles(first)
          if (active) setSpots(first)
          return
        }
        const { data } = await supabase
          .from('spots')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200)
        if (!active) return
        const pool = ((data ?? []) as Spot[])
          .filter(
            (s) =>
              Number.isFinite(s.lat) && Number.isFinite(s.lng),
          )
          .sort(
            (a, b) =>
              distanceMeters(pos.lat, pos.lng, a.lat, a.lng) -
              distanceMeters(pos.lat, pos.lng, b.lat, b.lng),
          )
        poolRef.current = pool
        const slice = pool.slice(0, PAGE)
        setHasMore(pool.length > PAGE)
        await mergeProfiles(slice)
        if (active) setSpots(slice)
        return
      }
      const first = await serverPage(0)
      if (!active) return
      pageRef.current = 1
      setHasMore(first.length === PAGE)
      await mergeProfiles(first)
      if (active) setSpots(first)
    })()
    return () => {
      active = false
    }
  }, [filter, serverPage, getPosition, mergeProfiles])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || spots === null) return
    setLoadingMore(true)
    try {
      if (filter === 'Près de moi' && poolRef.current.length > 0) {
        const shown = spots.length
        const next = poolRef.current.slice(shown, shown + PAGE)
        await mergeProfiles(next)
        setSpots((cur) => [...(cur ?? []), ...next])
        setHasMore(shown + next.length < poolRef.current.length)
      } else {
        const next = await serverPage(pageRef.current * PAGE)
        pageRef.current += 1
        await mergeProfiles(next)
        setSpots((cur) => [...(cur ?? []), ...next])
        setHasMore(next.length === PAGE)
      }
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, spots, filter, serverPage, mergeProfiles])

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

  if (spots.length === 0 && filter === 'Tout') {
    return <EmptyCarousel onSpot={() => navigate('/new-spot')} />
  }

  return (
    <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <h1 className="py-4 font-display text-2xl font-bold text-fg">Fil</h1>

      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-accent text-fg'
                : 'bg-card text-fg/50 hover:text-fg'
            }`}
          >
            {f === 'Près de moi' && <MapPin className="h-3.5 w-3.5" />}
            {f}
          </button>
        ))}
      </div>

      {geoMsg && (
        <p className="mb-4 rounded-xl bg-card px-4 py-3 text-xs text-fg/50">
          {geoMsg}
        </p>
      )}

      {spots.length === 0 ? (
        <p className="px-1 py-16 text-center text-sm text-fg/40">
          Aucun spot dans « {filter} » pour le moment.
        </p>
      ) : (
        <div className="space-y-5">
          {groupSpots(spots).map(({ primary: spot, count }) => {
            const prof = profiles[spot.user_id]
            const pseudo = prof?.pseudo || 'Spotter'
            const color = CAT_COLOR[spot.category] ?? CAT_COLOR.other
            const name = spot.model || spot.brand || 'Voiture'
            const sub = [spot.brand, spot.year].filter(Boolean).join(' · ')
            return (
              <article
                key={spot.id}
                className="overflow-hidden rounded-2xl bg-card shadow-[0_4px_20px_rgba(0,0,0,0.45)]"
              >
                <button
                  onClick={() => navigate(`/spot/${spot.id}`)}
                  className="relative block w-full transition-transform active:scale-[0.98]"
                >
                  {spot.photo_url ? (
                    <img
                      src={spot.photo_url}
                      alt={`${spot.brand} ${spot.model}`}
                      className="aspect-[4/3] w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-[4/3] w-full items-center justify-center bg-white/5">
                      <Car className="h-12 w-12 text-fg/20" />
                    </div>
                  )}
                  <span
                    className="absolute left-3 top-3 rounded-full px-3 py-1 text-[10px] font-bold tracking-wide text-white shadow"
                    style={{ backgroundColor: color }}
                  >
                    {categoryLabel(spot.category).toUpperCase()}
                  </span>
                  {count > 1 && (
                    <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-black/70 px-3 py-1 text-[10px] font-bold tracking-wide text-white backdrop-blur">
                      <Layers className="h-3 w-3" />
                      {count} photos
                    </span>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent p-4 pt-10 text-left">
                    <h2 className="font-display text-xl font-bold leading-tight text-white">
                      {name}
                    </h2>
                    {sub && (
                      <p className="mt-0.5 text-sm text-white/70">{sub}</p>
                    )}
                  </div>
                </button>

                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-full bg-accent text-xs font-bold text-fg">
                    {prof?.avatar ? (
                      <img
                        src={prof.avatar}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      pseudo.charAt(0).toUpperCase()
                    )}
                  </div>
                  <span className="truncate text-sm font-medium text-fg">
                    {pseudo}
                  </span>
                  <span className="flex-1 truncate text-center text-xs text-fg/40">
                    {[prof?.ville, timeAgo(spot.created_at)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <LikeButton spotId={spot.id} className="flex-none" />
                </div>
              </article>
            )
          })}

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
