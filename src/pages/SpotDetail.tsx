import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import {
  ArrowLeft,
  Car,
  Navigation,
  Zap,
  Share2,
  Send,
  ChevronRight,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  categoryLabel,
  formatPrice,
  spotterLevel,
  timeAgo,
  xpForPrice,
  type Spot,
} from '../lib/spots'
import LikeButton from '../components/LikeButton'
import { myPseudo, notifyPush } from '../lib/push'

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
  } | null>(null)
  const [comments, setComments] = useState<
    {
      id: string
      user_id: string
      content: string
      created_at: string
    }[]
  >([])
  const [comProfiles, setComProfiles] = useState<
    Record<string, { pseudo: string | null; avatar: string | null }>
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
      const { data: profs } = await supabase
        .from('profiles')
        .select('user_id, pseudo, avatar')
        .in('user_id', ids)
      const map: Record<string, { pseudo: string | null; avatar: string | null }> = {}
      for (const p of (profs ?? []) as {
        user_id: string
        pseudo: string | null
        avatar: string | null
      }[])
        map[p.user_id] = { pseudo: p.pseudo, avatar: p.avatar }
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
      const [{ count }, { data: prof }] = await Promise.all([
        supabase
          .from('spots')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', s.user_id),
        supabase
          .from('profiles')
          .select('pseudo, avatar')
          .eq('user_id', s.user_id)
          .maybeSingle(),
      ])
      if (!active) return
      setLevel(spotterLevel(count ?? 0))
      setOwner({
        pseudo: (prof?.pseudo as string | undefined) ?? null,
        avatar: (prof?.avatar as string | undefined) ?? null,
      })
    })()
    return () => {
      active = false
    }
  }, [id])

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
    <div className="min-h-screen bg-bg text-fg">
      {/* Photo plein écran */}
      <div className="relative h-[45vh] w-full">
        {spot.photo_url ? (
          <img
            src={spot.photo_url}
            alt={`${spot.brand} ${spot.model}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-card">
            <Car size={64} color="#444444" />
          </div>
        )}
        <button
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur"
        >
          <ArrowLeft className="h-5 w-5 text-fg" />
        </button>
        <button
          onClick={share}
          aria-label="Partager"
          className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur"
        >
          <Share2 className="h-5 w-5 text-fg" />
        </button>
        {shareMsg && (
          <span className="absolute right-4 top-[max(3.5rem,calc(env(safe-area-inset-top)+2.5rem))] rounded-full bg-black/70 px-3 py-1 text-xs text-fg backdrop-blur">
            {shareMsg}
          </span>
        )}
      </div>

      <div className="space-y-7 p-5 pb-10">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold">
            {spot.brand} {spot.model}
          </h1>
          <LikeButton spotId={spot.id} realtime />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-2xl border border-accent/30 bg-accent/10 px-5 py-4">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-fg/40">
              Prix neuf estimé
            </div>
            <div className="mt-1 text-xl font-bold text-fg">
              {formatPrice(spot.estimated_price) ?? 'Non estimé'}
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-bold text-fg">
            <Zap className="h-4 w-4" />+{xpForPrice(spot.estimated_price)} XP
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {info.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-card px-4 py-3">
              <div className="text-[11px] uppercase tracking-widest text-fg/40">
                {label}
              </div>
              <div className="mt-1 font-medium">{value}</div>
            </div>
          ))}
        </div>

        <button
          onClick={() => openNavigation(spot.lat, spot.lng)}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-accent py-3.5 text-sm font-semibold text-fg shadow-lg shadow-accent/30 transition-transform active:scale-[0.98]"
        >
          <Navigation className="h-4 w-4" />
          Y aller
        </button>

        <div
          ref={mapContainerRef}
          className="overflow-hidden rounded-2xl"
          style={{ width: '100%', height: '180px', backgroundColor: '#1A1A1A' }}
        />

        <button
          onClick={() => navigate(`/u/${spot.user_id}`)}
          className="flex w-full items-center gap-3 rounded-2xl bg-card p-4 text-left transition-transform active:scale-[0.99]"
        >
          <div className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-full bg-accent text-lg font-bold text-fg">
            {owner?.avatar ? (
              <img
                src={owner.avatar}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              (owner?.pseudo || 'Spotter').charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">
              {owner?.pseudo || 'Spotter'}
            </div>
            <div className="text-xs text-accent">{level ?? '—'}</div>
          </div>
          <ChevronRight className="ml-auto h-5 w-5 flex-none text-fg/30" />
        </button>

        <p className="text-sm text-fg/40">
          Spotté le {formatDateTime(spot.created_at)}
        </p>

        <section className="border-t border-white/5 pt-6">
          <h2 className="mb-3 font-display text-lg font-bold">
            Commentaires{' '}
            <span className="text-fg/40">({comments.length})</span>
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
                return (
                  <div key={c.id} className="flex gap-3">
                    <div className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-full bg-accent text-xs font-bold text-fg">
                      {p?.avatar ? (
                        <img
                          src={p.avatar}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        nm.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <span className="font-semibold text-fg">{nm}</span>{' '}
                        <span className="text-xs text-fg/40">
                          {timeAgo(c.created_at)}
                        </span>
                      </p>
                      <p className="mt-0.5 break-words text-sm text-fg/80">
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
