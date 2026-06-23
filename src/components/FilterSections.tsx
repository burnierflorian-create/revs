import { useState } from 'react'
import { BRAND_FILTERS } from '../lib/filterCatalog'
import type { Rarity } from '../lib/spots'

/** Shared building blocks for the Fil + Carte filter bottom sheets.
 *  Both sheets reuse the same #1a1a1a / #E8203A pill language and the
 *  same Catégorie + Marque sections; only the third section differs
 *  (Rareté on the Fil, Distance on the Carte). */

// The 8 categories surfaced in the sheet's scrollable Catégorie row.
export const SHEET_CATEGORIES = [
  'Tout',
  'Supercars',
  'Hypercars',
  'JDM',
  'Électrique',
  'Classique',
  'SUV',
  'Berline',
] as const

// Rarity buckets — a 4-tier simplification of the 6 internal rarities so
// the Fil filter stays readable. 'all' = no filter.
export type RarityBucket = 'all' | 'commun' | 'rare' | 'ultra' | 'legendaire'

export const RARITY_BUCKETS: { value: RarityBucket; label: string }[] = [
  { value: 'all', label: 'Tout' },
  { value: 'commun', label: 'Commun' },
  { value: 'rare', label: 'Rare' },
  { value: 'ultra', label: 'Ultra Rare' },
  { value: 'legendaire', label: 'Légendaire' },
]

const BUCKET_RARITIES: Record<Exclude<RarityBucket, 'all'>, Rarity[]> = {
  commun: ['standard'],
  rare: ['premium', 'performance'],
  ultra: ['exclusif', 'supercar'],
  legendaire: ['hypercar'],
}

export function matchesRarityBucket(
  rarity: Rarity | null | undefined,
  bucket: RarityBucket,
): boolean {
  if (bucket === 'all') return true
  return BUCKET_RARITIES[bucket].includes(rarity ?? 'standard')
}

/** Shared pill style — #1a1a1a inactive, #E8203A active, radius 20,
 *  padding 8px 16px, 14px. */
export function sheetPill(on: boolean): React.CSSProperties {
  return {
    flex: '0 0 auto',
    padding: '8px 16px',
    borderRadius: 20,
    fontSize: 14,
    fontWeight: 600,
    background: on ? '#E8203A' : '#1a1a1a',
    color: on ? '#fff' : 'rgba(255,255,255,0.72)',
    border: on ? '1px solid #E8203A' : '1px solid rgba(255,255,255,0.1)',
  }
}

const SECTION_LABEL =
  'mb-2.5 text-[13px] font-bold text-white'

/** Catégorie — a single horizontally-scrollable row of pills. */
export function CategorySection({
  value,
  onChange,
}: {
  value: string
  onChange: (c: string) => void
}) {
  return (
    <section>
      <p className={SECTION_LABEL}>Catégorie</p>
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-0.5">
        {SHEET_CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => onChange(c)}
            className="tappable transition-colors"
            style={sheetPill(value === c)}
          >
            {c}
          </button>
        ))}
      </div>
    </section>
  )
}

/** Marque — wrapped pills: the first 5 brands + a "Voir toutes les
 *  marques →" pill that expands the full 36-brand catalogue. Auto-expands
 *  when the current selection lives outside the first five. `value` is a
 *  brand slug (or null = Tout). */
export function BrandSection({
  value,
  onChange,
}: {
  value: string | null
  onChange: (key: string | null) => void
}) {
  const firstFive = BRAND_FILTERS.slice(0, 5)
  const selectedKey = value ?? 'Tout'
  const inFirstFive =
    selectedKey === 'Tout' || firstFive.some((b) => b.key === selectedKey)
  const [expanded, setExpanded] = useState(!inFirstFive)
  const list = expanded ? BRAND_FILTERS : firstFive

  return (
    <section>
      <p className={SECTION_LABEL}>Marque</p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onChange(null)}
          className="tappable transition-colors"
          style={sheetPill(selectedKey === 'Tout')}
        >
          Tout
        </button>
        {list.map((b) => (
          <button
            key={b.key}
            onClick={() => onChange(b.key)}
            className="tappable transition-colors"
            style={sheetPill(selectedKey === b.key)}
          >
            {b.label}
          </button>
        ))}
        {!expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="tappable transition-colors"
            style={sheetPill(false)}
          >
            Voir toutes les marques →
          </button>
        )}
      </div>
    </section>
  )
}
