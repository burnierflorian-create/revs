import { useEffect } from 'react'
import type { Spot, Rarity } from '../lib/spots'
import { prefersReducedMotion } from '../lib/motion'
import { openShareCard } from './ShareCardSheet'
import CollectorCardV2 from './CollectorCardV2'

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
  reveal = false,
  showShare = false,
}: {
  spot: Spot
  cardNumber: number
  isFirstOnRevs: boolean
  /** Accepted for API compatibility (community count) — surfaced on the
   *  card back in a later pass. */
  spotsCount?: number
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
        photoUrl: spot.photo_url,
        brand: spot.brand,
        model: spot.model,
        year: spot.year,
        rarity: 'hypercar',
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
      reveal={reveal && !prefersReducedMotion()}
      showShare={showShare}
      onShare={() =>
        openShareCard({
          photoUrl: spot.photo_url,
          brand: spot.brand,
          model: spot.model,
          year: spot.year,
          rarity,
        })
      }
    />
  )
}
