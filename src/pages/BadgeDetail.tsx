import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Lock } from 'lucide-react'
import {
  CATEGORY_LABEL,
  computeUnlocks,
  findBadge,
  type Badge,
} from '../lib/badges'
import { useBadgeContext } from '../hooks/useBadgeContext'
import { Skeleton } from '../components/Skeleton'
import Confetti from '../components/Confetti'

const SEEN_KEY = 'revs.seen-badges'

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function markSeen(slug: string) {
  try {
    const set = readSeen()
    if (set.has(slug)) return
    set.add(slug)
    localStorage.setItem(SEEN_KEY, JSON.stringify([...set]))
  } catch {
    // ignore
  }
}

export default function BadgeDetail() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const ctx = useBadgeContext()

  const badge: Badge | null = useMemo(() => {
    if (!slug) return null
    return findBadge(slug)
  }, [slug])

  const unlocked = useMemo(() => {
    if (!ctx || !slug) return false
    return computeUnlocks(ctx).has(slug)
  }, [ctx, slug])

  // Confetti the FIRST time the user lands on the detail page for a
  // badge they've unlocked. Persisted in localStorage so each badge
  // celebrates exactly once, ever.
  const [celebrate, setCelebrate] = useState(0)
  useEffect(() => {
    if (!unlocked || !slug) return
    const seen = readSeen()
    if (seen.has(slug)) return
    markSeen(slug)
    setCelebrate((n) => n + 1)
  }, [unlocked, slug])

  if (!badge) {
    return (
      <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
        <div className="flex items-center gap-4 py-4">
          <button
            onClick={() => navigate(-1)}
            aria-label="Retour"
            className="text-fg/60 hover:text-fg"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <h1 className="font-display text-2xl font-bold">Badge introuvable</h1>
        </div>
        <p className="text-sm text-fg/50">
          Ce badge n'existe pas (ou plus). Retour à la galerie ?
        </p>
        <button
          onClick={() => navigate('/badges')}
          className="mt-4 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-fg"
        >
          Voir tous les badges
        </button>
      </div>
    )
  }

  const isGold = !!badge.gold

  return (
    <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      {celebrate > 0 && <Confetti key={celebrate} />}
      <div className="flex items-center gap-4 py-4">
        <button
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="tappable text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="font-display text-xl font-extrabold tracking-tighter text-fg">
          Badge
        </h1>
      </div>

      <div className="flex flex-col items-center pt-4">
        {/* Emoji hero — disque avec ring gradient + halo coloré */}
        <div
          className="flex h-36 w-36 items-center justify-center rounded-full p-1"
          style={
            unlocked
              ? isGold
                ? {
                    background:
                      'conic-gradient(from 220deg, #E0B341 0%, #b8860b 30%, #E0B341 60%, #ffd700 100%)',
                    boxShadow: '0 12px 38px rgba(224,179,65,0.32)',
                  }
                : {
                    background:
                      'conic-gradient(from 220deg, #E8203A 0%, #b91528 25%, #4a0f16 55%, #E8203A 100%)',
                    boxShadow: '0 12px 38px rgba(232,32,58,0.32)',
                  }
              : {
                  background: 'rgb(var(--color-card))',
                  border: '1px solid var(--color-border)',
                }
          }
        >
          <div
            className="flex h-full w-full items-center justify-center rounded-full text-6xl"
            style={
              unlocked
                ? {
                    background: isGold
                      ? 'radial-gradient(circle at 30% 30%, rgba(224,179,65,0.25), #0a0a0a 70%)'
                      : 'radial-gradient(circle at 30% 30%, rgba(232,32,58,0.18), #0a0a0a 70%)',
                  }
                : { background: 'rgb(var(--color-bg))' }
            }
          >
            {unlocked ? badge.emoji : <Lock className="h-12 w-12 text-fg2/40" />}
          </div>
        </div>

        <h2
          className={`mt-5 font-display text-3xl font-extrabold tracking-tighter ${
            unlocked && isGold ? 'text-[#E0B341]' : 'text-fg'
          }`}
        >
          {badge.name}
        </h2>

        <span
          className="label-up mt-2 rounded-full bg-card px-3 py-1 text-[10px] text-fg2"
          style={{ border: '1px solid var(--color-border)' }}
        >
          {CATEGORY_LABEL[badge.category]}
        </span>

        <p className="mt-4 max-w-xs text-center text-sm text-fg2">
          {badge.desc}
        </p>

        {ctx === null ? (
          <Skeleton className="mt-6 h-32 w-full max-w-sm rounded-3xl" />
        ) : (
          <div className="mt-6 w-full max-w-sm space-y-3">
            <div
              className="rounded-3xl bg-card p-4"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <p className="label-up text-[10px] text-fg2">
                Comment l'obtenir
              </p>
              <p className="mt-1 text-sm font-medium text-fg">
                {badge.condition}
              </p>
            </div>

            {badge.xp != null && (
              <div
                className="flex items-center justify-between rounded-3xl bg-card p-4"
                style={{ border: '1px solid var(--color-border)' }}
              >
                <span className="label-up text-[10px] text-fg2">
                  Récompense XP
                </span>
                <span className="font-display text-2xl font-extrabold tracking-tighter text-accent">
                  +{badge.xp}
                </span>
              </div>
            )}

            <div
              className="flex items-center justify-between rounded-3xl bg-card p-4"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <span className="label-up text-[10px] text-fg2">Statut</span>
              {unlocked ? (
                <span className="flex items-center gap-1.5 text-sm font-extrabold tracking-wider text-green-400">
                  <Check className="h-4 w-4" />
                  DÉBLOQUÉ
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-sm font-bold tracking-wider text-fg2">
                  <Lock className="h-4 w-4" />
                  VERROUILLÉ
                </span>
              )}
            </div>
          </div>
        )}

        {!unlocked && ctx && (
          <p className="mt-6 max-w-xs text-center text-xs text-fg2">
            Continue à explorer et à spotter pour débloquer ce badge.
          </p>
        )}
      </div>
    </div>
  )
}
