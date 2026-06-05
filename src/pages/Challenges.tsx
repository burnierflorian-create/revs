import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Target, Check } from 'lucide-react'
import {
  challengePct,
  fetchActiveChallenges,
  type Challenge,
} from '../lib/challenges'
import { Skeleton } from '../components/Skeleton'

function endsAtLabel(iso: string): string {
  const end = new Date(iso)
  const now = new Date()
  const diffMs = end.getTime() - now.getTime()
  const days = Math.max(0, Math.ceil(diffMs / 86_400_000))
  if (days === 0) return 'se termine aujourd’hui'
  if (days === 1) return 'reste 1 jour'
  return `reste ${days} jours`
}

export default function Challenges() {
  const navigate = useNavigate()
  const [items, setItems] = useState<Challenge[] | null>(null)

  useEffect(() => {
    let active = true
    fetchActiveChallenges().then((r) => {
      if (active) setItems(r)
    })
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="flex items-center gap-4 py-4">
        <button
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="tappable text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="flex items-center gap-2 display-xl text-fg">
          <Target className="h-7 w-7 text-accent" />
          Challenges
        </h1>
      </div>

      <p className="mb-5 text-sm text-fg2">
        3 défis renouvelés chaque lundi. Complète-les avant la fin de la
        semaine pour empocher l'XP.
      </p>

      {items === null ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-3xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center px-8 py-16 text-center">
          <p className="font-display text-2xl">🏆</p>
          <p className="mt-3 font-display text-lg font-extrabold tracking-tighter text-fg">
            Tous les challenges complétés
          </p>
          <p className="mt-1 text-sm text-fg2">
            De nouveaux arrivent lundi matin.
          </p>
        </div>
      ) : (
        <div className="space-y-3 pb-12">
          {items.map((c) => {
            const pct = challengePct(c)
            // `claimed` is now driven by the auto_claim trigger on
            // spots; `completed && !claimed` is a transient post-
            // insert window that the next page refresh clears.
            const done = c.claimed || c.completed
            return (
              <div
                key={c.id}
                className="relative overflow-hidden rounded-3xl bg-card p-5"
                style={{
                  border: done
                    ? '1px solid rgba(34,197,94,0.35)'
                    : '1px solid var(--color-border)',
                  background: done ? 'rgba(34,197,94,0.06)' : undefined,
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-base font-extrabold tracking-tighter text-fg">
                      {c.title}
                    </p>
                    <p className="mt-1 text-sm text-fg2">{c.description}</p>
                  </div>
                  <span className="flex-none rounded-full bg-accent px-2.5 py-1 text-[10px] font-extrabold tracking-wider text-fg">
                    +{c.xp_reward} XP
                  </span>
                </div>

                <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-fg/[0.08]">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ease-out ${
                      done ? 'bg-green-500' : 'bg-accent'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="mt-2.5 flex items-center justify-between">
                  <span className="label-up text-[10px] text-fg2">
                    {c.progress}/{c.target_value} · {endsAtLabel(c.ends_at)}
                  </span>
                  {done && (
                    <span className="flex items-center gap-1 text-[11px] font-extrabold tracking-wider text-green-400">
                      <Check className="h-3.5 w-3.5" />
                      COMPLÉTÉ
                    </span>
                  )}
                </div>

                {!done && (
                  <button
                    onClick={() => navigate('/new-spot')}
                    className="tappable mt-4 w-full rounded-full bg-fg/[0.06] py-3 text-sm font-bold tracking-wide text-fg/80 hover:bg-fg/[0.10]"
                    style={{ border: '1px solid var(--color-border)' }}
                  >
                    Continuer le défi
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
