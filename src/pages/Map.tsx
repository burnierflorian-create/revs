import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import type { DataDrivenPropertyValueSpecification } from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import {
  Car,
  LocateFixed,
  Loader2,
  Pause,
  Play,
  Rewind,
  Search as SearchIcon,
  Sparkles,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { SkeletonMap } from '../components/Skeleton'
import {
  distanceMeters,
  escapeHtml,
  timeAgo,
  type Spot,
} from '../lib/spots'
import {
  fetchSpottingPrediction,
  type PredictionResult,
  type SpotScore,
} from '../lib/spotPredictions'
import { xpLevel } from '../lib/xp'

function fmtDist(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}

const PARIS: [number, number] = [2.3522, 48.8566]
const DEFAULT_ZOOM = 13
const USER_ZOOM = 15
const RECENTER_ZOOM = 17
const GEO_TIMEOUT_MS = 3000
const SPOT_TTL_MS = 60 * 60 * 1000
const POLL_MS = 60 * 1000

const FILTERS = ['Tous', 'Supercars', 'Autre', 'JDM'] as const
const FILTER_CATEGORY: Record<string, string | null> = {
  Tous: null,
  Supercars: 'supercar',
  Autre: 'other',
  JDM: 'JDM',
}

const CAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`

type SpotProps = {
  id: string
  brand: string
  model: string
  year: number | null
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
  arc.setAttribute('stroke', '#E8203A')
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
  photo.style.boxShadow =
    '0 4px 14px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.05)'
  photo.style.transition = 'transform .15s ease'
  if (p.photo_url) {
    photo.style.backgroundImage = `url("${p.photo_url.replace(/"/g, '%22')}")`
    photo.style.backgroundSize = 'cover'
    photo.style.backgroundPosition = 'center'
  } else {
    photo.style.background = '#E8203A'
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
  inner.style.background =
    'radial-gradient(circle at 35% 30%, #ff4d62 0%, #E8203A 70%)'
  inner.style.border = '1.5px solid rgba(255,255,255,0.9)'
  inner.style.boxShadow =
    '0 4px 16px rgba(232,32,58,0.35), 0 2px 6px rgba(0,0,0,0.45)'
  inner.style.display = 'flex'
  inner.style.alignItems = 'center'
  inner.style.justifyContent = 'center'
  inner.style.color = '#fff'
  inner.style.fontWeight = '800'
  inner.style.fontSize = '14px'
  inner.style.letterSpacing = '-0.3px'
  inner.textContent = String(count)
  outer.appendChild(inner)
  return outer
}

function popupInner(p: SpotProps): string {
  const title = (p.model || p.brand || 'Spot').trim()
  const sub = [p.brand, p.year ?? undefined].filter(Boolean).join(' · ')
  const photo = p.photo_url
    ? `<img src="${escapeHtml(p.photo_url)}" alt="" style="width:72px;height:72px;border-radius:12px;object-fit:cover;flex:none" />`
    : ''
  return `
    <div style="display:flex;gap:12px;align-items:center;max-width:240px;color:#111111">
      ${photo}
      <div style="min-width:0">
        <div style="font-weight:800;font-size:15px;color:#111111">${escapeHtml(title)}</div>
        <div style="font-size:12px;color:#555555;margin-top:3px">${escapeHtml(sub || p.spotter)}</div>
        <div style="font-size:11px;color:#777777;margin-top:3px">${escapeHtml(timeAgo(p.created_at))}</div>
        <div style="font-size:11px;color:#E8203A;font-weight:700;margin-top:6px">Voir le détail →</div>
      </div>
    </div>`
}

type RawLayer = {
  id: string
  type: string
  source?: string
  'source-layer'?: string
}

type MapMode = '2D' | '3D'

const MODE_KEY = 'revs-map-mode'

// Snapchat-soft palette + a REVS red accent on the big roads.
const SNAP = {
  bg: '#F5F0E8',
  water: '#A8D8EA',
  green: '#B8E0C8',
  building: '#E8E4DE',
  building3d: '#D4C5B0',
  roadFill: '#FFFFFF',
  roadCase: '#DCD5C7',
  roadMajor: '#E8203A',
  outline: '#D8D2C8',
  admin: 'rgba(150,138,116,0.45)',
  street: '#555555',
  place: '#3F3F3F',
  halo: '#F5F0E8',
} as const

// Only label these road classes — no alleys / small streets.
const MAJOR_ROADS = ['motorway', 'trunk', 'primary', 'secondary']

