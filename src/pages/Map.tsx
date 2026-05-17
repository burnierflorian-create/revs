import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { Car, LocateFixed } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { SkeletonMap } from '../components/Skeleton'
import { escapeHtml, type Spot } from '../lib/spots'

const PARIS: [number, number] = [2.3522, 48.8566]
const DEFAULT_ZOOM = 13

const FILTERS = ['Tous', 'Supercars', 'Classics', 'JDM'] as const
const FILTER_CATEGORY: Record<string, string | null> = {
  Tous: null,
  Supercars: 'supercar',
  Classics: 'classic',
  JDM: 'JDM',
}

const CAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`

type SpotProps = {
  id: string
  brand: string
  model: string
  photo_url: string | null
  spotter: string
}

// Outer element is positioned by Mapbox (it owns the transform); the
// inner element carries the visual + the tap scale so we never clobber
// Mapbox's positioning transform.
function spotMarkerEl(p: SpotProps): HTMLDivElement {
  const outer = document.createElement('div')
  outer.style.cursor = 'pointer'
  const inner = document.createElement('div')
  inner.style.width = '40px'
  inner.style.height = '40px'
  inner.style.borderRadius = '9999px'
  inner.style.border = '2px solid #E63946'
  inner.style.overflow = 'hidden'
  inner.style.boxShadow = '0 3px 10px rgba(0,0,0,0.55)'
  inner.style.transition = 'transform .15s ease'
  if (p.photo_url) {
    inner.style.backgroundImage = `url("${p.photo_url.replace(/"/g, '%22')}")`
    inner.style.backgroundSize = 'cover'
    inner.style.backgroundPosition = 'center'
  } else {
    inner.style.background = '#E63946'
    inner.style.display = 'flex'
    inner.style.alignItems = 'center'
    inner.style.justifyContent = 'center'
    inner.innerHTML = CAR_SVG
  }
  outer.appendChild(inner)
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
      </div>
    </div>`
}

type RawLayer = {
  id: string
  type: string
  source?: string
  'source-layer'?: string
}

// Snapchat-night theme on top of streets-v12 + 3D terrain.
function applyRevsTheme(map: mapboxgl.Map) {
  try {
    const layers = (map.getStyle()?.layers ?? []) as unknown as RawLayer[]
    let buildingSource: string | undefined
    let buildingSourceLayer: string | undefined
    let firstSymbolId: string | undefined

    for (const l of layers) {
      const sl = l['source-layer']
      if (l.type === 'symbol' && !firstSymbolId) firstSymbolId = l.id
      try {
        if (l.type === 'background') {
          map.setPaintProperty(l.id, 'background-color', '#1a1a2e')
        } else if (l.type === 'fill' && sl === 'water') {
          map.setPaintProperty(l.id, 'fill-color', '#162447')
        } else if (l.type === 'fill' && (sl === 'landuse' || sl === 'park')) {
          map.setPaintProperty(l.id, 'fill-color', '#1b4332')
        } else if (l.type === 'line' && sl === 'road') {
          map.setPaintProperty(l.id, 'line-color', '#c9cdd8')
        } else if (l.type === 'symbol') {
          map.setPaintProperty(l.id, 'text-color', '#e8eaf0')
          map.setPaintProperty(l.id, 'text-halo-color', '#11131f')
        } else if (
          (l.type === 'fill' || l.type === 'fill-extrusion') &&
          sl === 'building'
        ) {
          if (l.source) {
            buildingSource = l.source
            buildingSourceLayer = sl
          }
        }
      } catch {
        /* property absent on this layer */
      }
    }

    type AddLayer = Parameters<typeof map.addLayer>[0]

    if (!map.getLayer('revs-3d-buildings')) {
      map.addLayer(
        {
          id: 'revs-3d-buildings',
          type: 'fill-extrusion',
          source: buildingSource ?? 'composite',
          'source-layer': buildingSourceLayer ?? 'building',
          minzoom: 13,
          paint: {
            'fill-extrusion-color': '#1f4068',
            'fill-extrusion-height': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13,
              0,
              16,
              ['coalesce', ['get', 'render_height'], ['get', 'height'], 14],
            ],
            'fill-extrusion-base': [
              'coalesce',
              ['get', 'render_min_height'],
              ['get', 'min_height'],
              0,
            ],
            'fill-extrusion-opacity': 0.9,
          },
        } as unknown as AddLayer,
        firstSymbolId,
      )
    }

    // 3D relief — great for the Annecy / Genève mountains.
    if (!map.getSource('mapbox-dem')) {
      map.addSource('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      })
    }
    map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 })
    if (!map.getLayer('sky')) {
      map.addLayer({
        id: 'sky',
        type: 'sky',
        paint: {
          'sky-type': 'atmosphere',
          'sky-atmosphere-sun': [0, 0],
          'sky-atmosphere-sun-intensity': 4,
        },
      } as unknown as AddLayer)
    }
  } catch {
    /* theming is best-effort — never break the map */
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
        style: 'mapbox://styles/mapbox/streets-v12',
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

    function featureCollection(): GeoJSON.FeatureCollection {
      const cat = FILTER_CATEGORY[filterRef.current]
      const feats: GeoJSON.Feature[] = []
      for (const sp of allSpots.values()) {
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
          }
          key = `s${sp.id}`
          marker = markers[key]
          if (!marker) {
            const el = spotMarkerEl(sp)
            const inner = el.firstElementChild as HTMLElement
            el.addEventListener('click', (ev) => {
              ev.stopPropagation()
              inner.style.transform = 'scale(1.2)'
              const popup = new mapboxgl.Popup({
                offset: 26,
                closeButton: true,
              })
                .setLngLat(coords)
                .setHTML(popupHtml(sp))
                .addTo(map)
              popup.on('close', () => {
                inner.style.transform = 'scale(1)'
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
      applyRevsTheme(map)
      setMapReady(true)
      flyToUser()

      const { data } = await supabase
        .from('spots')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)
      const spots = (data ?? []) as Spot[]
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
      .subscribe()

    return () => {
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
        style={{ width: '100%', height: '100vh', backgroundColor: '#1a1a2e' }}
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
