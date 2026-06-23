import { useState } from 'react'
import FilterSheet from './FilterSheet'
import {
  BRAND_FILTERS,
  BRAND_QUICK,
  CATEGORY_FILTERS,
  CATEGORY_QUICK,
} from '../lib/filterCatalog'

/** Two-level compact filter bar shared by the Fil and the Carte.
 *
 *  Level 1 — two always-visible horizontal scroll rows:
 *    • Categories: Tout · Supercars · Hypercars · Voir plus ↓
 *    • Brands:     Tout · Ferrari · Lamborghini · Voir plus ↓
 *  Level 2 — "Voir plus" opens a bottom sheet listing every option.
 *
 *  `glass` switches the inactive pill background to a translucent
 *  glassmorphism (used on the Carte so the map shows through).
 */
export default function QuickFilters({
  category,
  brand,
  onCategory,
  onBrand,
  glass = false,
}: {
  category: string
  brand: string | null
  onCategory: (c: string) => void
  onBrand: (key: string) => void
  glass?: boolean
}) {
  const [catSheet, setCatSheet] = useState(false)
  const [brandSheet, setBrandSheet] = useState(false)

  const inactiveBg = glass ? 'rgba(10,10,10,0.8)' : '#1a1a1a'
  const inactiveBorder = glass ? 'rgba(255,255,255,0.14)' : '#333'

  const pill = (active: boolean) =>
    ({
      height: 34,
      borderRadius: 20,
      padding: '0 16px',
      fontSize: 13,
      flex: '0 0 auto',
      color: active ? '#fff' : 'rgba(255,255,255,0.7)',
      background: active ? '#E8203A' : inactiveBg,
      border: active ? '1px solid #E8203A' : `1px solid ${inactiveBorder}`,
      ...(glass
        ? { backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }
        : {}),
    }) as React.CSSProperties

  const catLabel = (c: string) => c
  const brandLabel = (key: string) =>
    BRAND_FILTERS.find((b) => b.key === key)?.label ?? key

  // "Voir plus" reflects an active out-of-quick selection (e.g. "Berline").
  const catInQuick = (CATEGORY_QUICK as readonly string[]).includes(category)
  const moreCatActive = !catInQuick && category !== 'Tout'
  const brandKey = brand ?? 'Tout'
  const brandInQuick =
    brandKey === 'Tout' || (BRAND_QUICK as readonly string[]).includes(brandKey)
  const moreBrandActive = !brandInQuick

  return (
    <div className="space-y-2">
      {/* Categories row */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {CATEGORY_QUICK.map((c) => (
          <button
            key={c}
            onClick={() => onCategory(c)}
            className="tappable font-semibold tracking-tight transition-colors"
            style={pill(category === c)}
          >
            {catLabel(c)}
          </button>
        ))}
        <button
          onClick={() => setCatSheet(true)}
          className="tappable font-semibold tracking-tight transition-colors"
          style={pill(moreCatActive)}
        >
          {moreCatActive ? `${catLabel(category)} ↓` : 'Voir plus ↓'}
        </button>
      </div>

      {/* Brands row */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        <button
          onClick={() => onBrand('Tout')}
          className="tappable font-semibold tracking-tight transition-colors"
          style={pill(brandKey === 'Tout')}
        >
          Tout
        </button>
        {BRAND_QUICK.map((key) => (
          <button
            key={key}
            onClick={() => onBrand(key)}
            className="tappable font-semibold tracking-tight transition-colors"
            style={pill(brandKey === key)}
          >
            {brandLabel(key)}
          </button>
        ))}
        <button
          onClick={() => setBrandSheet(true)}
          className="tappable font-semibold tracking-tight transition-colors"
          style={pill(moreBrandActive)}
        >
          {moreBrandActive ? `${brandLabel(brandKey)} ↓` : 'Voir plus ↓'}
        </button>
      </div>

      <FilterSheet
        open={catSheet}
        title="Catégorie"
        options={CATEGORY_FILTERS.map((c) => ({ key: c, label: c }))}
        selected={category}
        onClose={() => setCatSheet(false)}
        onApply={(c) => onCategory(c)}
      />
      <FilterSheet
        open={brandSheet}
        title="Marque"
        options={[
          { key: 'Tout', label: 'Tout' },
          ...BRAND_FILTERS.map((b) => ({ key: b.key, label: b.label })),
        ]}
        selected={brandKey}
        onClose={() => setBrandSheet(false)}
        onApply={(key) => onBrand(key)}
      />
    </div>
  )
}
