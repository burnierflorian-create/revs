// XP levels — Débutant 0-99, Chasseur 100-299, Expert 300-699,
// Élite 700-1499, Légende 1500+. `max` is exclusive; null = top tier.
const TIERS: { name: string; min: number; max: number | null }[] = [
  { name: 'Débutant', min: 0, max: 100 },
  { name: 'Chasseur', min: 100, max: 300 },
  { name: 'Expert', min: 300, max: 700 },
  { name: 'Élite', min: 700, max: 1500 },
  { name: 'Légende', min: 1500, max: null },
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
