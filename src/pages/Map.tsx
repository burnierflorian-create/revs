import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { Car, LocateFixed } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { SkeletonMap } from '../components/Skeleton'
import {
  categoryLabel,
  escapeHtml,
  timeAgo,
  type Spot,
} from '../lib/spots'

const PARIS: [number, number] = [2.3522, 48.8566]
const DEFAULT_ZOOM = 13

const FILTERS = ['Tous', 'Supercars', 'Classics', 'JDM'] as const

// null = pas de filtre ; sinon valeur de spots.category à matcher.
const FILTER_CATEGORY: Record<string, string | null> = {
  Tous: null,
  Supercars: 'supercar',
  Classics: 'classic',
  JDM: 'JDM',
}

const CAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`

function createSpotMarkerEl(spot: Spot): HTMLDivElement {
  const el = document.createElement('div')
  el.style.width = '52px'
  el.style.height = '52px'
  el.style.borderRadius = '9999px'
  el.style.border = '2px solid #E63946'
  el.style.overflow = 'hidden'
  el.style.cursor = 'pointer'
  el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)'
  if (spot.photo_url) {
    el.style.backgroundImage = `url("${spot.photo_url.replace(/"/g, '%22')}")`
    el.style.backgroundSize = 'cover'
    el.style.backgroundPosition = 'center'
  } else {
    el.style.background = '#E63946'
    el.style.display = 'flex'
    el.style.alignItems = 'center'
    el.style.justifyContent = 'center'
    el.innerHTML = CAR_SVG
  }
  return el
}

function popupHtml(spot: Spot): string {
  const title = `${escapeHtml(spot.brand)} ${escapeHtml(spot.model)}`.trim()
  const sub = [spot.color, spot.year].filter(Boolean).join(' · ')
  const photo = spot.photo_url
    ? `<img src="${escapeHtml(spot.photo_url)}" alt="" style="width:80px;height:80px;border-radius:12px;object-fit:cover;flex:none" />`
    : ''
  return `
    <div style="display:flex;gap:12px;align-items:center;max-width:240px">
      ${photo}
      <div style="min-width:0">
        <div style="font-weight:600;font-size:14px">${title || 'Spot'}</div>
        ${sub ? `<div style="font-size:12px;opacity:.6;margin-top:2px">${escapeHtml(sub)}</div>` : ''}
        <div style="font-size:11px;opacity:.45;margin-top:4px">${escapeHtml(timeAgo(spot.created_at))}</div>
        <div style="display:inline-block;margin-top:6px;font-size:10px;padding:2px 8px;border-radius:9999px;background:rgba(230,57,70,.2);color:#F5F5F0">${escapeHtml(categoryLabel(spot.category))}</div>
      </div>
    </div>`
}

