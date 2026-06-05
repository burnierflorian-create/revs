import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Lock, Trophy } from 'lucide-react'
import {
  allBadges,
  computeUnlocks,
  CATEGORY_LABEL,
  type Badge,
  type BadgeCategory,
} from '../lib/badges'
import { useBadgeContext } from '../hooks/useBadgeContext'
import { Skeleton } from '../components/Skeleton'

const CATEGORY_ORDER: BadgeCategory[] = [
  'spots',
  'streak',
  'discovery',
  'community',
  'premium',
  'brands',
  'special',
]

export default function Badges() {
  const navigate = useNavigate()
  const ctx = useBadgeContext()

  const data = useMemo(() => {
    if (!ctx) return null
    const list = allBadges(ctx)
    const unlocks = computeUnlocks(ctx)
    const byCat = new Map<BadgeCategory, Badge[]>()
    for (const b of list) {
      const arr = byCat.get(b.category) ?? []
      arr.push(b)
      byCat.set(b.category, arr)
    }
    for (const arr of byCat.values()) {
      arr.sort((a, b) => {
        const ua = unlocks.has(a.slug) ? 0 : 1
        const ub = unlocks.has(b.slug) ? 0 : 1
        if (ua !== ub) return ua - ub
        return (a.order ?? 99) - (b.order ?? 99)
      })
    }
    return {
      byCat,
      unlocks,
      totalUnlocked: list.filter((b) => unlocks.has(b.slug)).length,
      total: list.length,
    }
  }, [ctx])

  const pct = data
    ? Math.round((data.totalUnlocked / Math.max(1, data.total)) * 100)
    : 0

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
          <Trophy className="h-7 w-7 text-accent" />
          Badges
        </h1>
      </div>

      {/* Progression compteur — gros chiffre + barre */}
      {data && (
        <section
          className="mb-6 rounded-3xl bg-card p-5"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <div className="flex items-baseline justify-between">
            <span className="label-up text-[10px] text-fg2">Progression</span>
            <span className="font-display text-3xl font-extrabold tracking-tighter text-fg">
              {data.totalUnlocked}
              <span className="ml-1 text-sm text-fg2">/{data.total}</span>
            </span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-fg/[0.08]">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
              style={{
                width: `${pct}%`,
                boxShadow: '0 0 12px rgba(232,32,58,0.45)',
              }}
            />
          </div>
          <p className="mt-2 text-xs text-fg2">
            {pct < 25
              ? 'Tu commences à peine — chaque spot rapproche du suivant.'
              : pct < 60
                ? 'Belle collection en construction.'
                : pct < 90
                  ? 'Tu touches presque la complétion.'
                  : 'Collection quasi parfaite 👑'}
          </p>
        </section>
      )}

      {data === null ? (
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-3xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-7 pb-12">
          {CATEGORY_ORDER.map((cat) => {
            const items = data.byCat.get(cat) ?? []
            if (items.length === 0) return null
            const unlockedInCat = items.filter((b) =>
              data.unlocks.has(b.slug),
            ).length
            return (
              <section key={cat}>
                <h2 className="mb-3 flex items-baseline justify-between px-1">
                  <span className="font-display text-lg font-extrabold tracking-tighter text-fg">
                    {CATEGORY_LABEL[cat]}
                  </span>
                  <span className="label-up text-[10px] text-fg2">
                    {unlockedInCat}/{items.length}
                  </span>
                </h2>
                <div className="grid grid-cols-4 gap-1.5">
                  {items.map((b) => {
                    const isUnlocked = data.unlocks.has(b.slug)
                    return (
                      <button
                        key={b.slug}
                        onClick={() => navigate(`/badges/${b.slug}`)}
                        className="tappable relative flex flex-col items-center gap-1.5 rounded-2xl px-1 py-3 text-center"
                        style={{
                          background: isUnlocked
                            ? b.gold
                              ? 'rgba(224,179,65,0.12)'
                              : 'rgba(232,32,58,0.08)'
                            : 'rgb(var(--color-card))',
                          border: isUnlocked
                            ? b.gold
                              ? '1px solid rgba(224,179,65,0.4)'
                              : '1px solid rgba(232,32,58,0.3)'
                            : '1px solid var(--color-border)',
                          boxShadow: isUnlocked
                            ? b.gold
                              ? '0 0 22px rgba(224,179,65,0.22)'
                              : '0 0 20px rgba(232,32,58,0.18)'
                            : undefined,
                        }}
                      >
                        {isUnlocked ? (
                          <span className="text-2xl">{b.emoji}</span>
                        ) : (
                          <span className="flex h-7 items-center justify-center">
                            <Lock className="h-4 w-4 text-fg2/50" />
                          </span>
                        )}
                        <span
                          className={`text-[10px] font-semibold leading-tight ${
                            isUnlocked
                              ? b.gold
                                ? 'text-[#E0B341]'
                                : 'text-accent'
                              : 'text-fg2/60'
                          }`}
                        >
                          {b.name}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
