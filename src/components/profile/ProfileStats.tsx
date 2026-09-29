// ═══════════════════════ PROFIL — STATISTIQUES ═══════════════════════
//
// Cinq chiffres sur une seule rangée, séparés par des filets fins. Pas cinq
// cartes : cinq cartes sur 375 px donneraient 67 px chacune, et la grille
// mangerait plus de hauteur que l'information qu'elle porte.
//
// Chaque statistique ne devient cliquable que si une destination RÉELLE
// existe. « Modèles » n'a pas de page dédiée : elle renvoie vers l'onglet
// Collection du profil, qui est exactement ce qu'elle décrit.

import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { ProfileStat } from './types'


export default function ProfileStats({ stats }: { stats: ProfileStat[] }) {
  const navigate = useNavigate()
  const { t } = useTranslation()

  return (
    <div
      className="flex items-stretch rounded-2xl px-1 py-3"
      style={{
        background: 'var(--color-glass-mid)',
        border: '1px solid var(--color-border)',
      }}
    >
      {stats.map((s, i) => {
        const interactive = !!(s.to || s.onPress)
        const Tag = interactive ? 'button' : 'div'
        return (
          <div key={s.key} className="flex min-w-0 flex-1 items-stretch">
            {i > 0 && (
              <span className="w-px flex-none self-center bg-fg/10" style={{ height: 26 }} />
            )}
            <Tag
              {...(interactive
                ? {
                    type: 'button' as const,
                    onClick: () => (s.onPress ? s.onPress() : navigate(s.to as string)),
                    'aria-label': t('profilepage.stats.open', {
                      label: s.label,
                      count: s.value,
                    }),
                  }
                : {})}
              className={`min-w-0 flex-1 px-1 text-center${
                interactive ? ' tappable transition-transform active:scale-[0.94]' : ''
              }`}
            >
              <span className="block font-display text-[19px] font-extrabold leading-none tabular-nums text-fg">
                {s.empty ? '—' : `${s.prefix ?? ''}${s.value}`}
              </span>
              {/* Pas de chevron : à 375 px, cinq colonnes laissent ~63 px
                  chacune, et le chevron volait les 8 px qui manquaient au
                  libellé — « Marques » devenait « Marq… ». La cellule entière
                  est tappable, l'affordance vient du retour au toucher. */}
              <span className="mt-1.5 block truncate text-[9.5px] font-semibold tracking-tight text-fg/50">
                {s.label}
              </span>
            </Tag>
          </div>
        )
      })}
    </div>
  )
}
