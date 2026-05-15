import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { LocateFixed } from 'lucide-react'

const PARIS: [number, number] = [2.3522, 48.8566]
const DEFAULT_ZOOM = 13

const FILTERS = ['Tous', 'Supercars', 'Classics', 'JDM'] as const

type TestPin = {
  name: string
  date: string
  lng: number
  lat: number
}

const TEST_PINS: TestPin[] = [
  { name: 'Ferrari 488 GTB', date: '12 mai 2026', lng: 2.3522, lat: 48.8566 },
  { name: 'Lamborghini Huracán', date: '10 mai 2026', lng: 2.3651, lat: 48.8602 },
  { name: 'Porsche 911 GT3', date: '8 mai 2026', lng: 2.3402, lat: 48.8531 },
  { name: 'Nissan Skyline GT-R R34', date: '5 mai 2026', lng: 2.3699, lat: 48.8501 },
  { name: 'Mercedes 300SL Gullwing', date: '1 mai 2026', lng: 2.3301, lat: 48.8623 },
]

const CAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`

function createMarkerEl(): HTMLDivElement {
  const el = document.createElement('div')
  el.className =
    'flex items-center justify-center w-9 h-9 rounded-full bg-accent shadow-lg shadow-accent/40 ring-2 ring-black/30 cursor-pointer'
  el.innerHTML = CAR_SVG
  return el
}

export default function Map() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<string>('Tous')

  function flyToUser() {
    if (!mapRef.current || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        mapRef.current?.flyTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 14,
          essential: true,
        })
      },
      () => {
        /* refus / indisponible : on reste sur la vue courante */
      },
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
    console.log('[Map] VITE_MAPBOX_TOKEN au montage:', token)
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

    // DEBUG 1 : taille réelle du conteneur juste après l'init
    console.log(
      '[Map] container après init — offsetWidth:',
      containerRef.current.offsetWidth,
      'offsetHeight:',
      containerRef.current.offsetHeight,
      '| position calculée:',
      getComputedStyle(containerRef.current).position,
    )

    const markers: mapboxgl.Marker[] = []

    map.on('error', (e) => {
      const msg = e.error?.message ?? ''
      if (/401|403|unauthorized|forbidden|access token|not authorized/i.test(msg)) {
        setError('Carte indisponible : token Mapbox invalide ou non autorisé.')
      }
    })

    map.on('load', () => {
      // Le conteneur peut n'être dimensionné qu'après le 1er layout :
      // on force un resize pour éviter un canvas 0×0 (écran noir).
      map.resize()

      const c = map.getCanvas()
      console.log(
        '[Map] load — canvas:',
        c.width,
        'x',
        c.height,
        '| container:',
        containerRef.current?.offsetWidth,
        'x',
        containerRef.current?.offsetHeight,
      )

      for (const pin of TEST_PINS) {
        const popup = new mapboxgl.Popup({
          offset: 24,
          closeButton: true,
        }).setHTML(
          `<div class="font-medium text-sm">${pin.name}</div><div class="text-xs opacity-60 mt-0.5">${pin.date}</div>`,
        )

        const marker = new mapboxgl.Marker({ element: createMarkerEl() })
          .setLngLat([pin.lng, pin.lat])
          .setPopup(popup)
          .addTo(map)

        markers.push(marker)
      }

      flyToUser()
    })

    return () => {
      for (const m of markers) m.remove()
      map.remove()
      mapRef.current = null
    }
  }, [])

  return (
    <div className="fixed inset-0">
      {/* DEBUG: hauteur explicite inline (bat le CSS .mapboxgl-map) + fond rouge temporaire */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100vh', backgroundColor: '#ff0000' }}
      />

      {/* Barre de filtre */}
      <div className="absolute left-0 right-0 top-0 z-10 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
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

      {/* Bouton "Me localiser" */}
      <button
        onClick={flyToUser}
        aria-label="Me localiser"
        className="absolute bottom-24 right-4 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-accent shadow-lg shadow-accent/40 transition-transform active:scale-95"
      >
        <LocateFixed className="h-5 w-5 text-fg" />
      </button>

      {/* Erreur */}
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
