import { bodyTypeFor } from './car-body-type'
import type { Spot } from './spots'

// Shared pill-category matcher used by the Fil (Feed) and the Carte (Map)
// horizontal filter pills. Keeps the electric/classic detection in one
// place so the two surfaces stay in sync.
//
// "Tout" / "Tous" (show everything) and "Près de moi" (a sort, not a
// category) are handled by the callers — this only resolves the real
// category buckets.

// Electric detection — there's no stored `electric` category, so we match
// on well-known EV brand/model name cues.
export const ELECTRIC_RE =
  /\b(tesla|model [sx3y]|polestar|rivian|lucid|taycan|e-?tron|eqa|eqb|eqc|eqe|eqs|ioniq|\bid\.?\s?[3457]\b|nissan leaf|\bleaf\b|\bzoe\b|cupra born|\bborn\b|fisker|eletre|mach-?e|nio|\bbyd\b|xpeng|\bev6\b|\bevs?\b|électrique|electric)\b/i

export function matchesPillCategory(s: Spot, cat: string): boolean {
  switch (cat) {
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
    default:
      // Unknown bucket / "Tout" / "Tous" → no filtering.
      return true
  }
}
