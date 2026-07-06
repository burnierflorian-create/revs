import { useMemo, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Lock } from 'lucide-react'
import {
  allBadges,
  computeUnlocks,
  type Badge,
  type BadgeContext,
} from '../lib/badges'
import { badgeIcon } from '../lib/customIcons'
import { useBadgeContext } from '../hooks/useBadgeContext'
import { Skeleton } from '../components/Skeleton'

// ───────────────────── progress / date helpers ─────────────────────

/** Best-effort progress for the countable badges, used for the locked
 *  progress bar (e.g. "3/10 spots"). Returns null for badges whose
 *  progress can't be expressed as a simple current/target ratio. */
function badgeProgress(
  b: Badge,
  ctx: BadgeContext,
): { current: number; target: number; unit: string } | null {
  const spots = ctx.spots
  const total = spots.length
  const brands = new Set(
    spots.map((s) => (s.brand ?? '').toLowerCase().trim()).filter(Boolean),
  ).size
  const priced = (min: number) =>
    spots.filter((s) => (s.estimated_price ?? 0) >= min).length
  const streak = maxStreakDays(ctx.daysWithSpot)

  switch (b.slug) {
    case 'premier-spot':
      return { current: Math.min(total, 1), target: 1, unit: 'spot' }
    case 'serie-10':
      return { current: Math.min(total, 10), target: 10, unit: 'spots' }
    case 'centurion':
      return { current: Math.min(total, 100), target: 100, unit: 'spots' }
    case 'photographe':
      return {
        current: Math.min(ctx.likesReceived, 50),
        target: 50,
        unit: 'likes',
      }
    case 'social-10':
      return { current: Math.min(ctx.followers, 10), target: 10, unit: 'abonnés' }
    case 'influenceur':
      return { current: Math.min(ctx.followers, 50), target: 50, unit: 'abonnés' }
    case 'collectionneur':
      return { current: Math.min(brands, 10), target: 10, unit: 'marques' }
    case 'streak-7':
      return { current: Math.min(streak, 7), target: 7, unit: 'jours' }
    case 'streak-30':
      return { current: Math.min(streak, 30), target: 30, unit: 'jours' }
    case 'supercar-spotter':
      return { current: Math.min(priced(80_000), 10), target: 10, unit: 'spots' }
    case 'hypercar-hunter':
      return { current: Math.min(priced(200_000), 5), target: 5, unit: 'spots' }
    default:
      return null
  }
}

/** Longest consecutive-day streak — mirrors the lib's maxStreak. */
function maxStreakDays(daysSet: Set<string>): number {
  if (daysSet.size === 0) return 0
  const list = [...daysSet].sort()
  let best = 1
  let cur = 1
  for (let i = 1; i < list.length; i += 1) {
    const prev = new Date(list[i - 1] + 'T00:00:00Z').getTime()
    const here = new Date(list[i] + 'T00:00:00Z').getTime()
    if (Math.round((here - prev) / 86_400_000) === 1) {
      cur += 1
      best = Math.max(best, cur)
    } else {
      cur = 1
    }
  }
  return best
}

/** For the spot-count milestone badges we can derive the exact day the
 *  badge was earned = the date the Nth oldest spot was posted. Returns a
 *  formatted fr-FR date, or null when not derivable. */
function badgeObtainedDate(b: Badge, ctx: BadgeContext): string | null {
  const n =
    b.slug === 'premier-spot'
      ? 1
      : b.slug === 'serie-10'
        ? 10
        : b.slug === 'centurion'
          ? 100
          : null
  if (n === null) return null
  // ctx.spots is newest-first; the Nth oldest is at length - n.
  const idx = ctx.spots.length - n
  if (idx < 0) return null
  const at = ctx.spots[idx]?.created_at
  if (!at) return null
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(at))
}

// ─────────────────────────── page ───────────────────────────

