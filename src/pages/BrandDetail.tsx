import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Bell, Check, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { brandTagline, getBrand } from '../lib/brands'
import { timeAgo, type Spot } from '../lib/spots'
import { Skeleton } from '../components/Skeleton'
import BrandLogo from '../components/BrandLogo'
import { rarityBadge } from '../lib/rarityStyle'
import { rarityRank } from '../components/CollectorCard'
import { translateError } from '../lib/errors'

type TopSpotter = {
  user_id: string
  pseudo: string | null
  avatar: string | null
  count: number
}

type NewsRow = {
  id: string
  title: string
  summary: string | null
  source: string | null
  url: string
  image_url: string | null
  published_at: string | null
  created_at: string
}

// Build a Postgrest .or() expression that matches `spots.brand` (or
// `news.title`) against every alias of the catalogue entry. Escapes
// commas because Postgrest uses them as separators.
function ilikeOr(column: string, patterns: string[]): string {
  return patterns
    .map((p) => `${column}.ilike.%${p.replace(/,/g, '')}%`)
    .join(',')
}

export default function BrandDetail() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const brand = getBrand(slug)

  const [me, setMe] = useState<string | null>(null)
  const [following, setFollowing] = useState(false)
  const [followerCount, setFollowerCount] = useState<number | null>(null)
  const [followBusy, setFollowBusy] = useState(false)
  const [followErr, setFollowErr] = useState<string | null>(null)

  const [description, setDescription] = useState<string | null>(null)
  const [descLoading, setDescLoading] = useState(true)

  const [spots, setSpots] = useState<Spot[] | null>(null)
  const [totalSpots, setTotalSpots] = useState<number | null>(null)
  const [topSpotter, setTopSpotter] = useState<TopSpotter | null>(null)
  const [news, setNews] = useState<NewsRow[]>([])
  // user_id → pseudo for the spotter watermark on every community photo.
  const [spotterNames, setSpotterNames] = useState<Record<string, string>>({})

  const matchPatterns = useMemo(() => brand?.match ?? [], [brand])

  // ---- Load data on mount --------------------------------------------------
  useEffect(() => {
    if (!brand) return
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!active) return
      setMe(user?.id ?? null)

      const brandOr = ilikeOr('brand', matchPatterns)
      const titleOr = ilikeOr('title', matchPatterns)
      const summaryOr = ilikeOr('summary', matchPatterns)

      const followStatus = user
        ? supabase
            .from('brand_follows')
            .select('id')
            .eq('brand', brand.slug)
            .eq('user_id', user.id)
            .maybeSingle()
        : Promise.resolve({ data: null })

      const [spotsRes, countRes, followCountRes, followRes, newsRes] =
        await Promise.all([
          supabase
            .from('spots')
            .select('*')
            .or(brandOr)
            .order('created_at', { ascending: false })
            .limit(60),
          supabase
            .from('spots')
            .select('*', { count: 'exact', head: true })
            .or(brandOr),
          supabase.rpc('brand_follower_count', { p_brand: brand.slug }),
          followStatus,
          supabase
            .from('news')
            .select(
              'id, title, summary, source, url, image_url, published_at, created_at',
            )
            .gt('expires_at', new Date().toISOString())
            .or(`${titleOr},${summaryOr}`)
            .order('published_at', { ascending: false, nullsFirst: false })
            .limit(5),
        ])
      if (!active) return

      const allSpots = (spotsRes.data ?? []) as Spot[]
      setSpots(allSpots)
      setTotalSpots(countRes.count ?? allSpots.length)

      // Pseudos for every spotter in the grid (watermark + community credit).
      const uids = [...new Set(allSpots.map((s) => s.user_id))]
      if (uids.length) {
        supabase
          .from('profiles')
          .select('user_id, pseudo')
          .in('user_id', uids)
          .then(({ data }) => {
            if (!active) return
            const m: Record<string, string> = {}
            for (const p of (data ?? []) as {
              user_id: string
              pseudo: string | null
            }[]) {
              m[p.user_id] = (p.pseudo ?? '').trim() || 'Spotter'
            }
            setSpotterNames(m)
          })
      }
      setFollowerCount(
        typeof followCountRes.data === 'number' ? followCountRes.data : 0,
      )
      setFollowing(!!followRes.data)
      setNews((newsRes.data ?? []) as NewsRow[])

      // Top spotter: pick the user with the most spots of this brand
      // in the loaded window (bounded by the 60-row limit above).
      const counts = new Map<string, number>()
      for (const s of allSpots) {
        counts.set(s.user_id, (counts.get(s.user_id) ?? 0) + 1)
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
      if (top) {
        const [uid, count] = top
        const { data: prof } = await supabase
          .from('profiles')
          .select('user_id, pseudo, avatar')
          .eq('user_id', uid)
          .maybeSingle()
        if (active) {
          const p = prof as {
            pseudo: string | null
            avatar: string | null
          } | null
          setTopSpotter({
            user_id: uid,
            pseudo: p?.pseudo ?? null,
            avatar: p?.avatar ?? null,
            count,
          })
        }
      } else {
        setTopSpotter(null)
      }
    })()
    return () => {
      active = false
    }
  }, [brand, matchPatterns])

  // ---- Description (Claude, cached server-side) ----------------------------
  useEffect(() => {
    if (!brand) return
    let active = true
    setDescLoading(true)
    ;(async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) {
          if (active) setDescLoading(false)
          return
        }
        const res = await fetch('/api/brand-description', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ brand: brand.slug }),
        })
        const data = (await res.json()) as {
          description?: string
          error?: string
        }
        if (!active) return
        if (data.description) setDescription(data.description)
      } catch {
        /* keep description null — the card collapses */
      } finally {
        if (active) setDescLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [brand])

  // ---- Follow toggle -------------------------------------------------------
  const toggleFollow = useCallback(async () => {
    if (!brand || !me || followBusy) return
    setFollowBusy(true)
    setFollowErr(null)
    const wasFollowing = following
    setFollowing(!wasFollowing)
    setFollowerCount((c) => (c == null ? c : c + (wasFollowing ? -1 : 1)))
    const op = wasFollowing
      ? supabase
          .from('brand_follows')
          .delete()
          .eq('brand', brand.slug)
          .eq('user_id', me)
      : supabase.from('brand_follows').insert({ brand: brand.slug, user_id: me })
    const { error } = await op
    if (error) {
      setFollowing(wasFollowing)
      setFollowerCount((c) => (c == null ? c : c + (wasFollowing ? 1 : -1)))
      setFollowErr(translateError(error))
    }
    setFollowBusy(false)
  }, [brand, me, following, followBusy])

  // ---- Derived stats -------------------------------------------------------
  const modelsCount = useMemo(() => {
    if (!spots) return null
    const set = new Set<string>()
    for (const s of spots) {
      const m = (s.model ?? '').trim().toLowerCase()
      if (m) set.add(m)
    }
    return set.size
  }, [spots])

  // Community photos grouped by precise model. Groups are ordered by their
  // best rarity (rarest model first), then by how many were spotted.
  const modelGroups = useMemo(() => {
    if (!spots) return null
    const photos = spots.filter((s) => s.photo_url)
    const byModel = new Map<string, Spot[]>()
    for (const s of photos) {
      const key = (s.model ?? '').trim() || '—'
      const arr = byModel.get(key) ?? []
      arr.push(s)
      byModel.set(key, arr)
    }
    return [...byModel.entries()]
      .map(([model, list]) => ({
        model,
        list,
        rank: Math.max(...list.map((s) => rarityRank(s.rarity))),
      }))
      .sort((a, b) => b.rank - a.rank || b.list.length - a.list.length)
  }, [spots])

  if (!brand) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-8 text-center text-fg">
        <p className="text-sm text-fg2">Marque introuvable.</p>
        <button
          onClick={() => navigate('/brands')}
          className="tappable rounded-full bg-accent px-6 py-3 text-sm font-extrabold tracking-wider text-fg"
          style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
        >
          VOIR TOUTES LES MARQUES
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* ─────────────────── HERO ─────────────────── */}
      <header
        className="relative overflow-hidden"
        style={{
          background: `radial-gradient(120% 80% at 50% 0%, ${brand.color}cc 0%, ${brand.color}55 35%, ${brand.color}1A 65%, #0a0a0a 100%)`,
        }}
      >
        {/* Subtle radial highlight for depth */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 60% at 50% 110%, rgba(0,0,0,0.65) 0%, transparent 70%)',
          }}
        />
        <button
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="tappable absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/30 backdrop-blur"
          style={{ border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <ArrowLeft className="h-5 w-5 text-fg" />
        </button>

        <div className="relative flex flex-col items-center px-6 pb-10 pt-[calc(env(safe-area-inset-top)+5rem)] text-center">
          <BrandLogo
            brand={brand}
            size={140}
            className="drop-shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
          />
          <h1 className="mt-6 font-display text-[34px] font-extrabold leading-none tracking-tighter text-white">
            {brand.name}
          </h1>
          <span className="label-up mt-3 inline-block whitespace-nowrap rounded-full bg-black/35 px-4 py-1.5 text-[10px] text-fg/90 backdrop-blur">
            {brandTagline(brand)}
          </span>
          {/* Community vs official-account marker. Verified accounts get
              a blue check chip; everyone else gets a discreet greyed-out
              "page communautaire" label so users know the page is
              curated by the community, not the brand itself. */}
          <span
            className={`label-up mt-2 inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-[10px] backdrop-blur ${
              brand.verified
                ? 'bg-[#1D9BF0]/90 text-white'
                : 'bg-fg/10 text-fg/55'
            }`}
          >
            {brand.verified ? (
              <>
                <Check className="h-3 w-3" strokeWidth={3} />
                Compte officiel
              </>
            ) : (
              'Page communautaire'
            )}
          </span>

          {/* Alerts CTA — kept INSIDE the hero so it sits cleanly on
              the brand-coloured gradient and can never be partially
              clipped by header overflow or stacking-context quirks. */}
          <div className="mt-7 flex w-full flex-col items-center">
            <button
              onClick={toggleFollow}
              disabled={followBusy || !me}
              className="tappable inline-flex items-center gap-2 whitespace-nowrap rounded-full px-6 py-3 text-sm font-extrabold uppercase tracking-wider disabled:opacity-50"
              style={
                following
                  ? { background: '#E8203A', color: '#fff' }
                  : {
                      background: '#141414',
                      border: '1px solid #E8203A',
                      color: '#E8203A',
                    }
              }
            >
              {following ? (
                <>
                  <Check className="h-4 w-4" strokeWidth={3} />
                  Alertes activées
                </>
              ) : (
                <>
                  <Bell className="h-4 w-4" />
                  Activer les alertes
                </>
              )}
            </button>
            <p className="mt-2.5 text-[11px] text-fg/55">
              {followerCount ?? 0} passionné
              {(followerCount ?? 0) > 1 ? 's ont' : ' a'} activé les alertes
            </p>
            {followErr && (
              <p className="mt-2 text-xs text-accent">{followErr}</p>
            )}
          </div>
        </div>
      </header>

      <main className="space-y-8 px-4 pb-8 pt-7">

        {/* ─────────────────── DESCRIPTION ─────────────────── */}
        <section>
          {descLoading ? (
            <div
              className="flex items-center gap-2 rounded-3xl bg-card p-6 text-sm text-fg2"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Rédaction de la fiche…
            </div>
          ) : description ? (
            <article
              className="rounded-3xl bg-card p-6"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <p className="font-serif text-[15px] leading-relaxed text-fg/90">
                {description}
              </p>
            </article>
          ) : (
            <p
              className="rounded-3xl bg-card p-6 text-sm text-fg2"
              style={{ border: '1px solid var(--color-border)' }}
            >
              Description indisponible pour le moment.
            </p>
          )}
        </section>

        {/* ─────────────────── KEY FIGURES ─────────────────── */}
        <section
          className="flex items-stretch rounded-2xl"
          style={{ background: '#141414', padding: '16px' }}
        >
          {/* Spots — red, count-up */}
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <span
              className="font-display tabular-nums"
              style={{ fontSize: '24px', fontWeight: 800, color: '#E8203A' }}
            >
              <CountUp value={totalSpots} />
            </span>
            <span className="label-up mt-1 text-[10px] text-fg2">Spots</span>
          </div>

          <span className="w-px self-stretch bg-white/10" />

          {/* Models — white, count-up */}
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <span
              className="font-display tabular-nums text-white"
              style={{ fontSize: '24px', fontWeight: 800 }}
            >
              <CountUp value={modelsCount} />
            </span>
            <span className="label-up mt-1 text-[10px] text-fg2">Modèles</span>
          </div>

          <span className="w-px self-stretch bg-white/10" />

          {/* Top spotter — mini avatar + pseudo */}
          <button
            onClick={
              topSpotter ? () => navigate(`/u/${topSpotter.user_id}`) : undefined
            }
            disabled={!topSpotter}
            className="flex flex-1 flex-col items-center justify-center gap-1 text-center"
          >
            <span className="flex items-center gap-1.5">
              <span
                className="flex h-6 w-6 flex-none items-center justify-center overflow-hidden rounded-full text-[10px] font-bold text-white"
                style={{ background: '#E8203A' }}
              >
                {topSpotter?.avatar ? (
                  <img
                    src={topSpotter.avatar}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover object-top"
                  />
                ) : (
                  (topSpotter?.pseudo || 'S').charAt(0).toUpperCase()
                )}
              </span>
              <span className="max-w-[68px] truncate text-[13px] font-bold text-white">
                {topSpotter?.pseudo || (topSpotter ? 'Spotter' : '—')}
              </span>
            </span>
            <span className="label-up text-[10px] text-fg2">Top spotter</span>
          </button>
        </section>

        {/* ─────────────────── COMMUNITY SPOTS (par modèle) ─────────────────── */}
        <section>
          <SectionTitle>Spots de la communauté</SectionTitle>
          {spots === null ? (
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[4/5] rounded-xl" />
              ))}
            </div>
          ) : !modelGroups || modelGroups.length === 0 ? (
            <p
              className="rounded-3xl bg-card p-8 text-center text-sm text-fg2"
              style={{ border: '1px solid var(--color-border)' }}
            >
              Aucun spot {brand.name} pour le moment.
              <br />
              Sois le premier à en spotter une !
            </p>
          ) : (
            <div className="space-y-6">
              {modelGroups.map((group) => (
                <div key={group.model}>
                  <p className="mb-2.5 px-0.5 text-[14px] font-bold text-white">
                    {group.model}{' '}
                    <span className="font-semibold text-fg2">
                      ({group.list.length})
                    </span>
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {group.list.map((s) => (
                      <CommunityCard
                        key={s.id}
                        spot={s}
                        pseudo={spotterNames[s.user_id]}
                        onTap={() => navigate(`/spot/${s.id}`)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ─────────────────── NEWS ─────────────────── */}
        {news.length > 0 && (
          <section>
            <SectionTitle>Actus {brand.name}</SectionTitle>
            <div className="space-y-3">
              {news.slice(0, 4).map((n) => (
                <a
                  key={n.id}
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tappable flex items-center gap-3 p-3"
                  style={{
                    background: '#141414',
                    borderRadius: '12px',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  {n.image_url && (
                    <img
                      src={n.image_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="flex-none object-cover"
                      style={{ width: '80px', height: '80px', borderRadius: '10px' }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[14px] font-bold leading-snug text-white">
                      {n.title}
                    </p>
                    <p className="mt-1.5 text-[11px] text-fg2">
                      {[n.source, timeAgo(n.published_at ?? n.created_at)]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 px-1 font-display text-lg font-extrabold tracking-tighter text-fg">
      {children}
    </h2>
  )
}

// Count-up number for the stats band. Tweens 0 → value once on load
// (ease-out). Renders an em-dash while the value is still loading (null).
function CountUp({ value }: { value: number | null }) {
  const [disp, setDisp] = useState(0)
  const fromRef = useRef(0)
  useEffect(() => {
    if (value == null) return
    const from = fromRef.current
    const to = value
    const start = performance.now()
    const dur = 900
    let raf = 0
    const ease = (k: number) => 1 - Math.pow(1 - k, 3)
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / dur)
      const v = Math.round(from + (to - from) * ease(k))
      fromRef.current = v
      setDisp(v)
      if (k < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = to
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  if (value == null) return <>—</>
  return <>{disp}</>
}

// One community photo card: full-bleed image, rarity chip top-right,
// spotter handle bottom-left on a translucent pill.
function CommunityCard({
  spot,
  pseudo,
  onTap,
}: {
  spot: Spot
  pseudo?: string
  onTap: () => void
}) {
  const rb = rarityBadge(spot.rarity)
  return (
    <button
      onClick={onTap}
      className="tappable group relative aspect-[4/5] overflow-hidden bg-card"
      style={{ borderRadius: '12px', border: '1px solid var(--color-border)' }}
    >
      <img
        src={spot.photo_url ?? ''}
        alt={`${spot.brand} ${spot.model}`}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover transition-transform duration-300 group-active:scale-105"
      />
      <span
        className="absolute right-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide"
        style={{ background: rb.bg, color: rb.fg, border: `1px solid ${rb.border}` }}
      >
        {rb.label}
      </span>
      <span className="absolute bottom-1.5 left-1.5 max-w-[80%] truncate rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
        @{pseudo ?? 'Spotter'}
      </span>
    </button>
  )
}
