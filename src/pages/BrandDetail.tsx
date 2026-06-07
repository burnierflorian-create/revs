import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Bell, BellOff, Check, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { brandTagline, getBrand } from '../lib/brands'
import { timeAgo, type Spot } from '../lib/spots'
import { Skeleton } from '../components/Skeleton'
import BrandLogo from '../components/BrandLogo'
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

  // Community photos grouped by precise model, biggest model first, so
  // the gallery reads as a tidy per-model showcase.
  const spotsByModel = useMemo(() => {
    if (!spots) return null
    const groups = new Map<string, Spot[]>()
    for (const s of spots) {
      if (!s.photo_url) continue
      const key = (s.model ?? '').trim() || 'Autres modèles'
      const arr = groups.get(key) ?? []
      arr.push(s)
      groups.set(key, arr)
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
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
              className={`tappable inline-flex items-center gap-2 whitespace-nowrap rounded-full px-6 py-3 text-sm font-extrabold tracking-wider uppercase disabled:opacity-50 ${
                following
                  ? 'bg-fg/15 text-white backdrop-blur'
                  : 'bg-white text-black'
              }`}
              style={
                following
                  ? { border: '1px solid rgba(255,255,255,0.10)' }
                  : { boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }
              }
            >
              {following ? (
                <>
                  <BellOff className="h-4 w-4" />
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
        <section className="grid grid-cols-3 gap-2.5">
          <KeyStat
            value={totalSpots == null ? '—' : String(totalSpots)}
            label="Spots REVS"
          />
          <KeyStat
            value={modelsCount == null ? '—' : String(modelsCount)}
            label="Modèles"
          />
          <KeyStat
            value={topSpotter?.pseudo || (topSpotter ? 'Spotter' : '—')}
            label="Meilleur spotter"
            onClick={
              topSpotter
                ? () => navigate(`/u/${topSpotter.user_id}`)
                : undefined
            }
            small
          />
        </section>

        {/* ─────────────────── COMMUNITY SPOTS (par modèle) ─────────────────── */}
        <section>
          <SectionTitle>Spots de la communauté</SectionTitle>
          {spots === null ? (
            <div className="grid grid-cols-3 gap-1.5">
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-lg" />
              ))}
            </div>
          ) : !spotsByModel || spotsByModel.length === 0 ? (
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
              {spotsByModel.map(([model, list]) => (
                <div key={model}>
                  {/* Model divider */}
                  <div className="mb-2.5 flex items-baseline gap-2 px-0.5">
                    <h3 className="font-display text-sm font-extrabold tracking-tight text-fg">
                      {model}
                    </h3>
                    <span className="text-[11px] font-medium text-fg2">
                      {list.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {list.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => navigate(`/spot/${s.id}`)}
                        className="tappable group relative aspect-square overflow-hidden rounded-xl bg-card"
                        style={{ border: '1px solid var(--color-border)' }}
                      >
                        <img
                          src={s.photo_url ?? ''}
                          alt={`${s.brand} ${s.model}`}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover transition-transform duration-300 group-active:scale-105"
                        />
                        {/* Spotter credit watermark — valorise la communauté */}
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-5">
                          <span className="truncate text-[9px] font-semibold tracking-tight text-white/85">
                            @{spotterNames[s.user_id] ?? 'Spotter'}
                          </span>
                        </span>
                      </button>
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
                  className="tappable flex gap-3 rounded-3xl bg-card p-3"
                  style={{ border: '1px solid var(--color-border)' }}
                >
                  {n.image_url && (
                    <img
                      src={n.image_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-20 w-20 flex-none rounded-2xl object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 font-display text-sm font-extrabold leading-snug tracking-tighter text-fg">
                      {n.title}
                    </p>
                    {n.summary && (
                      <p className="mt-1 line-clamp-2 text-xs text-fg2">
                        {n.summary}
                      </p>
                    )}
                    <p className="label-up mt-1.5 text-[10px] text-fg2">
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

function KeyStat({
  value,
  label,
  small,
  onClick,
}: {
  value: string
  label: string
  small?: boolean
  onClick?: () => void
}) {
  const inner = (
    <>
      <div
        className={`font-display font-extrabold leading-tight tracking-tighter text-fg ${
          small ? 'truncate text-base' : 'text-2xl'
        }`}
      >
        {value}
      </div>
      <div className="label-up mt-1 text-[10px] text-fg2">{label}</div>
    </>
  )
  const baseClassName =
    'flex h-24 flex-col items-start justify-end rounded-3xl bg-card p-3 text-left'
  const borderStyle = { border: '1px solid var(--color-border)' }
  return onClick ? (
    <button
      onClick={onClick}
      className={`tappable ${baseClassName}`}
      style={borderStyle}
    >
      {inner}
    </button>
  ) : (
    <div className={baseClassName} style={borderStyle}>
      {inner}
    </div>
  )
}
