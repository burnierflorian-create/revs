import {
  useEffect,
  useRef,
  useState,
  type TouchEvent,
  type TouchList,
} from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import {
  X,
  Car,
  Navigation,
  Zap,
  Share2,
  Send,
  ChevronRight,
  ChevronDown,
  Info,
  Loader2,
  MapPin,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  categoryLabel,
  formatPrice,
  xpForSpot,
  spotterLevel,
  timeAgo,
  type CarInfo,
  type Spot,
} from '../lib/spots'
import { fetchCardSpecs } from '../lib/cardSpecs'
import LikeButton from '../components/LikeButton'
import RarityBadge from '../components/RarityBadge'
import { myPseudo, notifyPush } from '../lib/push'
import { translateError } from '../lib/errors'
import { effectiveTitle } from '../lib/titles'

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(iso))
}

// Hand off to the device's native maps app for turn-by-turn.
function openNavigation(lat: number, lng: number) {
  const ua = navigator.userAgent || ''
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isAndroid = /Android/.test(ua)
  const url = isIOS
    ? `maps://?daddr=${lat},${lng}`
    : isAndroid
      ? `geo:${lat},${lng}?q=${lat},${lng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
  window.location.href = url
}

export default function SpotDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [spot, setSpot] = useState<Spot | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [level, setLevel] = useState<string | null>(null)
  const [owner, setOwner] = useState<{
    pseudo: string | null
    avatar: string | null
    ville: string | null
    tier: 'premium' | 'vip' | null
  } | null>(null)
  const [funFact, setFunFact] = useState<string | null>(null)
  // Swipe-down-to-close drag offset (px).
  const [dragY, setDragY] = useState(0)
  const dragStartRef = useRef<number | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [carInfo, setCarInfo] = useState<CarInfo | null>(null)
  const [infoBusy, setInfoBusy] = useState(false)
  const [infoErr, setInfoErr] = useState<string | null>(null)

  // On-demand market price: when a spot has no estimated_price (null/0),
  // fetch it via the server-side Haiku endpoint (which also persists it to
  // Supabase, so this only ever runs once per spot). `marketPrice` holds
  // the freshly-fetched value; the display falls back to it.
  const [marketPrice, setMarketPrice] = useState<number | null>(null)
  const [priceLoading, setPriceLoading] = useState(false)
  useEffect(() => {
    if (!spot) return
    if (spot.estimated_price && spot.estimated_price > 0) return
    if (marketPrice != null || priceLoading) return
    if (!spot.brand && !spot.model) return
    let active = true
    setPriceLoading(true)
    ;(async () => {
      try {
        // car-info requires a Supabase auth token (the call hits the paid
        // Claude API). market-price is folded into it as an action to stay
        // under the Hobby plan's 12-function limit.
        const {
          data: { session },
        } = await supabase.auth.getSession()
        const res = await fetch('/api/car-info?action=market-price', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token
              ? { Authorization: `Bearer ${session.access_token}` }
              : {}),
          },
          body: JSON.stringify({
            spotId: spot.id,
            brand: spot.brand,
            model: spot.model,
            year: spot.year,
          }),
        })
        const data = (await res.json()) as { price?: number | null }
        if (active && typeof data.price === 'number') setMarketPrice(data.price)
      } catch {
        /* leave price as "Indisponible" — best-effort */
      } finally {
        if (active) setPriceLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [spot, marketPrice, priceLoading])

  useEffect(() => {
    if (spot?.car_info) setCarInfo(spot.car_info)
  }, [spot?.car_info])

  async function toggleAbout() {
    if (aboutOpen) {
      setAboutOpen(false)
      return
    }
    setAboutOpen(true)
    if (carInfo || !spot || infoBusy) return
    setInfoBusy(true)
    setInfoErr(null)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Non authentifié')
      const res = await fetch('/api/car-info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ spot_id: spot.id }),
      })
      const data = (await res.json()) as {
        car_info?: CarInfo
        error?: string
      }
      if (!res.ok || !data.car_info)
        throw new Error(data.error || 'Échec de la recherche')
      setCarInfo(data.car_info)
    } catch (e) {
      setInfoErr(translateError(e))
    } finally {
      setInfoBusy(false)
    }
  }
  const [comments, setComments] = useState<
    {
      id: string
      user_id: string
      content: string
      created_at: string
    }[]
  >([])
  const [comProfiles, setComProfiles] = useState<
    Record<
      string,
      {
        pseudo: string | null
        avatar: string | null
        title: string | null
        xp: number
      }
    >
  >({})
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [shareMsg, setShareMsg] = useState<string | null>(null)

  async function loadComments() {
    if (!id) return
    const { data } = await supabase
      .from('comments')
      .select('id, user_id, content, created_at')
      .eq('spot_id', id)
      .order('created_at', { ascending: true })
      .limit(200)
    const list = (data ?? []) as {
      id: string
      user_id: string
      content: string
      created_at: string
    }[]
    setComments(list)
    const ids = [...new Set(list.map((c) => c.user_id))]
    if (ids.length) {
      // Parallel: profile fields (incl. manual title) + XP totals so we
      // can colour each commenter's pseudo with their effectiveTitle.
      const [profsRes, xpRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('user_id, pseudo, avatar, title')
          .in('user_id', ids),
        supabase
          .from('xp_transactions')
          .select('user_id, amount')
          .in('user_id', ids),
      ])
      const xpByUser = new Map<string, number>()
      for (const r of (xpRes.data ?? []) as {
        user_id: string
        amount: number
      }[]) {
        xpByUser.set(r.user_id, (xpByUser.get(r.user_id) ?? 0) + r.amount)
      }
      const map: Record<
        string,
        {
          pseudo: string | null
          avatar: string | null
          title: string | null
          xp: number
        }
      > = {}
      for (const p of (profsRes.data ?? []) as {
        user_id: string
        pseudo: string | null
        avatar: string | null
        title: string | null
      }[])
        map[p.user_id] = {
          pseudo: p.pseudo,
          avatar: p.avatar,
          title: p.title,
          xp: xpByUser.get(p.user_id) ?? 0,
        }
      setComProfiles(map)
    }
  }

  useEffect(() => {
    loadComments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function postComment() {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user || !id) {
      setSending(false)
      return
    }
    const { error } = await supabase
      .from('comments')
      .insert({ spot_id: id, user_id: user.id, content: body.slice(0, 280) })
    setSending(false)
    if (!error) {
      setText('')
      await loadComments()
      if (spot && spot.user_id !== user.id) {
        const who = await myPseudo()
        void notifyPush({
          user_id: spot.user_id,
          title: '💬 Nouveau commentaire',
          body: `${who} a commenté ton spot ${spot.brand} ${spot.model}`,
          url: `/spot/${spot.id}`,
          type: 'comments',
        })
      }
    }
  }

  async function share() {
    if (!spot) return
    const url = `https://revs-ten.vercel.app/spot/${spot.id}`
    const data = {
      title: `${spot.brand} ${spot.model}`,
      text: `Regarde ce spot sur REVS : ${spot.brand} ${spot.model}`,
      url,
    }
    try {
      if (navigator.share) {
        await navigator.share(data)
        return
      }
      await navigator.clipboard.writeText(url)
      setShareMsg('Lien copié !')
      setTimeout(() => setShareMsg(null), 2500)
    } catch {
      /* user cancelled share — ignore */
    }
  }

  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)

  useEffect(() => {
    if (!id) return
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('spots')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (!active) return
      if (!data) {
        setNotFound(true)
        return
      }
      const s = data as Spot
      setSpot(s)
      // Opening a spot counts as a view → keep it alive 1h more.
      void supabase.rpc('touch_spot', { p_spot_id: s.id })
      const [{ count }, { data: prof }, { data: tierRaw }] = await Promise.all([
        supabase
          .from('spots')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', s.user_id),
        supabase
          .from('profiles')
          .select('pseudo, avatar, ville')
          .eq('user_id', s.user_id)
          .maybeSingle(),
        supabase.rpc('user_tier', { p_user: s.user_id }),
      ])
      if (!active) return
      setLevel(spotterLevel(count ?? 0))
      const tier =
        tierRaw === 'premium' || tierRaw === 'vip' ? tierRaw : null
      setOwner({
        pseudo: (prof?.pseudo as string | undefined) ?? null,
        avatar: (prof?.avatar as string | undefined) ?? null,
        ville: (prof?.ville as string | undefined)?.trim() || null,
        tier,
      })

      // Fun fact — pulled from the per-model cached card specs (no extra
      // Claude cost: the model's specs are cached site-wide).
      fetchCardSpecs(s.brand, s.model, s.year).then((specs) => {
        if (active && specs?.fun_fact) setFunFact(specs.fun_fact)
      })
    })()
    return () => {
      active = false
    }
  }, [id])

  // Swipe-down-to-close — single-finger drag starting on the hero photo.
  function onDragStart(e: TouchEvent) {
    if (e.touches.length === 1) dragStartRef.current = e.touches[0].clientY
  }
  function onDragMove(e: TouchEvent) {
    if (dragStartRef.current == null || e.touches.length !== 1) return
    const dy = e.touches[0].clientY - dragStartRef.current
    if (dy > 0) setDragY(dy)
  }
  function onDragEnd() {
    if (dragStartRef.current == null) return
    dragStartRef.current = null
    if (dragY > 120) navigate(-1)
    else setDragY(0)
  }

  // Mini-carte non interactive avec le pin du spot.
  useEffect(() => {
    if (!spot || !mapContainerRef.current || mapRef.current) return
    const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
    if (!token) return
    mapboxgl.accessToken = token

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [spot.lng, spot.lat],
      zoom: 14,
      interactive: false,
      attributionControl: true,
    })
    mapRef.current = map

    const el = document.createElement('div')
    el.style.width = '26px'
    el.style.height = '26px'
    el.style.borderRadius = '9999px'
    el.style.border = '3px solid #0A0A0A'
    el.style.background = '#E63946'
    el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.5)'
    new mapboxgl.Marker({ element: el })
      .setLngLat([spot.lng, spot.lat])
      .addTo(map)
    map.on('load', () => map.resize())

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [spot])

  if (notFound) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-8 text-center text-fg">
        <p className="text-sm text-fg/60">Ce spot est introuvable.</p>
        <button
          onClick={() => navigate('/feed')}
          className="rounded-full bg-accent px-6 py-3 text-sm font-medium"
        >
          Retour au feed
        </button>
      </div>
    )
  }

  if (!spot) {
    return (
      <div className="min-h-screen bg-bg">
        <div className="h-[45vh] w-full animate-pulse bg-card" />
        <div className="space-y-4 p-5">
          <div className="h-6 w-2/3 animate-pulse rounded bg-card" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-card" />
          <div className="h-40 w-full animate-pulse rounded-2xl bg-card" />
        </div>
      </div>
    )
  }

  const info: [string, string][] = [
    ['Marque', spot.brand || '—'],
    ['Modèle', spot.model || '—'],
    ['Année', spot.year != null ? String(spot.year) : '—'],
    ['Couleur', spot.color || '—'],
    ['Catégorie', categoryLabel(spot.category)],
    ['Confiance IA', spot.confidence != null ? `${spot.confidence}%` : '—'],
  ]

  return (
    <div
      className="min-h-screen bg-bg text-fg"
      style={{
        transform: dragY ? `translateY(${dragY}px)` : undefined,
        transition:
          dragStartRef.current == null
            ? 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)'
            : 'none',
        borderTopLeftRadius: dragY ? 22 : undefined,
        borderTopRightRadius: dragY ? 22 : undefined,
        overflow: dragY ? 'hidden' : undefined,
      }}
    >
      {/* Photo plein écran, edge-to-edge. Pinch-to-zoom on the image;
          single-finger drag down on the hero closes the page (spring).
          Glassmorphism close + share buttons float on a top gradient. */}
      <div
        className="relative h-[60vh] w-full overflow-hidden bg-card"
        onTouchStart={onDragStart}
        onTouchMove={onDragMove}
        onTouchEnd={onDragEnd}
      >
        {spot.photo_url ? (
          <ZoomablePhoto
            src={spot.photo_url}
            alt={`${spot.brand} ${spot.model}`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-card">
            <Car size={64} color="#444444" />
          </div>
        )}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/65 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-bg via-bg/40 to-transparent"
        />
        <button
          onClick={() => navigate(-1)}
          aria-label="Fermer"
          className="tappable absolute left-4 top-[max(1rem,env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full"
          style={{
            background: 'rgba(255,255,255,0.12)',
            backdropFilter: 'blur(16px) saturate(180%)',
            WebkitBackdropFilter: 'blur(16px) saturate(180%)',
            border: '1px solid rgba(255,255,255,0.18)',
          }}
        >
          <X className="h-5 w-5 text-white" />
        </button>
        <button
          onClick={share}
          aria-label="Partager"
          className="tappable absolute right-4 top-[max(1rem,env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full bg-black/55 backdrop-blur"
          style={{ border: '1px solid rgba(255,255,255,0.14)' }}
        >
          <Share2 className="h-5 w-5 text-fg" />
        </button>
        {shareMsg && (
          <span className="absolute right-4 top-[max(4rem,calc(env(safe-area-inset-top)+3rem))] rounded-full bg-black/75 px-3 py-1 text-xs text-fg backdrop-blur">
            {shareMsg}
          </span>
        )}
      </div>

      <div className="space-y-7 p-5 pb-10">
        <div>
          <div className="flex items-start justify-between gap-4">
            <h1 className="display-xl text-fg">
              {spot.brand} {spot.model}
            </h1>
            <LikeButton spotId={spot.id} realtime />
          </div>
          {spot.description?.trim() ? (
            <p className="mt-2 whitespace-pre-line text-[14px] leading-snug text-fg2">
              {spot.description.trim()}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <RarityBadge rarity={spot.rarity} size="md" />
            {typeof spot.production === 'number' && spot.production > 0 && (
              <span
                className="rounded-full bg-card px-2.5 py-1 text-[11px] text-fg2"
                style={{ border: '1px solid var(--color-border)' }}
              >
                {new Intl.NumberFormat('fr-FR').format(spot.production)} ex.
                produits
              </span>
            )}
          </div>
        </div>

        {(() => {
          const goldXp =
            spot.rarity === 'supercar' || spot.rarity === 'hypercar'
          return (
            <div
              className="flex items-center justify-between gap-4 rounded-3xl px-5 py-4"
              style={
                goldXp
                  ? {
                      background:
                        'linear-gradient(135deg, rgba(224,179,65,0.18) 0%, rgba(184,134,11,0.06) 100%)',
                      border: '1px solid rgba(224,179,65,0.45)',
                    }
                  : {
                      background:
                        'linear-gradient(135deg, rgba(232,32,58,0.18) 0%, rgba(232,32,58,0.06) 100%)',
                      border: '1px solid rgba(232,32,58,0.35)',
                    }
              }
            >
              <div>
                <div className="label-up text-[10px] text-fg2">
                  Prix du marché
                </div>
                <div className="mt-1 font-display text-[28px] font-extrabold leading-none tracking-tighter text-fg">
                  {formatPrice(
                    spot.estimated_price && spot.estimated_price > 0
                      ? spot.estimated_price
                      : marketPrice,
                  ) ?? (priceLoading ? 'Estimation…' : 'Indisponible')}
                </div>
              </div>
              <div
                className="flex flex-none items-center gap-1.5 rounded-full px-4 py-2 text-sm font-extrabold tracking-wider"
                style={
                  goldXp
                    ? {
                        background:
                          'linear-gradient(120deg, #E0B341 0%, #FFD700 45%, #B8860B 100%)',
                        color: '#1a1306',
                        boxShadow: '0 8px 22px rgba(224,179,65,0.55)',
                      }
                    : {
                        background: 'rgb(var(--color-accent))',
                        color: 'rgb(var(--color-fg))',
                        boxShadow: '0 6px 18px rgba(232,32,58,0.45)',
                      }
                }
              >
                <Zap className="h-4 w-4" />+
                {xpForSpot(spot.estimated_price, spot.rarity)} XP
              </div>
            </div>
          )
        })()}

        <div className="grid grid-cols-2 gap-3">
          {info.map(([label, value]) => (
            <div
              key={label}
              className="rounded-2xl bg-card px-4 py-3"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <div className="label-up text-[10px] text-fg2">{label}</div>
              <div className="mt-1 font-semibold text-fg">{value}</div>
            </div>
          ))}
        </div>

        {/* Fun fact (IA, cached per model) */}
        {funFact && (
          <p
            className="text-[15px] italic leading-relaxed text-fg2"
            style={{ fontFamily: 'var(--font-display, inherit)' }}
          >
            «&nbsp;{funFact}&nbsp;»
          </p>
        )}

        {/* Location line */}
        <p className="flex items-center gap-1.5 text-[13px] text-fg2">
          <MapPin className="h-4 w-4 flex-none text-accent" />
          {owner?.ville ? (
            <span>{owner.ville}, France</span>
          ) : (
            <span className="tabular-nums">
              {spot.lat.toFixed(4)}, {spot.lng.toFixed(4)}
            </span>
          )}
        </p>

        <section
          className="overflow-hidden rounded-3xl bg-card"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <button
            onClick={toggleAbout}
            className="tappable flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
          >
            <span className="flex items-center gap-2 font-bold tracking-wide text-fg">
              <Info className="h-5 w-5 text-accent" />À propos de cette voiture
            </span>
            <ChevronDown
              className={`h-5 w-5 text-fg2 transition-transform ${
                aboutOpen ? 'rotate-180' : ''
              }`}
            />
          </button>
          {aboutOpen && (
            <div className="border-t border-white/[0.08] px-5 py-4">
              {infoBusy ? (
                <div className="flex items-center gap-2 text-sm text-fg2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Recherche des specs sur le web…
                </div>
              ) : infoErr ? (
                <p className="text-sm text-accent">{infoErr}</p>
              ) : carInfo ? (
                <div className="space-y-4 text-sm">
                  <p className="font-display text-lg font-extrabold tracking-tighter text-fg">
                    {carInfo.name}
                  </p>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                    {(
                      [
                        ['Moteur', carInfo.engine],
                        ['Puissance', carInfo.horsepower],
                        ['Couple', carInfo.torque],
                        ['0-100 km/h', carInfo.zero_to_100],
                        ['Vitesse max', carInfo.top_speed],
                        ['Prix neuf', carInfo.msrp_eur],
                        ['Production', carInfo.production],
                      ] as [string, string][]
                    ).map(([k, v]) => (
                      <div key={k}>
                        <dt className="label-up text-[10px] text-fg2">{k}</dt>
                        <dd className="mt-0.5 font-semibold text-fg">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="border-t border-fg/5 pt-3 text-fg/70">
                    {carInfo.history}
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </section>

        <button
          onClick={() => openNavigation(spot.lat, spot.lng)}
          className="tappable flex w-full items-center justify-center gap-2 rounded-full bg-accent py-3.5 text-sm font-extrabold tracking-wider text-fg"
          style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
        >
          <Navigation className="h-4 w-4" />
          Y ALLER
        </button>

        <div
          ref={mapContainerRef}
          className="overflow-hidden rounded-2xl"
          style={{
            width: '100%',
            height: '180px',
            backgroundColor: 'rgb(var(--color-card))',
            border: '1px solid var(--color-border)',
          }}
        />

        <button
          onClick={() => navigate(`/u/${spot.user_id}`)}
          className="tappable flex w-full items-center gap-3 rounded-2xl bg-card p-4 text-left"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <div
            className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-full bg-accent text-lg font-extrabold tracking-tighter text-fg"
            style={{ boxShadow: '0 0 0 2px rgb(var(--color-fg) / 0.06)' }}
          >
            {owner?.avatar ? (
              <img
                src={owner.avatar}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover object-top"
              />
            ) : (
              (owner?.pseudo || 'Spotter').charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 truncate font-semibold text-fg">
              <span className="truncate">{owner?.pseudo || 'Spotter'}</span>
              {owner?.tier && (
                <span
                  className={`flex-none rounded-full px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider ${
                    owner.tier === 'vip'
                      ? 'bg-[#FFD700]/15 text-[#FFD700]'
                      : 'bg-accent/15 text-accent'
                  }`}
                  aria-label={owner.tier === 'vip' ? 'Membre VIP' : 'Membre Premium'}
                >
                  {owner.tier === 'vip' ? '👑 VIP' : '⚡ PREMIUM'}
                </span>
              )}
            </div>
            <div className="text-xs text-accent">{level ?? '—'}</div>
          </div>
          <ChevronRight className="ml-auto h-5 w-5 flex-none text-fg2" />
        </button>

        <p className="text-xs text-fg2">
          Spotté le {formatDateTime(spot.created_at)}
        </p>

        <section className="border-t border-white/[0.08] pt-6">
          <h2 className="mb-3 font-display text-lg font-extrabold tracking-tighter text-fg">
            Commentaires{' '}
            <span className="text-fg2 font-bold">({comments.length})</span>
          </h2>

          <div className="space-y-4">
            {comments.length === 0 ? (
              <p className="text-sm text-fg/40">
                Sois le premier à commenter ce spot.
              </p>
            ) : (
              comments.map((c) => {
                const p = comProfiles[c.user_id]
                const nm = p?.pseudo || 'Spotter'
                const title = effectiveTitle(p?.xp ?? 0, p?.title ?? null)
                return (
                  <div key={c.id} className="flex gap-3">
                    <div className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-full bg-accent text-sm font-extrabold text-fg">
                      {p?.avatar ? (
                        <img
                          src={p.avatar}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover object-top"
                        />
                      ) : (
                        nm.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span
                          className={`truncate text-sm font-bold ${title.textClass}`}
                        >
                          {title.emoji && (
                            <span className="mr-1" aria-hidden>
                              {title.emoji}
                            </span>
                          )}
                          {nm}
                        </span>
                        <span className="text-[11px] text-fg2">
                          {timeAgo(c.created_at)}
                        </span>
                      </div>
                      <p
                        className="mt-1 break-words text-[14px] text-fg/85"
                        style={{ lineHeight: 1.55 }}
                      >
                        {c.content}
                      </p>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="mt-5 flex items-end gap-2">
            <textarea
              value={text}
              maxLength={280}
              rows={1}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ajoute un commentaire…"
              className="flex-1 resize-none rounded-2xl bg-card px-4 py-3 text-sm text-fg outline-none placeholder:text-fg/30 focus:ring-1 focus:ring-accent"
            />
            <button
              onClick={postComment}
              disabled={sending || !text.trim()}
              aria-label="Envoyer"
              className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-accent disabled:opacity-40"
            >
              <Send className="h-4 w-4 text-fg" />
            </button>
          </div>
          <p className="mt-1 px-1 text-right text-[10px] text-fg/30">
            {text.length}/280
          </p>
        </section>
      </div>
    </div>
  )
}

// Hero photo with two-finger pinch-to-zoom (1×–4×) + double-tap toggle.
// touch-action flips to "none" once zoomed so the page stops scrolling
// under the gesture; back to "pan-y" at 1× so normal scroll resumes.
function ZoomablePhoto({ src, alt }: { src: string; alt: string }) {
  const [scale, setScale] = useState(1)
  const startRef = useRef<{ dist: number; scale: number } | null>(null)

  const dist = (t: TouchList) =>
    Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

  function onTouchStart(e: TouchEvent<HTMLImageElement>) {
    if (e.touches.length === 2)
      startRef.current = { dist: dist(e.touches), scale }
  }
  function onTouchMove(e: TouchEvent<HTMLImageElement>) {
    if (e.touches.length === 2 && startRef.current) {
      e.preventDefault()
      const ratio = dist(e.touches) / startRef.current.dist
      setScale(Math.min(4, Math.max(1, startRef.current.scale * ratio)))
    }
  }
  function onTouchEnd(e: TouchEvent<HTMLImageElement>) {
    if (e.touches.length < 2) {
      startRef.current = null
      if (scale <= 1.05) setScale(1)
    }
  }

  return (
    <img
      src={src}
      alt={alt}
      fetchPriority="high"
      decoding="async"
      draggable={false}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onDoubleClick={() => setScale((s) => (s > 1 ? 1 : 2.5))}
      className="h-full w-full select-none object-cover"
      style={{
        transform: `scale(${scale})`,
        transition: startRef.current ? 'none' : 'transform 220ms ease-out',
        touchAction: scale > 1 ? 'none' : 'pan-y',
      }}
    />
  )
}