// Soft Snap-like recolor + a near-total POI strip. We keep roads,
// water, parks/landuse, relief, major-road names and city/neighbourhood
// names — every POI / transit / airport / parking / water label is
// removed. REVS touch: a thin red casing on major roads, a warm-beige
// shaded 3D-building layer (toggled on only in 3D).
function applySnapStyle(map: mapboxgl.Map) {
  try {
    const layers = (map.getStyle()?.layers ?? []) as unknown as RawLayer[]
    let buildingSource: string | undefined
    let buildingSourceLayer: string | undefined
    let firstRoadLineId: string | undefined
    let firstSymbolId: string | undefined
    const toRemove: string[] = []

    for (const l of layers) {
      const sl = l['source-layer']
      if (l.type === 'symbol' && !firstSymbolId) firstSymbolId = l.id
      if (l.type === 'line' && sl === 'road' && !firstRoadLineId)
        firstRoadLineId = l.id

      const isPlace =
        l.type === 'symbol' &&
        /settlement|state-label|country-label|continent-label/.test(l.id)
      const isRoadLabel = l.type === 'symbol' && /^road-label/.test(l.id)

      if (l.type === 'symbol' && !isPlace && !isRoadLabel) {
        toRemove.push(l.id)
        continue
      }
      if (/parking/.test(l.id)) {
        toRemove.push(l.id)
        continue
      }

      try {
        if (l.type === 'background') {
          map.setPaintProperty(l.id, 'background-color', SNAP.bg)
        } else if (l.type === 'fill' && sl === 'water') {
          map.setPaintProperty(l.id, 'fill-color', SNAP.water)
        } else if (l.type === 'line' && sl === 'waterway') {
          map.setPaintProperty(l.id, 'line-color', SNAP.water)
        } else if (
          l.type === 'fill' &&
          (sl === 'landuse' ||
            sl === 'landcover' ||
            sl === 'national_park' ||
            /landuse|landcover|park|grass|wood|golf|pitch/.test(l.id))
        ) {
          map.setPaintProperty(l.id, 'fill-color', SNAP.green)
        } else if (
          (l.type === 'fill' || l.type === 'fill-extrusion') &&
          sl === 'building'
        ) {
          if (l.source) {
            buildingSource = l.source
            buildingSourceLayer = sl
          }
          if (l.type === 'fill')
            map.setPaintProperty(l.id, 'fill-color', SNAP.building)
        } else if (l.type === 'line' && sl === 'building') {
          map.setPaintProperty(l.id, 'line-color', SNAP.outline)
        } else if (l.type === 'line' && sl === 'road') {
          const isCase = /case|casing|outline/.test(l.id)
          const isMajor = /motorway|trunk|primary|secondary/.test(l.id)
          map.setPaintProperty(
            l.id,
            'line-color',
            isCase
              ? isMajor
                ? SNAP.roadMajor
                : SNAP.roadCase
              : SNAP.roadFill,
          )
        } else if (l.type === 'line' && sl === 'admin') {
          map.setPaintProperty(l.id, 'line-color', SNAP.admin)
        } else if (isRoadLabel) {
          // Keep major + neighbourhood streets available, but only show
          // the small ones past zoom 15 (fading in 15→16) so the map is
          // clean from afar and useful up close.
          map.setFilter(
            l.id,
            [
              'match',
              ['get', 'class'],
              [...MAJOR_ROADS, 'tertiary', 'street', 'street_limited'],
              true,
              false,
            ] as unknown as Parameters<typeof map.setFilter>[1],
          )
          map.setLayoutProperty(
            l.id,
            'text-size',
            [
              'step',
              ['zoom'],
              ['match', ['get', 'class'], MAJOR_ROADS, 11.5, 0],
              15,
              12,
            ] as unknown as DataDrivenPropertyValueSpecification<number>,
          )
          map.setPaintProperty(
            l.id,
            'text-opacity',
            [
              'case',
              ['match', ['get', 'class'], MAJOR_ROADS, true, false],
              1,
              ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 1],
            ] as unknown as DataDrivenPropertyValueSpecification<number>,
          )
          map.setPaintProperty(l.id, 'text-color', SNAP.street)
          map.setPaintProperty(l.id, 'text-halo-color', SNAP.halo)
          map.setPaintProperty(l.id, 'text-halo-width', 1.1)
        } else if (isPlace) {
          map.setPaintProperty(l.id, 'text-color', SNAP.place)
          map.setPaintProperty(l.id, 'text-halo-color', SNAP.halo)
          map.setPaintProperty(l.id, 'text-halo-width', 1.4)
        }
      } catch {
        /* property absent on this layer */
      }
    }

    for (const id of toRemove) {
      if (map.getLayer(id)) map.removeLayer(id)
    }

    if (!map.getSource('mapbox-dem')) {
      map.addSource('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      })
    }

    // Directional light so extruded buildings get a lit face and a
    // shaded face — the Snap-Map relief look.
    map.setLight({
      anchor: 'map',
      color: '#fff4e0',
      intensity: 0.45,
      position: [1.5, 210, 32],
    })

    type AddLayer = Parameters<typeof map.addLayer>[0]
    // Insert below the road lines so roads + labels stay visible on
    // top of the buildings in 3D.
    if (!map.getLayer('revs-3d-buildings')) {
      map.addLayer(
        {
          id: 'revs-3d-buildings',
          type: 'fill-extrusion',
          source: buildingSource ?? 'composite',
          'source-layer': buildingSourceLayer ?? 'building',
          minzoom: 14,
          layout: { visibility: 'none' },
          paint: {
            'fill-extrusion-color': SNAP.building3d,
            'fill-extrusion-vertical-gradient': true,
            'fill-extrusion-height': [
              'interpolate',
              ['linear'],
              ['zoom'],
              14,
              0,
              15.5,
              ['coalesce', ['get', 'render_height'], ['get', 'height'], 6],
            ],
            'fill-extrusion-base': [
              'coalesce',
              ['get', 'render_min_height'],
              ['get', 'min_height'],
              0,
            ],
            'fill-extrusion-opacity': 0.95,
          },
        } as unknown as AddLayer,
        firstRoadLineId ?? firstSymbolId,
      )
    }
  } catch {
    /* styling is best-effort — never break the map */
  }
}

