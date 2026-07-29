import { useEffect } from 'react'
import type { Spot, Rarity } from '../lib/spots'
import { prefersReducedMotion } from '../lib/motion'
import { openShareCard } from './ShareCardSheet'
import CollectorCardV2, { type CardEvolution } from './CollectorCardV2'

// Public API preserved for consumers (MyCollection, LevelUpOverlay, Map,
// BrandDetail, Profile, NewSpot). The visual is now CollectorCardV2 — this
// stays a thin adapter that maps a Spot to the card's props + wires the
// share sheet and the collector serial number.

const RARITY_ORDER: Rarity[] = [
  'standard',
  'premium',
  'performance',
  'exclusif',
  'supercar',
  'hypercar',
]

export function rarityRank(r: Rarity | null | undefined): number {
  return RARITY_ORDER.indexOf((r ?? 'standard') as Rarity)
}

// Stats for the share image, from whatever the spot already carries (no fetch).
function shareStats(spot: Spot) {
  const ci = spot.car_info
  if (!ci) return undefined
  return { power: ci.horsepower, accel: ci.zero_to_100, vmax: ci.top_speed }
}

// Flavor edition sizes → the collector "#012/N" denominator. Rarer tiers get
// a smaller "print run" so the number reads as more precious. Tune here.
const EDITION_SIZE: Record<Rarity, number> = {
  standard: 9999,
  premium: 5000,
  performance: 2000,
  exclusif: 500,
  supercar: 250,
  hypercar: 100,
}

export default function CollectorCard({
  spot,
  cardNumber,
  isFirstOnRevs,
  evolution,
  onViewSpots,
  onChangePhoto,
  reveal = false,
  showShare = false,
}: {
  spot: Spot
  cardNumber: number
  isFirstOnRevs: boolean
  /** Accepted for API compatibility (community count). */
  spotsCount?: number
  /** Per-card level/count/dates/XP → mastery visuals on the card. */
  evolution?: CardEvolution
  /** Card back → open history + hero-photo picker (collection only). */
  onViewSpots?: () => void
  onChangePhoto?: () => void
  reveal?: boolean
  showShare?: boolean
}) {
  const rarity = (spot.rarity ?? 'standard') as Rarity

  // Preserve the wow moment: a freshly-revealed LEGENDARY card auto-opens
  // the share sheet so the user can post it straight to their story.
  useEffect(() => {
    if (!reveal || prefersReducedMotion() || rarity !== 'hypercar') return
    const t = window.setTimeout(() => {
      openShareCard({
        id: spot.id,
        photoUrl: spot.photo_url,
        brand: spot.brand,
        model: spot.model,
        year: spot.year,
        rarity: 'hypercar',
        serial: cardNumber,
        serialTotal: EDITION_SIZE[rarity] ?? 999,
        firstOnRevs: isFirstOnRevs,
        stats: shareStats(spot),
        autoMessage: 'Ta carte est prête à être partagée ! 🔥',
      })
    }, 1400)
    return () => window.clearTimeout(t)
  }, [reveal, rarity, spot])

  return (
    <CollectorCardV2
      photo={spot.photo_url}
      brand={spot.brand}
      model={spot.model}
      year={spot.year}
      category={spot.category}
      rarity={rarity}
      serial={cardNumber}
      serialTotal={EDITION_SIZE[rarity] ?? 999}
      firstOnRevs={isFirstOnRevs}
      evolution={evolution}
      onViewSpots={onViewSpots}
      onChangePhoto={onChangePhoto}
      reveal={reveal && !prefersReducedMotion()}
      showShare={showShare}
      onShare={() =>
        openShareCard({
          id: spot.id,
          photoUrl: spot.photo_url,
          brand: spot.brand,
          model: spot.model,
          year: spot.year,
          rarity,
          serial: cardNumber,
          serialTotal: EDITION_SIZE[rarity] ?? 999,
          firstOnRevs: isFirstOnRevs,
          stats: shareStats(spot),
        })
      }
    />
  )
}
