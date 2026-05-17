import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Flag, MapPin, Trophy } from 'lucide-react'
import {
  circuitImage,
  fmtGpDateTime,
  gpByRound,
  sessionsFor,
} from '../lib/f1'

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
      <span className="min-w-[2.75rem] rounded-xl bg-accent/15 px-2 py-2 text-center text-2xl font-bold tabular-nums text-accent">
        {String(value).padStart(2, '0')}
      </span>
      <span className="mt-1 text-[10px] uppercase tracking-widest text-fg/40">
        {label}
      </span>
    </div>
  )
}

export default function GrandPrixDetail() {
  const { round } = useParams<{ round: string }>()
  const navigate = useNavigate()
  const gp = gpByRound(Number(round))

  const cd = useCountdown(gp?.date ?? new Date(0).toISOString())

  if (!gp) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-8 text-center text-fg">
        <p className="text-sm text-fg/60">Grand Prix introuvable.</p>
        <button
          onClick={() => navigate('/discover')}
          className="rounded-full bg-accent px-6 py-3 text-sm font-medium"
        >
          Retour
        </button>
      </div>
    )
  }

  const sessions = sessionsFor(gp)

  return (
    <div className="min-h-screen bg-bg text-fg">
      <div className="relative h-[38vh] w-full">
        <img
          src={circuitImage(gp.round)}
          alt={gp.circuit}
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent" />
        <button
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur"
        >
          <ArrowLeft className="h-5 w-5 text-fg" />
        </button>
        <div className="absolute bottom-4 left-5 right-5">
          <div className="flex items-center gap-3">
            <span className="text-4xl leading-none">{gp.flag}</span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">
                Manche {gp.round} · F1 2026
              </p>
              <h1 className="truncate text-2xl font-bold">{gp.name}</h1>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-7 p-5 pb-12">
        <div className="flex items-center gap-2 text-sm text-fg/60">
          <MapPin className="h-4 w-4 flex-none text-accent" />
          <span>
            {gp.circuit} · {gp.country}
          </span>
        </div>

        {cd ? (
          <div className="rounded-2xl border border-accent/30 bg-accent/5 p-5">
            <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-widest text-fg/50">
              Départ de la course dans
            </p>
            <div className="flex items-center justify-center gap-3">
              <Unit value={cd.d} label="jours" />
              <Unit value={cd.h} label="hrs" />
              <Unit value={cd.m} label="min" />
              <Unit value={cd.s} label="sec" />
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/5 bg-card p-5 text-center text-sm text-fg/50">
            Ce Grand Prix a déjà eu lieu.
          </div>
        )}

        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <Flag className="h-5 w-5 text-accent" />
            Programme du week-end
          </h2>
          <div className="overflow-hidden rounded-2xl bg-card">
            {sessions.map((s, i) => (
              <div
                key={s.label}
                className={`flex items-center justify-between gap-3 px-4 py-3.5 ${
                  i < sessions.length - 1 ? 'border-b border-white/5' : ''
                } ${s.label === 'Course' ? 'bg-accent/10' : ''}`}
              >
                <span
                  className={`text-sm font-medium ${
                    s.label === 'Course' ? 'text-accent' : 'text-fg'
                  }`}
                >
                  {s.label}
                </span>
                <span className="text-right text-xs text-fg/50">
                  {fmtGpDateTime(s.date)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-fg/30">
            Horaires indicatifs (heure locale de ton appareil).
          </p>
        </section>

        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <Trophy className="h-5 w-5 text-accent" />
            Derniers vainqueurs
          </h2>
          {gp.winners && gp.winners.length > 0 ? (
            <div className="overflow-hidden rounded-2xl bg-card">
              {gp.winners.slice(0, 3).map((w, i) => (
                <div
                  key={w.year}
                  className={`flex items-center justify-between px-4 py-3.5 ${
                    i < Math.min(gp.winners!.length, 3) - 1
                      ? 'border-b border-white/5'
                      : ''
                  }`}
                >
                  <span className="text-sm font-semibold tabular-nums text-fg/50">
                    {w.year}
                  </span>
                  <span className="text-sm font-medium text-fg">
                    {w.driver}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/5 bg-card p-5 text-center text-sm text-fg/50">
              Historique à venir pour ce circuit.
            </div>
          )}
        </section>

        <a
          href={gp.officialUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-full bg-accent py-3.5 text-sm font-semibold text-fg shadow-lg shadow-accent/30 transition-transform active:scale-[0.98]"
        >
          <ExternalLink className="h-4 w-4" />
          Page officielle F1
        </a>
      </div>
    </div>
  )
}