// 2D = flat top-down. 3D = Snap-like tilt (50°) with a subtle terrain
// relief + extruded buildings (great over Annecy / Genève / the Alps).
// Pitch is eased 800ms for a smooth transition.
function applyMode(map: mapboxgl.Map, mode: MapMode) {
  try {
    if (mode === '3D') {
      map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.2 })
      if (map.getLayer('revs-3d-buildings'))
        map.setLayoutProperty('revs-3d-buildings', 'visibility', 'visible')
      map.easeTo({ pitch: 50, duration: 800 })
    } else {
      map.setTerrain(null)
      if (map.getLayer('revs-3d-buildings'))
        map.setLayoutProperty('revs-3d-buildings', 'visibility', 'none')
      map.easeTo({ pitch: 0, bearing: 0, duration: 800 })
    }
  } catch {
    /* never break the map on a mode switch */
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
  const searchRef = useRef<string>('')
  const refreshRef = useRef<(() => void) | null>(null)
  const recomputeHotZonesRef = useRef<(() => void) | null>(null)
  const clearHotZonesRef = useRef<(() => void) | null>(null)
  const navRef = useRef(navigate)
  navRef.current = navigate
  const posRef = useRef<{ lat: number; lng: number } | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<string>('Tous')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [toast, setToast] = useState<string | null>(null)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(0)
  const [panelSpots, setPanelSpots] = useState<Spot[]>([])
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(
    null,
  )
  const [mapReady, setMapReady] = useState(false)

  // Replay time-lapse state. `idle` hides all replay UI; `playing` ticks
  // the marker pop animation every 400 ms; `paused` keeps revealed
  // markers but stops the timer. Refs hold the heavy/non-rendered bits.
  const [replayState, setReplayState] = useState<'idle' | 'playing' | 'paused'>(
    'idle',
  )
  const [replayIndex, setReplayIndex] = useState(0)
  const [replayTotal, setReplayTotal] = useState(0)
  const [replayCurrentTime, setReplayCurrentTime] = useState<string>('')
  const replaySpotsRef = useRef<Spot[]>([])
  const replayMarkersRef = useRef<mapboxgl.Marker[]>([])
  const replayTimerRef = useRef<number | null>(null)

  const [mode, setMode] = useState<MapMode>(() => {
    try {
      const v = localStorage.getItem(MODE_KEY)
      if (v === '2D' || v === '3D') return v
    } catch {
      /* localStorage unavailable */
    }
    return '3D'
  })

  // AI prediction bottom-sheet state. The fetch is lazy — first time
  // the user opens the sheet we hit /api/car-info?action=predict-
  // spotting, then cache the result for the rest of the session.
  // The endpoint itself caches per (user, city, date) so even
  // navigating between Home (legacy spot) and Map would have been
  // free; this just avoids triggering it for users who never open
  // the sheet.
  const [infoSheetOpen, setInfoSheetOpen] = useState(false)
  const [prediction, setPrediction] = useState<PredictionResult | null>(null)
  const [predictionLoading, setPredictionLoading] = useState(false)
  const [predictionTried, setPredictionTried] = useState(false)

  useEffect(() => {
    if (!infoSheetOpen || predictionTried || predictionLoading) return
    let alive = true
    setPredictionLoading(true)
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        if (alive) {
          setPredictionLoading(false)
          setPredictionTried(true)
        }
        return
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('pseudo, ville')
        .eq('id', user.id)
        .maybeSingle()
      const ville = (profile?.ville as string | undefined)?.trim()
      if (!ville) {
        if (alive) {
          setPredictionLoading(false)
          setPredictionTried(true)
        }
        return
      }

      // Build the same context Home used to send so the AI message
      // stays personalised (top brands, last car, level).
      const [{ data: mySpots }, { data: xpRow }] = await Promise.all([
        supabase
          .from('spots')
          .select('brand, model, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(60),
        supabase.rpc('my_xp'),
      ])
      const recentList = (mySpots ?? []) as {
        brand: string | null
        model: string | null
      }[]
      const counts = new Map<string, number>()
      for (const r of recentList) {
        const b = (r.brand ?? '').trim()
        if (!b) continue
        counts.set(b, (counts.get(b) ?? 0) + 1)
      }
      const topBrands = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([brand]) => brand)
      const lastCar = recentList[0]
        ? `${recentList[0].brand ?? ''} ${recentList[0].model ?? ''}`.trim()
        : undefined

      const p = await fetchSpottingPrediction(ville, {
        pseudo: profile?.pseudo as string | undefined,
        spot_count: recentList.length,
        top_brands: topBrands,
        level: xpLevel((xpRow as number | null) ?? 0).name,
        last_car: lastCar,
      })
      if (!alive) return
      setPrediction(p)
      setPredictionLoading(false)
      setPredictionTried(true)
    })()
    return () => {
      alive = false
    }
  }, [infoSheetOpen, predictionTried, predictionLoading])

  function locate() {
    if (!navigator.geolocation) {
      setGeoError('Géolocalisation non disponible sur cet appareil.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoError(null)
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        posRef.current = p
        setUserPos(p)
        mapRef.current?.flyTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: RECENTER_ZOOM,
          speed: 2,
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
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  // ──────────────────────── Replay time-lapse ────────────────────────
  // Fetch today's spots, hide the normal source, then reveal them one
  // by one with a pop animation. Markers are owned outside the
  // GeoJSON source so they don't fight the clustering pipeline.

  function fmtSpotTime(iso: string): string {
    const d = new Date(iso)
    return new Intl.DateTimeFormat('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(d)
  }

  function replayClearMarkers() {
    for (const m of replayMarkersRef.current) m.remove()
    replayMarkersRef.current = []
  }

  function replayClearTimer() {
    if (replayTimerRef.current !== null) {
      window.clearInterval(replayTimerRef.current)
      replayTimerRef.current = null
    }
  }

  function replayStartTimer() {
    replayClearTimer()
    replayTimerRef.current = window.setInterval(() => {
      const map = mapRef.current
      const spots = replaySpotsRef.current
      if (!map || spots.length === 0) return
      setReplayIndex((i) => {
        if (i >= spots.length) {
          replayClearTimer()
          setReplayState('paused')
          return i
        }
        const sp = spots[i]
        const el = document.createElement('div')
        el.className = 'replay-pop'
        el.style.cssText =
          'width:18px;height:18px;border-radius:50%;background:#E8203A;box-shadow:0 0 22px rgba(232,32,58,0.85);border:2px solid #fff;'
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([sp.lng, sp.lat])
          .addTo(map)
        replayMarkersRef.current.push(marker)
        setReplayCurrentTime(fmtSpotTime(sp.created_at))
        return i + 1
      })
    }, 400)
  }

  async function startReplay() {
    if (replayState === 'playing') return
    if (replayState === 'paused') {
      setReplayState('playing')
      replayStartTimer()
      return
    }
    // Fresh start — fetch today's spots.
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const { data } = await supabase
      .from('spots')
      .select('*')
      .gte('created_at', startOfDay.toISOString())
      .order('created_at', { ascending: true })
      .limit(500)
    const spots = (data ?? []) as Spot[]
    if (spots.length === 0) {
      setToast("Aucun spot aujourd'hui à rejouer.")
      window.setTimeout(() => setToast(null), 2500)
      return
    }
    replaySpotsRef.current = spots
    setReplayTotal(spots.length)
    setReplayIndex(0)
    setReplayCurrentTime('')
    replayClearMarkers()
    // Hide the normal spots source while replay is active.
    const src = mapRef.current?.getSource('spots') as
      | mapboxgl.GeoJSONSource
      | undefined
    src?.setData({ type: 'FeatureCollection', features: [] })
    // Hide hot zones too — they'd compete visually with the replay pops.
    clearHotZonesRef.current?.()
    setReplayState('playing')
    replayStartTimer()
  }

  function pauseReplay() {
    if (replayState !== 'playing') return
    replayClearTimer()
    setReplayState('paused')
  }

  function stopReplay() {
    replayClearTimer()
    replayClearMarkers()
    replaySpotsRef.current = []
    setReplayState('idle')
    setReplayIndex(0)
    setReplayTotal(0)
    setReplayCurrentTime('')
    // Restore the regular spots layer + hot zones.
    refreshRef.current?.()
    recomputeHotZonesRef.current?.()
  }

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      replayClearTimer()
      replayClearMarkers()
    }
  }, [])

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

    const tokenMb = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
    if (!tokenMb) {
      setError('Token Mapbox manquant (VITE_MAPBOX_TOKEN).')
      return
    }
    mapboxgl.accessToken = tokenMb

    let cancelled = false
    let cleanup: (() => void) | null = null
    const containerEl = containerRef.current

    // Resolve the freshest GPS fix BEFORE building the map so it opens
    // straight on the user — never a Paris flash. Paris only if the fix
    // is unavailable or takes longer than 3s.
    function initialView(): Promise<{
      center: [number, number]
      zoom: number
    }> {
      return new Promise((resolve) => {
        if (!navigator.geolocation) {
          resolve({ center: PARIS, zoom: DEFAULT_ZOOM })
          return
        }
        let settled = false
        const fallback = setTimeout(() => {
          if (settled) return
          settled = true
          resolve({ center: PARIS, zoom: DEFAULT_ZOOM })
        }, GEO_TIMEOUT_MS)
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (settled) return
            settled = true
            clearTimeout(fallback)
            const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
            posRef.current = p
            setUserPos(p)
            resolve({
              center: [pos.coords.longitude, pos.coords.latitude],
              zoom: USER_ZOOM,
            })
          },
          () => {
            if (settled) return
            settled = true
            clearTimeout(fallback)
            resolve({ center: PARIS, zoom: DEFAULT_ZOOM })
          },
          { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 0 },
        )
      })
    }

    void initialView().then((view) => {
      if (cancelled || !containerEl || mapRef.current) return
      cleanup = initMap(containerEl, view.center, view.zoom)
    })

    function initMap(
      el: HTMLDivElement,
      initCenter: [number, number],
      initZoom: number,
    ): (() => void) | null {
    let map: mapboxgl.Map
    try {
      map = new mapboxgl.Map({
        container: el,
        style: 'mapbox://styles/mapbox/light-v11',
        center: initCenter,
        zoom: initZoom,
        pitch: 0,
        attributionControl: true,
        fadeDuration: 0,
        refreshExpiredTiles: false,
        renderWorldCopies: false,
      })
    } catch {
      setError('Impossible d’initialiser la carte.')
      return null
    }
    mapRef.current = map
    const allSpots = allSpotsRef.current
    const names = namesRef.current
    let pollId: ReturnType<typeof setInterval> | undefined
    // Signature of the on-screen marker set — lets us skip all DOM work
    // when a pan/zoom doesn't change which markers are visible.
    let lastSig = ''

    function isAlive(sp: Spot): boolean {
      return new Date(sp.expires_at).getTime() > Date.now()
    }

    function featureCollection(): GeoJSON.FeatureCollection {
      const cat = FILTER_CATEGORY[filterRef.current]
      const needle = searchRef.current.trim().toLowerCase()
      const feats: GeoJSON.Feature[] = []
      const panel: Spot[] = []
      for (const sp of allSpots.values()) {
        if (!isAlive(sp)) continue
        if (cat != null && sp.category !== cat) continue
        if (needle) {
          const hay = `${sp.brand ?? ''} ${sp.model ?? ''} ${sp.category ?? ''}`
            .toLowerCase()
          if (!hay.includes(needle)) continue
        }
        if (cat != null) panel.push(sp)
        feats.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [sp.lng, sp.lat] },
          properties: {
            id: sp.id,
            brand: sp.brand ?? '',
            model: sp.model ?? '',
            year: sp.year ?? null,
            photo_url: sp.photo_url ?? null,
            spotter: names.get(sp.user_id) ?? 'Anonyme',
            created_at: sp.created_at,
            expires_at: sp.expires_at,
          },
        })
      }
      panel.sort(
        (a, b) =>
          new Date(b.created_at).getTime() -
          new Date(a.created_at).getTime(),
      )
      setVisibleCount(feats.length)
      setPanelSpots(panel)
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
      lastSig = '' // force the next sync to rebuild this marker
    }

    // ──────────────────────── Hot zones ────────────────────────
    // Cluster recent spots (last 1 h, alive) within 500 m of each
    // other and render a pulsing red halo on each cluster of ≥2.
    // Intensity (size + opacity) scales with the cluster count.
    // Markers are keyed by sorted member-id hash so re-running the
    // computation preserves the pulse animation for unchanged
    // clusters and only re-creates markers when membership changes.
    const HOT_WINDOW_MS = 60 * 60 * 1000
    const HOT_RADIUS_M = 500
    const hotZonesByKey = new Map<string, mapboxgl.Marker>()

    function clearHotZones() {
      for (const m of hotZonesByKey.values()) m.remove()
      hotZonesByKey.clear()
    }
    clearHotZonesRef.current = clearHotZones

    function recomputeHotZones() {
      const now = Date.now()
      // 1. Collect alive + recent spots
      const recent: Spot[] = []
      for (const sp of allSpots.values()) {
        if (!isAlive(sp)) continue
        if (now - new Date(sp.created_at).getTime() > HOT_WINDOW_MS) continue
        recent.push(sp)
      }
      // 2. Greedy clustering — for each spot, attach to the first
      // cluster whose running centroid is within 500 m; otherwise
      // start a new cluster. Good enough for ≤200 recent spots.
      type Cluster = {
        ids: string[]
        lat: number
        lng: number
        count: number
      }
      const clusters: Cluster[] = []
      for (const sp of recent) {
        let placed = false
        for (const c of clusters) {
          if (
            distanceMeters(c.lat, c.lng, sp.lat, sp.lng) <= HOT_RADIUS_M
          ) {
            c.ids.push(sp.id)
            c.count += 1
            c.lat = c.lat + (sp.lat - c.lat) / c.count
            c.lng = c.lng + (sp.lng - c.lng) / c.count
            placed = true
            break
          }
        }
        if (!placed) {
          clusters.push({ ids: [sp.id], lat: sp.lat, lng: sp.lng, count: 1 })
        }
      }
      // 3. Hot zones = clusters with ≥2 spots
      const wanted = new Set<string>()
      for (const c of clusters) {
        if (c.count < 2) continue
        const key = c.ids.slice().sort().join('|')
        wanted.add(key)
        const intensity = Math.min(1, (c.count - 2) / 4) // 0 at 2 spots → 1 at 6+
        const size = Math.round(72 + intensity * 60) // 72px → 132px
        const opacity = (0.45 + intensity * 0.4).toFixed(2) // 0.45 → 0.85
        const existing = hotZonesByKey.get(key)
        if (existing) {
          existing.setLngLat([c.lng, c.lat])
          continue
        }
        const el = document.createElement('div')
        el.className = 'hot-zone-marker'
        el.style.setProperty('--hz-size', `${size}px`)
        el.style.setProperty('--hz-opacity', opacity)
        el.innerHTML =
          '<div class="hot-zone-ring"></div>' +
          '<div class="hot-zone-ring hot-zone-ring-delay"></div>'
        const marker = new mapboxgl.Marker({
          element: el,
          anchor: 'center',
        })
          .setLngLat([c.lng, c.lat])
          .addTo(map)
        hotZonesByKey.set(key, marker)
      }
      // 4. Remove markers for clusters that no longer exist
      for (const [key, marker] of hotZonesByKey) {
        if (!wanted.has(key)) {
          marker.remove()
          hotZonesByKey.delete(key)
        }
      }
    }
    recomputeHotZonesRef.current = recomputeHotZones

    // Recompute every minute so spots aging past the 1-hour window
    // drop out without needing a fresh fetch.
    const hotZonesInterval = window.setInterval(recomputeHotZones, 60_000)

    // Only fetch spots inside the current viewport + a ~500 m buffer.
    // Don't clear allSpots between fetches — merging keeps panning back
    // instant (no re-roundtrip for what we just saw).
    async function fetchSpotsInBounds(b: mapboxgl.LngLatBounds | null) {
      const bufLat = 0.0045 // ~500 m
      const minLat = b ? b.getSouth() - bufLat : -90
      const maxLat = b ? b.getNorth() + bufLat : 90
      const centerLat = b ? (minLat + maxLat) / 2 : 0
      const bufLng =
        bufLat / Math.max(0.1, Math.cos((centerLat * Math.PI) / 180))
      const minLng = b ? b.getWest() - bufLng : -180
      const maxLng = b ? b.getEast() + bufLng : 180

      const { data } = await supabase
        .from('spots')
        .select('*')
        .gt('expires_at', new Date().toISOString())
        .gte('lat', minLat)
        .lte('lat', maxLat)
        .gte('lng', minLng)
        .lte('lng', maxLng)
        .order('created_at', { ascending: false })
        .limit(500)
      const spots = (data ?? []) as Spot[]
      for (const sp of spots) allSpots.set(sp.id, sp)

      const need = [
        ...new Set(spots.map((s) => s.user_id).filter((id) => !names.has(id))),
      ]
      if (need.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('user_id, pseudo')
          .in('user_id', need)
        for (const p of (profs ?? []) as {
          user_id: string
          pseudo: string | null
        }[]) {
          if (p.pseudo) names.set(p.user_id, p.pseudo)
        }
      }
      refreshSource()
      recomputeHotZones()
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
            year:
              typeof props.year === 'number' ? props.year : null,
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
              const node = document.createElement('div')
              node.style.cursor = 'pointer'
              node.innerHTML = popupInner(sp)
              node.addEventListener('click', () => {
                popup.remove()
                navRef.current(`/spot/${sp.id}`)
              })
              popup.setLngLat(coords).setDOMContent(node).addTo(map)
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
      }
      // Mapbox keeps already-added markers positioned on its own, so if
      // the visible set is unchanged there is nothing to do.
      const sig = Object.keys(next).sort().join('|')
      if (sig === lastSig) return
      lastSig = sig
      for (const key in next) {
        if (!onScreenRef.current[key]) next[key].addTo(map)
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
      applySnapStyle(map)
      setMapReady(true)

      await fetchSpotsInBounds(map.getBounds())

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
      // Coalesce marker syncs to one per frame and only on events that
      // can actually change the visible set — never per render frame
      // (that was the source of pan/zoom jank under terrain).
      let syncQueued = false
      function scheduleSync() {
        if (syncQueued) return
        syncQueued = true
        requestAnimationFrame(() => {
          syncQueued = false
          if (!map.isSourceLoaded('spots')) return
          updateMarkers()
        })
      }
      map.on('move', scheduleSync)
      map.on('moveend', scheduleSync)
      map.on('zoom', scheduleSync)
      map.on('idle', scheduleSync)
      map.on('sourcedata', (e) => {
        if (e.sourceId === 'spots' && map.isSourceLoaded('spots'))
          scheduleSync()
      })
      scheduleSync()

      // Fetch new spots when the viewport changes (debounced).
      let fetchTimer: ReturnType<typeof setTimeout> | null = null
      map.on('moveend', () => {
        if (fetchTimer) clearTimeout(fetchTimer)
        fetchTimer = setTimeout(() => {
          void fetchSpotsInBounds(map.getBounds())
        }, 400)
      })

      // Re-poll so freshly-expired spots drop and extended ones return,
      // always scoped to the current viewport.
      pollId = setInterval(() => {
        void fetchSpotsInBounds(map.getBounds())
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
          recomputeHotZones()
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
      window.clearInterval(hotZonesInterval)
      clearHotZones()
      supabase.removeChannel(channel)
      for (const k in onScreenRef.current) onScreenRef.current[k].remove()
      onScreenRef.current = {}
      markersRef.current = {}
      allSpots.clear()
      names.clear()
      refreshRef.current = null
      recomputeHotZonesRef.current = null
      clearHotZonesRef.current = null
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
    } // end initMap

    return () => {
      cancelled = true
      if (cleanup) cleanup()
    }
  }, [])

  useEffect(() => {
    filterRef.current = activeFilter
    refreshRef.current?.()
  }, [activeFilter])

  useEffect(() => {
    searchRef.current = searchQuery
    refreshRef.current?.()
  }, [searchQuery])

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      /* localStorage unavailable */
    }
    if (mapReady && mapRef.current) applyMode(mapRef.current, mode)
  }, [mode, mapReady])

  return (
    <div className="fixed inset-0">
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100dvh', backgroundColor: '#F5F0E8' }}
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

      <div className="absolute left-0 right-0 top-0 z-10 space-y-2 px-4 pt-[max(3rem,calc(env(safe-area-inset-top)+2rem))]">
        <div
          className="mx-auto flex max-w-md items-center gap-2 rounded-full px-4 py-2.5"
          style={{
            background: 'rgba(10,10,10,0.65)',
            backdropFilter: 'saturate(160%) blur(20px)',
            WebkitBackdropFilter: 'saturate(160%) blur(20px)',
            border: '1px solid rgba(255,255,255,0.10)',
          }}
        >
          <SearchIcon className="h-4 w-4 flex-none text-fg2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher une voiture, une marque…"
            className="flex-1 bg-transparent text-sm text-fg placeholder-fg2 outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              aria-label="Effacer"
              className="tappable text-fg2 hover:text-fg"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Replay row — single pill button while idle, status banner
            (play/pause + progress + time) while running. Hidden when no
            search is active so the top bar stays uncluttered. */}
        {replayState === 'idle' ? (
          <button
            onClick={startReplay}
            className="tappable mx-auto flex items-center gap-2 rounded-full px-4 py-2 text-xs font-extrabold tracking-wider text-fg"
            style={{
              background: 'rgba(232,32,58,0.18)',
              backdropFilter: 'saturate(160%) blur(20px)',
              WebkitBackdropFilter: 'saturate(160%) blur(20px)',
              border: '1px solid rgba(232,32,58,0.45)',
              boxShadow: '0 4px 16px rgba(232,32,58,0.25)',
            }}
          >
            <Rewind className="h-3.5 w-3.5 text-accent" />
            REPLAY AUJOURD'HUI
          </button>
        ) : (
          <div
            className="mx-auto flex max-w-md items-center gap-3 rounded-full px-3 py-2"
            style={{
              background: 'rgba(10,10,10,0.85)',
              backdropFilter: 'saturate(160%) blur(20px)',
              WebkitBackdropFilter: 'saturate(160%) blur(20px)',
              border: '1px solid rgba(232,32,58,0.45)',
            }}
          >
            <button
              onClick={replayState === 'playing' ? pauseReplay : startReplay}
              aria-label={replayState === 'playing' ? 'Pause' : 'Reprendre'}
              className="tappable flex h-7 w-7 flex-none items-center justify-center rounded-full bg-accent text-fg"
            >
              {replayState === 'playing' ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 text-[11px] text-fg2">
                <span className="label-up text-[9px] text-accent">REPLAY</span>
                <span>
                  {replayIndex} / {replayTotal}
                </span>
                {replayCurrentTime && (
                  <span className="font-mono text-fg">
                    · {replayCurrentTime}
                  </span>
                )}
              </div>
              {/* Progress bar */}
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300"
                  style={{
                    width: `${replayTotal === 0 ? 0 : (replayIndex / replayTotal) * 100}%`,
                  }}
                />
              </div>
            </div>
            <button
              onClick={stopReplay}
              aria-label="Fermer"
              className="tappable flex h-7 w-7 flex-none items-center justify-center rounded-full text-fg2 hover:text-fg"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div
          className="mx-auto flex max-w-md gap-1 rounded-full p-1"
          style={{
            background: 'rgba(10,10,10,0.65)',
            backdropFilter: 'saturate(160%) blur(20px)',
            WebkitBackdropFilter: 'saturate(160%) blur(20px)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`tappable flex-1 rounded-full py-2 text-xs font-semibold tracking-wide transition-colors ${
                activeFilter === f
                  ? 'bg-accent text-fg shadow-glow'
                  : 'text-fg2 hover:text-fg'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* AI prediction info button — discrete 40 px round chip
          sitting just under the search bar, opens the bottom sheet
          carrying the personalised weather+spot tip. */}
      <button
        onClick={() => setInfoSheetOpen(true)}
        aria-label="Conseil de spot du jour"
        className="tappable absolute right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full"
        style={{
          top: 'calc(max(3rem, env(safe-area-inset-top) + 2rem) + 3.25rem)',
          background: '#141414',
          border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 8px 22px rgba(0,0,0,0.45)',
          color: 'var(--color-accent)',
        }}
      >
        <Sparkles className="h-4 w-4" />
      </button>

      <div
        className="absolute right-4 z-10"
        style={{
          top: 'calc(max(3rem, env(safe-area-inset-top) + 2rem) + 6.75rem)',
        }}
      >
        <div
          className="flex gap-1 rounded-full p-1"
          style={{
            background: 'rgba(10,10,10,0.65)',
            backdropFilter: 'saturate(160%) blur(20px)',
            WebkitBackdropFilter: 'saturate(160%) blur(20px)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {(['2D', '3D'] as MapMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`tappable rounded-full px-3.5 py-1.5 text-xs font-bold tracking-wide transition-colors ${
                mode === m
                  ? 'bg-accent text-fg'
                  : 'text-fg2 hover:text-fg'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {infoSheetOpen && (
        <MapPredictionSheet
          prediction={prediction}
          loading={predictionLoading}
          onClose={() => setInfoSheetOpen(false)}
        />
      )}

      {activeFilter !== 'Tous' && panelSpots.length > 0 && (
        <div
          className="animate-slide-up absolute left-0 right-0 z-10"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5rem)' }}
        >
          <div className="mx-2 rounded-2xl bg-black/70 p-3 backdrop-blur">
            <p className="mb-2 px-1 text-xs font-semibold text-fg/70">
              {panelSpots.length} {activeFilter} sur la carte
            </p>
            <div className="no-scrollbar flex gap-3 overflow-x-auto">
              {panelSpots.map((s) => {
                const dist =
                  userPos &&
                  Number.isFinite(s.lat) &&
                  Number.isFinite(s.lng)
                    ? fmtDist(
                        distanceMeters(
                          userPos.lat,
                          userPos.lng,
                          s.lat,
                          s.lng,
                        ),
                      )
                    : null
                return (
                  <button
                    key={s.id}
                    onClick={() => navigate(`/spot/${s.id}`)}
                    className="w-32 flex-none text-left"
                  >
                    <div className="h-20 w-32 overflow-hidden rounded-xl bg-card">
                      {s.photo_url ? (
                        <img
                          src={s.photo_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Car className="h-6 w-6 text-fg/20" />
                        </div>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs font-semibold text-fg">
                      {s.brand} {s.model}
                    </p>
                    <p className="truncate text-[10px] text-fg/50">
                      {[dist, timeAgo(s.created_at)]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <button
        onClick={flyToUser}
        aria-label="Me localiser"
        style={{
          bottom: 'calc(env(safe-area-inset-bottom) + 5rem + 0.75rem + 20px)',
          boxShadow:
            '0 6px 24px rgba(232,32,58,0.45), 0 0 0 1px rgba(255,255,255,0.06) inset',
        }}
        className="tappable absolute right-4 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-accent"
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

// ─────────────────────── AI prediction bottom sheet ───────────────────────
// Personalised "best time to spot" message lifted off Home into a
// pull-up sheet on the Map screen. Swipe-down dismisses it; tapping
// the dimmed backdrop also closes it. Sheet content is purely
// presentational — fetching is owned by the Map page so the same
// PredictionResult drives both states.

const PREDICTION_THEME: Record<SpotScore, { background: string; label: string }> = {
  bon: {
    background:
      'linear-gradient(155deg, #5a1018 0%, #2e0a0d 55%, #150708 100%)',
    label: 'CONDITIONS FAVORABLES',
  },
  moyen: {
    background:
      'linear-gradient(155deg, #4a2a08 0%, #2e1804 55%, #150b02 100%)',
    label: 'CONDITIONS MOYENNES',
  },
  mauvais: {
    background:
      'linear-gradient(155deg, #1e2024 0%, #14161a 55%, #0d0e10 100%)',
    label: 'PEU FAVORABLE',
  },
}

function MapPredictionSheet({
  prediction,
  loading,
  onClose,
}: {
  prediction: PredictionResult | null
  loading: boolean
  onClose: () => void
}) {
  const [drag, setDrag] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startY = useRef(0)

  // Lock background scroll while open + close on Escape (desktop).
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    startY.current = e.clientY
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    setDrag(Math.max(0, e.clientY - startY.current))
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    setDragging(false)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (drag > 110) {
      onClose()
    } else {
      setDrag(0)
    }
  }

  const theme = prediction
    ? PREDICTION_THEME[prediction.score_conditions]
    : PREDICTION_THEME.mauvais

  return (
    <div
      className="fixed inset-0 z-[80]"
      role="dialog"
      aria-modal="true"
      aria-label="Conseil de spot"
    >
      <div
        className="absolute inset-0 bg-black/55"
        onClick={onClose}
        style={{ animation: 'fade-in 220ms ease-out both' }}
      />
      <div
        className="animate-slide-up absolute inset-x-0 bottom-0 overflow-hidden rounded-t-3xl"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          background: 'var(--color-card)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderBottom: 'none',
          paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))',
          maxHeight: '70vh',
          transform: `translateY(${drag}px)`,
          transition: dragging
            ? 'none'
            : 'transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          touchAction: 'none',
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pb-1 pt-2.5">
          <div
            className="h-1 w-12 rounded-full"
            style={{ background: 'rgba(255,255,255,0.22)' }}
          />
        </div>

        {/* Hero block — themed by the prediction score */}
        <div className="px-4 pb-4 pt-2">
          <div
            className="relative overflow-hidden rounded-2xl px-4 py-4"
            style={{ background: theme.background }}
          >
            <div className="flex items-center justify-between gap-2">
              <p
                className="label-up text-[9.5px] text-white/75"
                style={{ letterSpacing: '0.18em' }}
              >
                {prediction ? theme.label : 'CONSEIL DU JOUR'}
              </p>
              <span
                className="inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 text-[9px] font-bold tracking-wider text-white/85 backdrop-blur"
                style={{ border: '1px solid rgba(255,255,255,0.12)' }}
              >
                IA 🎯
              </span>
            </div>
            {loading && !prediction ? (
              <div className="mt-3 flex items-center gap-2 text-[14px] text-white/80">
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyse en cours…
              </div>
            ) : prediction ? (
              <p
                className="mt-3 leading-snug text-white"
                style={{ fontSize: '17px', fontWeight: 600 }}
              >
                {prediction.message}
              </p>
            ) : (
              <p
                className="mt-3 leading-snug text-white/75"
                style={{ fontSize: '14px' }}
              >
                Ajoute ta ville dans Réglages pour recevoir un conseil
                personnalisé chaque jour (météo + tendance de spotting).
              </p>
            )}
          </div>

          <p
            className="mt-3 px-1 text-[11px] leading-snug text-fg2"
          >
            Mise à jour une fois par jour. Le conseil tient compte de
            ta ville, des marques que tu spottes le plus et de la
            météo locale.
          </p>
        </div>
      </div>
    </div>
  )
}
