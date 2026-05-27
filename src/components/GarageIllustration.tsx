import { bodyTypeFor } from '../lib/car-body-type'
import type { SpotCategory } from '../lib/spots'
import CarSilhouette from './CarSilhouettes'

// Brand+model → custom under-car glow colour. Order matters: more
// specific patterns first. Cars that don't match return `null` and the
// tile renders without a coloured glow.
const GLOWS: { match: RegExp; color: string }[] = [
  { match: /mercedes.*amg gt.*(roadster|cabriolet|spider)/i, color: '#E8203A' },
  { match: /mclaren.*570/i, color: '#FF6B00' },
  { match: /audi.*tt rs/i, color: '#C0C0FF' },
  { match: /mercedes.*gle 63.*coupe?/i, color: '#C8A96E' },
  { match: /porsche.*cayenne coupe?/i, color: '#A8C4D4' },
  { match: /toyota.*(gr|gt)[- ]?86/i, color: '#E8203A' },
  { match: /nissan.*juke/i, color: '#7EC8A4' },
  { match: /bmw.*i4/i, color: '#4DA6FF' },
]

function glowFor(brand: string, model: string): string | null {
  const full = `${brand} ${model}`
  for (const rule of GLOWS) {
    if (rule.match.test(full)) return rule.color
  }
  return null
}

/** Studio-photo style backdrop for a stylised SVG car illustration.
 *  Mimics a press shot: dark ceiling, brand-coloured floor reflection,
 *  spotlight vignette top corners, horizon line ~60 % down. The
 *  silhouette sits on top — its outline picks up a hint of the brand
 *  glow colour so it feels integrated with the lighting. */
export default function GarageIllustration({
  brand,
  model,
  category,
  className,
}: {
  brand: string
  model: string
  year?: number | null
  category?: SpotCategory | string
  className?: string
}) {
  const bodyType = bodyTypeFor(brand, model, category)
  const glow = glowFor(brand, model) ?? '#E8203A'
  // Inline `position: absolute` so we don't fight Tailwind's class
  // ordering (`.relative` would otherwise win over a Tailwind `.absolute`
  // class and collapse the layout — see previous fix).
  return (
    <div
      className={className ?? ''}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: '#0d0d10',
      }}
    >
      {/* Layer 1 — studio backdrop. Dark ceiling, slightly lighter
          midband, a faint horizon hint at ~58 % down. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, #0a0a0c 0%, #14141a 35%, #1a1a22 58%, #0e0e12 100%)',
        }}
      />

      {/* Layer 2 — horizon line. A thin glow at the floor seam helps
          the car read as "standing on a stage". */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '58%',
          height: '1px',
          background: `linear-gradient(90deg, transparent 0%, ${glow}66 50%, transparent 100%)`,
        }}
      />

      {/* Layer 3 — brand-coloured floor reflection. Soft wide ellipse
          centered at the car wheels. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse 75% 32% at 50% 76%, ${glow}AA 0%, ${glow}33 45%, transparent 75%)`,
        }}
      />

      {/* Layer 4 — soft side spotlights (studio lights). Faint cool
          cones from the top corners. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 50% 40% at 15% 0%, rgba(255,255,255,0.07) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 85% 0%, rgba(255,255,255,0.07) 0%, transparent 60%)',
        }}
      />

      {/* Layer 5 — the SVG itself. Flex-centered with padding to keep
          it inside the upper 2/3 of the tile (text band below). A
          subtle brand-tinted drop shadow gives it weight. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          paddingTop: '4%',
          paddingBottom: '28%',
          paddingLeft: '2%',
          paddingRight: '2%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          filter: `drop-shadow(0 8px 16px rgba(0,0,0,0.55)) drop-shadow(0 2px 4px ${glow}80)`,
        }}
      >
        <CarSilhouette type={bodyType} />
      </div>

      {/* Layer 6 — top-edge inner shadow for extra depth. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.50) 0%, transparent 30%)',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
