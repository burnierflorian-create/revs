// Shared coloured category badge — one system across the Explorer (News)
// and the Fil. Maps a raw category string (spot enum, news category, fr/en
// spellings) to a { label, color }. Returns null when the category has no
// dedicated colour (e.g. "other", "F1", "Events") so callers can skip the
// badge or fall back to a neutral chip.

export type CategoryBadge = { label: string; color: string }

export function categoryBadge(
  raw: string | null | undefined,
): CategoryBadge | null {
  const c = (raw ?? '').toLowerCase().trim()
  if (c === 'supercar' || c === 'supercars')
    return { label: 'SUPERCAR', color: '#E8203A' }
  if (c === 'hypercar' || c === 'hypercars')
    return { label: 'HYPERCAR', color: '#9B59B6' }
  if (c === 'jdm') return { label: 'JDM', color: '#FF6B00' }
  if (c === 'electric' || c === 'électrique' || c === 'electrique' || c === 'ev')
    return { label: 'ÉLECTRIQUE', color: '#4DA6FF' }
  if (c === 'classic' || c === 'classique' || c === 'youngtimer')
    return { label: 'CLASSIQUE', color: '#C8A96E' }
  if (c === 'suv' || c === 'crossover')
    return { label: 'SUV', color: '#2FAE74' }
  return null
}
