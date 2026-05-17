import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { GP_2026, fmtGpDate } from '../lib/f1'

export default function F1Calendar() {
  const navigate = useNavigate()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const nextIndex = GP_2026.findIndex(
    (g) => new Date(g.date).getTime() >= now,
  )

  function countdown(iso: string): string {
    const diff = new Date(iso).getTime() - now
    if (diff <= 0) return ''
    const d = Math.floor(diff / 86400000)
    const h = Math.floor((diff % 86400000) / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    return `${d}j ${h}h ${m}min`
  }

  return (
    <section className="pb-2 pt-3">
      <div className="space-y-2">
        {GP_2026.map((g, i) => {
          const isPast = new Date(g.date).getTime() < now
          const isNext = i === nextIndex
          return (
            <button
              key={g.round}
              onClick={() => navigate(`/f1/${g.round}`)}
              className={`w-full rounded-2xl border p-4 text-left transition-colors active:scale-[0.99] ${
                isNext
                  ? 'border-accent bg-accent/10'
                  : isPast
                    ? 'border-white/5 bg-card opacity-40'
                    : 'border-white/5 bg-card hover:bg-white/5'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-xl leading-none">{g.flag}</span>
                  <span className="truncate font-semibold text-fg">
                    {g.name}
                  </span>
                </div>
                {isNext ? (
                  <span className="flex-none rounded-full bg-accent px-2.5 py-1 text-[10px] font-bold tracking-wide text-fg">
                    PROCHAIN
                  </span>
                ) : (
                  <ChevronRight className="h-4 w-4 flex-none text-fg/30" />
                )}
              </div>

              <p className="mt-1 text-xs text-fg/50">
                {g.country} · {g.circuit}
              </p>

              <div className="mt-2 flex items-center justify-between">
                <span
                  className={`text-sm ${isNext ? 'text-accent' : 'text-fg/60'}`}
                >
                  {fmtGpDate(g.date)}
                </span>
                {isNext && (
                  <span className="text-sm font-semibold text-accent">
                    {countdown(g.date)}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
