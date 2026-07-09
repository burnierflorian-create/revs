import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ExternalLink,
  Flag,
  Loader2,
  MapPin,
  Trophy,
  Zap,
  AlertTriangle,
  Repeat,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  circuitImage,
  fmtGpDateTime,
  gpByRound,
  sessionsFor,
} from '../lib/f1'
import { findDriverByName, proxyImage } from '../lib/f1team'
import { Skeleton } from '../components/Skeleton'

type PodiumEntry = { position: 1 | 2 | 3; driver: string; team: string }
type RaceData = {
  podium: PodiumEntry[]
  pole: string
  fastestLap: { driver: string; time: string }
  laps: string
  notableRetirement: string
  summary: string
}
type RaceResponse =
  | { status: 'upcoming' }
  | {
      status: 'past'
      data: RaceData
      cached: boolean
      stale?: boolean
      generated_at: string
    }
  | { error: string }

function useCountdown(targetIso: string) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const diff = new Date(targetIso).getTime() - now
  if (diff <= 0) return null
  return {
    d: Math.floor(diff / 86400000),
    h: Math.floor((diff % 86400000) / 3600000),
    m: Math.floor((diff % 3600000) / 60000),
    s: Math.floor((diff % 60000) / 1000),
  }
}

function Unit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="min-w-[2.75rem] rounded-2xl bg-accent/15 px-2 py-2 text-center font-display text-2xl font-extrabold tabular-nums tracking-tighter text-accent">
        {String(value).padStart(2, '0')}
      </span>
      <span className="label-up mt-1.5 text-[10px] text-fg2">{label}</span>
    </div>
  )
}

// Podium medal / accent colours by position.
const PODIUM_STYLE: Record<
  1 | 2 | 3,
  { medal: string; accent: string; ring: string }
> = {
  1: {
    medal: '🥇',
    accent: '#FFD700',
    ring: 'rgba(255,215,0,0.45)',
  },
  2: {
    medal: '🥈',
    accent: '#C0C0C0',
    ring: 'rgba(192,192,192,0.45)',
  },
  3: {
    medal: '🥉',
    accent: '#CD7F32',
    ring: 'rgba(205,127,50,0.45)',
  },
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')
}

