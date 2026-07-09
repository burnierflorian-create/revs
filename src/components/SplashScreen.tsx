import { useEffect, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion'
import { RevsMark } from './Logo'

// Premium launch splash built on the REVS logo (Piste 2): the R mark tears in
// from the left with speed lines + a motion-blur trail, and "REVS" is revealed
// in its wake (S in red), then it fades to the app. ~2.3s, 100% GPU
// (transform/opacity). Skipped under reduced motion. Overlay — never blocks.

const DURATION = 2350

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

      {/* logo lockup: mark (with motion-blur trail) + REVS revealed */}
      <div className="rvsplash-logo">
        <span className="rvsplash-mark">
          <span className="rvsplash-ghost rvsplash-ghost-3">
            <RevsMark size={100} />
          </span>
          <span className="rvsplash-ghost rvsplash-ghost-2">
            <RevsMark size={100} />
          </span>
          <span className="rvsplash-ghost rvsplash-ghost-1">
            <RevsMark size={100} />
          </span>
          <span className="rvsplash-markmain">
            <RevsMark size={100} />
          </span>
        </span>
        <span className="rvsplash-word">
          {['R', 'E', 'V', 'S'].map((ch, i) => (
            <span
              key={ch}
              className={
                ch === 'S' ? 'rvsplash-letter rvsplash-letter-s' : 'rvsplash-letter'
              }
              style={{ animationDelay: `${0.55 + i * 0.09}s` }}
            >
              {ch}
            </span>
          ))}
          <span className="rvsplash-glint" />
        </span>
      </div>

      <div className="rvsplash-tag">CARSPOTTING</div>
    </div>
  )
}
