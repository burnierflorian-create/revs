import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import type { DataDrivenPropertyValueSpecification } from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import {
  Camera,
  LocateFixed,
  Loader2,
  Search as SearchIcon,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { setPendingPhoto } from '../lib/pendingPhoto'
import { SkeletonMap } from '../components/Skeleton'
import {
  distanceMeters,
  escapeHtml,
  timeAgo,
  type Rarity,
  type Spot,
} from '../lib/spots'
import MapFiltersModal, {
  DEFAULT_MAP_FILTERS,
  MAX_DISTANCE_KM,
  loadMapFilters,
  saveMapFilters,
  mapFiltersActive,
  type MapFilters,
} from '../components/MapFiltersModal'
import {
  matchesBrandFilter,
  matchesCategoryFilter,
} from '../lib/filterCatalog'
import { rarityRank } from '../components/CollectorCard'
import { rarityBadge } from '../lib/rarityStyle'
import { useTheme } from '../lib/theme'
import {
  fetchSpottingPrediction,
  type PredictionResult,
  type SpotScore,
} from '../lib/spotPredictions'
import { xpLevel } from '../lib/xp'

const PARIS: [number, number] = [2.3522, 48.8566]
const DEFAULT_ZOOM = 13
const USER_ZOOM = 15
const RECENTER_ZOOM = 17
const GEO_TIMEOUT_MS = 3000
const SPOT_TTL_MS = 60 * 60 * 1000
const POLL_MS = 60 * 1000

const CAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`

type SpotProps = {
  id: string
  brand: string
  model: string
  year: number | null
  photo_url: string | null
  spotter: string
  created_at: string
  /** 2026-06-01 rarity tint upgrade — colours the pin's depletion
   *  ring + ambient halo so the user can read the rarity layer at a
   *  glance without opening the popup. Maps to MAP_RARITY_COLOR. */
  rarity: Rarity
}

/** Per-rarity pin tint. Mirrors the CollectorCard frame palette so a
 *  user who learned "gold = hypercar" on Profile reads the same code
 *  on the map. Includes both a solid hex (used for the ring stroke
 *  and the photo border on photoless pins) and a glow alpha used for
 *  the ambient halo behind the pin. */
const MAP_RARITY_COLOR: Record<Rarity, { stroke: string; glow: string }> = {
  standard:    { stroke: '#888888', glow: 'rgba(136, 136, 136, 0.55)' },
  premium:     { stroke: '#4A9EFF', glow: 'rgba(74, 158, 255, 0.55)'  },
  performance: { stroke: '#EF4444', glow: 'rgba(239, 68, 68, 0.65)'   },
  exclusif:    { stroke: '#B87333', glow: 'rgba(184, 115, 51, 0.62)'  },
  supercar:    { stroke: '#9B59B6', glow: 'rgba(155, 89, 182, 0.65)'  },
  hypercar:    { stroke: '#FFD700', glow: 'rgba(255, 215, 0, 0.70)'   },
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
  const tint = MAP_RARITY_COLOR[p.rarity] ?? MAP_RARITY_COLOR.standard

  const outer = document.createElement('div')
  outer.style.cursor = 'pointer'
  outer.className = 'map-marker-pop'

  const wrap = document.createElement('div')
  wrap.style.position = 'relative'
  wrap.style.width = `${size}px`
  wrap.style.height = `${size}px`

  // Rarity halo — soft radial behind the pin, scaled to ~58px so it
  // bleeds slightly past the depletion ring. Hypercar/Supercar get a
  // visibly stronger glow; standard stays subtle so the map doesn't
  // turn into a Christmas tree.
  const halo = document.createElement('div')
  halo.style.position = 'absolute'
  halo.style.left = '50%'
  halo.style.top = '50%'
  halo.style.width = '58px'
  halo.style.height = '58px'
  halo.style.marginLeft = '-29px'
  halo.style.marginTop = '-29px'
  halo.style.borderRadius = '50%'
  halo.style.background = `radial-gradient(closest-side, ${tint.glow} 0%, rgba(0,0,0,0) 70%)`
  halo.style.pointerEvents = 'none'
  halo.style.filter = 'blur(2px)'
  wrap.appendChild(halo)

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
  arc.setAttribute('stroke', tint.stroke)
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
    // Photoless pin → tint the fallback car silhouette in the rarity
    // color so the marker still carries the same visual code.
    photo.style.background = tint.stroke
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

type ClusterLeaf = {
  id: string
  brand: string
  model: string
  photo_url: string | null
  spotter: string
  created_at: string
  rarity: Rarity
}

const RARITY_BY_SCORE: Rarity[] = [
  'standard',
  'premium',
  'performance',
  'exclusif',
  'supercar',
  'hypercar',
]

function clusterMarkerEl(count: number, maxRarity: number): HTMLDivElement {
  const outer = document.createElement('div')
  outer.style.cursor = 'pointer'
  outer.className = 'map-marker-pop'
  // Spec radii 20/25/30 → diameters 40/50/60 at 2-4 / 5-9 / 10+ spots.
  const size = count < 5 ? 40 : count < 10 ? 50 : 60
  const tint =
    MAP_RARITY_COLOR[
      RARITY_BY_SCORE[Math.max(0, Math.min(5, Math.round(maxRarity) - 1))]
    ] ?? MAP_RARITY_COLOR.standard
  // A rarity-coloured halo ring only when the cluster holds a supercar+.
  const rareRing = maxRarity >= 5 ? `0 0 0 2px ${tint.stroke}, ` : ''
  const inner = document.createElement('div')
  inner.style.width = `${size}px`
  inner.style.height = `${size}px`
  inner.style.borderRadius = '9999px'
  inner.style.background = '#E8203A'
  inner.style.border = '3px solid rgba(255,255,255,0.3)'
  inner.style.boxShadow =
    rareRing + '0 4px 16px rgba(232,32,58,0.4), 0 2px 6px rgba(0,0,0,0.45)'
  inner.style.display = 'flex'
  inner.style.alignItems = 'center'
  inner.style.justifyContent = 'center'
  inner.style.color = '#fff'
  inner.style.fontWeight = '800'
  inner.style.fontSize = size >= 50 ? '15px' : '14px'
  inner.style.letterSpacing = '-0.3px'
  inner.textContent = count < 1000 ? String(count) : `${Math.floor(count / 1000)}k`
  outer.appendChild(inner)
  return outer
}

function popupInner(p: SpotProps): string {
  const title = (p.model || p.brand || 'Spot').trim()
  const sub = [p.brand, p.year ?? undefined].filter(Boolean).join(' · ')
  const photo = p.photo_url
    ? `<img src="${escapeHtml(p.photo_url)}" alt="" loading="lazy" decoding="async" style="width:72px;height:72px;border-radius:12px;object-fit:cover;flex:none" />`
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

/** Feature flag — mirrors the same constant in Home.tsx. Gates the
 *  Sparkles entry button + the MapPredictionSheet render + the lazy
 *  fetch. Component, lib and bottom-sheet code all stay in place so
 *  reviving the feature is a one-line flip. */
const SHOW_WEATHER_IA = false

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

// Dark-theme 3D building extrusion colour — anthracite that reads as
// volume against the Mapbox dark-v11 base without competing with
// the brand-red rarity pins.
const BUILDING_3D_DARK = '#2A2A2E'

// Only label these road classes — no alleys / small streets.
const MAJOR_ROADS = ['motorway', 'trunk', 'primary', 'secondary']

// Soft Snap-like recolor + a near-total POI strip. We keep roads,
// water, parks/landuse, relief, major-road names and city/neighbourhood
// names — every POI / transit / airport / parking / water label is
// removed. REVS touch: a thin red casing on major roads, a warm-beige
// shaded 3D-building layer (toggled on only in 3D).
function applySnapStyle(map: mapboxgl.Map, theme: 'dark' | 'light' = 'light') {
  try {
    const layers = (map.getStyle()?.layers ?? []) as unknown as RawLayer[]
    let buildingSource: string | undefined
    let buildingSourceLayer: string | undefined
    let firstRoadLineId: string | undefined
    let firstSymbolId: string | undefined
    const toRemove: string[] = []
    // In dark mode we let Mapbox's dark-v11 base render natively (it's
    // a professionally tuned night style) and only add the 3D building
    // extrusion in anthracite. In light mode we run the full Snap-style
    // warm-neutral recolor + extrusion.
    const isDark = theme === 'dark'

    for (const l of layers) {
      const sl = l['source-layer']
      if (l.type === 'symbol' && !firstSymbolId) firstSymbolId = l.id
      if (l.type === 'line' && sl === 'road' && !firstRoadLineId)
        firstRoadLineId = l.id

      const isPlace =
        l.type === 'symbol' &&
        /settlement|state-label|country-label|continent-label/.test(l.id)
      const isRoadLabel = l.type === 'symbol' && /^road-label/.test(l.id)

      // Symbol + parking stripping is part of the Snap-style light
      // aesthetic. In dark mode we keep Mapbox dark-v11's curated
      // label set intact — much cleaner than a near-empty night map.
      if (!isDark) {
        if (l.type === 'symbol' && !isPlace && !isRoadLabel) {
          toRemove.push(l.id)
          continue
        }
        if (/parking/.test(l.id)) {
          toRemove.push(l.id)
          continue
        }
      }

      try {
        // Building source/layer discovery must run regardless of theme
        // so the 3D extrusion add below can target it. Recolor calls
        // below are gated to light mode only.
        if (
          (l.type === 'fill' || l.type === 'fill-extrusion') &&
          sl === 'building'
        ) {
          if (l.source) {
            buildingSource = l.source
            buildingSourceLayer = sl
          }
        }
        if (isDark) {
          // Dark mode: rely on Mapbox dark-v11's native palette. The
          // building source was discovered above so the 3D extrusion
          // can target it; everything else stays Mapbox-native.
          continue
        }
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
          l.type === 'fill' &&
          sl === 'building'
        ) {
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
            'fill-extrusion-color': isDark ? BUILDING_3D_DARK : SNAP.building3d,
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

// ─────────────────── User-location compass marker ───────────────────
// Apple-Plans-style location marker: a 60×70 SVG with a blue dot at
// (30,42), a SMIL-animated pulsing halo (r 11→18, opacity 0.18→0) and a
// trapezoidal directional beam above it. The beam fades in only once a
// real compass heading lands; rotation is GPU-composited and interpolated
// along the shortest arc for buttery-smooth tracking. The Mapbox marker is
// offset so the DOT (not the SVG centre) sits on the GPS coordinate, and
// the rotation pivot is the dot too, so the beam swings around it.
const USER_MARKER_HTML = `
<svg width="60" height="70" viewBox="0 0 60 70" fill="none" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
  <defs>
    <linearGradient id="revsBeam" x1="0.5" y1="1" x2="0.5" y2="0">
      <stop offset="0%" stop-color="#4DA6FF" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#4DA6FF" stop-opacity="0"/>
    </linearGradient>
    <filter id="revsGlow">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <!-- Trapezoidal directional beam -->
  <path class="user-cone" d="M26 38 Q22 10 14 2 Q30 -4 46 2 Q38 10 34 38 Z" fill="url(#revsBeam)"/>
  <!-- Pulsing halo -->
  <circle cx="30" cy="42" r="13" fill="#4DA6FF" opacity="0.15">
    <animate attributeName="r" values="11;18;11" dur="2s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.18;0;0.18" dur="2s" repeatCount="indefinite"/>
  </circle>
  <!-- Main blue dot -->
  <circle cx="30" cy="42" r="11" fill="#4DA6FF" stroke="white" stroke-width="3" filter="url(#revsGlow)"/>
  <!-- White core -->
  <circle cx="30" cy="42" r="3" fill="white"/>
</svg>
`

type DOEStatic = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

class CompassMarker {
  private currentAngle = 0
  private targetAngle = 0
  private hasHeading = false
  private lastSample = 0
  private animationId: number | null = null
  private marker: mapboxgl.Marker | null = null
  // Mapbox positions the OUTER element (it owns that element's transform);
  // the inner rotEl carries our compass rotation so the two never fight.
  private outerEl: HTMLElement | null = null
  private rotEl: HTMLElement | null = null
  private coneEl: SVGElement | null = null
  private orientationHandler: ((e: Event) => void) | null = null
  private gestureCleanup: (() => void) | null = null

  init(map: mapboxgl.Map, position: [number, number]) {
    this.outerEl = document.createElement('div')
    this.rotEl = document.createElement('div')
    // 60×70 box; the dot is at (30,42) = 50% 60%, so the rotation pivot is
    // the dot and the beam swings around it (not the SVG centre).
    this.rotEl.style.cssText =
      'width:60px;height:70px;line-height:0;will-change:transform;transform-origin:50% 60%;'
    this.rotEl.innerHTML = USER_MARKER_HTML
    this.outerEl.appendChild(this.rotEl)
    this.coneEl = this.rotEl.querySelector('.user-cone')
    // Beam hidden until a real heading arrives → blue dot only, no spin.
    if (this.coneEl) this.coneEl.style.opacity = '0'

    this.marker = new mapboxgl.Marker({
      element: this.outerEl,
      anchor: 'center',
      // Lands the DOT (30,42), not the SVG centre (30,35), on the GPS
      // point — the requested { x:0.5, y:0.7 } intent. Element centre is
      // shifted 7px up so the dot 7px below it falls on the coordinate.
      offset: [0, -7],
    })
      .setLngLat(position)
      .addTo(map)

    this.startAnimation()
    this.requestCompassPermission()
  }

  private requestCompassPermission() {
    const DOE = window.DeviceOrientationEvent as DOEStatic | undefined
    if (DOE && typeof DOE.requestPermission === 'function') {
      // iOS — permission must be requested from a user gesture.
      const onGesture = () => {
        DOE.requestPermission?.()
          .then((p) => {
            if (p === 'granted') this.listenToCompass()
          })
          .catch(() => {})
        this.gestureCleanup?.()
      }
      window.addEventListener('touchend', onGesture, { once: true })
      window.addEventListener('click', onGesture, { once: true })
      this.gestureCleanup = () => {
        window.removeEventListener('touchend', onGesture)
        window.removeEventListener('click', onGesture)
        this.gestureCleanup = null
      }
    } else if (DOE) {
      this.listenToCompass()
    }
  }

  private listenToCompass() {
    const THROTTLE_MS = 50 // max 20 updates/s
    const handler = (ev: Event) => {
      const now = Date.now()
      if (now - this.lastSample < THROTTLE_MS) return
      this.lastSample = now
      const e = ev as DeviceOrientationEvent & {
        webkitCompassHeading?: number
      }
      let heading: number
      if (typeof e.webkitCompassHeading === 'number') {
        heading = e.webkitCompassHeading // iOS — already absolute (0=North)
      } else if (e.absolute && typeof e.alpha === 'number') {
        heading = 360 - e.alpha // Android absolute
      } else {
        return // no reliable absolute heading
      }
      if (Number.isNaN(heading)) return
      this.targetAngle = heading
      if (!this.hasHeading) {
        // First valid reading — snap the start angle, reveal the cone.
        this.currentAngle = heading
        this.hasHeading = true
        if (this.coneEl) this.coneEl.style.opacity = '1'
      }
    }
    this.orientationHandler = handler
    // deviceorientationabsolute (Android) + deviceorientation (iOS).
    window.addEventListener('deviceorientationabsolute', handler, true)
    window.addEventListener('deviceorientation', handler, true)
  }

  private startAnimation() {
    const animate = () => {
      if (this.hasHeading && this.rotEl) {
        // Shortest-arc interpolation so we never spin the long way round.
        let diff = this.targetAngle - this.currentAngle
        while (diff > 180) diff -= 360
        while (diff < -180) diff += 360
        const smoothFactor = 0.08 // very fluid: fast start, soft settle
        this.currentAngle += diff * smoothFactor
        this.currentAngle = ((this.currentAngle % 360) + 360) % 360
        this.rotEl.style.transform = `rotate(${this.currentAngle}deg)`
      }
      this.animationId = requestAnimationFrame(animate)
    }
    this.animationId = requestAnimationFrame(animate)
  }

  updatePosition(lng: number, lat: number) {
    this.marker?.setLngLat([lng, lat])
  }

  destroy() {
    if (this.animationId) cancelAnimationFrame(this.animationId)
    if (this.orientationHandler) {
      window.removeEventListener(
        'deviceorientationabsolute',
        this.orientationHandler,
        true,
      )
      window.removeEventListener(
        'deviceorientation',
        this.orientationHandler,
        true,
      )
    }
    this.gestureCleanup?.()
    this.marker?.remove()
    this.marker = null
  }
}

export default function MapPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { theme } = useTheme()

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const allSpotsRef = useRef<globalThis.Map<string, Spot>>(new globalThis.Map())
  const namesRef = useRef<globalThis.Map<string, string>>(new globalThis.Map())
  const markersRef = useRef<Record<string, mapboxgl.Marker>>({})
  const onScreenRef = useRef<Record<string, mapboxgl.Marker>>({})
  const searchRef = useRef<string>('')
  // Hidden camera input for the centered "Spotter" FAB — clicked
  // synchronously inside the tap so iOS opens the native camera; the
  // captured photo is stashed and NewSpot consumes it on mount.
  const spotInputRef = useRef<HTMLInputElement>(null)
  // All map filters (catégorie / marque / distance) live in the bottom
  // sheet. Mirrored into a ref so the marker-building loop reads the
  // latest without re-subscribing.
  const advFiltersRef = useRef<MapFilters>(DEFAULT_MAP_FILTERS)
  const refreshRef = useRef<(() => void) | null>(null)
  const recomputeHotZonesRef = useRef<(() => void) | null>(null)
  // Called from the theme-change effect after setStyle() reloads the
  // base style. setStyle() drops sources + layers but mapboxgl.Marker
  // instances live on the map container DOM so they survive. This
  // re-adds the `spots` source + invisible probe layer + retriggers
  // marker sync so pins + hot zones come back instantly.
  const reattachLayersRef = useRef<(() => void) | null>(null)
  const clearHotZonesRef = useRef<(() => void) | null>(null)
  const navRef = useRef(navigate)
  navRef.current = navigate
  const posRef = useRef<{ lat: number; lng: number } | null>(null)
  // Live user-location compass marker + its geolocation watch (below).
  const userMarkerRef = useRef<CompassMarker | null>(null)
  const watchIdRef = useRef<number | null>(null)

  const [error, setError] = useState<string | null>(null)
  // Map-only state — search + filters live entirely here and touch ONLY
  // the geographic markers. Filters are persisted under their own
  // localStorage key (revs_map_filters), so nothing here ever reaches
  // the Fil. Restored from storage on mount.
  const [mapSearchQuery, setMapSearchQuery] = useState<string>('')
  const [mapFilters, setMapFilters] = useState<MapFilters>(() =>
    loadMapFilters(),
  )
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(0)
  const [mapReady, setMapReady] = useState(false)
  // Spots of a tapped same-place cluster, shown in a bottom sheet.
  const [clusterSheet, setClusterSheet] = useState<ClusterLeaf[] | null>(null)

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
    if (!SHOW_WEATHER_IA) return
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

  // Centered camera FAB → native camera → stash photo → NewSpot.
  // Same flow as Home's SpotterAction so spotting straight from the map
  // lands in the identical publish pipeline.
  function onSpotCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return // user backed out of the camera
    setPendingPhoto(file)
    navigate('/new-spot')
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
        // Mapbox base style follows the app theme. Dark uses Mapbox's
        // dark-v11 so the rarity-tinted pins read as glowing dots over
        // a noir map; light uses light-v11 for the Apple Maps feel.
        style:
          theme === 'light'
            ? 'mapbox://styles/mapbox/light-v11'
            : 'mapbox://styles/mapbox/dark-v11',
        center: initCenter,
        zoom: initZoom,
        pitch: 0,
        // Mapbox logo + attribution fully hidden (also forced off via the
        // global .mapboxgl-ctrl-* CSS rules in index.css).
        attributionControl: false,
        logoPosition: 'bottom-left',
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
      const needle = searchRef.current.trim().toLowerCase()
      const adv = advFiltersRef.current
      // Distance filter is only meaningful below the max (50 km = illimité)
      // and only when we have the viewer's position to measure from.
      const distLimitM =
        adv.distanceKm < MAX_DISTANCE_KM && posRef.current
          ? adv.distanceKm * 1000
          : null
      const me = posRef.current
      const feats: GeoJSON.Feature[] = []
      for (const sp of allSpots.values()) {
        if (!isAlive(sp)) continue
        if (needle) {
          const hay = `${sp.brand ?? ''} ${sp.model ?? ''} ${sp.category ?? ''}`
            .toLowerCase()
          if (!hay.includes(needle)) continue
        }
        // Catégorie / Marque ('Tout' / null = no filter).
        if (adv.category !== 'Tout' && !matchesCategoryFilter(sp, adv.category))
          continue
        if (adv.brand && !matchesBrandFilter(sp, adv.brand)) continue
        // Distance from the viewer (when a sub-max radius is selected).
        if (distLimitM != null && me) {
          if (distanceMeters(me.lat, me.lng, sp.lat, sp.lng) > distLimitM)
            continue
        }
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
            rarity: sp.rarity ?? 'standard',
            // 1 (standard) … 6 (hypercar) — reduced to max_rarity per
            // cluster so the pill can flag a rare-bearing cluster.
            rarity_score: rarityRank(sp.rarity) + 1,
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
            const el = clusterMarkerEl(count, Number(props.max_rarity ?? 1))
            el.addEventListener('click', () => {
              const src = map.getSource(
                'spots',
              ) as mapboxgl.GeoJSONSource | null
              if (!src) return
              const cid = Number(props.cluster_id)
              const cur = map.getZoom()
              src.getClusterExpansionZoom(cid, (err, zoom) => {
                if (err == null && zoom != null && zoom > cur) {
                  // Zooming in WILL break the cluster apart → do it.
                  map.easeTo({ center: coords, zoom })
                } else {
                  // Same place / can't expand → list the spots in a sheet.
                  src.getClusterLeaves(cid, 100, 0, (lerr, leaves) => {
                    if (lerr || !leaves) return
                    const items = leaves.map((f) => {
                      const pr = (f.properties ?? {}) as Record<string, unknown>
                      return {
                        id: String(pr.id ?? ''),
                        brand: String(pr.brand ?? ''),
                        model: String(pr.model ?? ''),
                        photo_url:
                          typeof pr.photo_url === 'string' ? pr.photo_url : null,
                        spotter: String(pr.spotter ?? 'Anonyme'),
                        created_at: String(pr.created_at ?? ''),
                        rarity: (typeof pr.rarity === 'string'
                          ? pr.rarity
                          : 'standard') as Rarity,
                      }
                    })
                    setClusterSheet(items)
                  })
                }
              })
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
            // Coerce to a known rarity bucket; an unknown/legacy value
            // falls back to standard so the pin still renders with the
            // neutral grey tint instead of black.
            rarity: (typeof props.rarity === 'string' &&
              (props.rarity as string) in MAP_RARITY_COLOR
              ? (props.rarity as Rarity)
              : 'standard'),
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
      applySnapStyle(map, theme)
      setMapReady(true)

      await fetchSpotsInBounds(map.getBounds())

      // Source + invisible probe layer extracted into a function so
      // the theme-change setStyle() flow can re-attach them after the
      // new base style finishes loading (Mapbox drops user sources
      // on setStyle).
      function attachSpotsLayer() {
        if (!map.getSource('spots')) {
          map.addSource('spots', {
            type: 'geojson',
            data: featureCollection(),
            cluster: true,
            clusterMaxZoom: 16,
            clusterRadius: 60,
            clusterProperties: {
              // Highest rarity tier present in the cluster (1…6).
              max_rarity: ['max', ['get', 'rarity_score']],
            },
          })
        }
        if (!map.getLayer('spot-src')) {
          map.addLayer({
            id: 'spot-src',
            type: 'circle',
            source: 'spots',
            paint: { 'circle-radius': 0, 'circle-opacity': 0 },
          })
        }
      }
      attachSpotsLayer()
      reattachLayersRef.current = attachSpotsLayer
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
      reattachLayersRef.current = null
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
    searchRef.current = mapSearchQuery
    refreshRef.current?.()
  }, [mapSearchQuery])

  useEffect(() => {
    advFiltersRef.current = mapFilters
    refreshRef.current?.()
  }, [mapFilters])

  // Theme swap — when the user flips dark/light from Settings while
  // /map is already mounted, hot-swap the Mapbox base style instead
  // of forcing a full remount. setStyle() DROPS user sources +
  // layers, but mapboxgl.Marker instances live on the map container
  // DOM so they survive. We re-attach the spots source + invisible
  // probe layer on `style.load`, then refresh the data and recompute
  // hot zones so pins + clusters come back instantly.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const next =
      theme === 'light'
        ? 'mapbox://styles/mapbox/light-v11'
        : 'mapbox://styles/mapbox/dark-v11'
    // No-op if the requested style is already loaded (e.g. theme set
    // to the same value back-to-back).
    const current = map.getStyle()?.sprite
    if (current && current.includes(theme === 'light' ? 'light' : 'dark')) {
      return
    }
    function onStyleLoad() {
      // Re-narrow inside the closure — TS can't carry the outer
      // `if (!map) return` guard through a nested function.
      const m = mapRef.current
      if (!m) return
      try {
        // Re-apply the Snap-style recolor + 3D extrusion against the
        // freshly-loaded base style. In dark mode this only adds the
        // anthracite 3D extrusion; in light mode it runs the full
        // warm-neutral recolor + 3D in beige.
        applySnapStyle(m, theme)
        reattachLayersRef.current?.()
        refreshRef.current?.()
        recomputeHotZonesRef.current?.()
      } catch {
        /* swallow — fail-open keeps the map usable */
      }
    }
    try {
      map.once('style.load', onStyleLoad)
      map.setStyle(next)
    } catch {
      map.off('style.load', onStyleLoad)
    }
  }, [theme])

  // Search → city geocoding fallback. If the user types a query that
  // matches zero local spots AND looks like a place name (≥3 chars,
  // no digits), debounce for 700ms then hit Mapbox geocoding and
  // flyTo the top hit. Lets "Lyon" zoom to Lyon even when nobody has
  // spotted there yet. Brand-name queries still hit zero results
  // and just stay zoomed where the user was — no harm.
  useEffect(() => {
    const q = mapSearchQuery.trim()
    if (q.length < 3) return
    // Skip if the query already matches at least one local spot —
    // the user is filtering, not searching.
    if (visibleCount > 0) return
    // Skip likely brand+number combos (M3, 911, e63s) — those are
    // car queries, not place queries.
    if (/[0-9]/.test(q)) return
    const map = mapRef.current
    const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
    if (!map || !token) return

    const ctl = new AbortController()
    const t = window.setTimeout(async () => {
      try {
        const center = map.getCenter()
        const proximity = `${center.lng.toFixed(4)},${center.lat.toFixed(4)}`
        const url =
          `https://api.mapbox.com/geocoding/v5/mapbox.places/` +
          `${encodeURIComponent(q)}.json` +
          `?types=place,locality,neighborhood,region` +
          `&proximity=${proximity}&limit=1&language=fr` +
          `&access_token=${token}`
        const res = await fetch(url, { signal: ctl.signal })
        if (!res.ok) return
        const json = (await res.json()) as {
          features?: { center?: [number, number]; place_name?: string }[]
        }
        const hit = json.features?.[0]
        if (!hit?.center) return
        map.flyTo({
          center: hit.center,
          zoom: 11,
          speed: 1.4,
          curve: 1.8,
          essential: true,
        })
        const placeLabel = (hit.place_name ?? q).split(',')[0]
        setToast(`Vol vers ${placeLabel}`)
        window.setTimeout(() => setToast(null), 2400)
      } catch {
        /* aborted or network — silent */
      }
    }, 700)
    return () => {
      window.clearTimeout(t)
      ctl.abort()
    }
  }, [mapSearchQuery, visibleCount])

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      /* localStorage unavailable */
    }
    if (mapReady && mapRef.current) applyMode(mapRef.current, mode)
  }, [mode, mapReady])

  // ── Live user-location compass marker (Apple Plans style) ──
  // A CompassMarker instance owns the SVG marker, its rAF rotation loop
  // and the DeviceOrientation listeners. We just feed it GPS fixes from
  // watchPosition: the first fix builds + adds the marker, later fixes
  // only move it. It stays a blue dot (no cone) until a real heading lands.
  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current
    if (!map || !navigator.geolocation) return

    let compass: CompassMarker | null = null

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lng = pos.coords.longitude
        const lat = pos.coords.latitude
        posRef.current = { lat, lng }
        if (!compass) {
          compass = new CompassMarker()
          compass.init(map, [lng, lat])
          userMarkerRef.current = compass
        } else {
          compass.updatePosition(lng, lat)
        }
      },
      () => {
        /* permission denied / unavailable → no dot, silent */
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    )
    watchIdRef.current = watchId

    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      compass?.destroy()
      compass = null
      userMarkerRef.current = null
    }
  }, [mapReady])

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

      <div className="absolute left-0 right-0 top-0 z-10 px-4 pt-[max(3rem,calc(env(safe-area-inset-top)+2rem))]">
        {/* Search + advanced-filters icon on one line — mirrors the Fil.
            The search bar flexes; the filter icon sits to its right as a
            light, fond-less glyph (a tiny active dot when filters are on). */}
        <div className="mx-auto flex max-w-md items-center gap-2">
          <div
            className="flex flex-1 items-center gap-2 rounded-2xl px-4 py-3"
            style={{
              // Theme-aware iOS Maps glass — flips from translucent
              // dark glass (dark mode, sits on dark-v11 map) to
              // translucent white glass (light mode, sits on Snap
              // beige map) via the CSS var ladder.
              background: 'var(--color-glass-mid)',
              backdropFilter: 'saturate(170%) blur(12px)',
              WebkitBackdropFilter: 'saturate(170%) blur(12px)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 12px 28px rgba(0, 0, 0, 0.18)',
            }}
          >
            <SearchIcon className="h-4 w-4 flex-none text-fg2" />
            <input
              type="text"
              value={mapSearchQuery}
              onChange={(e) => setMapSearchQuery(e.target.value)}
              placeholder="Rechercher une voiture…"
              className="min-w-0 flex-1 bg-transparent text-sm font-medium text-fg outline-none placeholder:text-fg2"
            />
            {mapSearchQuery && (
              <button
                onClick={() => setMapSearchQuery('')}
                aria-label="Effacer"
                className="tappable text-fg2 hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => setFiltersOpen(true)}
            aria-label="Filtres"
            className="tappable relative flex-none p-2 text-fg2 hover:text-fg"
          >
            <SlidersHorizontal className="h-5 w-5" />
            {mapFiltersActive(mapFilters) && (
              <span
                className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent"
                aria-hidden
              />
            )}
          </button>
        </div>

        {/* "REPLAY AUJOURD'HUI" pill removed per 2026-05-28 cleanup.
            The underlying time-lapse logic (startReplay/pauseReplay/
            stopReplay + the replay state) stays in the module so it
            can be reattached to a future UI surface without rewiring
            the marker animation. */}
        {/* Category / brand / distance pills moved INTO the filter sheet
            (the sliders icon next to the search) per 2026-06-23 — the map
            header is now just the search row so the map owns the screen. */}
      </div>

      {/* AI prediction Sparkles entry button — archived behind
          SHOW_WEATHER_IA. Both the button and the bottom sheet stay
          wired so flipping the constant back to true revives the
          feature without rewiring fetch / state / sheet code. */}
      {SHOW_WEATHER_IA && (
        <button
          onClick={() => setInfoSheetOpen(true)}
          aria-label="Conseil de spot du jour"
          className="tappable absolute right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full"
          style={{
            top: 'calc(max(3rem, env(safe-area-inset-top) + 2rem) + 3.25rem)',
            background: 'rgb(var(--color-card))',
            border: '1px solid rgb(var(--color-fg) / 0.10)',
            boxShadow: '0 8px 22px rgba(0,0,0,0.45)',
            color: 'rgb(var(--color-accent))',
          }}
        >
          <Sparkles className="h-4 w-4" />
        </button>
      )}

      {SHOW_WEATHER_IA && infoSheetOpen && (
        <MapPredictionSheet
          prediction={prediction}
          loading={predictionLoading}
          onClose={() => setInfoSheetOpen(false)}
        />
      )}

      {/* Bottom-right control stack — slim 2D/3D pill sitting just
          above the geolocation button. The pill is barely wider than
          the geo circle so the column reads as a unit. Lifted 16px
          off the tab bar per the launch polish pass so the stack
          can't be mis-tapped when reaching for the nav. */}
      <div
        className="absolute right-4 z-10 flex flex-col items-end gap-3"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 7rem + 0.75rem + 20px)' }}
      >
        <div
          className="flex gap-0.5 rounded-xl p-0.5"
          style={{
            background: 'rgb(var(--color-card) / 0.80)',
            backdropFilter: 'saturate(160%) blur(14px)',
            WebkitBackdropFilter: 'saturate(160%) blur(14px)',
            border: '1px solid rgb(var(--color-fg) / 0.06)',
            boxShadow: '0 10px 24px rgba(0, 0, 0, 0.45)',
          }}
        >
          {(['2D', '3D'] as MapMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`tappable rounded-lg px-2.5 py-1.5 font-extrabold tracking-wide transition-all ${
                mode === m
                  ? 'bg-accent text-white shadow-md active:scale-95'
                  : 'text-fg2 hover:text-fg active:scale-95'
              }`}
              style={{ fontSize: '11px' }}
            >
              {m}
            </button>
          ))}
        </div>

        <button
          onClick={flyToUser}
          aria-label="Me localiser"
          className="tappable flex h-12 w-12 items-center justify-center rounded-full bg-accent transition-transform active:scale-90"
          style={{
            // shadow-2xl level — bigger ambient + brand-tinted glow +
            // tight contact + inset hairline so the FAB sits visually
            // above the map regardless of zoom / style.
            boxShadow:
              '0 18px 40px rgba(232, 32, 58, 0.42), 0 8px 18px rgba(0, 0, 0, 0.40), 0 4px 10px rgba(0, 0, 0, 0.30), inset 0 0 0 1px rgba(255, 255, 255, 0.10)',
          }}
        >
          <LocateFixed className="h-5 w-5 text-fg" />
        </button>
      </div>

      {/* Centered "Spotter" camera FAB — primary action, round, brand
          red (#E8203A), white camera glyph. Sits above the global tab
          bar so it's fully visible and never overlapped. Tapping fires
          the hidden capture input synchronously (iOS camera requirement). */}
      <input
        ref={spotInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onSpotCapture}
        className="hidden"
      />
      <button
        onClick={() => spotInputRef.current?.click()}
        aria-label="Spotter une voiture"
        className="tappable absolute left-1/2 z-40 flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full transition-transform active:scale-90"
        style={{
          bottom: 'calc(env(safe-area-inset-bottom) + 4.75rem)',
          background: '#E8203A',
          boxShadow:
            '0 18px 40px rgba(232, 32, 58, 0.45), 0 8px 18px rgba(0, 0, 0, 0.40), 0 4px 10px rgba(0, 0, 0, 0.30), inset 0 0 0 1px rgba(255, 255, 255, 0.12)',
        }}
      >
        <Camera className="h-7 w-7 text-white" strokeWidth={2.2} />
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

      <MapFiltersModal
        open={filtersOpen}
        initial={mapFilters}
        onClose={() => setFiltersOpen(false)}
        onApply={(next) => {
          // Apply + persist to the map's own key. onClose (fired by the
          // modal right after onApply) closes the sheet.
          setMapFilters(next)
          saveMapFilters(next)
        }}
      />

      {clusterSheet && (
        <ClusterSheet
          items={clusterSheet}
          onClose={() => setClusterSheet(null)}
          onOpenSpot={(id) => {
            setClusterSheet(null)
            navigate(`/spot/${id}`)
          }}
        />
      )}
    </div>
  )
}

