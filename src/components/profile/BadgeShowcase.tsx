// ═══════════════════════ PROFIL — BADGES ═══════════════════════
//
// Les badges avaient leur propre onglet dans la maquette, mais vivaient en
// réalité au fond de l'onglet « Récompenses », sous l'abonnement. Ils
// remontent ici, avec la séparation que la spec demande : ce qui est acquis
// d'abord, ce qui reste à décrocher ensuite, visiblement verrouillé.
//
// ── AUCUNE RÉCOMPENSE XP N'EST AFFICHÉE ──
// Le catalogue portait un champ `xp` annonçant 675 XP au total, dont pas un
// n'était jamais crédité. Le champ a disparu à la refonte XP du 29/09. Les
// badges sont des distinctions, et rien d'autre ne doit être promis.

import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Lock } from 'lucide-react'
import type { Badge } from '../../lib/badges'
import { badgeIcon } from '../../lib/customIcons'
import SectionHead from './SectionHead'

function BadgeTile({
  badge,
  unlocked,
  onOpen,
}: {
  badge: Badge
  unlocked: boolean
  onOpen: () => void
}) {
  const icon = badgeIcon(badge.slug)
  return (
    <button
      onClick={onOpen}
      className="tappable flex min-w-0 flex-col items-center gap-1.5 transition-transform active:scale-95"
      aria-label={badge.name}
    >
      <span
        className="flex h-[58px] w-[58px] flex-none items-center justify-center overflow-hidden rounded-full text-2xl"
        style={{
          background: unlocked
            ? badge.gold
              ? 'rgba(224,179,65,0.14)'
              : 'rgb(var(--color-accent) / 0.12)'
            : 'rgb(var(--color-fg) / 0.04)',
          border: unlocked
            ? badge.gold
              ? '1px solid rgba(224,179,65,0.45)'
              : '1px solid rgb(var(--color-accent) / 0.35)'
            : '1px solid rgb(var(--color-fg) / 0.07)',
          // Les verrouillés gardent une silhouette lisible : assez estompés
          // pour se distinguer, assez présents pour donner envie.
          opacity: unlocked ? 1 : 0.42,
        }}
      >
        {unlocked ? (
          icon ? (
            <img
              src={icon}
              alt=""
              aria-hidden
              loading="lazy"
              decoding="async"
              className="h-full w-full rounded-full object-cover"
            />
          ) : (
            badge.emoji
          )
        ) : (
          <Lock className="h-4 w-4 text-fg2/60" strokeWidth={1.8} />
        )}
      </span>
      <span
        className="line-clamp-2 text-center text-[10px] font-semibold leading-tight"
        style={{ color: unlocked ? 'rgb(var(--color-fg) / 0.8)' : 'rgb(var(--color-fg) / 0.4)' }}
      >
        {badge.name}
      </span>
    </button>
  )
}

export default function BadgeShowcase({
  badges,
  unlocks,
}: {
  badges: Badge[]
  unlocks: Set<string>
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const unlocked = badges.filter((b) => unlocks.has(b.slug))
  const locked = badges.filter((b) => !unlocks.has(b.slug))

  return (
    <div className="space-y-7 px-4">
      <section>
        <SectionHead
          title={t('profilepage.badges.heading')}
          count={t('profilepage.badges.summary', {
            unlocked: unlocked.length,
            total: badges.length,
          })}
          onMore={() => navigate('/badges')}
        />
        {/* Barre de complétion — la seule mesure globale qui ait du sens ici. */}
        <div
          className="h-[5px] w-full overflow-hidden rounded-full"
          style={{ background: 'var(--color-ring-track)' }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${badges.length ? Math.round((unlocked.length / badges.length) * 100) : 0}%`,
              background: 'rgb(var(--color-accent))',
              transition: 'width 800ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          />
        </div>
      </section>

      {unlocked.length > 0 && (
        <section>
          <h3 className="label-up mb-3 text-[10px] text-fg2">
            {t('profilepage.badges.obtained')}
          </h3>
          <div className="grid grid-cols-4 gap-x-2 gap-y-4">
            {unlocked.map((b) => (
              <BadgeTile
                key={b.slug}
                badge={b}
                unlocked
                onOpen={() => navigate(`/badges/${b.slug}`)}
              />
            ))}
          </div>
        </section>
      )}

      {locked.length > 0 && (
        <section>
          <h3 className="label-up mb-3 text-[10px] text-fg2">
            {t('profilepage.badges.toUnlock')}
          </h3>
          <div className="grid grid-cols-4 gap-x-2 gap-y-4">
            {locked.map((b) => (
              <BadgeTile
                key={b.slug}
                badge={b}
                unlocked={false}
                onOpen={() => navigate(`/badges/${b.slug}`)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
