import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, MapPin, Search, LocateFixed } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatEventDate, type CarEvent } from '../lib/events'
import { distanceMeters } from '../lib/spots'
import { Skeleton } from './Skeleton'

const ORANGE = '#F59E0B'
const NEAR_RADIUS_M = 50_000

// Static mini-map of the area (Europe view) for the empty state.
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
const MINI_MAP_URL = MAPBOX_TOKEN
  ? `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/2.4,46.6,4/640x220@2x?access_token=${MAPBOX_TOKEN}&attribution=false&logo=false`
  : null

// Community meets, created only by verified organizers. A normal user
// sees the list but no create button.
export default function Meets() {
  const navigate = useNavigate()
  const [events, setEvents] = useState<CarEvent[] | null>(null)
  const [canCreate, setCanCreate] = useState(false)
  const [q, setQ] = useState('')
  const [near, setNear] = useState(false)
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null)
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoMsg, setGeoMsg] = useState<string | null>(null)

  function toggleNear() {
    if (near) {
      setNear(false)
      return
    }
    if (pos) {
      setNear(true)
      return
    }
    if (!navigator.geolocation) {
      setGeoMsg('Géolocalisation non disponible.')
      return
    }
    setGeoBusy(true)
    setGeoMsg(null)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude })
        setNear(true)
        setGeoBusy(false)
      },
      () => {
        setGeoMsg('Localisation refusée — impossible de filtrer autour de toi.')
        setGeoBusy(false)
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 },
    )
  }

  useEffect(() => {
    let active = true
    supabase
      .from('events')
      .select('*')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(50)
      .then(({ data }) => {
        if (active) setEvents((data ?? []) as CarEvent[])
      })
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || !active) return
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle()
      if (!active) return
      const role = (data?.role as string | undefined) ?? 'user'
      setCanCreate(role === 'organizer' || role === 'admin')
    })()
    return () => {
      active = false
    }
  }, [])

  const term = q.trim().toLowerCase()
  const filtered =
    events == null
      ? null
      : events.filter((ev) => {
          if (
            term &&
            ![ev.title, ev.location, ev.type]
              .filter(Boolean)
              .some((v) => v!.toLowerCase().includes(term))
          )
            return false
          if (near && pos) {
            if (
              ev.lat == null ||
              ev.lng == null ||
              !Number.isFinite(ev.lat) ||
              !Number.isFinite(ev.lng)
            )
              return false
            if (
              distanceMeters(pos.lat, pos.lng, ev.lat, ev.lng) >
              NEAR_RADIUS_M
            )
              return false
          }
          return true
        })

  return (
    <div className="px-4 pb-8">
      {canCreate ? (
        <button
          onClick={() => navigate('/new-event')}
          className="my-4 flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-semibold text-[#0A0A0A]"
          style={{ backgroundColor: ORANGE }}
        >
          <Plus className="h-5 w-5" />
          Créer un événement
        </button>
      ) : (
        events !== null &&
        events.length > 0 && (
          <p className="my-4 rounded-xl bg-card px-4 py-3 text-center text-xs text-fg/40">
            Création réservée aux organisateurs vérifiés — fais une demande
            dans Paramètres.
          </p>
        )
      )}

      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg/30" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un événement…"
            className="w-full rounded-full bg-card py-2.5 pl-9 pr-3 text-sm text-fg outline-none placeholder:text-fg/30 focus:ring-1 focus:ring-[#F59E0B]"
          />
        </div>
        <button
          onClick={toggleNear}
          disabled={geoBusy}
          className={`flex flex-none items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
            near
              ? 'text-[#0A0A0A]'
              : 'bg-card text-fg/60 hover:text-fg'
          }`}
          style={near ? { backgroundColor: ORANGE } : undefined}
        >
          <LocateFixed className="h-4 w-4" />
          {geoBusy ? '…' : 'Près de moi'}
        </button>
      </div>
      {geoMsg && (
        <p className="mb-3 rounded-xl bg-card px-4 py-2.5 text-xs text-fg/50">
          {geoMsg}
        </p>
      )}

      <div className="space-y-3">
        {events === null ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="space-y-3 rounded-2xl border border-white/5 bg-card p-4"
            >
              <Skeleton className="h-4 w-20 rounded-full" />
              <Skeleton className="h-5 w-2/3 rounded" />
              <Skeleton className="h-3 w-1/3 rounded" />
              <Skeleton className="h-3 w-1/2 rounded" />
            </div>
          ))
        ) : events.length === 0 ? (
          <div className="overflow-hidden rounded-2xl border border-white/5 bg-card">
            <div className="relative h-36 w-full">
              {MINI_MAP_URL ? (
                <img
                  src={MINI_MAP_URL}
                  alt="Carte de la zone"
                  className="h-full w-full object-cover opacity-70"
                />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-[#F59E0B]/15 to-transparent" />
              )}
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${ORANGE}26` }}
                >
                  <MapPin className="h-6 w-6" style={{ color: ORANGE }} />
                </div>
              </div>
            </div>
            <div className="p-6 text-center">
              <p className="font-medium text-fg">
                Aucun événement dans ta région pour le moment
              </p>
              <p className="mt-1 text-xs text-fg/40">
                {canCreate
                  ? 'Sois le premier à organiser un meet ici.'
                  : 'Tu organises des meets ? Deviens organisateur vérifié.'}
              </p>
              <button
                onClick={() =>
                  navigate(canCreate ? '/new-event' : '/settings')
                }
                className="mt-4 rounded-full px-6 py-2.5 text-sm font-semibold text-[#0A0A0A]"
                style={{ backgroundColor: ORANGE }}
              >
                {canCreate ? 'Créer un événement' : 'Devenir organisateur'}
              </button>
            </div>
          </div>
        ) : filtered && filtered.length === 0 ? (
          <p className="px-1 py-12 text-center text-sm text-fg/40">
            {near
              ? 'Aucun événement dans un rayon de 50 km.'
              : 'Aucun événement ne correspond à ta recherche.'}
          </p>
        ) : (
          (filtered ?? []).map((ev) => (
            <article
              key={ev.id}
              className="rounded-2xl border border-[#F59E0B]/20 bg-[#F59E0B]/5 p-4"
            >
              <span className="inline-block rounded-full bg-[#F59E0B]/20 px-3 py-1 text-[10px] font-semibold tracking-wide text-[#F59E0B]">
                {ev.type.toUpperCase()}
              </span>
              <h3 className="mt-2 font-semibold text-fg">{ev.title}</h3>
              <p className="mt-1 text-sm text-[#F59E0B]">
                {formatEventDate(ev.starts_at)}
              </p>
              <p className="mt-1 text-sm text-fg/60">{ev.location}</p>
              <p className="mt-2 text-xs text-fg/30">Inscriptions à venir</p>
            </article>
          ))
        )}
      </div>
    </div>
  )
}
