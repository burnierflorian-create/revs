import { useEffect, useRef, useState } from 'react'

/** XP progress bar with an animated "liquid" gradient sheen + rising
 *  bubbles. When `pct` increases (XP gained) the flow speeds up for 1s.
 *  The motion is purely CSS, so prefers-reduced-motion (handled in
 *  design-system.css) stills it automatically. */
export default function LiquidXpBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct))
  const [boost, setBoost] = useState(false)
  const prev = useRef(clamped)

  useEffect(() => {
    if (clamped > prev.current) {
      setBoost(true)
      const t = window.setTimeout(() => setBoost(false), 1000)
      prev.current = clamped
      return () => window.clearTimeout(t)
    }
    prev.current = clamped
  }, [clamped])

  return (
    <div className="liquid-xp-track">
      <div
        className={`liquid-xp-fill${boost ? ' boost' : ''}`}
        style={{ width: `${clamped}%` }}
      >
        {[22, 55, 82].map((left, i) => (
          <span
            key={i}
            className="liquid-xp-bubble"
            style={{ left: `${left}%`, animationDelay: `${i * 0.7}s` }}
          />
        ))}
      </div>
    </div>
  )
}
