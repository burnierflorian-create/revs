import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { Car, LocateFixed } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { SkeletonMap } from '../components/Skeleton'
import { escapeHtml, timeAgo, type Spot } from '../lib/spots'

const PARIS: [number, number] = [2.3522, 48.8566]
const DEFAULT_ZOOM = 13
const SPOT_TTL_MS = 60 * 60 * 1000
const POLL_MS = 60 * 1000

const FILTERS = ['Tous', 'Supercars', 'Classics', 'JDM'] as const
const FILTER_CATEGORY: Record<string, string | null> = {
  Tous: null,
  Supercars: 'supercar',
  Classics: 'classic',
  JDM: 'JDM',
}

const CAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`

type SpotProps = {
  id: string
  brand: string
  model: string
  photo_url: string | null
  spotter: string
  created_at: string
}

// Outer element is positioned by Mapbox (it owns the transform). Inside
// it: an SVG "story ring" that depletes over the spot's remaining life,
// and a photo disc that carries the tap-scale (so we never clobber
// Mapbox's positioning transform).
function spotMarkerEl(p: SpotProps, remainingMs: number): HTMLDivElement {
  const size = 48
  const r = 21
  const c = 2 * Math.PI * r
  const frac = Math.max(0, Math.min(1, remainingMs / SPOT_TTL_MS))

  const outer = document.createElement('div')
  outer.style.cursor = 'pointer'

  const wrap = document.createElement('div')
  wrap.style.position = 'relative'
  wrap.style.width = `${size}px`
  wrap.style.height = `${size}px`

  const svgns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgns, 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.style.position = 'absolute'
  svg.style.inset = '0'
  svg.style.transform = 'rotate(-90deg)'
  svg.style.pointerEvents = 'none'

  const track = document.createElementNS(svgns, 'circle')
  track.setAttribute('cx', String(size / 2))
  track.setAttribute('cy', String(size / 2))
  track.setAttribute('r', String(r))
  track.setAttribute('fill', 'none')
  track.setAttribute('stroke', 'rgba(255,255,255,0.16)')
  track.setAttribute('stroke-width', '3')

  const arc = document.createElementNS(svgns, 'circle')
  arc.setAttribute('cx', String(size / 2))
  arc.setAttribute('cy', String(size / 2))
  arc.setAttribute('r', String(r))
  arc.setAttribute('fill', 'none')
  arc.setAttribute('stroke', '#E63946')
  arc.setAttribute('stroke-width', '3')
  arc.setAttribute('stroke-linecap', 'round')
  arc.style.strokeDasharray = String(c)
  arc.style.strokeDashoffset = String(c * (1 - frac))
  arc.style.transition = `stroke-dashoffset ${Math.max(0, remainingMs)}ms linear`

  svg.appendChild(track)
  svg.appendChild(arc)

  const ps = 38
  const photo = document.createElement('div')
  photo.dataset.photo = '1'
  photo.style.position = 'absolute'
  photo.style.left = '50%'
  photo.style.top = '50%'
  photo.style.width = `${ps}px`
  photo.style.height = `${ps}px`
  photo.style.marginLeft = `-${ps / 2}px`
  photo.style.marginTop = `-${ps / 2}px`
  photo.style.borderRadius = '9999px'
  photo.style.overflow = 'hidden'
  photo.style.border = '2px solid #0A0A0A'
  photo.style.boxShadow = '0 3px 10px rgba(0,0,0,0.55)'
  photo.style.transition = 'transform .15s ease'
  if (p.photo_url) {
    photo.style.backgroundImage = `url("${p.photo_url.replace(/"/g, '%22')}")`
    photo.style.backgroundSize = 'cover'
    photo.style.backgroundPosition = 'center'
  } else {
    photo.style.background = '#E63946'
    photo.style.display = 'flex'
    photo.style.alignItems = 'center'
    photo.style.justifyContent = 'center'
    photo.innerHTML = CAR_SVG
  }

  wrap.appendChild(svg)
  wrap.appendChild(photo)
  outer.appendChild(wrap)

  // Kick the depletion: on the next frame, run the ring down to empty
  // over the remaining lifetime via the CSS transition above.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      arc.style.strokeDashoffset = String(c)
    }),
  )

  return outer
}

