import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { BrandSection, CategorySection } from './FilterSections'

// Advanced map filters — the bottom sheet behind the Carte filter icon.
// Holds the full map filtering surface: Catégorie, Marque, Distance.

export type MapFilters = {
  category: string // 'Tout' | 'Supercars' | … | 'Berline'
  brand: string | null // brand slug, or null = toutes
  distanceKm: number // 1..50 ; 50 = illimité (no distance filter)
}

export const MAX_DISTANCE_KM = 50

export const DEFAULT_MAP_FILTERS: MapFilters = {
  category: 'Tout',
  brand: null,
  distanceKm: MAX_DISTANCE_KM,
}

export function mapFiltersActive(f: MapFilters): boolean {
  return (
    f.category !== 'Tout' ||
    f.brand !== null ||
    f.distanceKm < MAX_DISTANCE_KM
  )
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
      category: typeof p.category === 'string' ? p.category : 'Tout',
      brand: typeof p.brand === 'string' ? p.brand : null,
      distanceKm:
        typeof p.distanceKm === 'number' &&
        p.distanceKm >= 1 &&
        p.distanceKm <= MAX_DISTANCE_KM
          ? p.distanceKm
          : MAX_DISTANCE_KM,
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

  const dirty = mapFiltersActive(draft)
  const distanceLabel =
    draft.distanceKm >= MAX_DISTANCE_KM
      ? 'Illimité'
      : `${draft.distanceKm} km`

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

          {/* Distance — Carte only */}
          <section>
            <div className="mb-2.5 flex items-baseline justify-between">
              <p className="text-[13px] font-bold text-white">Distance</p>
              <span className="text-[13px] font-bold" style={{ color: '#E8203A' }}>
                {distanceLabel}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={MAX_DISTANCE_KM}
              step={1}
              value={draft.distanceKm}
              onChange={(e) =>
                setDraft((d) => ({ ...d, distanceKm: Number(e.target.value) }))
              }
              className="revs-range w-full"
              aria-label="Distance maximale"
            />
            <div className="mt-1 flex justify-between text-[11px] text-white/40">
              <span>1 km</span>
              <span>50 km</span>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="mt-5 flex items-center gap-3">
          {dirty && (
            <button
              onClick={() => setDraft(DEFAULT_MAP_FILTERS)}
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
