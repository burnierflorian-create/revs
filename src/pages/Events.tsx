import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatEventDate, type CarEvent } from '../lib/events'
import { Skeleton } from '../components/Skeleton'
import F1Calendar from '../components/F1Calendar'

export default function Events() {
  const navigate = useNavigate()
  const [events, setEvents] = useState<CarEvent[] | null>(null)

  useEffect(() => {
    let active = true
    supabase
      .from('events')
      .select('*')
      .order('starts_at', { ascending: true })
      .limit(50)
      .then(({ data }) => {
        if (active) setEvents((data ?? []) as CarEvent[])
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <h1 className="py-4 text-2xl font-semibold text-fg">Événements</h1>

      <F1Calendar />

      <h2 className="py-3 text-lg font-semibold text-fg">
        Événements communautaires
      </h2>

      <div className="space-y-3 pb-8">
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
          <div className="rounded-2xl border border-white/5 bg-card p-6 text-center">
            <p className="text-sm text-fg/60">Aucun événement prévu</p>
            <button
              onClick={() => navigate('/new-event')}
              className="mt-4 rounded-full bg-accent px-6 py-3 text-sm font-medium text-fg"
            >
              Créer un événement
            </button>
          </div>
        ) : (
          events.map((ev) => (
            <article
              key={ev.id}
              className="rounded-2xl border border-white/5 bg-white/5 p-4"
            >
              <span className="inline-block rounded-full bg-accent/20 px-3 py-1 text-[10px] font-semibold tracking-wide text-fg">
                {ev.type.toUpperCase()}
              </span>
              <h3 className="mt-2 font-semibold text-fg">{ev.title}</h3>
              <p className="mt-1 text-sm text-accent">
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
