// Shared "passions auto" preference vocabulary — used by both the
// onboarding flow (collection) and Settings → "Mes passions auto"
// (editing). Kept in one place so the option ids, i18n keys and limits
// never drift between the two screens.
//
// STORAGE ONLY for now: these feed profiles.preferred_brands /
// preferred_universes / ambition. The personalisation modules that read
// them (challenges, leagues, XP, home content) come in later chantiers.

// Universe ids — i18n at onboarding.universes.options.<id>. Brands are
// not enumerated here; they come from CAR_MAKES in ./cars.
export const UNIVERSES = [
  'hypercars_supercars',
  'f1_motorsport',
  'gt_touring',
  'youngtimers_classics',
  'jdm',
  'muscle_american',
  'hot_hatch',
  'luxury_prestige',
  'tuning',
  'suv_4x4',
] as const

// Ambition ids — single choice. i18n at onboarding.ambition.options.<id>.
// Mirrors the profiles_ambition_check DB constraint (0060).
export const AMBITIONS = [
  'fun',
  'ranking',
  'city_number_one',
  'collection',
] as const

export type Universe = (typeof UNIVERSES)[number]
export type Ambition = (typeof AMBITIONS)[number]

export const MAX_BRANDS = 3
export const MAX_UNIVERSES = 3

// Toggle an id in a multi-select array, enforcing a max count. Selecting
// an already-selected id removes it; selecting a new one past the cap is a
// no-op (the UI disables unselected options at the cap, this is a guard).
export function toggleCapped(
  list: string[],
  id: string,
  max: number,
): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id)
  if (list.length >= max) return list
  return [...list, id]
}
