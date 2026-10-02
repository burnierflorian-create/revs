// ═══════════════════════ PROFIL — ONGLETS ═══════════════════════
//
// ── POURQUOI CE N'EST PLUS UN CONTRÔLE SEGMENTÉ ──
// À quatre onglets, un segmenté tenait : 343 px disponibles à 375 px, ~78 px
// chacun, « Récompenses » tronqué mais lisible. À SIX, chaque onglet tombe à
// 52 px — « Collection » y devient « Coll… » et « Récompenses » « Réc… ».
// Trois libellés sur six illisibles, ce n'est plus une barre d'onglets.
//
// La barre défile donc horizontalement, en pastilles de largeur naturelle,
// comme les catégories du Fil et les sous-onglets de Découvrir. L'indicateur
// glissant disparaît avec le segmenté : il supposait des largeurs égales.

import { useEffect, useRef } from 'react'
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
  const barRef = useRef<HTMLDivElement>(null)

  // La barre défile : arrivé par /profile?tab=favorites, l'onglet actif est
  // hors du champ et l'écran paraît montrer « Garage » alors qu'il affiche les
  // favoris. On le ramène donc dans la vue — à l'ouverture comme au clic.
  useEffect(() => {
    const i = PROFILE_TABS.indexOf(active)
    const el = barRef.current?.children[i] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [active])

  return (
    <div
      ref={barRef}
      role="tablist"
      aria-label={t('profilepage.tabs.aria')}
      className="flex gap-2 overflow-x-auto pb-1"
      style={{ scrollbarWidth: 'none' }}
      data-swipe-x=""
    >
      {PROFILE_TABS.map((k) => {
        const on = k === active
        return (
          <button
            key={k}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(k)}
            className="tappable flex-none whitespace-nowrap rounded-full px-4 py-2 text-[13px] transition-colors"
            style={
              on
                ? {
                    background: 'rgb(var(--color-accent))',
                    color: '#fff',
                    fontWeight: 700,
                    boxShadow: '0 2px 12px rgb(var(--color-accent) / 0.38)',
                  }
                : {
                    background: 'var(--color-glass-mid)',
                    border: '1px solid var(--color-border)',
                    color: 'rgb(var(--color-fg-2))',
                    fontWeight: 500,
                  }
            }
          >
            {t(`profilepage.tabs.${k}`)}
          </button>
        )
      })}
    </div>
  )

}
