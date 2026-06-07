import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GP_2026, fmtGpDate } from '../lib/f1'
import { supabase } from '../lib/supabase'

type RaceRow = {
  round: number
  data: { podium?: { driver: string }[] } | null
}

// Minimalist "race bible" scoreboard — no gray boxes, no circuit-photo
// backgrounds. Each GP is a clean row: square mini-flag · name + circuit ·
// a faint status label far right. The current-week GP glows subtly amber.
export default function F1Calendar() {
  const navigate = useNavigate()
  const [now, setNow] = useState(() => Date.now())
  const [winners, setWinners] = useState<Record<number, string>>({})

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('f1_race_results')
        .select('round, data')
      if (!active) return
      const m: Record<number, string> = {}
      for (const r of (data ?? []) as RaceRow[]) {
        const w = r.data?.podium?.[0]?.driver
        if (w && w !== 'N/A') m[r.round] = w
      }
      setWinners(m)
    })()
    return () => {
      active = false
    }
  }, [])

  const nextIndex = GP_2026.findIndex((g) => new Date(g.date).getTime() >= now)

  return (
    <section className="pt-1">
      {GP_2026.map((g, i) => {
        const isPast = new Date(g.date).getTime() < now
        const isNext = i === nextIndex
        const winner = winners[g.round]
        return (
          <button
            key={g.round}
            onClick={() => navigate(`/f1/${g.round}`)}
            className="tappable flex w-full items-center gap-3.5 py-3 text-left"
            style={{ borderBottom: '1px solid var(--color-divider)' }}
          >
            {/* Discreet square flag */}
            <span
              className="flex h-7 w-7 flex-none items-center justify-center overflow-hidden rounded-[5px] text-lg leading-none"
              style={{ background: 'rgb(var(--color-fg) / 0.05)' }}
            >
              {g.flag}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold tracking-tight text-fg">
                {g.name}
              </p>
              <p
                className="truncate text-[12px]"
                style={
                  isNext
                    ? {
                        color: '#FCD34D',
                        textShadow: '0 0 10px rgba(252,211,77,0.35)',
                      }
                    : { color: 'rgb(var(--color-fg) / 0.5)' }
                }
              >
                {g.circuit}
                {isPast && winner ? ` · 🏆 ${winner}` : ''}
              </p>
            </div>

            <div className="flex-none pl-2 text-right">
              {isPast ? (
                <span
                  className="text-[10px] font-medium uppercase tracking-wide"
                  style={{ color: 'rgb(var(--color-fg) / 0.4)' }}
                >
                  Terminé
                </span>
              ) : (
                <span
                  className={`text-[12px] tabular-nums ${isNext ? 'font-semibold' : ''}`}
                  style={
                    isNext
                      ? { color: '#FCD34D' }
                      : { color: 'rgb(var(--color-fg) / 0.5)' }
                  }
                >
                  {fmtGpDate(g.date)}
                </span>
              )}
            </div>
          </button>
        )
      })}
    </section>
  )
}
