import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GP_2026, fmtGpDate } from '../lib/f1'
import { supabase } from '../lib/supabase'

type CircuitRow = { round: number; url: string }
type RaceRow = {
  round: number
  data: { podium?: { driver: string }[] } | null
}

export default function F1Calendar() {
  const navigate = useNavigate()
  const [now, setNow] = useState(() => Date.now())
  const [images, setImages] = useState<Record<number, string>>({})
  const [winners, setWinners] = useState<Record<number, string>>({})

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Single shot fetch on mount — both tables are small (24 rows max each)
  // and public-read so RLS doesn't slow anything down.
  useEffect(() => {
    let active = true
    ;(async () => {
      const [imgRes, raceRes] = await Promise.all([
        supabase.from('f1_circuit_images').select('round, url'),
        supabase.from('f1_race_results').select('round, data'),
      ])
      if (!active) return
      const imgMap: Record<number, string> = {}
      for (const r of (imgRes.data ?? []) as CircuitRow[]) {
        imgMap[r.round] = r.url
      }
      setImages(imgMap)
      const winMap: Record<number, string> = {}
      for (const r of (raceRes.data ?? []) as RaceRow[]) {
        const w = r.data?.podium?.[0]?.driver
        if (w && w !== 'N/A') winMap[r.round] = w
      }
      setWinners(winMap)
    })()
    return () => {
      active = false
    }
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
      <div className="space-y-2.5">
        {GP_2026.map((g, i) => {
          const isPast = new Date(g.date).getTime() < now
          const isNext = i === nextIndex
          const photo = images[g.round]
          const winner = winners[g.round]
          return (
            <button
              key={g.round}
              onClick={() => navigate(`/f1/${g.round}`)}
              className="tappable relative block w-full overflow-hidden rounded-2xl text-left"
              style={{
                border: isNext
                  ? '1px solid rgba(232,32,58,0.50)'
                  : '1px solid var(--color-border)',
                boxShadow: isNext
                  ? '0 8px 28px rgba(232,32,58,0.22)'
                  : undefined,
              }}
            >
              {/* Layer 1 — circuit photo bg (blurred + dimmed), or
                  fallback to a plain card surface when no image cached
                  yet. Past GPs are extra dimmed so the visual hierarchy
                  reads "upcoming > next > done" at a glance. */}
              {photo ? (
                <>
                  <img
                    src={photo}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover"
                    style={{
                      filter: isPast
                        ? 'blur(10px) brightness(0.30) saturate(0.85)'
                        : 'blur(10px) brightness(0.50)',
                      transform: 'scale(1.1)',
                    }}
                  />
                  <div
                    aria-hidden
                    className="absolute inset-0"
                    style={{
                      background: isNext
                        ? 'linear-gradient(155deg, rgba(232,32,58,0.32) 0%, rgba(20,20,20,0.85) 60%, rgba(10,10,10,0.95) 100%)'
                        : 'linear-gradient(155deg, rgba(20,20,20,0.55) 0%, rgba(15,15,15,0.85) 70%, rgba(10,10,10,0.95) 100%)',
                    }}
                  />
                </>
              ) : (
                <div
                  aria-hidden
                  className="absolute inset-0 bg-card"
                  style={{
                    background: isNext
                      ? 'linear-gradient(155deg, rgba(232,32,58,0.20) 0%, rgb(var(--color-card)) 70%)'
                      : 'rgb(var(--color-card))',
                  }}
                />
              )}

              {/* Layer 2 — content */}
              <div className="relative flex items-center gap-3 p-4">
                <span className="flex-none text-4xl leading-none">
                  {g.flag}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate font-display leading-tight tracking-tighter text-fg"
                    style={{ fontSize: '16px', fontWeight: 800 }}
                  >
                    {g.name}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-fg/55">
                    {g.circuit}
                  </p>
                  <p
                    className={`mt-1 text-[12px] ${isNext ? 'font-bold text-accent' : 'text-fg/55'}`}
                  >
                    {fmtGpDate(g.date)}
                    {isNext && (
                      <span className="ml-2 font-semibold text-accent">
                        · {countdown(g.date)}
                      </span>
                    )}
                    {isPast && winner && (
                      <span className="ml-2 text-fg/65">· 🏆 {winner}</span>
                    )}
                  </p>
                </div>

                {isNext ? (
                  <span
                    className="label-up flex-none rounded-full bg-accent px-2.5 py-1 text-[10px] text-fg"
                    style={{
                      boxShadow: '0 0 14px rgba(232,32,58,0.65)',
                      animation: 'next-gp-pulse 2s ease-in-out infinite',
                    }}
                  >
                    PROCHAIN
                  </span>
                ) : isPast ? (
                  <span
                    className="label-up flex-none rounded-full px-2.5 py-1 text-[10px] text-fg/55"
                    style={{
                      background: 'rgb(var(--color-fg) / 0.06)',
                      border: '1px solid rgb(var(--color-fg) / 0.10)',
                    }}
                  >
                    TERMINÉ
                  </span>
                ) : null}
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
