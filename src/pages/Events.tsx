import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
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
    <div className="bg-bg px-4 pb-4">

      {/* SECTION 1 — Calendrier F1 (titre rendu par le composant) */}
      <section>
        <F1Calendar />
      </section>

      {/* CTA entre les deux sections */}
      <button
        onClick={() => navigate('/new-event')}
        className="my-6 flex w-full items-center justify-center gap-2 rounded-full bg-accent py-3.5 text-sm font-semibold text-fg"
      >
        <Plus className="h-5 w-5" />
        Créer un événement
      </button>

      {/* SECTION 2 — Événements communautaires */}
      <section className="border-t border-white/5 pt-5">
        <h2 className="pb-1 text-lg font-semibold text-fg">
          Événements communautaires
        </h2>
        <p className="pb-4 text-xs text-fg/40">
          Cars &amp; Coffee, track days, meets REVS, rassemblements
        </p>

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
              <p className="text-sm text-fg/60">
                Aucun événement communautaire pour le moment.
              </p>
              <p className="mt-1 text-xs text-fg/40">
                Sois le premier à en organiser un !
              </p>
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
      </section>
    </div>
  )
}
