import GarageIllustration from './GarageIllustration'
import type { SpotCategory } from '../lib/spots'

/** Renders a uniform garage tile. Photos are no longer used — every
 *  tile renders the stylised SVG illustration (with an optional brand-
 *  coloured under-car glow). The text block sits over the illustration
 *  in its own layer so the brand stays legible on every tile. */
export default function GarageCard({
  brand,
  model,
  year,
  category,
}: {
  brand: string
  model: string
  year?: number | null
  category?: SpotCategory | string
  // Kept for backwards compat with existing call sites — ignored.
  imageUrl?: string | null
}) {
  return (
    <>
      {/* SVG illustration fills the tile. */}
      <GarageIllustration
        brand={brand}
        model={model}
        year={year}
        category={category}
        className="absolute inset-0"
      />

      {/* Year badge top-right — transparent glass chip so the
          illustration's brand glow still bleeds through, per the
          launch polish spec (309496.jpg). */}
      {typeof year === 'number' && year > 1900 && (
        <span
          className="label-up absolute right-3 top-3 rounded-md px-2 py-0.5 font-bold text-fg/90"
          style={{
            background: 'rgba(255, 255, 255, 0.10)',
            border: '1px solid rgba(255, 255, 255, 0.10)',
            backdropFilter: 'saturate(150%) blur(12px)',
            WebkitBackdropFilter: 'saturate(150%) blur(12px)',
            fontSize: '10px',
            letterSpacing: '0.06em',
          }}
        >
          {year}
        </span>
      )}

      {/* Text band bottom — solid dark strip with a top-edge gradient
          so the SVG above never gets dimmed (the previous gradient went
          too high). Brand small caps then model bold white. */}
      <div
        className="absolute inset-x-0 bottom-0 px-3 pb-3 pt-2"
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.78) 40%, rgba(0,0,0,0.92) 100%)',
        }}
      >
        <p className="label-up truncate text-[10px] text-fg/55">
          {brand}
        </p>
        <p className="truncate font-display text-sm font-extrabold leading-tight tracking-tighter text-white">
          {model}
        </p>
      </div>
    </>
  )
}
