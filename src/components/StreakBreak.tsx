import { useEffect, useState } from 'react'
import { prefersReducedMotion, vibrate } from '../lib/motion'

const CHANNEL = 'revs:streak-break'

/** Fire the full-screen "streak lost" animation (flame grows, shakes,
 *  then dies into smoke). Call when a streak drops from >0 to 0. */
export function triggerStreakBreak() {
  window.dispatchEvent(new CustomEvent(CHANNEL))
}

/** Global mount (MainLayout). Plays a 2s flame-extinguish overlay. */
export default function StreakBreak() {
  const [on, setOn] = useState(false)

  useEffect(() => {
    const handler = () => {
      if (prefersReducedMotion()) return
      vibrate([100, 50, 100])
      setOn(true)
      window.setTimeout(() => setOn(false), 2000)
    }
    window.addEventListener(CHANNEL, handler)
    return () => window.removeEventListener(CHANNEL, handler)
  }, [])

  if (!on) return null
  return (
    <div className="fx-streak" aria-hidden>
      <div style={{ position: 'relative', width: 120, height: 90 }}>
        <div
          className="fx-streak-flame"
          style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }}
        >
          🔥
        </div>
        {[-18, 0, 18].map((sx, i) => (
          <span
            key={i}
            className="fx-smoke"
            style={{ '--sx': `${sx}px`, animationDelay: `${0.5 + i * 0.12}s` } as React.CSSProperties}
          />
        ))}
      </div>
      <div className="fx-streak-text">Streak perdu 😢</div>
    </div>
  )
}
