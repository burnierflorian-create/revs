import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
// `Map` est aliasé : importé tel quel, il masque le Map natif que ce
// fichier utilise pour indexer les profils, et le build casse sans rapport
// apparent avec l'icône.
import { Bookmark, Car, Heart, Layers, Loader2, Map as MapIcon, MapPin, MessageCircle, MoreHorizontal, Search as SearchIcon, SlidersHorizontal, SmilePlus, X, Zap } from 'lucide-react'
import { supabase } from '../lib/supabase'
import SpotMenu, { type SpotMenuAction } from '../components/SpotMenu'
import ReportSheet from '../components/ReportSheet'
import { onAvatarChange } from '../lib/avatar'
import {
  EMPTY_SOCIAL,
  REACTIONS,
  loadSpotSocial,
  setReaction,
  type Reaction,
  type SpotSocial,
} from '../lib/spotSocial'
import { hapticSelection } from '../lib/haptic'
import StoriesRow from '../components/stories/StoriesRow'
import { hasGeoPermission } from '../lib/geo'
import {
  distanceMeters,
  timeAgo,
  xpForSpot,
  type Spot,
} from '../lib/spots'
import { categoryBadge } from '../lib/categoryStyle'
import { rarityBadge } from '../lib/rarityStyle'
import { displayHandle } from '../lib/social'
import { SkeletonCard } from '../components/Skeleton'
import CommentsSheet from '../components/CommentsSheet'
import { hapticTap } from '../lib/haptic'
import { myPseudo, notifyPush } from '../lib/push'
import { onNewSpot } from '../lib/feedSync'
import FeedFiltersModal, {
  type FeedSort,
  filtersActive,
  loadFeedFilters,
  saveFeedFilters,
  type FeedFilters,
} from '../components/FeedFiltersModal'
import PullIndicator from '../components/PullIndicator'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import {
  matchesBrandFilter,
  matchesCategoryFilter,
} from '../lib/filterCatalog'
import { matchesRarityBucket, SHEET_CATEGORIES } from '../components/FilterSections'
import { isFounder } from '../lib/founders'
import { prefersReducedMotion } from '../lib/motion'

/** Les quatre entrées du Fil.
 *
 *  Un onglet n'est pas un filtre de plus : c'est le PÉRIMÈTRE dans lequel les
 *  filtres (catégorie, marque, rareté, ville) s'appliquent ensuite. D'où un
 *  état séparé — mélanger les deux obligerait à deviner, en lisant un
 *  réglage sauvegardé, lequel des deux l'utilisateur voulait vraiment. */
const FEED_TABS = ['foryou', 'following', 'nearby', 'popular'] as const
type FeedTab = (typeof FEED_TABS)[number]

/** L'ordre que chaque onglet impose au fil. « Pour toi » et « Abonnements »
 *  restent chronologiques : dans les deux cas on vient voir ce qui est
 *  nouveau, pas ce qui est le mieux classé. */
const TAB_SORT: Record<FeedTab, FeedSort> = {
  foryou: 'recent',
  following: 'recent',
  nearby: 'nearby',
  popular: 'liked',
}

const TAB_KEY = 'revs_feed_tab'

const PAGE = 10
const POOL_SIZE = 200

const SLIDES = [
  {
    img: 'https://images.unsplash.com/photo-1541348263662-e068662d82af?w=1200&q=80',
    titleKey: 'feedpage.slides.realtime',
  },
  {
    img: 'https://images.unsplash.com/photo-1567808291548-fc3ee04dbcf0?w=1200&q=80',
    titleKey: 'feedpage.slides.community',
  },
  {
    img: 'https://images.unsplash.com/photo-1617060219602-8cbf8f1eff8d?w=1200&q=80',
    titleKey: 'feedpage.slides.ranking',
  },
]

type Prof = {
  pseudo: string | null
  ville: string | null
  avatar: string | null
  title: string | null
  xp: number
  instagram: string | null
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
  const { t } = useTranslation()
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % SLIDES.length), 4000)
    return () => clearInterval(t)
  }, [])
  return (
    // pb : la barre de navigation basse recouvrait le bouton « Sois le
    // premier à spotter ». Une marge en rem ne suffit pas — il faut la
    // hauteur de la barre PLUS la zone sûre de l'appareil.
    <div className="flex min-h-screen flex-col bg-bg px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
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
                {t(s.titleKey)}
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
              aria-label={t('feedpage.slideAria', { number: idx + 1 })}
            />
          ))}
        </div>
      </div>
      <button
        onClick={onSpot}
        className="mt-6 w-full rounded-full bg-accent py-4 text-sm font-semibold text-fg shadow-lg shadow-accent/40"
      >
        {t('feedpage.beFirstToSpot')}
      </button>
    </div>
  )
}

