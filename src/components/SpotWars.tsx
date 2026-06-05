import { useEffect, useState } from 'react'
import { Swords, Crown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Skeleton } from './Skeleton'

type Row = {
  rank: number
  city: string
  spots_week: number
  total_pct: number
}

// Local-timezone date when the current ISO week reset (last Monday at
// 00:00). Displayed under the heading so users understand when the
// next reset hits.
function weekStartLabel(): string {
  const now = new Date()
  const day = now.getDay() // 0 = Sun
  const sinceMonday = (day + 6) % 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - sinceMonday)
  monday.setHours(0, 0, 0, 0)
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(monday)
}

export default function SpotWars() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data, error } = await supabase.rpc('spot_wars_leaderboard', {
        p_limit: 10,
      })
      if (!active) return
      if (error) {
        console.warn('[spot-wars] failed:', error.message)
        setErr('Classement indisponible')
        return
      }
      setRows((data ?? []) as Row[])
    })()
    return () => {
      active = false
    }
  }, [])

  return (
    <section className="px-4 pb-8">
      <header className="mb-4 mt-2 flex items-start gap-3">
        <div
          className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl"
          style={{
            background: 'rgba(232,32,58,0.12)',
            border: '1px solid rgba(232,32,58,0.40)',
            boxShadow: '0 0 18px rgba(232,32,58,0.25)',
          }}
        >
          <Swords className="h-5 w-5 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="display-xl text-fg" style={{ fontSize: '24px' }}>
            Spot Wars
          </h1>
          <p className="mt-1 text-[12px] text-fg2">
            Classement hebdomadaire des villes · démarré {weekStartLabel()}
          </p>
        </div>
      </header>

      {err ? (
        <p className="rounded-2xl bg-card p-5 text-center text-sm text-fg2"
           style={{ border: '1px solid var(--color-border)' }}>
          {err}
        </p>
      ) : rows === null ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p
          className="rounded-3xl bg-card p-6 text-center text-sm text-fg2"
          style={{ border: '1px solid var(--color-border)' }}
        >
          Aucun spot cette semaine. Soyez les premiers à mettre votre ville
          sur la carte.
        </p>
      ) : (
        <ol className="space-y-2">
          {rows.map((r) => {
            const isTop = r.rank === 1
            const isPodium = r.rank <= 3
            return (
              <li
                key={r.city}
                className="relative overflow-hidden rounded-2xl"
                style={
                  isTop
                    ? {
                        background:
                          'linear-gradient(95deg, rgba(212,175,55,0.18) 0%, rgba(15,15,15,0.95) 65%)',
                        border: '1px solid rgba(212,175,55,0.45)',
                        boxShadow: '0 6px 22px rgba(212,175,55,0.18)',
                      }
                    : r.rank === 2
                      ? {
                          background:
                            'linear-gradient(95deg, rgba(192,192,192,0.14) 0%, rgba(15,15,15,0.95) 70%)',
                          border: '1px solid rgba(192,192,192,0.30)',
                        }
                      : r.rank === 3
                        ? {
                            background:
                              'linear-gradient(95deg, rgba(205,127,50,0.14) 0%, rgba(15,15,15,0.95) 70%)',
                            border: '1px solid rgba(205,127,50,0.32)',
                          }
                        : {
                            background: 'rgb(var(--color-card))',
                            border: '1px solid var(--color-border)',
                          }
                }
              >
                {/* Relative progress bar — full width slice underneath. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 left-0"
                  style={{
                    width: `${Math.max(8, Math.min(100, Number(r.total_pct)))}%`,
                    background: isPodium
                      ? `linear-gradient(90deg, rgba(232,32,58,0.10) 0%, transparent 100%)`
                      : `linear-gradient(90deg, rgba(232,32,58,0.06) 0%, transparent 100%)`,
                  }}
                />
                <div className="relative flex items-center gap-3 px-3 py-3">
                  <span
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-full font-display text-base font-extrabold tracking-tighter"
                    style={{
                      background: isTop
                        ? 'rgba(212,175,55,0.20)'
                        : 'rgb(var(--color-fg) / 0.06)',
                      color: isTop
                        ? '#FFD700'
                        : r.rank === 2
                          ? '#C0C0C0'
                          : r.rank === 3
                            ? '#CD7F32'
                            : 'rgb(var(--color-fg-2))',
                      border: isTop
                        ? '1px solid rgba(212,175,55,0.55)'
                        : '1px solid rgb(var(--color-fg) / 0.08)',
                    }}
                  >
                    {isTop ? <Crown className="h-4 w-4" /> : r.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-base font-extrabold tracking-tighter text-fg">
                      {r.city}
                    </p>
                    <p className="mt-0.5 text-[11px] text-fg2">
                      {r.total_pct}% du leader
                    </p>
                  </div>
                  <span
                    className="flex-none font-display text-xl font-extrabold tracking-tighter"
                    style={{ color: isPodium ? '#FFD700' : 'rgb(var(--color-fg))' }}
                  >
                    {r.spots_week}
                    <span className="ml-1 text-[10px] font-bold tracking-wider text-fg2">
                      spot{r.spots_week > 1 ? 's' : ''}
                    </span>
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <p className="label-up mt-5 text-center text-[10px] text-fg2/70">
        Reset chaque lundi à minuit · basé sur la ville de chaque spotter
      </p>
    </section>
  )
}
