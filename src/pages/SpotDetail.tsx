import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { ArrowLeft, Car } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  categoryLabel,
  spotterLevel,
  spotterName,
  type Spot,
} from '../lib/spots'
import LikeButton from '../components/LikeButton'

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(iso))
}

export default function SpotDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [spot, setSpot] = useState<Spot | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [level, setLevel] = useState<string | null>(null)

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
      const { count } = await supabase
        .from('spots')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', s.user_id)
      if (active) setLevel(spotterLevel(count ?? 0))
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
      </div>

      <div className="space-y-7 p-5 pb-10">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold">
            {spot.brand} {spot.model}
          </h1>
          <LikeButton spotId={spot.id} realtime />
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

        <div
          ref={mapContainerRef}
          className="overflow-hidden rounded-2xl"
          style={{ width: '100%', height: '180px', backgroundColor: '#1A1A1A' }}
        />

        <div className="flex items-center gap-3 rounded-2xl bg-card p-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-lg font-bold text-fg">
            {spotterName(null).charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="font-medium">{spotterName(null)}</div>
            <div className="text-xs text-accent">
              {level ?? '—'}
            </div>
          </div>
        </div>

        <p className="text-sm text-fg/40">
          Spotté le {formatDateTime(spot.created_at)}
        </p>
      </div>
    </div>
  )
}
