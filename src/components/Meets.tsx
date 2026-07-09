import { useEffect, useState } from 'react'
import { Search, LocateFixed } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatEventDate, type CarEvent } from '../lib/events'
import { distanceMeters } from '../lib/spots'
import { Skeleton } from './Skeleton'

const ORANGE = '#F59E0B'
const NEAR_RADIUS_M = 50_000

// Read-only list of community meets. Event creation lives in
// Paramètres → Avancé (organizers/admins only).
export default function Meets() {
  const [events, setEvents] = useState<CarEvent[] | null>(null)
  const [q, setQ] = useState('')
  const [near, setNear] = useState(false)
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null)
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoMsg, setGeoMsg] = useState<string | null>(null)
  const [city, setCity] = useState<string | null>(null)

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
    return () => {
      active = false
    }
  }, [])

  // The user's city — personalises the empty state ("Aucun événement à …").
  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('profiles')
        .select('ville')
        .eq('user_id', user.id)
        .maybeSingle()
      if (active) setCity((data?.ville as string | undefined)?.trim() || null)
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
            near ? 'text-[#0A0A0A]' : 'bg-card text-fg/60 hover:text-fg'
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
              className="space-y-3 rounded-2xl border border-fg/5 bg-card p-4"
            >
              <Skeleton className="h-4 w-20 rounded-full" />
              <Skeleton className="h-5 w-2/3 rounded" />
              <Skeleton className="h-3 w-1/3 rounded" />
              <Skeleton className="h-3 w-1/2 rounded" />
            </div>
          ))
        ) : filtered && filtered.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <span aria-hidden style={{ fontSize: '52px', lineHeight: 1 }}>
              🏎️
            </span>
            <p className="mt-5 text-[16px] font-semibold text-fg">
              Aucun événement à {city ?? 'ta région'} pour l'instant
            </p>
            <p className="mt-2 max-w-[18rem] text-[13px] leading-relaxed text-fg/45">
              Les organisateurs vérifiés publient bientôt des meets dans ta
              région
            </p>
            {(near || term.length > 0) && (
              <button
                onClick={() => {
                  setNear(false)
                  setQ('')
                }}
                className="tappable mt-5 text-[13px] font-medium text-fg/55 hover:text-fg"
              >
                Voir tous les événements de France →
              </button>
            )}
          </div>
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
