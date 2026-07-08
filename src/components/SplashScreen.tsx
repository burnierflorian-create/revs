import { useEffect, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion'

// Premium launch splash: a supercar tears across the screen with speed lines
// and a motion-blur trail; "REVS" is revealed in its wake, then the whole
// thing fades to the app. ~2.3s, 100% GPU (transform/opacity only). Skipped
// under reduced motion. It's an OVERLAY — the app boots underneath, so it
// never blocks; it just auto-dismisses.

const DURATION = 2350

// Sleek right-facing supercar silhouette (drives left → right).
function CarGlyph() {
  return (
    <svg
      viewBox="0 0 344 128"
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="rvBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3d3d44" />
          <stop offset="42%" stopColor="#191a1e" />
          <stop offset="100%" stopColor="#050506" />
        </linearGradient>
        <linearGradient id="rvRim" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#E8203A" stopOpacity="0" />
          <stop offset="58%" stopColor="#FF5A6E" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#E8203A" stopOpacity="0.15" />
        </linearGradient>
      </defs>

      {/* wheel-arch shadows tuck the wheels under the body */}
      <ellipse cx="80" cy="86" rx="26" ry="16" fill="#000" opacity="0.5" />
      <ellipse cx="262" cy="86" rx="26" ry="16" fill="#000" opacity="0.5" />
      {/* wheels */}
      <g>
        <circle cx="80" cy="90" r="19" fill="#0a0a0b" />
        <circle cx="80" cy="90" r="19" fill="none" stroke="#54545c" strokeWidth="2.5" />
        <circle cx="80" cy="90" r="7.5" fill="#2a2a2e" />
        <circle cx="262" cy="90" r="19" fill="#0a0a0b" />
        <circle cx="262" cy="90" r="19" fill="none" stroke="#54545c" strokeWidth="2.5" />
        <circle cx="262" cy="90" r="7.5" fill="#2a2a2e" />
      </g>

      {/* body — low GT wedge, nose to the right (direction of travel) */}
      <path
        d="M 20 90 C 18 74 24 68 44 65 C 72 61 100 59 124 57 C 134 43 158 37 184 40 C 198 41 212 45 226 50 C 260 56 292 69 320 81 L 334 88 L 334 90 Z"
        fill="url(#rvBody)"
      />
      {/* bright red rim-light flowing along the roofline */}
      <path
        d="M 20 90 C 18 74 24 68 44 65 C 72 61 100 59 124 57 C 134 43 158 37 184 40 C 198 41 212 45 226 50 C 260 56 292 69 320 81 L 334 88"
        fill="none"
        stroke="url(#rvRim)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      {/* cabin glass */}
      <path
        d="M 138 57 C 146 45 162 41 180 43 C 192 44 202 47 210 50 L 132 57 Z"
        fill="#0b0d12"
        opacity="0.92"
      />
      {/* rear tail-light */}
      <rect x="21" y="66" width="7" height="9" rx="2" fill="#E8203A" />
      {/* head-light (front, right) */}
      <path d="M 308 74 L 330 84 L 324 88 L 304 78 Z" fill="#fff" opacity="0.85" />
      {/* side vent accent */}
      <path d="M 150 76 L 200 78 L 198 82 L 150 80 Z" fill="#000" opacity="0.45" />
    </svg>
  )
}

export default function SplashScreen() {
  const [gone, setGone] = useState(() => prefersReducedMotion())

  useEffect(() => {
    if (gone) return
    const t = window.setTimeout(() => setGone(true), DURATION)
    return () => window.clearTimeout(t)
  }, [gone])

  if (gone) return null

  return (
    <div className="rvsplash" aria-hidden>
      {/* dark red horizon glow */}
      <div className="rvsplash-glow" />

      {/* rushing speed lines */}
      <div className="rvsplash-lines">
        {Array.from({ length: 8 }).map((_, i) => (
          <span
            key={i}
            className="rvsplash-line"
            style={{
              top: `${16 + i * 8.5}%`,
              animationDelay: `${0.05 + i * 0.04}s`,
              width: `${30 + ((i * 37) % 45)}%`,
              opacity: 0.12 + (i % 3) * 0.16,
            }}
          />
        ))}
      </div>

      {/* REVS — revealed in the car's wake */}
      <div className="rvsplash-word">
        {['R', 'E', 'V', 'S'].map((ch, i) => (
          <span
            key={ch}
            className="rvsplash-letter"
            style={{ animationDelay: `${0.6 + i * 0.1}s` }}
          >
            {ch}
          </span>
        ))}
        <span className="rvsplash-glint" />
      </div>
      <div className="rvsplash-tag">CARSPOTTING</div>

      {/* the car: motion-blur ghosts trailing the solid body */}
      <div className="rvsplash-car">
        <span className="rvsplash-ghost rvsplash-ghost-3">
          <CarGlyph />
        </span>
        <span className="rvsplash-ghost rvsplash-ghost-2">
          <CarGlyph />
        </span>
        <span className="rvsplash-ghost rvsplash-ghost-1">
          <CarGlyph />
        </span>
        <span className="rvsplash-underglow" />
        <span className="rvsplash-body">
          <CarGlyph />
        </span>
      </div>
    </div>
  )
}