function clusterMarkerEl(count: number): HTMLDivElement {
  const outer = document.createElement('div')
  outer.style.cursor = 'pointer'
  const size = count < 10 ? 38 : count < 50 ? 46 : 56
  const inner = document.createElement('div')
  inner.style.width = `${size}px`
  inner.style.height = `${size}px`
  inner.style.borderRadius = '9999px'
  inner.style.background = '#E63946'
  inner.style.border = '2px solid rgba(255,255,255,0.85)'
  inner.style.boxShadow = '0 3px 12px rgba(0,0,0,0.55)'
  inner.style.display = 'flex'
  inner.style.alignItems = 'center'
  inner.style.justifyContent = 'center'
  inner.style.color = '#fff'
  inner.style.fontWeight = '700'
  inner.style.fontSize = '14px'
  inner.textContent = String(count)
  outer.appendChild(inner)
  return outer
}

function popupHtml(p: SpotProps): string {
  const title = `${escapeHtml(p.brand)} ${escapeHtml(p.model)}`.trim()
  const photo = p.photo_url
    ? `<img src="${escapeHtml(p.photo_url)}" alt="" style="width:72px;height:72px;border-radius:12px;object-fit:cover;flex:none" />`
    : ''
  return `
    <div style="display:flex;gap:12px;align-items:center;max-width:240px">
      ${photo}
      <div style="min-width:0">
        <div style="font-weight:700;font-size:14px">${title || 'Spot'}</div>
        <div style="font-size:12px;opacity:.6;margin-top:3px">par ${escapeHtml(p.spotter)}</div>
        <div style="font-size:11px;opacity:.45;margin-top:2px">${escapeHtml(timeAgo(p.created_at))}</div>
      </div>
    </div>`
}

type RawLayer = {
  id: string
  type: string
  source?: string
  'source-layer'?: string
}

// Strip the GPS clutter from dark-v11: keep roads, water, landuse and
// city/region names; drop every POI / transit / airport / parking /
// road / water label. Add a single simple 3D building extrusion so the
// map feels immersive without being busy.
function applyCleanStyle(map: mapboxgl.Map) {
  try {
    const layers = (map.getStyle()?.layers ?? []) as unknown as RawLayer[]
    let buildingSource: string | undefined
    let buildingSourceLayer: string | undefined
    let firstSymbolId: string | undefined
    const toRemove: string[] = []

    for (const l of layers) {
      const sl = l['source-layer']
      if (l.type === 'symbol' && !firstSymbolId) firstSymbolId = l.id

      const isPlaceLabel =
        l.type === 'symbol' &&
        /settlement|state-label|country-label|continent-label/.test(l.id)
      if (l.type === 'symbol' && !isPlaceLabel) {
        toRemove.push(l.id)
        continue
      }
      if (/parking/.test(l.id)) {
        toRemove.push(l.id)
        continue
      }
      if (
        (l.type === 'fill' || l.type === 'fill-extrusion') &&
        sl === 'building' &&
        l.source
      ) {
        buildingSource = l.source
        buildingSourceLayer = sl
        toRemove.push(l.id)
      }
    }

    for (const id of toRemove) {
      if (map.getLayer(id)) map.removeLayer(id)
    }

    type AddLayer = Parameters<typeof map.addLayer>[0]
    if (!map.getLayer('revs-3d-buildings')) {
      map.addLayer(
        {
          id: 'revs-3d-buildings',
          type: 'fill-extrusion',
          source: buildingSource ?? 'composite',
          'source-layer': buildingSourceLayer ?? 'building',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': '#23252b',
            'fill-extrusion-height': [
              'interpolate',
              ['linear'],
              ['zoom'],
              14,
              0,
              16.5,
              ['coalesce', ['get', 'render_height'], ['get', 'height'], 12],
            ],
            'fill-extrusion-base': [
              'coalesce',
              ['get', 'render_min_height'],
              ['get', 'min_height'],
              0,
            ],
            'fill-extrusion-opacity': 0.85,
          },
        } as unknown as AddLayer,
        firstSymbolId,
      )
    }
  } catch {
    /* styling is best-effort — never break the map */
  }
}

