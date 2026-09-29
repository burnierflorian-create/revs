// ═══════════════════════ PROFIL — ONGLETS ═══════════════════════
//
// Quatre onglets, contrôle segmenté. L'indicateur actif est un bloc rouge qui
// GLISSE d'un onglet à l'autre plutôt que d'apparaître : c'est la micro-
// interaction demandée, et elle coûte une transformation GPU.
//
// Sur 375 px, quatre libellés dans 343 px laissent ~78 px chacun — « Récompenses »
// n'y tient pas en entier. Il est donc tronqué proprement plutôt que réduit à
// une taille illisible ou passé à la ligne.

import { useTranslation } from 'react-i18next'
import { PROFILE_TABS, type ProfileTabKey } from './types'


export default function ProfileTabs({
  active,
  onChange,
}: {
  active: ProfileTabKey
  onChange: (k: ProfileTabKey) => void
}) {
  const { t } = useTranslation()
  const index = Math.max(0, PROFILE_TABS.indexOf(active))

  return (
    <div
      role="tablist"
      aria-label={t('profilepage.tabs.aria')}
      className="relative flex rounded-full p-1"
      style={{
        background: 'var(--color-glass-mid)',
        border: '1px solid var(--color-border)',
      }}
    >
      {/* Indicateur glissant — positionné en pourcentage, donc indépendant de
          la largeur réelle du conteneur. */}
      <span
        aria-hidden
        className="absolute bottom-1 top-1 rounded-full"
        style={{
          width: 'calc((100% - 0.5rem) / 4)',
          left: `calc(0.25rem + ${index} * ((100% - 0.5rem) / 4))`,
          background: 'rgb(var(--color-accent))',
          boxShadow: '0 2px 12px rgb(var(--color-accent) / 0.38)',
          transition: 'left 280ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      />
      {PROFILE_TABS.map((k) => {
        const on = k === active
        return (
          <button
            key={k}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(k)}
            className="tappable relative z-10 min-w-0 flex-1 truncate rounded-full py-[7px] font-bold tracking-tight transition-colors"
            // Mesuré : « Récompenses » réclame 74 px à 10,5 px pour 70 px
            // disponibles à 375 px. La taille suit donc la largeur d'écran au
            // lieu d'être fixe, et le padding horizontal disparaît — les 4 px
            // qu'il prenait étaient exactement ceux qui manquaient.
            style={{
              color: on ? '#fff' : 'rgb(var(--color-fg-2))',
              fontSize: 'clamp(10px, 2.7vw, 11.5px)',
            }}
          >
            {t(`profilepage.tabs.${k}`)}
          </button>
        )
      })}
    </div>
  )
}
