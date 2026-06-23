import { useEffect, useState } from 'react'
import { Filter, X } from 'lucide-react'
import { BRANDS } from '../lib/brands'

export type FeedSort = 'recent' | 'liked' | 'nearby' | 'week'

export type FeedFilters = {
  category: string // 'Tout' | 'Supercars' | 'Hypercars' | 'JDM' | 'Berlines' | 'SUV' | 'Coupés' | 'Cabriolets' | 'Autre'
  brand: string | null // brand slug, or null
  sort: FeedSort
  city: string
}

export const DEFAULT_FILTERS: FeedFilters = {
  category: 'Tout',
  brand: null,
  sort: 'recent',
  city: '',
}

export function filtersActive(f: FeedFilters): boolean {
  return (
    f.category !== 'Tout' ||
    f.brand !== null ||
    f.sort !== 'recent' ||
    f.city.trim().length > 0
  )
}

// Feed-only persistence. A DEDICATED localStorage key (distinct from the
// map's revs_map_filters) is what guarantees absolute isolation: applying
// feed filters can never reach the Carte and vice-versa.
const FEED_FILTERS_KEY = 'revs_feed_filters'

export function loadFeedFilters(): FeedFilters {
  try {
    const raw = localStorage.getItem(FEED_FILTERS_KEY)
    if (!raw) return DEFAULT_FILTERS
    const p = JSON.parse(raw) as Partial<FeedFilters>
    return {
      category: typeof p.category === 'string' ? p.category : 'Tout',
      brand: typeof p.brand === 'string' ? p.brand : null,
      sort: typeof p.sort === 'string' ? (p.sort as FeedSort) : 'recent',
      city: typeof p.city === 'string' ? p.city : '',
    }
  } catch {
    return DEFAULT_FILTERS
  }
}

export function saveFeedFilters(f: FeedFilters): void {
  try {
    localStorage.setItem(FEED_FILTERS_KEY, JSON.stringify(f))
  } catch {
    /* storage unavailable — non-fatal */
  }
}

const CATEGORIES = [
  'Tout',
  'Supercars',
  'Hypercars',
  'JDM',
  'Électrique',
  'Classique',
  'Berlines',
  'SUV',
  'Coupés',
  'Cabriolets',
  'Autre',
] as const

const SORTS: { value: FeedSort; label: string }[] = [
  { value: 'recent', label: 'Plus récents' },
  { value: 'liked', label: 'Plus likés' },
  { value: 'nearby', label: 'Près de moi' },
  { value: 'week', label: 'Cette semaine' },
]

export default function FeedFiltersModal({
  open,
  initial,
  onClose,
  onApply,
}: {
  open: boolean
  initial: FeedFilters
  onClose: () => void
  onApply: (next: FeedFilters) => void
}) {
  const [draft, setDraft] = useState<FeedFilters>(initial)

  // Re-sync draft each time the modal opens so reopening shows the
  // current applied filters (not the stale draft from last cancel).
  useEffect(() => {
    if (open) setDraft(initial)
  }, [open, initial])

  if (!open) return null

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
        <div className="flex items-center justify-between border-b border-fg/5 px-5 pt-5 pb-3">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
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
          {/* Catégorie */}
          <section>
            <p className="mb-2 text-xs uppercase tracking-[0.16em] text-fg/45">
              Catégorie
            </p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => {
                const on = draft.category === c
                return (
                  <button
                    key={c}
                    onClick={() => setDraft((d) => ({ ...d, category: c }))}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      on ? 'bg-accent text-fg' : 'bg-card text-fg/60'
                    }`}
                  >
                    {c}
                  </button>
                )
              })}
            </div>
          </section>

          {/* Marque */}
          <section>
            <p className="mb-2 text-xs uppercase tracking-[0.16em] text-fg/45">
              Marque
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setDraft((d) => ({ ...d, brand: null }))}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  draft.brand === null
                    ? 'bg-accent text-fg'
                    : 'bg-card text-fg/60'
                }`}
              >
                Toutes
              </button>
              {BRANDS.map((b) => {
                const on = draft.brand === b.slug
                return (
                  <button
                    key={b.slug}
                    onClick={() =>
                      setDraft((d) => ({ ...d, brand: on ? null : b.slug }))
                    }
                    className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      on
                        ? 'bg-accent text-fg'
                        : 'bg-card text-fg/60 hover:text-fg'
                    }`}
                  >
                    {b.name}
                  </button>
                )
              })}
            </div>
          </section>

          {/* Tri */}
          <section>
            <p className="mb-2 text-xs uppercase tracking-[0.16em] text-fg/45">
              Tri
            </p>
            <div className="grid grid-cols-2 gap-2">
              {SORTS.map((s) => {
                const on = draft.sort === s.value
                return (
                  <button
                    key={s.value}
                    onClick={() =>
                      setDraft((d) => ({ ...d, sort: s.value }))
                    }
                    className={`rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                      on ? 'bg-accent text-fg' : 'bg-card text-fg/60'
                    }`}
                  >
                    {s.label}
                  </button>
                )
              })}
            </div>
          </section>

          {/* Ville */}
          <section>
            <label
              htmlFor="filter-city"
              className="mb-2 block text-xs uppercase tracking-[0.16em] text-fg/45"
            >
              Ville du spotter
            </label>
            <input
              id="filter-city"
              type="text"
              value={draft.city}
              onChange={(e) =>
                setDraft((d) => ({ ...d, city: e.target.value }))
              }
              placeholder="ex. Annecy, Paris…"
              className="w-full rounded-2xl bg-card px-4 py-3 text-sm text-fg placeholder-fg/30 outline-none ring-1 ring-fg/5 focus:ring-accent/60"
              autoComplete="off"
            />
          </section>
        </div>

        {/* Footer — the Appliquer button floats clear of the global tab
            bar (z-40, ~2.75rem + safe area). The modal lives inside an
            opacity-driven .tab-pane stacking context, so we lift the
            button with padding rather than relying on z-index alone. */}
        <div className="flex flex-col gap-2 border-t border-fg/5 p-4 pb-[calc(env(safe-area-inset-bottom)+4.5rem)]">
          {filtersActive(draft) && (
            <button
              onClick={() => setDraft(DEFAULT_FILTERS)}
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