export default function MapPage() {
  const navigate = useNavigate()
  const location = useLocation()

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const allSpotsRef = useRef<globalThis.Map<string, Spot>>(new globalThis.Map())
  const namesRef = useRef<globalThis.Map<string, string>>(new globalThis.Map())
  const markersRef = useRef<Record<string, mapboxgl.Marker>>({})
  const onScreenRef = useRef<Record<string, mapboxgl.Marker>>({})
  const filterRef = useRef<string>('Tous')
  const refreshRef = useRef<(() => void) | null>(null)

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
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 0 },
    )
  }

  function flyToUser() {
    if (!mapRef.current) return
    const perms = navigator.permissions
    if (!perms?.query) {
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
        pitch: 45,
        attributionControl: true,
      })
    } catch {
      setError('Impossible d’initialiser la carte.')
      return
    }
    mapRef.current = map
    const allSpots = allSpotsRef.current
    const names = namesRef.current
    let pollId: ReturnType<typeof setInterval> | undefined

    function isAlive(sp: Spot): boolean {
      return new Date(sp.expires_at).getTime() > Date.now()
    }

    function featureCollection(): GeoJSON.FeatureCollection {
      const cat = FILTER_CATEGORY[filterRef.current]
      const feats: GeoJSON.Feature[] = []
      for (const sp of allSpots.values()) {
        if (!isAlive(sp)) continue
        if (cat != null && sp.category !== cat) continue
        feats.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [sp.lng, sp.lat] },
          properties: {
            id: sp.id,
            brand: sp.brand ?? '',
            model: sp.model ?? '',
            photo_url: sp.photo_url ?? null,
            spotter: names.get(sp.user_id) ?? 'Anonyme',
            created_at: sp.created_at,
            expires_at: sp.expires_at,
          },
        })
      }
      setVisibleCount(feats.length)
      return { type: 'FeatureCollection', features: feats }
    }

    function refreshSource() {
      const src = map.getSource('spots') as mapboxgl.GeoJSONSource | undefined
      if (src) src.setData(featureCollection())
    }
    refreshRef.current = refreshSource

    // Drop a marker so updateMarkers rebuilds it (fresh story ring) the
    // next render — used when a spot's expiry is extended.
    function refreshMarker(id: string) {
      const k = `s${id}`
      onScreenRef.current[k]?.remove()
      delete onScreenRef.current[k]
      delete markersRef.current[k]
    }

    async function fetchSpots() {
      const { data } = await supabase
        .from('spots')
        .select('*')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(200)
      const spots = (data ?? []) as Spot[]
      allSpots.clear()
      for (const sp of spots) allSpots.set(sp.id, sp)

      const ids = [...new Set(spots.map((s) => s.user_id))]
      if (ids.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('user_id, pseudo')
          .in('user_id', ids)
        for (const p of (profs ?? []) as {
          user_id: string
          pseudo: string | null
        }[]) {
          if (p.pseudo) names.set(p.user_id, p.pseudo)
        }
      }
      refreshSource()
    }

    function updateMarkers() {
      const feats = map.querySourceFeatures('spots')
      const next: Record<string, mapboxgl.Marker> = {}
      const markers = markersRef.current
      for (const f of feats) {
        if (f.geometry.type !== 'Point') continue
        const coords = f.geometry.coordinates as [number, number]
        const props = (f.properties ?? {}) as Record<string, unknown>
        let key: string
        let marker = undefined as mapboxgl.Marker | undefined

        if (props.cluster) {
          key = `c${props.cluster_id}`
          marker = markers[key]
          if (!marker) {
            const count = Number(props.point_count ?? 0)
            const el = clusterMarkerEl(count)
            el.addEventListener('click', () => {
              const src = map.getSource(
                'spots',
              ) as mapboxgl.GeoJSONSource | null
              src?.getClusterExpansionZoom(
                Number(props.cluster_id),
                (err, zoom) => {
                  if (err == null && zoom != null)
                    map.easeTo({ center: coords, zoom })
                },
              )
            })
            marker = new mapboxgl.Marker({ element: el }).setLngLat(coords)
            markers[key] = marker
          }
        } else {
          const sp: SpotProps = {
            id: String(props.id ?? ''),
            brand: String(props.brand ?? ''),
            model: String(props.model ?? ''),
            photo_url:
              typeof props.photo_url === 'string' ? props.photo_url : null,
            spotter: String(props.spotter ?? 'Anonyme'),
            created_at: String(props.created_at ?? ''),
          }
          key = `s${sp.id}`
          marker = markers[key]
          if (!marker) {
            const expiresAt =
              typeof props.expires_at === 'string' ? props.expires_at : ''
            const remainingMs = expiresAt
              ? new Date(expiresAt).getTime() - Date.now()
              : 0
            const el = spotMarkerEl(sp, remainingMs)
            const photoEl = el.querySelector(
              '[data-photo]',
            ) as HTMLElement | null
            el.addEventListener('click', (ev) => {
              ev.stopPropagation()
              if (photoEl) photoEl.style.transform = 'scale(1.2)'
              const popup = new mapboxgl.Popup({
                offset: 26,
                closeButton: true,
              })
                .setLngLat(coords)
                .setHTML(popupHtml(sp))
                .addTo(map)
              popup.on('close', () => {
                if (photoEl) photoEl.style.transform = 'scale(1)'
              })
              // A view keeps the spot alive 1h more; reflect it locally
              // so the ring visibly refills.
              supabase
                .rpc('touch_spot', { p_spot_id: sp.id })
                .then(() => {
                  const cur = allSpots.get(sp.id)
                  if (cur) {
                    cur.expires_at = new Date(
                      Date.now() + SPOT_TTL_MS,
                    ).toISOString()
                    allSpots.set(sp.id, cur)
                    refreshSource()
                    refreshMarker(sp.id)
                  }
                })
            })
            marker = new mapboxgl.Marker({ element: el }).setLngLat(coords)
            markers[key] = marker
          }
        }
        next[key] = marker
        if (!onScreenRef.current[key]) marker.addTo(map)
      }
      for (const k in onScreenRef.current) {
        if (!next[k]) onScreenRef.current[k].remove()
      }
      onScreenRef.current = next
    }

    map.on('error', (e) => {
      const msg = e.error?.message ?? ''
      if (
        /401|403|unauthorized|forbidden|access token|not authorized/i.test(msg)
      ) {
        setError('Carte indisponible : token Mapbox invalide ou non autorisé.')
      }
    })

    map.on('load', async () => {
      map.resize()
      applyCleanStyle(map)
      setMapReady(true)
      flyToUser()

      await fetchSpots()

      map.addSource('spots', {
        type: 'geojson',
        data: featureCollection(),
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      })
      // Invisible layer so the source's tiles load (querySourceFeatures
      // only returns features from rendered tiles).
      map.addLayer({
        id: 'spot-src',
        type: 'circle',
        source: 'spots',
        paint: { 'circle-radius': 0, 'circle-opacity': 0 },
      })
      map.on('render', () => {
        if (!map.isSourceLoaded('spots')) return
        updateMarkers()
      })

      // Re-poll so freshly-expired spots drop and extended ones return.
      pollId = setInterval(() => {
        void fetchSpots()
      }, POLL_MS)
    })

    const channel = supabase
      .channel('public:spots')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'spots' },
        (payload) => {
          const sp = payload.new as Spot
          if (!sp?.id) return
          allSpots.set(sp.id, sp)
          refreshSource()
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'spots' },
        (payload) => {
          const sp = payload.new as Spot
          if (!sp?.id) return
          allSpots.set(sp.id, sp)
          refreshSource()
          refreshMarker(sp.id)
        },
      )
      .subscribe()

    return () => {
      if (pollId) clearInterval(pollId)
      supabase.removeChannel(channel)
      for (const k in onScreenRef.current) onScreenRef.current[k].remove()
      onScreenRef.current = {}
      markersRef.current = {}
      allSpots.clear()
      names.clear()
      refreshRef.current = null
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  useEffect(() => {
    filterRef.current = activeFilter
    refreshRef.current?.()
  }, [activeFilter])

  return (
    <div className="fixed inset-0">
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

      <div className="absolute left-0 right-0 top-0 z-10 px-4 pt-[max(4rem,calc(env(safe-area-inset-top)+3rem))]">
        <div className="mx-auto flex max-w-md gap-1 rounded-full bg-black/60 p-1 backdrop-blur">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`flex-1 rounded-full py-2 text-xs font-medium transition-colors ${
                activeFilter === f
                  ? 'bg-accent text-fg'
                  : 'text-fg/50 hover:text-fg'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={flyToUser}
        aria-label="Me localiser"
        style={{
          bottom: 'calc(env(safe-area-inset-bottom) + 5rem + 0.75rem + 20px)',
        }}
        className="absolute right-4 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-accent shadow-lg shadow-accent/40 transition-transform active:scale-95"
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
