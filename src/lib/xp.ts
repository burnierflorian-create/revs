// XP levels — full ladder, no upper cap. Each tier's `max` is exclusive
// (a user with `xp === tier.max` already belongs to the next tier).
// The top tier (REVS OG) sets `max: null` to signal "no cap".
const TIERS: { name: string; min: number; max: number | null }[] = [
  { name: 'Rookie',         min: 0,      max: 200 },
  { name: 'Chasseur',       min: 200,    max: 500 },
  { name: 'Expert',         min: 500,    max: 1000 },
  { name: 'Élite',          min: 1000,   max: 2000 },
  { name: 'Maître Spotter', min: 2000,   max: 4000 },
  { name: 'Légende',        min: 4000,   max: 8000 },
  { name: 'Icône REVS',     min: 8000,   max: 15000 },
  { name: 'Fantôme',        min: 15000,  max: 25000 },
  { name: 'Mythique',       min: 25000,  max: 50000 },
  { name: 'REVS OG',        min: 50000,  max: null },
]

export type XpLevel = {
  name: string
  pct: number // progress within the current tier, 0-100
  toNext: number // XP remaining to the next tier (0 if max)
  isMax: boolean
  next: string | null
}

export function xpLevel(xp: number): XpLevel {
  const safe = Math.max(0, Math.floor(xp))
  const idx = TIERS.findIndex((t) => t.max === null || safe < t.max)
  const tier = TIERS[idx]
  if (tier.max === null) {
    return { name: tier.name, pct: 100, toNext: 0, isMax: true, next: null }
  }
  const span = tier.max - tier.min
  const pct = Math.min(100, Math.max(0, Math.round(((safe - tier.min) / span) * 100)))
  return {
    name: tier.name,
    pct,
    toNext: tier.max - safe,
    isMax: false,
    next: TIERS[idx + 1]?.name ?? null,
  }
}

export const XP_LADDER: ReadonlyArray<{ name: string; min: number; max: number | null }> = TIERS
