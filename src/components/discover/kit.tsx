// ═══════ TROUSSE VISUELLE DE LA SECTION DÉCOUVRIR ═══════
//
// Les huit écrans d'Automobile et de F1 partagent une grammaire : une barre
// REVS, deux niveaux d'onglets, des en-têtes de section, des pastilles de
// date et des badges de rang. Avant, chaque écran redessinait les siens — le
// même rang était un rond gris sur une page et un carré bordé sur une autre,
// et les trois écrans F1 n'avaient pas le même pas de grille.
//
// Tout passe par les jetons du design system (bg-card, text-fg, text-fg2) et
// jamais par un hexadécimal figé : REVS a un thème clair, et un #141414 en
// dur y ferait une carte noire sur fond blanc. Seul le rouge d'accent est
// écrit en var(--revs-red) — il est invariant par charte.

import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

/**
 * Onglets en pastilles — le contrôle segmenté de la planche.
 *
 * Piste arrondie discrète, segments de largeur égale, pastille rouge pleine
 * avec halo sur l'actif. La largeur égale est délibérée : « Écuries &
 * Pilotes » est trois fois plus long que « Actu », et des segments dimensionnés
 * par leur contenu feraient sauter la pastille d'un onglet à l'autre.
 */
export function PillTabs<K extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: K; label: string }[]
  value: K
  onChange: (k: K) => void
}) {
  return (
    <div
      className="grid w-full rounded-full p-1"
      style={{
        gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
        background: 'rgb(var(--color-fg) / 0.05)',
      }}
    >
      {tabs.map((tab) => {
        const active = value === tab.key
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            aria-pressed={active}
            className="tappable truncate rounded-full px-1.5 py-2 text-center text-[12px] transition-all duration-200"
            style={
              active
                ? {
                    background: 'var(--revs-red)',
                    color: '#fff',
                    fontWeight: 700,
                    boxShadow: '0 2px 14px rgb(var(--color-accent) / 0.45)',
                  }
                : { color: 'rgb(var(--color-fg-2))', fontWeight: 500 }
            }
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

/** En-tête de section — « Événements à venir » et son « Voir tout » optionnel. */
export function SectionTitle({
  children,
  action,
  onAction,
}: {
  children: ReactNode
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[17px] font-bold leading-tight text-fg">{children}</h2>
      {action && (
        <button
          onClick={onAction}
          className="tappable flex flex-none items-center gap-0.5 text-[13px] font-medium text-fg2"
        >
          {action}
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

/**
 * Pastille de date — mois abrégé au-dessus, quantième en gros.
 *
 * `month` et `day` sont passés déjà formatés par l'appelant plutôt que
 * calculés ici : le calendrier F1 et les événements n'utilisent pas la même
 * locale ni le même fuseau, et une pastille qui déciderait elle-même du
 * format introduirait un troisième comportement.
 */
export function DateBlock({ month, day }: { month: string; day: string }) {
  return (
    <div
      className="flex h-[52px] w-[52px] flex-none flex-col items-center justify-center rounded-xl"
      style={{ background: 'rgb(var(--color-fg) / 0.06)' }}
    >
      <span className="text-[10px] font-bold uppercase leading-none tracking-wider text-fg2">
        {month}
      </span>
      <span className="mt-1 text-[19px] font-extrabold leading-none tabular-nums text-fg">
        {day}
      </span>
    </div>
  )
}

/**
 * Badge de rang — carré arrondi bordé de la couleur d'écurie.
 *
 * La couleur est portée par la BORDURE et non par le fond : plusieurs livrées
 * 2026 (le jaune Alpine, l'orange McLaren) rendent un chiffre blanc illisible
 * en aplat, alors qu'en contour elles restent identifiables sans nuire au
 * contraste du chiffre.
 */
export function RankBadge({ n, color }: { n: number; color: string }) {
  return (
    <span
      className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-xl text-[15px] font-bold tabular-nums text-fg"
      style={{ border: `1.5px solid ${color}`, background: 'rgb(var(--color-fg) / 0.03)' }}
    >
      {n}
    </span>
  )
}

/** Chevron de fin de ligne, au gris secondaire du thème. */
export function RowChevron() {
  return <ChevronRight className="h-[18px] w-[18px] flex-none text-fg2" />
}

/**
 * Écusson d'écurie — losange plein à la couleur de la livrée.
 *
 * La planche montre les vrais écussons des écuries. REVS n'en détient aucun
 * (`F1Team.logo` est vide pour les dix écuries) et en fabriquer un
 * ressemblant reviendrait à imiter une marque déposée. Cette forme neutre
 * tient le même rôle de repère coloré dans la ligne sans prétendre être le
 * logo de quiconque.
 */
export function TeamCrest({ color, size = 24 }: { color: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="flex-none"
      style={{
        width: size,
        height: size,
        background: color,
        clipPath: 'polygon(50% 0%, 100% 22%, 100% 70%, 50% 100%, 0% 70%, 0% 22%)',
        opacity: 0.92,
      }}
    />
  )
}

/** Barre de progression fine — part de points d'un pilote face au leader. */
export function ScoreBar({ ratio, color }: { ratio: number; color: string }) {
  return (
    <span
      aria-hidden
      className="mt-1.5 block h-[3px] w-full overflow-hidden rounded-full"
      style={{ background: 'rgb(var(--color-fg) / 0.08)' }}
    >
      <span
        className="block h-full rounded-full"
        style={{
          width: `${Math.max(0, Math.min(1, ratio)) * 100}%`,
          background: color,
        }}
      />
    </span>
  )
}
