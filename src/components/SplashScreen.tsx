import { useEffect, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion'

/** Animated launch splash. Shows on every full app load: the letters
 *  R·E·V·S fly in from the right with a motion blur, the logo pulses,
 *  "CARSPOTTING" spreads in red underneath, then the whole thing fades to
 *  reveal the app. Skipped entirely under reduced motion. */
export default function SplashScreen() {
  const [gone, setGone] = useState(() => prefersReducedMotion())

  useEffect(() => {
    if (gone) return
    const t = window.setTimeout(() => setGone(true), 2500)
    return () => window.clearTimeout(t)
  }, [gone])

  if (gone) return null

  return (
    <div className="splash-screen" aria-hidden>
      <div className="splash-logo">
        {['R', 'E', 'V', 'S'].map((ch, i) => (
          <span
            key={ch}
            className="splash-letter"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            {ch}
          </span>
        ))}
      </div>
      <div className="splash-tagline">CARSPOTTING</div>
    </div>
  )
}
