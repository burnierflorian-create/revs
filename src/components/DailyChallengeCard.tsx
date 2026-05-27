import { useEffect, useState } from 'react'
import { Check, Loader2, Target, Zap } from 'lucide-react'
import {
  claimDailyChallenge,
  fetchDailyChallenge,
  type DailyChallenge,
  type DailyChallengeContext,
} from '../lib/dailyChallenge'
import { floatXp } from './XpFloater'
import { Skeleton } from './Skeleton'

/** "Défi du jour" card. Generated lazily once per day per user via the
 *  car-info?action=daily-challenge endpoint and claimed by tapping the
 *  inline "Relevé !" button. Honour-system on the verification — the
 *  user themselves attests completion; the RPC is single-shot per
 *  (user, date) so they can't double-claim. */
export default function DailyChallengeCard({
  context,
}: {
  context: DailyChallengeContext
}) {
  const [data, setData] = useState<DailyChallenge | null>(null)
  const [loading, setLoading] = useState(true)
  const [claiming, setClaiming] = useState(false)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchDailyChallenge(context)
      .then((d) => {
        if (!active) return
        if (!d) setErrored(true)
        else setData(d)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
    // The context object is rebuilt every render but its meaningful
    // pieces are stable for the lifetime of Home — fetching once on
    // mount is enough. Re-fetch if pseudo/city/top brands change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.pseudo, context.city, context.last_car])

  async function onClaim() {
    if (claiming || !data || data.completed_at) return
    setClaiming(true)
    const { ok, xp_reward } = await claimDailyChallenge()
    setClaiming(false)
    if (ok) {
      floatXp(xp_reward)
      setData({
        ...data,
        completed_at: new Date().toISOString(),
      })
    }
  }

  if (loading && !data) {
    return (
      <section
        className="overflow-hidden rounded-[20px] p-4"
        style={{
          background:
            'linear-gradient(155deg, #4a2a08 0%, #2e1804 55%, #150b02 100%)',
          border: '1px solid rgba(245,158,11,0.30)',
        }}
      >
        <div className="flex items-center gap-2 text-sm text-white/70">
          <Loader2 className="h-4 w-4 animate-spin" />
          Génération du défi…
        </div>
        <Skeleton className="mt-3 h-5 w-3/4 rounded" />
      </section>
    )
  }
  if (errored || !data) return null

  const done = data.completed_at !== null
  return (
    <section
      className="relative overflow-hidden rounded-[20px]"
      style={{
        background: done
          ? 'linear-gradient(155deg, rgba(34,197,94,0.20) 0%, rgba(20,40,25,0.95) 60%, rgba(10,10,10,0.95) 100%)'
          : 'linear-gradient(155deg, rgba(245,158,11,0.20) 0%, rgba(40,28,8,0.95) 60%, rgba(10,10,10,0.95) 100%)',
        border: done
          ? '1px solid rgba(34,197,94,0.45)'
          : '1px solid rgba(245,158,11,0.40)',
        boxShadow: done
          ? '0 12px 32px rgba(34,197,94,0.15)'
          : '0 12px 32px rgba(245,158,11,0.18)',
      }}
    >
      <div className="relative px-4 py-4">
        <div className="flex items-start gap-3">
          <div
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full"
            style={{
              background: done
                ? 'rgba(34,197,94,0.22)'
                : 'rgba(245,158,11,0.22)',
              border: done
                ? '1px solid rgba(34,197,94,0.55)'
                : '1px solid rgba(245,158,11,0.55)',
            }}
          >
            {done ? (
              <Check className="h-4 w-4 text-green-300" />
            ) : (
              <Target className="h-4 w-4 text-[#FFD27A]" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="label-up text-[9px] text-white/65">
              {done ? 'Défi du jour · complété' : 'Défi du jour'}
            </p>
            <p
              className="mt-1 leading-snug text-white"
              style={{ fontSize: '15px', fontWeight: 600 }}
            >
              {data.objective}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span
            className="inline-flex items-center gap-1 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-extrabold tracking-wider text-white backdrop-blur"
            style={{ border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <Zap className="h-3 w-3 text-accent" />+{data.xp_reward} XP
          </span>
          {done ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-green-500/15 px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider text-green-300"
              style={{ border: '1px solid rgba(34,197,94,0.45)' }}
            >
              <Check className="h-3.5 w-3.5" /> Relevé
            </span>
          ) : (
            <button
              onClick={onClaim}
              disabled={claiming}
              className="tappable inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider text-fg disabled:opacity-50"
              style={{ boxShadow: '0 6px 18px rgba(232,32,58,0.45)' }}
            >
              {claiming ? '…' : 'RELEVÉ !'}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
