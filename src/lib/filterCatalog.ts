import { bodyTypeFor } from './car-body-type'
import { BRANDS } from './brands'
import { ELECTRIC_RE } from './spotCategory'
import type { Spot } from './spots'

// ───────────────────────── Categories ─────────────────────────
// Full list shown in the "Voir plus" category sheet (singular labels).
export const CATEGORY_FILTERS = [
  'Tout',
  'Supercars',
  'Hypercars',
  'JDM',
  'Électrique',
  'Classique',
  'SUV',
  'Berline',
  'Coupé',
] as const

// Level-1 quick row (always visible) — the rest live behind "Voir plus".
export const CATEGORY_QUICK = ['Tout', 'Supercars', 'Hypercars'] as const

/** Whether a spot matches a category bucket. Accepts both the singular
 *  labels used by the new pills (Berline, Coupé) and the legacy plural
 *  ones still used by the advanced sheet (Berlines, Coupés, Cabriolets),
 *  so every surface resolves through this single matcher. */
export function matchesCategoryFilter(s: Spot, cat: string): boolean {
  switch (cat) {
    case 'Tout':
      return true
    case 'Supercars':
      return (
        s.category === 'supercar' ||
        bodyTypeFor(s.brand, s.model, s.category) === 'supercar'
      )
    case 'Hypercars':
      return (
        s.category === 'hypercar' ||
        bodyTypeFor(s.brand, s.model, s.category) === 'hypercar'
      )
    case 'JDM':
      return (
        s.category === 'JDM' ||
        bodyTypeFor(s.brand, s.model, s.category) === 'jdm-sport'
      )
    case 'Électrique':
      return ELECTRIC_RE.test(`${s.brand} ${s.model}`)
    case 'Classique':
      return s.category === 'classic' || s.category === 'youngtimer'
    case 'SUV': {
      const bt = bodyTypeFor(s.brand, s.model, s.category)
      return bt === 'suv' || bt === 'suv-coupe' || bt === 'mini-suv'
    }
    case 'Berline':
    case 'Berlines': {
      const bt = bodyTypeFor(s.brand, s.model, s.category)
      return bt === 'sedan' || bt === 'sport-sedan'
    }
    case 'Coupé':
    case 'Coupés':
      return /\bcoupe\b|\bcoupé\b/i.test(`${s.brand} ${s.model}`)
    case 'Cabriolets':
      return /\bcabriolet\b|\bconvertible\b|\bspider\b|\bspyder\b|\broadster\b|\btarga\b/i.test(
        `${s.brand} ${s.model}`,
      )
    case 'Autre':
      return (
        s.category === 'other' ||
        s.category === 'classic' ||
        s.category === 'youngtimer'
      )
    default:
      return true
  }
}

// ───────────────────────── Brands ─────────────────────────
export type BrandFilter = { key: string; label: string; match: string[] }

// The 36 brands surfaced in the "Voir plus" brand sheet, in the requested
// order. `key` is the catalogue slug (so it round-trips with the rest of
// the app); the match substrings are pulled from BRANDS when available,
// with a name fallback for the two brands not catalogued (BAC, Ginetta).
const WANTED: { key: string; label: string }[] = [
  { key: 'ferrari', label: 'Ferrari' },
  { key: 'lamborghini', label: 'Lamborghini' },
  { key: 'mclaren', label: 'McLaren' },
  { key: 'porsche', label: 'Porsche' },
  { key: 'mercedes-benz', label: 'Mercedes-AMG' },
  { key: 'bmw', label: 'BMW' },
  { key: 'audi', label: 'Audi' },
  { key: 'bentley', label: 'Bentley' },
  { key: 'rolls-royce', label: 'Rolls-Royce' },
  { key: 'bugatti', label: 'Bugatti' },
  { key: 'koenigsegg', label: 'Koenigsegg' },
  { key: 'pagani', label: 'Pagani' },
  { key: 'aston-martin', label: 'Aston Martin' },
  { key: 'maserati', label: 'Maserati' },
  { key: 'alfa-romeo', label: 'Alfa Romeo' },
  { key: 'toyota', label: 'Toyota' },
  { key: 'nissan', label: 'Nissan' },
  { key: 'honda', label: 'Honda' },
  { key: 'mazda', label: 'Mazda' },
  { key: 'subaru', label: 'Subaru' },
  { key: 'ford', label: 'Ford' },
  { key: 'chevrolet', label: 'Chevrolet' },
  { key: 'dodge', label: 'Dodge' },
  { key: 'cadillac', label: 'Cadillac' },
  { key: 'range-rover', label: 'Range Rover' },
  { key: 'jeep', label: 'Jeep' },
  { key: 'rimac', label: 'Rimac' },
  { key: 'lotus', label: 'Lotus' },
  { key: 'noble', label: 'Noble' },
  { key: 'tvr', label: 'TVR' },
  { key: 'caterham', label: 'Caterham' },
  { key: 'ariel', label: 'Ariel' },
  { key: 'bac', label: 'BAC' },
  { key: 'radical', label: 'Radical' },
  { key: 'ginetta', label: 'Ginetta' },
  { key: 'singer', label: 'Singer' },
]

export const BRAND_FILTERS: BrandFilter[] = WANTED.map((w) => {
  const b = BRANDS.find((x) => x.slug === w.key)
  return {
    key: w.key,
    label: w.label,
    match: b?.match ?? [w.label.toLowerCase()],
  }
})

// Level-1 quick brand keys ('Tout' is rendered separately by the bar).
export const BRAND_QUICK = ['ferrari', 'lamborghini'] as const

/** Whether a spot matches a brand key. Resolves match substrings from the
 *  36-brand catalogue first, then falls back to the full BRANDS list so
 *  brands chosen in the advanced sheet (any of the ~69 slugs) still work. */
export function matchesBrandFilter(s: Spot, key: string | null): boolean {
  if (!key || key === 'Tout') return true
  const match =
    BRAND_FILTERS.find((b) => b.key === key)?.match ??
    BRANDS.find((b) => b.slug === key)?.match ??
    [key.replace(/-/g, ' ')]
  const needle = (s.brand ?? '').toLowerCase()
  return match.some((m) => needle.includes(m))
}
