import { useEffect, useState } from 'react'
import { Filter, X } from 'lucide-react'
import { BRANDS } from '../lib/brands'
import type { Rarity } from '../lib/spots'
import { CARD_LEVELS } from '../lib/cardLevels'
import { appConfig } from '../config/appConfig'

// Advanced map filters — the BottomSheet behind the Carte filter icon.
// Mirrors the Feed's FeedFiltersModal pattern (overlay → rounded-t sheet,
// draft + Appliquer/Réinitialiser) but on the map's own dimensions:
// rarity, constructeur, niveau de carte.

export type MapFilters = {
  rarity: Rarity | 'all'
  brand: string | null // brand slug, or null = toutes
  cardLevel: number // 0 = tous, else minimum card level (1-5)
}

export const DEFAULT_MAP_FILTERS: MapFilters = {
  rarity: 'all',
  brand: null,
  cardLevel: 0,
}

export function mapFiltersActive(f: MapFilters): boolean {
  return f.rarity !== 'all' || f.brand !== null || f.cardLevel > 0
}

// Map-only persistence. A DEDICATED localStorage key (distinct from the
// Feed's) is what guarantees absolute isolation: applying map filters can
// never bleed into the Fil and vice-versa.
const MAP_FILTERS_KEY = 'revs_map_filters'

export function loadMapFilters(): MapFilters {
  try {
    const raw = localStorage.getItem(MAP_FILTERS_KEY)
    if (!raw) return DEFAULT_MAP_FILTERS
    const p = JSON.parse(raw) as Partial<MapFilters>
    return {
      rarity: typeof p.rarity === 'string' ? (p.rarity as MapFilters['rarity']) : 'all',
      brand: typeof p.brand === 'string' ? p.brand : null,
      cardLevel: typeof p.cardLevel === 'number' ? p.cardLevel : 0,
    }
  } catch {
    return DEFAULT_MAP_FILTERS
  }
}

export function saveMapFilters(f: MapFilters): void {
  try {
    localStorage.setItem(MAP_FILTERS_KEY, JSON.stringify(f))
  } catch {
    /* storage unavailable — non-fatal */
  }
}

const RARITIES: { value: Rarity; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'premium', label: 'Premium' },
  { value: 'performance', label: 'Performance' },
  { value: 'exclusif', label: 'Exclusif' },
  { value: 'supercar', label: 'Supercar' },
  { value: 'hypercar', label: 'Hypercar' },
]

export default function MapFiltersModal({
  open,
  initial,
  onClose,
  onApply,
}: {
  open: boolean
  initial: MapFilters
  onClose: () => void
  onApply: (next: MapFilters) => void
}) {
  const [draft, setDraft] = useState<MapFilters>(initial)

  useEffect(() => {
    if (open) setDraft(initial)
  }, [open, initial])

  if (!open) return null

  const chip = (on: boolean) =>
    `rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
      on ? 'bg-accent text-fg' : 'bg-card text-fg/60 hover:text-fg'
    }`

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-md flex-col rounded-t-3xl bg-bg sm:rounded-3xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-fg/5 px-5 pb-3 pt-5">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-fg">
            <Filter className="h-5 w-5 text-accent" />
            Filtres
          </h2>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="text-fg/50 hover:text-fg"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body — scrollable. Big bottom padding so the last section
            clears the floating footer + the global tab bar. */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-24 pt-5">
          {/* Rareté */}
          <section>
            <p className="mb-2 text-xs uppercase tracking-[0.16em] text-fg/45">
              Rareté
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setDraft((d) => ({ ...d, rarity: 'all' }))}
                className={chip(draft.rarity === 'all')}
              >
                Toutes
              </button>
              {RARITIES.map((r) => {
                const on = draft.rarity === r.value
                return (
                  <button
                    key={r.value}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        rarity: on ? 'all' : r.value,
                      }))
                    }
                    className={chip(on)}
                  >
                    {r.label}
                  </button>
                )
              })}
            </div>
          </section>

          {/* Niveau de carte — phase-gated by SHOW_CARD_LEVEL_UP. */}
          {appConfig.SHOW_CARD_LEVEL_UP && (
          <section>
            <p className="mb-2 text-xs uppercase tracking-[0.16em] text-fg/45">
              Niveau de carte
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setDraft((d) => ({ ...d, cardLevel: 0 }))}
                className={chip(draft.cardLevel === 0)}
              >
                Tous
              </button>
              {CARD_LEVELS.map((l) => {
                const on = draft.cardLevel === l.level
                return (
                  <button
                    key={l.level}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        cardLevel: on ? 0 : l.level,
                      }))
                    }
                    className={chip(on)}
                  >
                    {l.name}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-[11px] text-fg/40">
              Affiche les spots des modèles que tu possèdes à ce niveau ou plus.
            </p>
          </section>
          )}

          {/* Constructeur */}
          <section>
            <p className="mb-2 text-xs uppercase tracking-[0.16em] text-fg/45">
              Constructeur
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setDraft((d) => ({ ...d, brand: null }))}
                className={chip(draft.brand === null)}
              >
                Tous
              </button>
              {BRANDS.map((b) => {
                const on = draft.brand === b.slug
                return (
                  <button
                    key={b.slug}
                    onClick={() =>
                      setDraft((d) => ({ ...d, brand: on ? null : b.slug }))
                    }
                    className={chip(on)}
                  >
                    {b.name}
                  </button>
                )
              })}
            </div>
          </section>
        </div>

        {/* Footer — the Appliquer button floats clear of the global tab
            bar (z-40, ~2.75rem + safe area). The modal lives inside an
            opacity-driven .tab-pane stacking context, so we lift the
            button with padding rather than relying on z-index alone. */}
        <div className="flex flex-col gap-2 border-t border-fg/5 p-4 pb-[calc(env(safe-area-inset-bottom)+4.5rem)]">
          {mapFiltersActive(draft) && (
            <button
              onClick={() => setDraft(DEFAULT_MAP_FILTERS)}
              className="w-full rounded-full bg-fg/5 py-2.5 text-sm font-medium text-fg/70 hover:bg-fg/10"
            >
              Réinitialiser
            </button>
          )}
          <button
            onClick={() => {
              onApply(draft)
              onClose()
            }}
            className="w-full rounded-full bg-accent py-3 text-sm font-bold text-fg"
          >
            Appliquer les filtres
          </button>
        </div>
      </div>
    </div>
  )
}