export default function GrandPrixDetail() {
  const { t } = useTranslation()
  const { round } = useParams<{ round: string }>()
  const navigate = useNavigate()
  const gp = gpByRound(Number(round))

  const cd = useCountdown(gp?.date ?? new Date(0).toISOString())

  const [race, setRace] = useState<RaceData | null>(null)
  const [raceLoading, setRaceLoading] = useState(false)
  const [raceError, setRaceError] = useState<string | null>(null)

  // Past GP only: fetch the race results.
  useEffect(() => {
    if (!gp) return
    if (new Date(gp.date).getTime() > Date.now()) return
    let active = true
    setRace(null)
    setRaceError(null)
    setRaceLoading(true)
    ;(async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) {
          if (active) setRaceLoading(false)
          return
        }
        const res = await fetch('/api/f1?type=race', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ round: gp.round }),
        })
        const json = (await res.json()) as RaceResponse
        if (!active) return
        if ('error' in json) {
          setRaceError(json.error)
        } else if (json.status === 'past') {
          setRace(json.data)
        }
      } catch {
        if (active) setRaceError(t('f1gp.resultsUnavailable'))
      } finally {
        if (active) setRaceLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [gp])

  if (!gp) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-8 text-center text-fg">
        <p className="text-sm text-fg2">{t('f1gp.gpNotFound')}</p>
        <button
          onClick={() => navigate('/discover')}
          className="tappable rounded-full bg-accent px-6 py-3 text-sm font-extrabold tracking-wider text-fg"
          style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
        >
          {t('f1gp.back')}
        </button>
      </div>
    )
  }

  const sessions = sessionsFor(gp)
  const isPast = new Date(gp.date).getTime() <= Date.now()

  return (
    <div className="min-h-screen bg-bg text-fg">
      <div className="relative h-[38vh] w-full">
        <img
          src={circuitImage(gp.round)}
          alt={gp.circuit}
          fetchPriority="high"
          decoding="async"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent" />
        <button
          onClick={() => navigate(-1)}
          aria-label={t('f1gp.back')}
          className="tappable absolute left-4 top-[max(1rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur"
          style={{ border: '1px solid rgb(var(--color-fg) / 0.08)' }}
        >
          <ArrowLeft className="h-5 w-5 text-fg" />
        </button>
        <div className="absolute bottom-4 left-5 right-5">
          <div className="flex items-center gap-3">
            <span className="text-4xl leading-none">{gp.flag}</span>
            <div className="min-w-0">
              <p className="label-up text-[10px] text-accent">
                {t('f1gp.roundLabel', { round: gp.round })}
              </p>
              <h1 className="truncate font-display text-2xl font-extrabold tracking-tighter text-fg">
                {gp.name}
              </h1>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-7 p-5 pb-12">
        <div className="flex items-center gap-2 text-sm text-fg2">
          <MapPin className="h-4 w-4 flex-none text-accent" />
          <span>
            {gp.circuit} · {gp.country}
          </span>
        </div>

        {cd ? (
          <div
            className="rounded-3xl p-5"
            style={{
              background:
                'linear-gradient(155deg, rgba(232,32,58,0.18) 0%, rgba(232,32,58,0.04) 60%, rgba(20,20,20,0.95) 100%)',
              border: '1px solid rgba(232,32,58,0.40)',
              boxShadow: '0 12px 36px rgba(232,32,58,0.16)',
            }}
          >
            <p className="label-up mb-3 text-center text-[10px] text-fg2">
              {t('f1gp.raceStartsIn')}
            </p>
            <div className="flex items-center justify-center gap-3">
              <Unit value={cd.d} label={t('f1gp.unitDays')} />
              <Unit value={cd.h} label={t('f1gp.unitHours')} />
              <Unit value={cd.m} label={t('f1gp.unitMinutes')} />
              <Unit value={cd.s} label={t('f1gp.unitSeconds')} />
            </div>
          </div>
        ) : isPast ? (
          /* Past GP → results section below */
          <RaceResults
            loading={raceLoading}
            race={race}
            error={raceError}
            gpName={gp.name}
          />
        ) : (
          <div
            className="rounded-3xl bg-card p-5 text-center text-sm text-fg2"
            style={{ border: '1px solid var(--color-border)' }}
          >
            {t('f1gp.gpAlreadyHappened')}
          </div>
        )}

        <section>
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-extrabold tracking-tighter text-fg">
            <Flag className="h-5 w-5 text-accent" />
            {t('f1gp.weekendSchedule')}
          </h2>
          <div
            className="overflow-hidden rounded-3xl bg-card"
            style={{ border: '1px solid var(--color-border)' }}
          >
            {sessions.map((s, i) => (
              <div
                key={s.label}
                className={`flex items-center justify-between gap-3 px-4 py-3.5 ${
                  i < sessions.length - 1 ? 'border-b border-fg/5' : ''
                } ${s.label === 'Course' ? 'bg-accent/10' : ''}`}
              >
                <span
                  className={`text-sm font-bold tracking-wide ${
                    s.label === 'Course' ? 'text-accent' : 'text-fg'
                  }`}
                >
                  {s.label}
                </span>
                <span className="text-right text-xs text-fg2">
                  {fmtGpDateTime(s.date)}
                </span>
              </div>
            ))}
          </div>
          <p className="label-up mt-2 text-[10px] text-fg2/70">
            {t('f1gp.localTimeNote')}
          </p>
        </section>

        <section>
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-extrabold tracking-tighter text-fg">
            <Trophy className="h-5 w-5 text-accent" />
            {t('f1gp.recentWinners')}
          </h2>
          {gp.winners && gp.winners.length > 0 ? (
            <div
              className="overflow-hidden rounded-3xl bg-card"
              style={{ border: '1px solid var(--color-border)' }}
            >
              {gp.winners.slice(0, 3).map((w, i) => (
                <div
                  key={w.year}
                  className={`flex items-center justify-between px-4 py-3.5 ${
                    i < Math.min(gp.winners!.length, 3) - 1
                      ? 'border-b border-fg/5'
                      : ''
                  }`}
                >
                  <span className="label-up text-[11px] tabular-nums text-fg2">
                    {w.year}
                  </span>
                  <span className="text-sm font-bold tracking-tight text-fg">
                    {w.driver}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div
              className="rounded-3xl bg-card p-5 text-center text-sm text-fg2"
              style={{ border: '1px solid var(--color-border)' }}
            >
              {t('f1gp.historyComingSoon')}
            </div>
          )}
        </section>

        <a
          href={gp.officialUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="tappable flex w-full items-center justify-center gap-2 rounded-full bg-accent py-3.5 text-sm font-extrabold tracking-wider text-fg"
          style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
        >
          <ExternalLink className="h-4 w-4" />
          {t('f1gp.officialF1Page')}
        </a>
      </div>
    </div>
  )
}

function RaceResults({
  loading,
  race,
  error,
  gpName,
}: {
  loading: boolean
  race: RaceData | null
  error: string | null
  gpName: string
}) {
  const { t } = useTranslation()
  if (loading) {
    return (
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-fg2">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          {t('f1gp.fetchingResults')}
        </div>
        <Skeleton className="h-44 rounded-3xl" />
        <Skeleton className="h-24 rounded-3xl" />
      </section>
    )
  }
  if (error || !race || race.podium.length === 0) {
    return (
      <div
        className="rounded-3xl bg-card p-5 text-center text-sm text-fg2"
        style={{ border: '1px solid var(--color-border)' }}
      >
        {t('f1gp.resultsUnavailableNow')}
      </div>
    )
  }

  return (
    <section className="space-y-5">
      {/* Podium */}
      <div>
        <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-extrabold tracking-tighter text-fg">
          <Trophy className="h-5 w-5 text-accent" />
          {t('f1gp.podiumTitle', { gpName })}
        </h2>
        <div className="space-y-2">
          {race.podium.map((p) => {
            const style = PODIUM_STYLE[p.position]
            const matched = findDriverByName(p.driver)
            const photo = proxyImage(matched?.photo)
            return (
              <div
                key={p.position}
                className="flex items-center gap-3 rounded-2xl px-3 py-3"
                style={{
                  background: 'rgb(var(--color-card))',
                  border: `1px solid ${style.ring}`,
                  boxShadow:
                    p.position === 1
                      ? `0 6px 22px ${style.ring}`
                      : undefined,
                }}
              >
                <span className="text-2xl leading-none" aria-hidden>
                  {style.medal}
                </span>
                <PodiumPortrait
                  photo={photo}
                  initials={initials(p.driver)}
                  ring={style.ring}
                />
                <div className="min-w-0 flex-1">
                  <p
                    title={p.driver}
                    className="line-clamp-2 font-display text-[15px] font-extrabold leading-tight tracking-tighter text-fg"
                  >
                    {p.driver}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-fg2">
                    {p.team !== 'N/A' ? p.team : '—'}
                  </p>
                </div>
                <span
                  className="flex-none font-display text-xl font-extrabold tracking-tighter"
                  style={{ color: style.accent }}
                >
                  {p.position}
                  <span className="text-xs font-bold opacity-80">
                    {p.position === 1
                      ? t('f1gp.ordinalFirst')
                      : t('f1gp.ordinalOther')}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Key stats */}
      <div className="grid grid-cols-3 gap-2.5">
        <RaceStat
          icon={<Flag className="h-4 w-4" />}
          label={t('f1gp.statPole')}
          value={race.pole !== 'N/A' ? race.pole : '—'}
        />
        <RaceStat
          icon={<Zap className="h-4 w-4" />}
          label={t('f1gp.statFastestLap')}
          value={
            race.fastestLap.driver !== 'N/A' ? race.fastestLap.driver : '—'
          }
          sub={
            race.fastestLap.time !== 'N/A' ? race.fastestLap.time : undefined
          }
        />
        <RaceStat
          icon={<Repeat className="h-4 w-4" />}
          label={t('f1gp.statLaps')}
          value={race.laps !== 'N/A' ? race.laps : '—'}
          big
        />
      </div>

      {/* Notable retirement */}
      {race.notableRetirement && race.notableRetirement !== 'N/A' && (
        <div
          className="flex items-start gap-3 rounded-2xl px-4 py-3.5"
          style={{
            background: 'rgb(var(--color-fg) / 0.03)',
            border: '1px solid var(--color-divider)',
          }}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-accent" />
          <div className="min-w-0">
            <p className="label-up text-[10px] text-fg2">
              {t('f1gp.notableRetirement')}
            </p>
            <p className="mt-1 text-sm leading-snug text-fg/90">
              {race.notableRetirement}
            </p>
          </div>
        </div>
      )}

      {/* Summary */}
      {race.summary && race.summary !== 'N/A' && (
        <article
          className="rounded-3xl bg-card p-5"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <p className="label-up text-[10px] text-fg2">
            {t('f1gp.raceSummary')}
          </p>
          <p className="mt-2 font-serif text-[15px] leading-relaxed text-fg/85">
            {race.summary}
          </p>
        </article>
      )}
    </section>
  )
}

function PodiumPortrait({
  photo,
  initials,
  ring,
}: {
  photo?: string
  initials: string
  ring: string
}) {
  const [failed, setFailed] = useState(false)
  const showPhoto = photo && !failed
  return (
    <div
      className="relative flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-full font-display text-sm font-extrabold tracking-tighter text-fg"
      style={{
        background:
          'linear-gradient(135deg, rgb(var(--color-fg) / 0.06) 0%, rgb(var(--color-fg) / 0.02) 100%)',
        border: `2px solid ${ring}`,
      }}
    >
      {showPhoto ? (
        <img
          src={photo}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover object-top"
        />
      ) : (
        initials
      )}
    </div>
  )
}

function RaceStat({
  icon,
  label,
  value,
  sub,
  big,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  big?: boolean
}) {
  return (
    <div
      className="rounded-3xl bg-card p-3"
      style={{ border: '1px solid var(--color-border)' }}
    >
      <div className="flex items-center gap-1.5 text-fg2">
        <span className="text-accent">{icon}</span>
        <span className="label-up text-[10px]">{label}</span>
      </div>
      <p
        className={`mt-2 truncate font-display font-extrabold tracking-tighter text-fg ${
          big ? 'text-2xl' : 'text-sm'
        }`}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 truncate text-[11px] tabular-nums text-fg2">
          {sub}
        </p>
      )}
    </div>
  )
}