export default function MapPage() {
  const navigate = useNavigate()
  const location = useLocation()

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<globalThis.Map<string, mapboxgl.Marker>>(
    new globalThis.Map(),
  )
  const allSpotsRef = useRef<globalThis.Map<string, Spot>>(new globalThis.Map())
  const filterRef = useRef<string>('Tous')
  const renderRef = useRef<(() => void) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<string>('Tous')
  const [toast, setToast] = useState<string | null>(null)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(0)
  const [mapReady, setMapReady] = useState(false)

  function locate() {
    if (!navigator.geolocation) {
      setGeoError('Géolocalisation non disponible sur cet appareil.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoError(null)
        mapRef.current?.flyTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 14,
          essential: true,
        })
      },
      (err) => {
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Autorise la localisation dans Réglages → Safari → Localisation'
            : 'Position indisponible pour le moment, réessaie.',
        )
        setTimeout(() => setGeoError(null), 6000)
      },
      // maximumAge:0 forces a fresh fix — iOS PWA can otherwise hand back
      // a stale/empty cached position and appear to do nothing.
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 0 },
    )
  }

  // On iOS, getCurrentPosition fails silently when permission isn't
  // already granted. Check Permissions API first (when available): if
  // denied, tell the user exactly where to enable it; otherwise locate.
  function flyToUser() {
    if (!mapRef.current) return
    const perms = navigator.permissions
    if (!perms?.query) {
      // Older iOS has no Permissions API — go straight to geolocation.
      locate()
      return
    }
    perms
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (status.state === 'denied') {
          setGeoError(
            'Autorise la localisation dans Réglages → Safari → Localisation',
          )
          setTimeout(() => setGeoError(null), 6000)
          return
        }
        locate()
      })
      .catch(() => locate())
  }

  // Toast après publication (passé via react-router state).
  useEffect(() => {
    const s = location.state as { toast?: string } | null
    if (s?.toast) {
      setToast(s.toast)
      navigate(location.pathname, { replace: true, state: null })
      const t = setTimeout(() => setToast(null), 3000)
      return () => clearTimeout(t)
    }
  }, [location, navigate])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
    if (!token) {
      setError('Token Mapbox manquant (VITE_MAPBOX_TOKEN).')
      return
    }
    mapboxgl.accessToken = token

    let map: mapboxgl.Map
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: PARIS,
        zoom: DEFAULT_ZOOM,
        attributionControl: true,
      })
    } catch {
      setError('Impossible d’initialiser la carte.')
      return
    }
    mapRef.current = map
    const markers = markersRef.current
    const allSpots = allSpotsRef.current

    function matches(spot: Spot): boolean {
      const cat = FILTER_CATEGORY[filterRef.current]
      return cat == null || spot.category === cat
    }

    function addMarker(spot: Spot) {
      if (!spot?.id || markers.has(spot.id)) return
      const popup = new mapboxgl.Popup({ offset: 28, closeButton: true }).setHTML(
        popupHtml(spot),
      )
      const marker = new mapboxgl.Marker({ element: createSpotMarkerEl(spot) })
        .setLngLat([spot.lng, spot.lat])
        .setPopup(popup)
        .addTo(map)
      markers.set(spot.id, marker)
    }

    function render() {
      for (const m of markers.values()) m.remove()
      markers.clear()
      for (const spot of allSpots.values()) {
        if (matches(spot)) addMarker(spot)
      }
      setVisibleCount(markers.size)
    }
    renderRef.current = render

    map.on('error', (e) => {
      const msg = e.error?.message ?? ''
      if (/401|403|unauthorized|forbidden|access token|not authorized/i.test(msg)) {
        setError('Carte indisponible : token Mapbox invalide ou non autorisé.')
      }
    })

    map.on('load', async () => {
      map.resize()
      setMapReady(true)
      flyToUser()

      const { data } = await supabase
        .from('spots')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      for (const spot of (data ?? []) as Spot[]) allSpots.set(spot.id, spot)
      render()
    })

    const channel = supabase
      .channel('public:spots')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'spots' },
        (payload) => {
          const spot = payload.new as Spot
          if (!spot?.id) return
          allSpots.set(spot.id, spot)
          if (matches(spot)) {
            addMarker(spot)
            setVisibleCount(markers.size)
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      for (const m of markers.values()) m.remove()
      markers.clear()
      allSpots.clear()
      renderRef.current = null
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  // Changement de filtre : on régénère les markers depuis le cache local.
  useEffect(() => {
    filterRef.current = activeFilter
    renderRef.current?.()
  }, [activeFilter])

  return (
    <div className="fixed inset-0">
      {/* Hauteur explicite inline : bat la règle .mapboxgl-map { position: relative }
          de mapbox-gl, qui sinon écrase un positionnement par classe et fait
          s'effondrer le conteneur à 0 (carte noire). */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100vh', backgroundColor: '#0A0A0A' }}
      />

      {!mapReady && !error && <SkeletonMap />}

      {toast && (
        <div className="absolute left-1/2 top-[max(1rem,env(safe-area-inset-top))] z-20 -translate-x-1/2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium shadow-lg">
          {toast}
        </div>
      )}

      {geoError && (
        <div className="absolute left-1/2 top-[max(1rem,env(safe-area-inset-top))] z-20 max-w-[90%] -translate-x-1/2 rounded-full bg-card px-5 py-2.5 text-center text-sm font-medium shadow-lg">
          {geoError}
        </div>
      )}

      {activeFilter !== 'Tous' && visibleCount === 0 && !error && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center px-8 text-center">
          <Car size={48} color="#444444" strokeWidth={1.5} />
          <p className="mt-4 text-base font-medium text-fg">
            Aucun spot en {activeFilter}
          </p>
          <p className="mt-1 text-sm text-[#888888]">
            Soyez le premier à spotter !
          </p>
        </div>
      )}

      {/* Barre de filtre */}
      <div className="absolute left-0 right-0 top-0 z-10 px-4 pt-[max(4rem,calc(env(safe-area-inset-top)+3rem))]">
        <div className="mx-auto flex max-w-md gap-1 rounded-full bg-black/60 p-1 backdrop-blur">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`flex-1 rounded-full py-2 text-xs font-medium transition-colors ${
                activeFilter === f ? 'bg-accent text-fg' : 'text-fg/50 hover:text-fg'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Bouton "Me localiser" */}
      <button
        onClick={flyToUser}
        aria-label="Me localiser"
        className="absolute bottom-24 right-4 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-accent shadow-lg shadow-accent/40 transition-transform active:scale-95"
      >
        <LocateFixed className="h-5 w-5 text-fg" />
      </button>

      {error && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg px-8">
          <div className="max-w-xs text-center">
            <p className="text-sm text-fg/80">{error}</p>
            <p className="mt-2 text-xs text-fg/40">
              Vérifie la variable VITE_MAPBOX_TOKEN dans .env.local.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