// ───────────────────── Cluster contents bottom sheet ─────────────────────
// Opened when a cluster can't be zoomed apart (multiple spots at the same
// place). Lists every spot of the cluster, sorted by likes desc then
// recency; tapping one opens its detail page.
function ClusterSheet({
  items,
  onClose,
  onOpenSpot,
}: {
  items: ClusterLeaf[]
  onClose: () => void
  onOpenSpot: (id: string) => void
}) {
  const [likes, setLikes] = useState<Record<string, number>>({})
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    let active = true
    const ids = items.map((i) => i.id)
    if (ids.length) {
      supabase
        .from('spot_likes')
        .select('spot_id')
        .in('spot_id', ids)
        .then(({ data }) => {
          if (!active) return
          const m: Record<string, number> = {}
          for (const r of (data ?? []) as { spot_id: string }[])
            m[r.spot_id] = (m[r.spot_id] ?? 0) + 1
          setLikes(m)
        })
    }
    return () => {
      active = false
      document.body.style.overflow = prev
    }
  }, [items])

  const sorted = [...items].sort((a, b) => {
    const diff = (likes[b.id] ?? 0) - (likes[a.id] ?? 0)
    if (diff !== 0) return diff
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <button
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0"
        style={{
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          animation: 'sheet-backdrop-in 200ms ease-out both',
        }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 px-4 pt-3"
        style={{
          background: '#141414',
          borderTopLeftRadius: '24px',
          borderTopRightRadius: '24px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          paddingBottom: 'max(env(safe-area-inset-bottom), 20px)',
          maxHeight: '75vh',
          overflowY: 'auto',
          boxShadow: '0 -24px 60px rgba(0,0,0,0.65)',
          animation: 'sheet-slide-up 280ms cubic-bezier(0.32,0.72,0,1) both',
        }}
      >
        <div className="flex justify-center pt-1">
          <span
            aria-hidden
            className="rounded-full"
            style={{ width: 40, height: 4, background: 'rgba(255,255,255,0.18)' }}
          />
        </div>
        <h3 className="mb-0.5 mt-3 font-display text-[17px] font-extrabold text-white">
          {items.length} spots ici
        </h3>
        <p className="mb-3 text-[12px] text-white/45">Triés par likes</p>
        <div className="space-y-2">
          {sorted.map((s) => {
            const rb = rarityBadge(s.rarity)
            const lk = likes[s.id] ?? 0
            return (
              <button
                key={s.id}
                onClick={() => onOpenSpot(s.id)}
                className="tappable flex w-full items-center gap-3 rounded-2xl p-2 text-left"
                style={{
                  background: '#0d0d0d',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {s.photo_url ? (
                  <img
                    src={s.photo_url}
                    alt=""
                    loading="lazy"
                    className="h-14 w-14 flex-none rounded-xl object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 flex-none items-center justify-center rounded-xl bg-white/5 text-white/30">
                    —
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold text-white">
                    {s.model || s.brand || 'Spot'}
                  </p>
                  <p className="truncate text-[12px] text-white/50">
                    @{s.spotter} · {timeAgo(s.created_at)}
                  </p>
                </div>
                {lk > 0 && (
                  <span className="flex-none text-[11px] font-bold text-white/40">
                    ♥ {lk}
                  </span>
                )}
                <span
                  className="flex-none rounded-full px-2 py-0.5 text-[9px] font-black uppercase"
                  style={{ background: rb.bg, color: rb.fg, border: `1px solid ${rb.border}` }}
                >
                  {rb.label}
                </span>
              </button>
            )
          })}
        </div>
        <button
          onClick={onClose}
          className="tappable mb-1 mt-4 w-full rounded-full py-3 text-[14px] font-semibold text-white"
          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          Fermer
        </button>
      </div>
    </div>,
    document.body,
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
          background: 'rgb(var(--color-card))',
          border: '1px solid rgb(var(--color-fg) / 0.08)',
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
            style={{ background: 'rgb(var(--color-fg) / 0.22)' }}
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
                className="label-up text-[9.5px] text-fg/75"
                style={{ letterSpacing: '0.18em' }}
              >
                {prediction ? theme.label : 'CONSEIL DU JOUR'}
              </p>
              <span
                className="inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 text-[9px] font-bold tracking-wider text-fg/85 backdrop-blur"
                style={{ border: '1px solid rgba(255,255,255,0.12)' }}
              >
                IA 🎯
              </span>
            </div>
            {loading && !prediction ? (
              <div className="mt-3 flex items-center gap-2 text-[14px] text-fg/80">
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
                className="mt-3 leading-snug text-fg/75"
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
