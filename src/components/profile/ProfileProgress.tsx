// ═══════════════════════ PROFIL — PROGRESSION ═══════════════════════
//
// Bloc de niveau. Toutes les valeurs viennent de `my_progress()` — le serveur
// décide, le client affiche. C'est la règle posée par la refonte XP du 29/09 :
// aucune logique de niveau ne doit vivre deux fois.
//
// Au niveau 100, le bloc devient un bouton vers le prestige. Ailleurs il reste
// inerte : il n'y a rien à ouvrir, donc rien ne doit ressembler à un bouton.

import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { openPrestige, romanPrestige, type Progress } from '../../lib/xp'

const nf = new Intl.NumberFormat('fr-FR')

export default function ProfileProgress({
  prog,
  /** Progression animée 0-100 : la barre se remplit au montage. */
  animPct,
}: {
  prog: Progress | null
  animPct: number
}) {
  const { t } = useTranslation()
  if (!prog) {
    return <div className="h-[92px] animate-pulse rounded-2xl bg-fg/[0.05]" />
  }

  const { level, title, prestige, levelXp, levelSpan, pct, isMax } = prog
  const Shell = isMax ? 'button' : 'div'

  return (
    <Shell
      {...(isMax
        ? {
            type: 'button' as const,
            onClick: openPrestige,
            'aria-label': t('prestige.available'),
          }
        : {})}
      className={`w-full rounded-2xl px-4 py-3.5 text-left${
        isMax ? ' tappable transition-transform active:scale-[0.98]' : ''
      }`}
      style={{
        background: 'var(--color-glass-mid)',
        border: isMax
          ? '1px solid rgb(var(--color-accent) / 0.55)'
          : '1px solid var(--color-border)',
        boxShadow: isMax ? '0 0 20px rgb(var(--color-accent) / 0.22)' : undefined,
      }}
    >
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            {prestige > 0 && (
              <span
                className="rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.1em]"
                style={{
                  color: 'rgb(var(--color-accent))',
                  background: 'rgb(var(--color-accent) / 0.13)',
                }}
              >
                {t('home.xp.prestige', { n: romanPrestige(prestige) })}
              </span>
            )}
            <span className="font-display text-[16px] font-extrabold tracking-tight text-fg">
              {t('home.xp.level')} {level}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[12px] font-medium text-fg2">
            {title}
          </span>
        </span>

        <span className="flex-none text-right">
          <span className="block font-display text-[15px] font-extrabold tabular-nums text-fg">
            {isMax ? t('home.xp.max') : `${pct}%`}
          </span>
          <span className="mt-0.5 block text-[10px] font-semibold tabular-nums text-fg/45">
            {isMax
              ? `${nf.format(prog.xpTotal)} XP`
              : `${nf.format(levelXp)} / ${nf.format(levelSpan)} XP`}
          </span>
        </span>

        {isMax && (
          <ChevronRight
            className="h-4 w-4 flex-none"
            style={{ color: 'rgb(var(--color-accent))' }}
            aria-hidden
          />
        )}
      </div>

      <div
        className="mt-3 h-[6px] w-full overflow-hidden rounded-full"
        style={{ background: 'var(--color-ring-track)' }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${isMax ? 100 : animPct}%`,
            background:
              'linear-gradient(90deg, rgb(var(--color-accent)) 0%, #ff5d6e 100%)',
            transition: 'width 900ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
      </div>
    </Shell>
  )
}
