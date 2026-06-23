import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  BrandSection,
  CategorySection,
  RARITY_BUCKETS,
  sheetPill,
  type RarityBucket,
} from './FilterSections'

export type FeedSort = 'recent' | 'liked' | 'nearby' | 'week'

export type FeedFilters = {
  category: string // 'Tout' | 'Supercars' | 'Hypercars' | 'JDM' | 'Électrique' | 'Classique' | 'SUV' | 'Berline'
  brand: string | null // brand slug, or null
  rarity: RarityBucket // 'all' | 'commun' | 'rare' | 'ultra' | 'legendaire'
  // Kept for back-compat with the feed's applyFilters() pipeline. No UI
  // surface anymore — everything lives in Catégorie / Marque / Rareté.
  sort: FeedSort
  city: string
}

export const DEFAULT_FILTERS: FeedFilters = {
  category: 'Tout',
  brand: null,
  rarity: 'all',
  sort: 'recent',
  city: '',
}

export function filtersActive(f: FeedFilters): boolean {
  return (
    f.category !== 'Tout' ||
    f.brand !== null ||
    f.rarity !== 'all' ||
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
      rarity:
        typeof p.rarity === 'string' ? (p.rarity as RarityBucket) : 'all',
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

  const dirty =
    draft.category !== 'Tout' || draft.brand !== null || draft.rarity !== 'all'

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col"
        style={{
          background: '#141414',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          maxHeight: '85vh',
          padding: 20,
          paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
        }}
      >
        {/* Handle */}
        <div className="flex justify-center pb-3">
          <span
            style={{
              width: 40,
              height: 4,
              borderRadius: 999,
              background: 'rgba(255,255,255,0.25)',
            }}
          />
        </div>

        {/* Title */}
        <h2
          className="font-display font-bold text-white"
          style={{ fontSize: 18 }}
        >
          Filtres
        </h2>

        {/* Body */}
        <div className="no-scrollbar mt-4 flex-1 space-y-5 overflow-y-auto">
          <CategorySection
            value={draft.category}
            onChange={(c) => setDraft((d) => ({ ...d, category: c }))}
          />

          <BrandSection
            value={draft.brand}
            onChange={(key) => setDraft((d) => ({ ...d, brand: key }))}
          />

          {/* Rareté — Fil only */}
          <section>
            <p className="mb-2.5 text-[13px] font-bold text-white">Rareté</p>
            <div className="no-scrollbar flex gap-2 overflow-x-auto pb-0.5">
              {RARITY_BUCKETS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setDraft((d) => ({ ...d, rarity: r.value }))}
                  className="tappable transition-colors"
                  style={sheetPill(draft.rarity === r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="mt-5 flex items-center gap-3">
          {dirty && (
            <button
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  category: 'Tout',
                  brand: null,
                  rarity: 'all',
                }))
              }
              className="tappable flex-none rounded-full px-5 py-3.5 text-sm font-medium"
              style={{
                background: 'rgba(255,255,255,0.06)',
                color: 'rgba(255,255,255,0.6)',
              }}
            >
              Réinitialiser
            </button>
          )}
          <button
            onClick={() => {
              onApply(draft)
              onClose()
            }}
            className="tappable flex-1 rounded-full py-3.5 text-sm font-bold text-white transition-transform active:scale-[0.98]"
            style={{ background: '#E8203A' }}
          >
            Appliquer les filtres
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