export default function Badges() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const ctx = useBadgeContext()
  const [selected, setSelected] = useState<Badge | null>(null)

  const data = useMemo(() => {
    if (!ctx) return null
    const list = allBadges(ctx)
    const unlocks = computeUnlocks(ctx)
    const sortByOrder = (a: Badge, b: Badge) =>
      (a.order ?? 99) - (b.order ?? 99)
    const unlocked = list.filter((b) => unlocks.has(b.slug)).sort(sortByOrder)
    const locked = list.filter((b) => !unlocks.has(b.slug)).sort(sortByOrder)
    return { unlocks, unlocked, locked, total: list.length }
  }, [ctx])

  return (
    <div
      className="min-h-screen px-4 pt-[max(1rem,env(safe-area-inset-top))]"
      style={{ background: '#0a0a0a', color: '#fff' }}
    >
      <div className="flex items-center gap-4 py-4">
        <button
          onClick={() => navigate(-1)}
          aria-label={t('gamif.back')}
          className="tappable text-white/60 hover:text-white"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="font-display text-2xl font-extrabold tracking-tight">
          {t('gamif.myBadges')}
        </h1>
        {data && (
          <span
            className="ml-auto font-display text-sm font-extrabold"
            style={{ color: '#E8203A' }}
          >
            {t('gamif.unlockedCount', {
              count: data.total,
              current: data.unlocked.length,
              total: data.total,
            })}
          </span>
        )}
      </div>

      {data === null ? (
        <div className="grid grid-cols-3 gap-3 pt-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-8 pb-16">
          {data.unlocked.length > 0 && (
            <BadgeSection
              title={t('gamif.sectionUnlocked')}
              badges={data.unlocked}
              unlocked
              onTap={setSelected}
            />
          )}
          {data.locked.length > 0 && (
            <BadgeSection
              title={t('gamif.sectionToUnlock')}
              badges={data.locked}
              unlocked={false}
              onTap={setSelected}
            />
          )}
        </div>
      )}

      {selected && ctx && (
        <BadgeSheet
          badge={selected}
          unlocked={!!data?.unlocks.has(selected.slug)}
          ctx={ctx}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

// ─────────────────────────── section ───────────────────────────

function BadgeSection({
  title,
  badges,
  unlocked,
  onTap,
}: {
  title: string
  badges: Badge[]
  unlocked: boolean
  onTap: (b: Badge) => void
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="font-display text-lg font-extrabold tracking-tight">
          {title}
        </h2>
        <span className="text-sm font-bold text-white/40">{badges.length}</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {badges.map((b) => (
          <button
            key={b.slug}
            onClick={() => onTap(b)}
            className="tappable relative flex aspect-square flex-col items-center justify-center gap-2 px-1 text-center transition-transform active:scale-[0.96]"
            style={{
              borderRadius: '16px',
              background: unlocked ? '#141414' : '#0d0d0d',
              border: '1px solid #333',
            }}
            aria-label={b.name}
          >
            {!unlocked && (
              <Lock
                className="absolute right-2 top-2 h-3.5 w-3.5 text-white/30"
                strokeWidth={2.2}
              />
            )}
            {badgeIcon(b.slug) ? (
              <img
                src={badgeIcon(b.slug)}
                alt=""
                className="h-9 w-9 rounded-xl object-cover"
                style={{
                  opacity: unlocked ? 1 : 0.3,
                  filter: unlocked ? undefined : 'grayscale(1)',
                }}
              />
            ) : (
              <span
                style={{
                  fontSize: '36px',
                  lineHeight: 1,
                  opacity: unlocked ? 1 : 0.3,
                  filter: unlocked ? undefined : 'grayscale(1)',
                }}
              >
                {b.emoji}
              </span>
            )}
            <span
              className="line-clamp-2 leading-tight"
              style={{
                fontSize: '10px',
                fontWeight: 600,
                color: unlocked ? '#fff' : 'rgba(255,255,255,0.4)',
              }}
            >
              {b.name}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

// ─────────────────────────── bottom sheet ───────────────────────────

function BadgeSheet({
  badge,
  unlocked,
  ctx,
  onClose,
}: {
  badge: Badge
  unlocked: boolean
  ctx: BadgeContext
  onClose: () => void
}) {
  const { t } = useTranslation()
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const prog = !unlocked ? badgeProgress(badge, ctx) : null
  const obtainedAt = unlocked ? badgeObtainedDate(badge, ctx) : null
  const pct = prog ? Math.round((prog.current / prog.target) * 100) : 0

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <button
        aria-label={t('gamif.close')}
        onClick={onClose}
        className="absolute inset-0"
        style={{
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          animation: 'sheet-backdrop-in 200ms ease-out both',
        }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 px-6 pt-3 text-center"
        style={{
          background: '#141414',
          borderTopLeftRadius: '28px',
          borderTopRightRadius: '28px',
          borderTop: '1px solid #333',
          paddingBottom: 'max(env(safe-area-inset-bottom), 24px)',
          boxShadow: '0 -24px 60px rgba(0,0,0,0.65)',
          animation: 'sheet-slide-up 280ms cubic-bezier(0.32,0.72,0,1) both',
        }}
      >
        <div className="flex justify-center pt-1">
          <span
            aria-hidden
            className="rounded-full"
            style={{ width: 40, height: 4, background: 'rgba(255,255,255,0.18)' }}
          />
        </div>

        <div
          className="mx-auto mt-5 flex h-24 w-24 items-center justify-center rounded-full"
          style={{
            background: badge.gold
              ? 'rgba(224,179,65,0.14)'
              : unlocked
                ? 'rgba(232,32,58,0.12)'
                : 'rgba(255,255,255,0.04)',
            border: badge.gold
              ? '1px solid rgba(224,179,65,0.45)'
              : unlocked
                ? '1px solid rgba(232,32,58,0.35)'
                : '1px solid #333',
          }}
        >
          {badgeIcon(badge.slug) ? (
            <img
              src={badgeIcon(badge.slug)}
              alt=""
              className="h-20 w-20 rounded-2xl object-cover"
              style={{
                opacity: unlocked ? 1 : 0.35,
                filter: unlocked ? undefined : 'grayscale(1)',
              }}
            />
          ) : (
            <span
              style={{
                fontSize: '64px',
                lineHeight: 1,
                opacity: unlocked ? 1 : 0.35,
                filter: unlocked ? undefined : 'grayscale(1)',
              }}
            >
              {badge.emoji}
            </span>
          )}
        </div>

        <h3
          className="mt-4 font-display font-extrabold tracking-tight text-white"
          style={{ fontSize: '20px' }}
        >
          {badge.name}
        </h3>

        <p
          className="mx-auto mt-2 max-w-[20rem] leading-relaxed"
          style={{ fontSize: '14px', color: '#999' }}
        >
          {badge.desc}
        </p>

        {unlocked ? (
          <div className="mt-4">
            {obtainedAt && (
              <p
                className="font-semibold"
                style={{ fontSize: '13px', color: '#34D399' }}
              >
                {t('gamif.unlockedOn', { date: obtainedAt })}
              </p>
            )}
            <p
              className="mt-1 font-bold"
              style={{ fontSize: '15px', color: '#34D399' }}
            >
              {t('gamif.unlockedCheck')}
            </p>
          </div>
        ) : (
          <div className="mt-4">
            <p
              className="font-semibold"
              style={{ fontSize: '14px', color: '#E8203A' }}
            >
              {badge.condition}
            </p>
            {prog && (
              <div className="mx-auto mt-3 max-w-[16rem]">
                <div
                  className="h-2 w-full overflow-hidden rounded-full"
                  style={{ background: '#222' }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      background:
                        'linear-gradient(90deg, #E8203A 0%, #ff4d4d 100%)',
                    }}
                  />
                </div>
                <p className="mt-1.5 text-[12px] font-medium text-white/55">
                  {prog.current}/{prog.target} {t(`gamif.unit_${prog.unit}`)}
                </p>
              </div>
            )}
          </div>
        )}

        <button
          onClick={onClose}
          className="tappable mt-6 w-full rounded-full py-3 font-semibold text-white"
          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid #333' }}
        >
          {t('gamif.close')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
