import type { Rarity } from './spots'

// ─────────────────────────────────────────────────────────────────────
// Deterministic rarity from market value. Rarity is computed ONCE, when a
// model is first spotted (from its resale value), then FROZEN in the DB.
// Every later spot of that model reads the stored rarity — no recompute.
//
// Thresholds are the single source of truth (mirror them server-side in
// identify-car once validated). Bands are on the resale/market value in €.
// ─────────────────────────────────────────────────────────────────────

export type RarityBand = {
  rarity: Rarity
  label: string
  /** Inclusive lower bound in € (upper bound = next band's min − 1). */
  min: number
}

// PROPOSAL — awaiting validation. Tune the numbers here; everything else
// (identify-car, cards, badges) derives from this table.
export const RARITY_BANDS: RarityBand[] = [
  { rarity: 'standard', label: 'Commun', min: 0 },
  { rarity: 'premium', label: 'Peu commun', min: 20_000 },
  { rarity: 'performance', label: 'Rare', min: 45_000 },
  { rarity: 'exclusif', label: 'Épique', min: 90_000 },
  { rarity: 'supercar', label: 'Ultra Rare', min: 130_000 },
  { rarity: 'hypercar', label: 'Légendaire', min: 400_000 },
]

/** Rarity from a market value (€). Unknown/0 price → the lowest tier. */
export function rarityFromPrice(price: number | null | undefined): Rarity {
  if (price == null || price <= 0) return 'standard'
  let out: Rarity = 'standard'
  for (const b of RARITY_BANDS) if (price >= b.min) out = b.rarity
  return out
}

/** Human range label for a band, e.g. "45 000 – 89 999 €" or "≥ 500 000 €". */
export function bandRange(i: number): string {
  const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(n)
  const lo = RARITY_BANDS[i].min
  const hi = RARITY_BANDS[i + 1]?.min
  if (lo === 0) return `< ${fmt(RARITY_BANDS[1].min)} €`
  return hi ? `${fmt(lo)} – ${fmt(hi - 1)} €` : `≥ ${fmt(lo)} €`
}
