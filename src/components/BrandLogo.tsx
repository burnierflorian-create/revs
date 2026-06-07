import { useMemo, useState } from 'react'
import { logoCandidates, type Brand, wordmarkDataUrl } from '../lib/brands'

// Renders a brand logo on the app's dark theme.
//
// Fallback chain (each step triggers on <img onError>):
//   1..N. Every URL in `logoCandidates(brand)` — typically a hand-rolled
//         inline-SVG wordmark for hard cases, then carlogos.org, then
//         Wikimedia, then Clearbit.
//   final. A generic wordmark SVG with the brand name in display font —
//         never an initials chip.
//
// Sizing model:
//   - Outer container is a perfect SIZE×SIZE square so the grid stays
//     uniform regardless of which logo loads.
//   - Inside, `inner` ratio leaves consistent breathing room (~16 px at
//     the grid size of 88). `brand.logoScale` lets per-brand outliers
//     (McLaren speedmark, Koenigsegg shield) grow proportionally.
//
// Container background is transparent on purpose — callers control the
// surface (brand-coloured hero on the detail page, dark or brand-tinted
// card in the grid). For brands flagged `invertOnDark`, a CSS filter
// renders the (otherwise dark) logo as a pure white silhouette.
// `brand.logoFilter` is then composed on top for finer tweaks
// (brightness, contrast).
export default function BrandLogo({
  brand,
  size = 64,
  className = '',
  mono = false,
}: {
  brand: Brand
  size?: number
  className?: string
  // When true, render the logo as a single theme-aware silhouette
  // (white on dark, charcoal on light) via the .brand-logo-mono class —
  // overrides the per-brand colour/invert filters. Used by the Explorer
  // grid so every mark reads cleanly on the OLED background.
  mono?: boolean
}) {
  const sources = useMemo(() => logoCandidates(brand), [brand])
  const [cursor, setCursor] = useState(0)

  // Default inner ratio: 0.64 → roughly 16 px of breathing room on each
  // side at the grid container size (88 px), which is what the design
  // brief specifies. `logoScale` multiplies it for outliers with too
  // much empty space inside the source asset. Capped at 0.96 so the
  // logo never bleeds to the very edge of the container.
  const inner = Math.min(0.96, 0.64 * (brand.logoScale ?? 1))
  const imgPx = Math.round(size * inner)

  // If every external URL failed, render the generic wordmark SVG
  // (brand name in display font) inside the same <img> container —
  // never falls back to a 2-letter initials chip.
  const src =
    cursor >= sources.length ? wordmarkDataUrl(brand.name) : sources[cursor]

  // Full per-brand treatment used on the colour brand-detail hero.
  const perBrandFilter = [
    brand.invertOnDark ? 'brightness(0) invert(1)' : '',
    brand.logoFilter ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  // In the Explorer list (mono), the theme-aware monochrome class is only
  // safe for SVG GLYPHS (inline monograms/wordmarks) and brands flagged as
  // dark wordmarks — there it flips white↔charcoal cleanly. Colored or
  // detailed logos (BMW roundel, Ferrari, etc.) keep their REAL colours:
  // the destructive brightness(0)·invert flattens them into a white blob,
  // and they read perfectly on both themes as-is. Off the list (detail
  // page) we keep the original per-brand filter.
  const inline = src.startsWith('data:')
  const monoActive = mono && (inline || brand.invertOnDark === true)
  const monoClass = monoActive ? 'brand-logo-mono' : undefined
  const appliedFilter = monoActive
    ? undefined
    : mono
      ? brand.logoFilter || undefined
      : perBrandFilter || undefined

  return (
    <div
      className={`flex flex-none items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src={src}
        alt={brand.name}
        loading="lazy"
        onError={() => setCursor((c) => c + 1)}
        className={monoClass}
        style={{
          width: imgPx,
          height: imgPx,
          objectFit: 'contain',
          filter: appliedFilter,
        }}
      />
    </div>
  )
}
