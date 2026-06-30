import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Camera, Users, Tag } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  fetchEventLiveStats,
  type EventLiveStats,
} from '../lib/liveEvents'
import type { Spot } from '../lib/spots'
import { Skeleton } from '../components/Skeleton'

const POLL_MS = 15_000

type EventRow = {
  id: string
  title: string
  location: string
  starts_at: string
  is_live: boolean
}

export default function EventLive() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [event, setEvent] = useState<EventRow | null>(null)
  const [spots, setSpots] = useState<Spot[] | null>(null)
  const [stats, setStats] = useState<EventLiveStats | null>(null)

  async function refresh() {
    if (!id) return
    const [evRes, spRes, statsRes] = await Promise.all([
      supabase
        .from('events')
        .select('id, title, location, starts_at, is_live')
        .eq('id', id)
        .maybeSingle(),
      supabase.rpc('event_live_spots', { p_event_id: id, p_limit: 50 }),
      fetchEventLiveStats(id),
    ])
    setEvent((evRes.data as EventRow | null) ?? null)
    setSpots((spRes.data ?? []) as Spot[])
    setStats(statsRes)
  }

  useEffect(() => {
    void refresh()
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return (
    <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="flex items-center gap-4 py-4">
        <button
          onClick={() => navigate(-1)}
          aria-label={t('miscpages.eventLive.back')}
          className="tappable text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
            </span>
            <span className="label-up text-[10px] text-accent">
              {t('miscpages.eventLive.live')}
            </span>
          </div>
          <h1 className="truncate font-display text-2xl font-extrabold tracking-tighter text-fg">
            {event?.title ?? t('miscpages.eventLive.eventFallback')}
          </h1>
          {event?.location && (
            <p className="mt-0.5 truncate text-xs text-fg2">{event.location}</p>
          )}
        </div>
      </div>

      {/* Stats */}
      {stats ? (
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            icon={<Camera className="h-4 w-4" />}
            value={stats.spot_count}
            label={t('miscpages.eventLive.statSpots')}
          />
          <StatCard
            icon={<Users className="h-4 w-4" />}
            value={stats.participant_count}
            label={t('miscpages.eventLive.statParticipants')}
          />
          <StatCard
            icon={<Tag className="h-4 w-4" />}
            value={stats.brand_count}
            label={t('miscpages.eventLive.statBrands')}
          />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-3xl" />
          ))}
        </div>
      )}

      {/* Spots list */}
      <div className="mt-6 pb-12">
        <h2 className="label-up mb-3 text-[10px] text-fg2">
          {t('miscpages.eventLive.spotsHeading')}
        </h2>
        {spots === null ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-2xl" />
            ))}
          </div>
        ) : spots.length === 0 ? (
          <div
            className="rounded-3xl bg-card p-6 text-center text-sm text-fg2"
            style={{ border: '1px solid var(--color-border)' }}
          >
            {t('miscpages.eventLive.noSpots')}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {spots.map((s) => (
              <button
                key={s.id}
                onClick={() => navigate(`/spot/${s.id}`)}
                className="tappable group relative overflow-hidden rounded-2xl bg-card text-left"
                style={{ border: '1px solid var(--color-border)' }}
              >
                <div className="aspect-square">
                  {s.photo_url ? (
                    <img
                      src={s.photo_url}
                      alt={`${s.brand} ${s.model}`}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-fg2/50">
                      —
                    </div>
                  )}
                </div>
                <div
                  className="label-up absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[9px] text-white"
                  style={{ boxShadow: '0 4px 12px rgba(232,32,58,0.45)' }}
                >
                  {t('miscpages.eventLive.badge')}
                </div>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-2.5 pt-7">
                  <p className="truncate font-display text-xs font-extrabold leading-tight tracking-tighter text-white">
                    {s.brand} {s.model}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode
  value: number
  label: string
}) {
  return (
    <div
      className="rounded-3xl bg-card p-4"
      style={{ border: '1px solid var(--color-border)' }}
    >
      <div className="flex items-center gap-1.5 text-fg2">
        <span className="text-accent">{icon}</span>
        <span className="label-up text-[10px]">{label}</span>
      </div>
      <p className="mt-2 font-display text-2xl font-extrabold tracking-tighter text-fg">
        {value}
      </p>
    </div>
  )
}
