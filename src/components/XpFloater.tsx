import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion'

type FloatEvent = { id: number; amount: number }

const CHANNEL = 'revs:xp-float'
let nextId = 1

/** Fire a "+N XP ⚡" floater from anywhere in the app. The mounted
 *  <XpFloater /> overlay (see MainLayout) listens to this event and
 *  animates a game-style toast upward with a count-up. Calling it from N
 *  places at once stacks the toasts vertically. The optional `rarity` arg
 *  is kept for call-site compatibility; the toast colour is now fixed
 *  (red number, white "XP ⚡"). */
export function floatXp(amount: number, _rarity?: string) {
  void _rarity
  if (!Number.isFinite(amount) || amount <= 0) return
  window.dispatchEvent(
    new CustomEvent<{ amount: number }>(CHANNEL, { detail: { amount } }),
  )
}

/** Counts from 0 → value over ~0.8s (eased), then holds. Static when the
 *  user prefers reduced motion. */
function CountUp({ value }: { value: number }) {
  const [n, setN] = useState(() => (prefersReducedMotion() ? value : 0))
  const rafRef = useRef(0)

  useEffect(() => {
    if (prefersReducedMotion()) {
      setN(value)
      return
    }
    const DURATION = 800
    let start: number | null = null
    const tick = (t: number) => {
      if (start === null) start = t
      const p = Math.min(1, (t - start) / DURATION)
      // easeOutCubic for a fast-then-soft count.
      const eased = 1 - Math.pow(1 - p, 3)
      setN(Math.round(eased * value))
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value])

  return <>{n}</>
}

/** Global XP toast overlay. Mount once near the root (MainLayout). */
export default function XpFloater() {
  const [events, setEvents] = useState<FloatEvent[]>([])

  useEffect(() => {
    const handler = (e: Event) => {
      const { amount } = (e as CustomEvent<{ amount: number }>).detail
      const id = nextId++
      setEvents((cur) => [...cur, { id, amount }])
      window.setTimeout(() => {
        setEvents((cur) => cur.filter((ev) => ev.id !== id))
      }, 1600)
    }
    window.addEventListener(CHANNEL, handler)
    return () => window.removeEventListener(CHANNEL, handler)
  }, [])

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 bottom-28 z-[60]"
    >
      {events.map((ev, i) => (
        <div
          key={ev.id}
          className="fx-xp-toast"
          // Stack concurrent toasts: each sits 40px above the previous.
          style={{ bottom: i * 40 }}
        >
          <span style={{ color: '#E8203A' }}>
            +<CountUp value={ev.amount} />
          </span>
          <span style={{ color: '#fff' }}> XP ⚡</span>
        </div>
      ))}
    </div>
  )
}