export default function Feed() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [spots, setSpots] = useState<Spot[] | null>(null)
  const [profiles, setProfiles] = useState<Record<string, Prof>>({})
  // L'état social de toutes les cartes chargées, en une seule structure. La
  // carte le reçoit en propriété : elle n'interroge plus la base pour
  // s'afficher, seulement pour agir.
  const [social, setSocial] = useState<Record<string, SpotSocial>>({})
  // Dedupe/group once per spots change — not on every keystroke/re-render.
  const grouped = useMemo(() => groupSpots(spots ?? []), [spots])
  // Feed-only state — search + filters live entirely here and sort ONLY
  // the community post list. Filters persisted under their own key
  // (revs_feed_filters, distinct from the map's), restored on mount, so
  // nothing here ever touches the Carte.
  /** Catégories réellement représentées dans le vivier courant. */
  const [poolCats, setPoolCats] = useState<Set<string>>(() => new Set())
  const [tab, setTab] = useState<FeedTab>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(TAB_KEY) : null
    return (FEED_TABS as readonly string[]).includes(saved ?? '') ? (saved as FeedTab) : 'foryou'
  })
  // Les comptes que je suis — une requête, au montage. L'onglet
  // « Abonnements » filtre ensuite en mémoire : interroger la base à chaque
  // changement d'onglet pour une liste de sept identifiants serait absurde.
  const followingRef = useRef<Set<string> | null>(null)
  const [followingReady, setFollowingReady] = useState(false)
  const [feedFilters, setFeedFilters] = useState<FeedFilters>(() =>
    loadFeedFilters(),
  )
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [feedSearchQuery, setFeedSearchQuery] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  /** Un rechargement en cours alors qu'une liste est déjà affichée. Distinct
   *  de `spots === null`, qui signifie « rien n'a jamais été chargé ». */
  const [reloading, setReloading] = useState(false)
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


  useEffect(() => {
    let active = true
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!active) return
      if (!user) {
        followingRef.current = new Set()
        setFollowingReady(true)
        return
      }
      const { data } = await supabase
        .from('followers')
        .select('following_id')
        .eq('follower_id', user.id)
      if (!active) return
      followingRef.current = new Set(
        ((data ?? []) as { following_id: string }[]).map((r) => r.following_id),
      )
      setFollowingReady(true)
    })()
    return () => {
      active = false
    }
  }, [])

  const mergeProfiles = useCallback(async (list: Spot[], force = false) => {
    const ids = [
      ...new Set(
        list
          .map((s) => s.user_id)
          .filter((id) => force || !(id in profilesRef.current)),
      ),
    ]
    if (ids.length === 0) return
    // Parallel: profile fields + XP totals (used to derive the title chip).
    const [profsRes, xpRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('user_id, pseudo, ville, avatar, title, instagram')
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
      instagram: string | null
    }[]) {
      next[p.user_id] = {
        pseudo: p.pseudo,
        ville: p.ville,
        avatar: p.avatar,
        title: p.title,
        instagram: p.instagram ?? null,
        xp: xpByUser.get(p.user_id) ?? 0,
      }
    }
    // Mark every requested id as resolved so we don't refetch misses.
    for (const id of ids)
      if (!next[id])
        next[id] = { pseudo: null, ville: null, avatar: null, title: null, instagram: null, xp: 0 }
    profilesRef.current = next
    setProfiles(next)
  }, [])

  // Un appel par lot affiché, jamais un par carte. Les identifiants déjà
  // connus sont réinterrogés : un like posé ailleurs depuis le dernier
  // chargement doit se voir, et le coût est le même pour dix lignes.
  const socialRef = useRef<Record<string, SpotSocial>>({})
  const mergeSocial = useCallback(async (list: Spot[]) => {
    const ids = list.map((s) => s.id)
    if (ids.length === 0) return
    const got = await loadSpotSocial(ids)
    socialRef.current = { ...socialRef.current, ...got }
    setSocial(socialRef.current)
  }, [])

  /** Mise à jour optimiste d'une carte : l'interface répond au doigt, la
   *  base suit. Le prochain chargement du lot écrase de toute façon. */
  const patchSocial = useCallback((id: string, patch: Partial<SpotSocial>) => {
    socialRef.current = {
      ...socialRef.current,
      [id]: { ...(socialRef.current[id] ?? EMPTY_SOCIAL), ...patch },
    }
    setSocial(socialRef.current)
  }, [])

  // Changement de photo de profil — le Fil garde les profils résolus en
  // mémoire et ne les redemande jamais. Sans cette annonce, changer sa photo
  // puis revenir au Fil montrait encore l'ancienne, pour soi comme pour les
  // autres cartes du même auteur. Aucune requête : l'URL arrive avec
  // l'annonce.
  useEffect(
    () =>
      onAvatarChange((userId, avatar) => {
        const cur = profilesRef.current[userId]
        if (!cur) return
        profilesRef.current = { ...profilesRef.current, [userId]: { ...cur, avatar } }
        setProfiles(profilesRef.current)
      }),
    [],
  )

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
  /** Les filtres tels qu'ils s'appliquent réellement : ceux de la feuille,
   *  dont le tri est imposé par l'onglet actif. L'onglet décide COMMENT on
   *  ordonne ; la feuille décide CE QU'on garde. */
  const effectiveFilters = useMemo<FeedFilters>(
    () => ({ ...feedFilters, sort: TAB_SORT[tab] }),
    [feedFilters, tab],
  )

  // L'onglet est lu via une ref dans `applyFilters` : le passer en
  // dépendance recréerait le filtre — et donc rechargerait tout le pool — à
  // chaque bascule, alors que le pool est le même pour les quatre.
  const tabRef = useRef<FeedTab>(tab)
  // Écrit dans un effet, pas en plein rendu : React interdit de muter une
  // ref pendant le rendu, et l'effet s'exécute avant l'effet de chargement
  // qui la lit — l'ordre est garanti par leur ordre de déclaration.
  useEffect(() => {
    tabRef.current = tab
  }, [tab])

  const applyFilters = useCallback(
    (pool: Spot[], f: FeedFilters): Spot[] => {
      let out = pool
      // ── PÉRIMÈTRE DE L'ONGLET ──
      // « Abonnements » n'affiche que les comptes suivis. Tant que la liste
      // n'est pas revenue on ne filtre pas : montrer une page vide pendant
      // l'aller-retour ferait croire qu'on ne suit personne.
      if (f.sort !== undefined && tabRef.current === 'following' && followingRef.current) {
        const follows = followingRef.current
        out = out.filter((s) => follows.has(s.user_id))
      }
      // Category filter — shared matcher (spot.category enum + body-type
      // silhouette mapping + name keywords) so every bucket works.
      if (f.category && f.category !== 'Tout') {
        out = out.filter((s) => matchesCategoryFilter(s, f.category))
      }
      // Brand filter — shared matcher (catalogue `match[]` substrings).
      if (f.brand) {
        out = out.filter((s) => matchesBrandFilter(s, f.brand))
      }
      // Rarity bucket filter (Commun / Rare / Ultra Rare / Légendaire).
      if (f.rarity && f.rarity !== 'all') {
        out = out.filter((s) => matchesRarityBucket(s.rarity, f.rarity))
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
    // On NE vide PAS la liste ici. `spots = null` déclenche l'écran de
    // squelettes, qui remplace la page ENTIÈRE — barre d'onglets comprise.
    // Changer d'onglet faisait donc disparaître les onglets pendant deux
    // secondes : impossible d'en viser un autre, et l'impression que
    // l'application a planté. L'ancienne liste reste à l'écran, atténuée, le
    // temps que la nouvelle arrive.
    setReloading(true)
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
      setPoolCats(
        new Set(SHEET_CATEGORIES.filter((c) => c !== 'Tout' && pool.some((s) => matchesCategoryFilter(s, c)))),
      )

      // 2. Sort-specific side fetches in parallel.
      const sideFetches: Promise<unknown>[] = []
      if (effectiveFilters.sort === 'liked') {
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
      if (effectiveFilters.sort === 'nearby') {
        sideFetches.push(
          (async () => {
            // Never auto-prompt on load — only use GPS if already granted
            // (the 'nearby' sort is persisted, so this runs on every open).
            if (!(await hasGeoPermission())) {
              setGeoMsg(t('feedpage.geoDisabled'))
              return
            }
            const p = await getPosition()
            userPosRef.current = p
            if (!p) setGeoMsg(t('feedpage.geoDisabled'))
          })(),
        )
      }
      // City filter needs profiles to resolve villes — resolve them eagerly
      // so the initial filter pass doesn't miss matches.
      if (effectiveFilters.city.trim()) {
        sideFetches.push(mergeProfiles(pool))
      }
      if (sideFetches.length) await Promise.all(sideFetches)
      if (!active) return

      const filtered = applyFilters(pool, effectiveFilters)
      const slice = filtered.slice(0, PAGE)
      // `force` : un rechargement du Fil doit relire les profils, sinon un
      // avatar changé dans un autre onglet reste l'ancien tant que l'onglet
      // Fil n'a pas été démonté. Une requête pour toute la page.
      await Promise.all([mergeProfiles(slice, true), mergeSocial(slice)])
      if (!active) return
      pageRef.current = 1
      setHasMore(filtered.length > PAGE)
      setSpots(slice)
      setReloading(false)
    })()
    return () => {
      active = false
    }
    // `followingReady` : tant que la liste des abonnements n'est pas
    // revenue, l'onglet « Abonnements » ne filtre rien. Ce drapeau déclenche
    // le seul rechargement nécessaire, une fois, à son arrivée.
  }, [
    effectiveFilters,
    refreshKey,
    followingReady,
    applyFilters,
    getPosition,
    mergeProfiles,
    mergeSocial,
    t,
  ])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || spots === null) return
    setLoadingMore(true)
    try {
      const filtered = applyFilters(poolRef.current, effectiveFilters)
      const shown = spots.length
      const next = filtered.slice(shown, shown + PAGE)
      await Promise.all([mergeProfiles(next), mergeSocial(next)])
      setSpots((cur) => [...(cur ?? []), ...next])
      setHasMore(shown + next.length < filtered.length)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, spots, effectiveFilters, applyFilters, mergeProfiles, mergeSocial])

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

  /** Les catégories à proposer, et elles seules.
   *
   *  La référence montre une rangée fixe. Ici elle est calculée sur le vivier
   *  réellement chargé : une pastille « Hypercars » qui ne renvoie jamais
   *  rien n'est pas un filtre, c'est une impasse. « Tout » reste toujours
   *  présent, et la catégorie active aussi — sans quoi la pastille sur
   *  laquelle on vient d'appuyer disparaîtrait sous le doigt.
   *
   *  Le calcul se fait sur le VIVIER (`poolCats`, posé au chargement) et non
   *  sur les spots affichés : ces derniers sont déjà filtrés, donc une fois
   *  « Supercars » choisi toutes les autres pastilles disparaîtraient. */
  const categoryChips = useMemo(() => {
    const present = SHEET_CATEGORIES.filter(
      (c) => c !== 'Tout' && (c === feedFilters.category || poolCats.has(c)),
    )
    return ['Tout', ...present]
  }, [poolCats, feedFilters.category])

  if (spots === null) {
    return (
      <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="space-y-5 pt-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    )
  }

  const allDefaults = !filtersActive(feedFilters)
  // Le carrousel d'accueil dit « REVS est vide, sois le premier ». Il ne vaut
  // que sur « Pour toi » sans filtre : affiché sur « Abonnements », il
  // remplaçait la page entière — barre d'onglets comprise — pour annoncer
  // que REVS est désert, alors qu'il manquait seulement quelqu'un à suivre.
  if (spots.length === 0 && allDefaults && tab === 'foryou') {
    return <EmptyCarousel onSpot={() => navigate('/new-spot')} />
  }

  // The filter icon dot lights up whenever ANY filter is non-default —
  // everything (catégorie / marque / rareté) now lives in the sheet.
  const advancedActive = filtersActive(feedFilters)


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

      {/* Search (~85%) + a single minimal slider icon that opens the
          filters sheet. The "Fil" title was removed 2026-06-23; the
          category / brand / rarity pills moved INTO the sheet 2026-06-23
          so the header is just the search row and the photos below own
          the screen. Glass + border resolve through CSS vars so the
          whole row auto-flips dark / light. */}
      <div className="mb-4 flex items-center gap-2 px-4 pt-3">
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
            placeholder={t('feedpage.searchPlaceholder')}
            style={{ fontSize: '16px' }}
            className="flex-1 bg-transparent font-medium tracking-tight text-fg/80 placeholder:text-fg2 outline-none"
          />
          {feedSearchQuery && (
            <button
              onClick={() => setFeedSearchQuery('')}
              aria-label={t('feedpage.clear')}
              className="tappable text-fg2 hover:text-fg"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          onClick={() => setFiltersOpen(true)}
          aria-label={t('feedpage.advancedFilters')}
          className="tappable relative flex flex-none items-center justify-center"
          style={{
            height: 36,
            width: 36,
            borderRadius: 10,
            background: advancedActive ? 'rgba(232,32,58,0.15)' : '#1a1a1a',
            border: advancedActive
              ? '1px solid rgba(232,32,58,0.40)'
              : '1px solid #333',
          }}
        >
          <SlidersHorizontal
            className={`h-[18px] w-[18px] ${advancedActive ? 'text-accent' : 'text-fg2'}`}
          />
          {advancedActive && (
            <span
              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent"
              style={{ border: '2px solid rgb(var(--color-bg))' }}
            />
          )}
        </button>
      </div>

      {/* ── LES QUATRE ENTRÉES DU FIL ──
          Pour toi · Abonnements · À proximité · Populaires.
          Au-dessus des catégories, parce qu'elles sont au-dessus dans la
          hiérarchie : l'onglet choisit DE QUI on regarde les spots, la
          catégorie choisit LESQUELS. L'actif porte le rouge REVS ; les autres
          restent neutres pour qu'un seul élément attire l'œil. */}
      <div
        role="tablist"
        aria-label={t('feedpage.tabsLabel')}
        className="mb-3 flex gap-2 overflow-x-auto px-4"
        style={{ scrollbarWidth: 'none' }}
        data-swipe-x=""
      >
        {FEED_TABS.map((k) => {
          const on = tab === k
          return (
            <button
              key={k}
              role="tab"
              aria-selected={on}
              onClick={() => {
                if (on) return
                hapticSelection()
                setTab(k)
                try {
                  localStorage.setItem(TAB_KEY, k)
                } catch {
                  // Mode privé : l'onglet ne survivra pas à la fermeture, et
                  // c'est tout ce que l'on perd.
                }
              }}
              className="tappable flex-none rounded-full px-4 py-2 text-[13.5px] transition-colors"
              style={
                on
                  ? {
                      background: 'var(--revs-red)',
                      color: '#fff',
                      fontWeight: 700,
                      boxShadow: '0 2px 14px rgb(var(--color-accent) / 0.4)',
                    }
                  : {
                      background: 'rgb(var(--color-fg) / 0.05)',
                      color: 'rgb(var(--color-fg-2))',
                      fontWeight: 500,
                    }
              }
            >
              {t(`feedpage.tab.${k}`)}
            </button>
          )
        })}
      </div>

      {/* Catégories — contrôle segmenté défilant, sous la recherche.
          Elles existaient déjà, mais uniquement au fond de la feuille de
          filtres : il fallait ouvrir une modale pour changer de catégorie,
          alors que c'est le filtre le plus utilisé. Elles pilotent le MÊME
          `feedFilters.category` que la feuille — une seule source de vérité,
          pas deux états à synchroniser. */}
      {categoryChips.length > 1 && (
        <div
          className="mb-3 flex gap-2 overflow-x-auto px-4 pb-1"
          style={{ scrollbarWidth: 'none' }}
          data-swipe-x=""
        >
          {categoryChips.map((c) => {
            const on = feedFilters.category === c
            return (
              <button
                key={c}
                onClick={() => {
                  hapticSelection()
                  setFeedFilters((f) => ({ ...f, category: c }))
                }}
                aria-pressed={on}
                className="tappable flex-none rounded-full px-4 py-2 text-[13px] transition-colors"
                style={
                  on
                    ? {
                        background: 'var(--revs-red)',
                        color: '#fff',
                        fontWeight: 700,
                        boxShadow: '0 2px 14px rgb(var(--color-accent) / 0.4)',
                      }
                    : {
                        background: 'rgb(var(--color-fg) / 0.05)',
                        color: 'rgb(var(--color-fg-2))',
                        fontWeight: 500,
                      }
                }
              >
                {c === 'Tout' ? t('feedpage.allCategories') : c}
              </button>
            )
          })}
        </div>
      )}

      {/* Stories — SOUS les filtres et AU-DESSUS des publications, comme le
          demande la référence : une story est une actualité de quelques
          heures, elle se consulte avant de descendre dans le fil. */}
      <StoriesRow />

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
          {/* Le vide d'un onglet ne dit pas la même chose que le vide du
              Fil. « Aucun spot » sur « Abonnements » laisse croire que REVS
              est désert, alors qu'il manque seulement quelqu'un à suivre. */}
          <p className="mt-4 font-display text-lg font-extrabold tracking-tighter text-fg">
            {tab === 'following'
              ? t('feedpage.emptyFollowing')
              : tab === 'nearby'
                ? t('feedpage.emptyNearby')
                : tab === 'popular'
                  ? t('feedpage.emptyPopular')
                  : allDefaults
                    ? t('feedpage.empty.noSpotsTitle')
                    : t('feedpage.empty.noMatchTitle')}
          </p>
          <p className="mt-1 text-sm text-fg2">
            {tab === 'following'
              ? t('feedpage.emptyFollowingBody')
              : allDefaults
                ? t('feedpage.empty.noSpotsBody')
                : t('feedpage.empty.noMatchBody')}
          </p>
        </div>
      ) : (
        <div
          style={{
            opacity: reloading ? 0.45 : 1,
            transition: 'opacity 160ms linear',
            pointerEvents: reloading ? 'none' : undefined,
          }}
        >
          {(() => {
            const needle = feedSearchQuery.trim().toLowerCase()
            const filtered = needle
              ? grouped.filter(({ primary: s }) => {
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
              : grouped
            if (filtered.length === 0) {
              return (
                <p className="px-8 py-12 text-center text-sm text-fg2">
                  {t('feedpage.searchNoResults')}
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
                social={social[spot.id] ?? EMPTY_SOCIAL}
                onPatch={patchSocial}
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
              {t('feedpage.allCaughtUp')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────── FEED CARD ───────────────────────────────

// Double-tap heart burst — 8 fixed directions, slightly varied distance
// (60–80px) and size (8–16px) for a natural pop. Deterministic so the
// render stays pure.
const HEART_DIRS = [0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
  const a = (deg * Math.PI) / 180
  const dist = 60 + (i % 3) * 10
  const size = 8 + (i % 5) * 2
  return {
    hx: Math.cos(a) * dist,
    hy: Math.sin(a) * dist,
    size,
  }
})

/** One spot in the feed — Instagram-grade. Layers: spotter row, 4:5
 *  edge-to-edge photo (double-tap to like, never navigates), tools row
 *  (like + count, comment + count, XP badge), tappable title block (the
 *  only path to the detail page), and a quick-comment row that opens the
 *  comments sheet. All theme-aware. */
const FeedCard = memo(function FeedCard({
  spot,
  prof,
  burstCount,
  social,
  onPatch,
}: {
  spot: Spot
  prof?: Prof
  burstCount: number
  /** Likes, commentaires, réactions et mon état, chargés par lot. La carte
   *  ne les redemande jamais : elle les reçoit. */
  social: SpotSocial
  onPatch: (id: string, patch: Partial<SpotSocial>) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const meRef = useRef<string | null>(null)
  const busyRef = useRef(false)
  const lastTapRef = useRef(0)
  // Pending single-tap → open detail. Cancelled if a 2nd tap (double-tap
  // like) lands within the 300 ms window.
  const tapNavRef = useRef<number | null>(null)
  // Parallax: the photo is 120% tall inside an overflow-hidden frame; we
  // translate it at ~0.1× the card's distance from the viewport centre so
  // it drifts slower than the scroll. Capturing scroll listener catches
  // the tab-pane's scroll (events don't bubble, but capture does).
  const photoRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  useEffect(() => {
    if (prefersReducedMotion()) return
    const photo = photoRef.current
    const img = imgRef.current
    if (!photo || !img) return
    let visible = false
    let raf = 0
    const apply = () => {
      raf = 0
      const rect = photo.getBoundingClientRect()
      const vh = window.innerHeight || 1
      const offset = rect.top + rect.height / 2 - vh / 2
      const margin = rect.height * 0.1
      const ty = Math.max(-margin, Math.min(margin, offset * 0.1)) - margin
      img.style.transform = `translate3d(0, ${ty}px, 0)`
    }
    const onScroll = () => {
      if (visible && !raf) raf = requestAnimationFrame(apply)
    }
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? false
        if (visible) onScroll()
      },
      { threshold: 0 },
    )
    io.observe(photo)
    window.addEventListener('scroll', onScroll, true)
    apply()
    return () => {
      io.disconnect()
      window.removeEventListener('scroll', onScroll, true)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])
  const bmBusyRef = useRef(false)
  // Tout l'état social vient du Fil. Le lire ici plutôt que de le recopier
  // dans un useState garantit qu'une carte ne peut pas afficher un compteur
  // que la page a déjà corrigé ailleurs.
  const { liked, likeCount, commentCount, bookmarked } = {
    liked: social.liked,
    likeCount: social.like_count,
    commentCount: social.comment_count,
    bookmarked: social.bookmarked,
  }
  const [heartPop, setHeartPop] = useState(false)
  const [reactOpen, setReactOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  // En état et non en ref : le rendu s'en sert pour décider si « Supprimer »
  // apparaît, et une ref lue pendant le rendu ne provoquerait pas le second
  // rendu qui fait apparaître l'entrée.
  const [meId, setMeId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [myAvatar, setMyAvatar] = useState<string | null>(null)
  const [myInitial, setMyInitial] = useState('?')

  const pseudo = prof?.pseudo || t('feedpage.defaultPseudo')
  // L'Instagram de l'auteur, dans l'en-tête de SA publication. Emplacement
  // stable et discret : plus besoin de le recopier dans chaque description.
  // Rien n'est affiché quand il n'est pas renseigné — le champ est facultatif.
  const igLabel = displayHandle(prof?.instagram)
  const ville = prof?.ville?.trim() || ''
  const founder = isFounder(spot.user_id)
  const cat = categoryBadge(spot.category)
  const rb = rarityBadge(spot.rarity)
  const title = [spot.brand, spot.model].filter(Boolean).join(' ') || t('feedpage.defaultCar')

  /** La ligne « 2017 · 1.0 TSI · 95 ch » de la référence.
   *
   *  Tout vient de `spot.car_info`, déjà porté par le spot — aucune requête
   *  supplémentaire : une par carte sur un fil qui défile coûterait bien plus
   *  cher que la ligne ne vaut. Chaque élément n'apparaît que s'il existe
   *  réellement ; une voiture sans fiche moteur affiche son année seule, et
   *  une voiture sans rien n'affiche pas de ligne du tout. */
  const specLine = [
    spot.year ? String(spot.year) : null,
    spot.car_info?.engine?.trim() || null,
    spot.car_info?.horsepower?.trim() || null,
    cat?.label ?? null,
  ]
    .filter(Boolean)
    .join(' · ')

  // Identité de l'utilisateur courant — pour l'avatar du champ commentaire
  // et pour savoir au nom de qui écrire. L'état social, lui, n'est PLUS
  // chargé ici : il descend du Fil, qui l'obtient pour toute la page en un
  // appel (`spot_social`, migration 0116). Quatre requêtes par carte sur dix
  // cartes faisaient quarante allers-retours au premier rendu.
  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!active || !user) return
      meRef.current = user.id
      setMeId(user.id)
      const { data } = await supabase
        .from('profiles')
        .select('avatar, pseudo')
        .eq('user_id', user.id)
        .maybeSingle()
      if (!active) return
      const m = data as { avatar: string | null; pseudo: string | null } | null
      setMyAvatar(m?.avatar ?? null)
      setMyInitial((m?.pseudo ?? user.email ?? '?').charAt(0).toUpperCase())
    })()
    return () => {
      active = false
    }
  }, [])

  async function setLikeState(next: boolean) {
    const uid = meRef.current
    if (!uid || busyRef.current || next === liked) return
    busyRef.current = true
    onPatch(spot.id, { liked: next, like_count: Math.max(0, likeCount + (next ? 1 : -1)) })
    const op = next
      ? supabase.from('spot_likes').insert({ spot_id: spot.id, user_id: uid })
      : supabase
          .from('spot_likes')
          .delete()
          .eq('spot_id', spot.id)
          .eq('user_id', uid)
    const { error } = await op
    if (error) {
      onPatch(spot.id, { liked: !next, like_count: likeCount })
    } else if (next && spot.user_id !== uid) {
      const who = await myPseudo()
      void notifyPush({
        user_id: spot.user_id,
        title: t('feedpage.push.likeTitle'),
        body: t('feedpage.push.likeBody', {
          who,
          brand: spot.brand,
          model: spot.model,
        }),
        url: `/spot/${spot.id}`,
        type: 'likes',
      })
    }
    busyRef.current = false
  }

  /** Mettre de côté, ou retirer.
   *
   *  Optimiste puis corrigé en cas d'échec, comme le like : l'icône doit
   *  répondre au doigt, pas au réseau. La contrainte d'unicité en base rend
   *  un double ajout impossible — on s'appuie dessus plutôt que de vérifier
   *  avant d'écrire, une vérification préalable laissant toujours une course
   *  ouverte entre deux appuis rapprochés. */
  async function toggleBookmark() {
    const uid = meRef.current
    if (!uid || bmBusyRef.current) return
    bmBusyRef.current = true
    const next = !bookmarked
    onPatch(spot.id, { bookmarked: next })
    hapticTap()
    const { error } = next
      ? await supabase.from('spot_bookmarks').insert({ spot_id: spot.id, user_id: uid })
      : await supabase
          .from('spot_bookmarks')
          .delete()
          .eq('spot_id', spot.id)
          .eq('user_id', uid)
    // 23505 = la ligne existait déjà : l'état visé est atteint, ce n'est pas
    // un échec.
    if (error && error.code !== '23505') onPatch(spot.id, { bookmarked: !next })
    bmBusyRef.current = false
  }

  /** Pose, change ou retire sa réaction.
   *
   *  Le compteur bouge de +1, 0 ou -1 selon qu'on en posait déjà une : poser
   *  après avoir déjà réagi remplace, cela n'ajoute pas une voix. La base
   *  l'impose de toute façon par sa clé primaire — on ne fait ici que ne pas
   *  la contredire à l'écran le temps de l'aller-retour. */
  async function react(emoji: Reaction) {
    const uid = meRef.current
    if (!uid) return
    const prev = social.my_reaction
    const next = prev === emoji ? null : emoji
    const counts = { ...social.reactions }
    if (prev) counts[prev] = Math.max(0, (counts[prev] ?? 1) - 1)
    if (next) counts[next] = (counts[next] ?? 0) + 1
    onPatch(spot.id, {
      my_reaction: next,
      reactions: counts,
      reaction_count: Math.max(0, social.reaction_count + (next ? 1 : 0) - (prev ? 1 : 0)),
    })
    setReactOpen(false)
    hapticTap()
    const applied = await setReaction(spot.id, uid, emoji, prev)
    if (applied !== next) onPatch(spot.id, { my_reaction: applied })
  }

  /** Signaler, ou supprimer la sienne.
   *
   *  Le signalement ouvre la feuille des motifs : le motif oriente ce qu'un
   *  modérateur regarde en premier, et le choisir à la place de l'utilisateur
   *  reviendrait à classer tous les dossiers pareil. */
  async function onMenuAction(a: SpotMenuAction) {
    const uid = meRef.current
    if (!uid) return
    if (a === 'report') {
      setReportOpen(true)
      return
    }
    if (a === 'delete') {
      if (spot.user_id !== uid) return
      const { error } = await supabase.from('spots').delete().eq('id', spot.id)
      if (!error) setNotice(t('spotmenu.deleted'))
      setTimeout(() => setNotice(null), 2600)
    }
  }

  // Single tap → open the spot detail (after a 300 ms wait to rule out a
  // double-tap). A second tap within 300 ms is a double-tap → like + spring
  // heart pop, and cancels the pending navigation.
  function onPhotoTap() {
    const now = Date.now()
    if (now - lastTapRef.current < 300) {
      lastTapRef.current = 0
      if (tapNavRef.current) {
        clearTimeout(tapNavRef.current)
        tapNavRef.current = null
      }
      setHeartPop(true)
      hapticTap()
      // 650ms so the 600ms mini-heart burst finishes before unmount.
      window.setTimeout(() => setHeartPop(false), 650)
      void setLikeState(true) // double-tap always likes, never unlikes
    } else {
      lastTapRef.current = now
      if (tapNavRef.current) clearTimeout(tapNavRef.current)
      tapNavRef.current = window.setTimeout(() => {
        tapNavRef.current = null
        navigate(`/spot/${spot.id}`)
      }, 300)
    }
  }

  return (
    // 8px gap between posts on the #0a0a0a page; each post's interactions
    // live on a clean #141414 block so they never bleed into the next one.
    <article className="feed-card" style={{ marginBottom: '8px' }}>
      {/* EN-TÊTE — AU-DESSUS de la photo, pas posé dessus.
          Il flottait sur l'image, ce qui obligeait à un fond translucide et
          le rendait plus ou moins lisible selon la photo. La référence le
          sort de l'image : l'auteur et le lieu appartiennent à la
          publication, la photo appartient à la voiture. */}
      <div className="flex items-center gap-2.5 px-4 pb-2.5 pt-3">
        <button
          onClick={() => navigate(`/u/${spot.user_id}`)}
          aria-label={t('feedpage.profileOf', { pseudo })}
          className="tappable flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-full bg-fg/10 text-[15px] font-extrabold text-fg"
          style={{ border: '2px solid var(--revs-red)' }}
        >
          {prof?.avatar ? (
            <img
              src={prof.avatar}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full rounded-full object-cover"
              style={{ objectPosition: 'top' }}
            />
          ) : (
            pseudo.charAt(0).toUpperCase()
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              onClick={() => navigate(`/u/${spot.user_id}`)}
              className="tappable truncate text-[15px] font-bold leading-tight text-fg"
            >
              {pseudo}
            </button>
            {founder && (
              <span
                className="flex-none rounded px-1.5 py-[2px] text-[9px] font-extrabold uppercase tracking-wider text-white"
                style={{ background: 'var(--revs-red)' }}
              >
                {t('feedpage.founder')}
              </span>
            )}
            {igLabel && (
              <span className="truncate text-[13px] font-medium text-fg2">
                {igLabel}
              </span>
            )}
          </div>
          <p className="mt-0.5 flex items-center gap-1 text-[12.5px] text-fg2">
            {ville && (
              <>
                <MapPin className="h-3 w-3 flex-none" />
                <span className="truncate">{ville}</span>
                <span aria-hidden>·</span>
              </>
            )}
            <span className="flex-none">{timeAgo(spot.created_at)}</span>
          </p>
        </div>
        {/* « … » — copier le lien, partager, signaler, et supprimer si c'est
            la sienne. Posé à droite de l'en-tête comme sur la référence. */}
        <button
          onClick={() => setMenuOpen(true)}
          aria-label={t('spotmenu.open')}
          className="tappable -mr-1 flex h-9 w-9 flex-none items-center justify-center rounded-full text-fg2"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>

      {/* Confirmation du signalement ou de la suppression. Un bandeau dans
          la carte plutôt qu'une alerte : une alerte bloque la page entière
          pour dire « merci ». */}
      {notice && (
        <p
          role="status"
          className="mx-4 mb-1 rounded-xl px-3 py-2 text-center text-[12.5px] font-semibold text-fg"
          style={{ background: 'rgb(var(--color-accent) / 0.16)' }}
        >
          {notice}
        </p>
      )}

      <ReportSheet
        open={reportOpen}
        targetType="spot"
        targetId={spot.id}
        label={title}
        onClose={() => setReportOpen(false)}
      />

      <SpotMenu
        spotId={spot.id}
        label={title}
        isMine={meId === spot.user_id}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onAction={(a) => void onMenuAction(a)}
      />

      {/* PHOTO 4:5 — full-bleed. Rarity badge top-right, 44px floating
          header, and the car identity over a bottom gradient that keeps
          the text legible on any photo. Double-tap likes; never navigates. */}
      <div
        ref={photoRef}
        onClick={onPhotoTap}
        // 1/1 et non 4/5 : mesuré sur la référence, la photo y est carrée, et
        // c'est ce qui fait tenir la carte ENTIÈRE sur un écran — en-tête,
        // identité du véhicule, actions et bouton carte. En 4/5 le bouton
        // « Voir sur la carte » tombait systématiquement sous la ligne de
        // flottaison, donc personne ne le voyait.
        className="relative aspect-square cursor-pointer select-none overflow-hidden"
      >
        {spot.photo_url ? (
          <img
            ref={imgRef}
            src={spot.photo_url}
            alt={title}
            loading="lazy"
            decoding="async"
            className="absolute left-0 top-0 w-full object-cover contrast-[1.03] brightness-[0.98]"
            style={{ height: '120%', willChange: 'transform' }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-fg/5">
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

        {/* Identité du véhicule, posée au bas de la photo.
            La référence sépare trois niveaux : la MARQUE en petit au-dessus,
            le MODÈLE en gros, puis une ligne de caractéristiques. L'ancienne
            version écrivait « marque modèle » sur une seule ligne et mêlait
            à la suite la catégorie, la ville et l'heure — c'est-à-dire des
            informations sur la PUBLICATION, qui vivent maintenant dans
            l'en-tête, au-dessus de la photo. */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            navigate(`/spot/${spot.id}`)
          }}
          className="absolute inset-x-0 bottom-0 z-10 px-4 pb-3 text-left"
          aria-label={t('feedpage.view', { title })}
        >
          {spot.brand && (
            <p className="truncate text-[12px] font-semibold uppercase tracking-[0.12em] text-white/70">
              {spot.brand}
            </p>
          )}
          <p className="truncate text-[21px] font-bold leading-tight text-white">
            {spot.model || title}
          </p>
          {specLine && (
            <p className="mt-1 truncate text-[13px] font-medium text-white/75">
              {specLine}
            </p>
          )}
          {spot.description?.trim() ? (
            <p className="clamp-2 mt-1 text-[13px] leading-snug text-white/70">
              {spot.description.trim()}
            </p>
          ) : null}
        </button>

        {heartPop && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
            <Heart
              className="feed-double-heart h-28 w-28"
              style={{ color: '#FF2D46', fill: '#FF2D46' }}
            />
            {HEART_DIRS.map((d, i) => (
              <Heart
                key={i}
                className="feed-mini-heart"
                style={
                  {
                    width: d.size,
                    height: d.size,
                    '--hx': `${d.hx}px`,
                    '--hy': `${d.hy}px`,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
        )}

        {/* Compteur de photos — en haut à GAUCHE, face au badge de rareté.
            Il était sous le badge, à droite, où les deux se chevauchaient
            visuellement. */}
        {burstCount > 1 && (
          <span
            className="absolute left-3 top-3 z-20 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums text-white"
            style={{
              background: 'rgba(0, 0, 0, 0.5)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              backdropFilter: 'saturate(160%) blur(12px)',
              WebkitBackdropFilter: 'saturate(160%) blur(12px)',
            }}
          >
            <Layers className="h-3 w-3" />
            1/{burstCount}
          </span>
        )}
      </div>

      {/* Interactions block — own #141414 surface so likes / comments / XP
          + the comment bar clearly belong to THIS post. */}
      <div style={{ background: '#141414' }}>
        <div className="flex items-center gap-5 px-4 pt-3">
          <button
            onClick={() => setLikeState(!liked)}
            aria-label={liked ? t('feedpage.unlike') : t('feedpage.like')}
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
            aria-label={t('feedpage.comments')}
            className="tappable flex items-center gap-1.5"
          >
            <MessageCircle strokeWidth={1.2} className="h-6 w-6 text-white" />
            <span className="text-sm font-medium text-white">{commentCount}</span>
          </button>
          {/* Favori — distinct du like : le like applaudit, le favori range.
              Les deux coexistent donc, comme sur la référence. */}
          <button
            onClick={toggleBookmark}
            aria-label={bookmarked ? t('feedpage.unbookmark') : t('feedpage.bookmark')}
            aria-pressed={bookmarked}
            className="tappable flex items-center"
          >
            <Bookmark
              strokeWidth={1.2}
              className={`h-6 w-6 transition-colors ${bookmarked ? 'fill-accent text-accent' : 'text-white'}`}
            />
          </button>
          {/* ── RÉACTIONS ──
              Le déclencheur reste discret : soit le visage neutre, soit la
              réaction qu'on a posée. Le panneau ne s'ouvre qu'au doigt, et se
              referme au choix — une réaction est un geste d'une seconde, pas
              un formulaire. Le cœur n'est pas dans la liste : il EST le
              bouton Like, deux centimètres à gauche. */}
          <div className="relative flex items-center">
            <button
              onClick={() => setReactOpen((v) => !v)}
              aria-label={t('feedpage.react')}
              aria-expanded={reactOpen}
              className="tappable flex items-center gap-1.5"
            >
              {social.my_reaction ? (
                <span className="text-[20px] leading-none">{social.my_reaction}</span>
              ) : (
                <SmilePlus strokeWidth={1.2} className="h-6 w-6 text-white" />
              )}
              {social.reaction_count > 0 && (
                <span className="text-sm font-medium text-white">{social.reaction_count}</span>
              )}
            </button>
            {reactOpen && (
              <>
                {/* Voile transparent : un appui n'importe où ailleurs referme,
                    sans qu'il faille viser à nouveau le petit bouton. */}
                <button
                  aria-hidden
                  tabIndex={-1}
                  onClick={() => setReactOpen(false)}
                  className="fixed inset-0 z-[60] cursor-default"
                />
                <div
                  role="group"
                  aria-label={t('feedpage.react')}
                  className="absolute bottom-full left-1/2 z-[61] mb-2 flex -translate-x-1/2 gap-1 rounded-full px-2 py-1.5"
                  style={{
                    background: 'rgba(20,20,20,0.96)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
                    backdropFilter: 'blur(10px)',
                  }}
                >
                  {REACTIONS.map((e) => (
                    <button
                      key={e}
                      onClick={() => void react(e)}
                      aria-label={e}
                      aria-pressed={social.my_reaction === e}
                      className="tappable flex h-9 w-9 items-center justify-center rounded-full text-[20px] leading-none transition-transform active:scale-90"
                      style={{
                        background:
                          social.my_reaction === e ? 'rgba(232,32,58,0.22)' : 'transparent',
                      }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <span className="ml-auto flex items-center gap-1 text-white/50">
            <Zap strokeWidth={1.2} className="h-[18px] w-[18px] text-accent" />
            <span className="text-xs font-medium tabular-nums">
              +{xpForSpot(spot.estimated_price, spot.rarity)} XP
            </span>
          </span>
        </div>

        {/* « Voir sur la carte » — demandé par la référence.
            Il n'ouvre pas la Map générale : il transmet l'identifiant du spot
            dans l'URL, et la Map s'y recentre, sélectionne le marqueur et
            ouvre son aperçu. Sans cela le bouton reposerait la question qu'il
            prétend résoudre : « où était cette voiture ? ».
            Masqué quand le spot n'a pas de coordonnées exploitables — un
            bouton qui mène à une carte vide est pire que pas de bouton. */}
        {Number.isFinite(spot.lat) && Number.isFinite(spot.lng) && (
          <button
            onClick={() => navigate(`/map?spot=${spot.id}`)}
            className="tappable mx-4 mt-3 flex w-[calc(100%-2rem)] items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold text-fg"
            style={{
              background: 'rgb(var(--color-fg) / 0.06)',
              border: '1px solid var(--color-border)',
            }}
          >
            <MapIcon className="h-[18px] w-[18px]" />
            {t('feedpage.seeOnMap')}
          </button>
        )}

        {/* Comment bar — directly under the actions, inside the same block. */}
        <button
          onClick={() => setSheetOpen(true)}
          className="tappable mt-2 flex w-full items-center gap-2.5 px-4 pb-3.5 text-left"
          aria-label={t('feedpage.addComment')}
        >
          <div className="flex h-7 w-7 flex-none items-center justify-center overflow-hidden rounded-full bg-white/10 text-[11px] font-extrabold text-white/70">
            {myAvatar ? (
              <img src={myAvatar} alt="" className="h-full w-full object-cover object-top" />
            ) : (
              myInitial
            )}
          </div>
          <span className="text-[13px] text-white/45">{t('feedpage.addCommentPlaceholder')}</span>
        </button>
      </div>

      <CommentsSheet
        spotId={spot.id}
        ownerId={spot.user_id}
        spotLabel={`${spot.brand} ${spot.model}`}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCountChange={(n) => onPatch(spot.id, { comment_count: n })}
      />
    </article>
  )
})
