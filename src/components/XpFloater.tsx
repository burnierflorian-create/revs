import { useEffect, useState } from 'react'
import { Zap } from 'lucide-react'

type FloatEvent = { id: number; amount: number; color: string }

const CHANNEL = 'revs:xp-float'
let nextId = 1

// Neon green for the rare tiers (a rare catch deserves a different colour
// than a daily standard spot), the brand red otherwise.
const NEON = '#39FF6A'
const RED = '#E8203A'
const RARE = new Set(['hypercar', 'exclusif', 'supercar', 'performance'])
function colorForRarity(rarity?: string): string {
  return rarity && RARE.has(rarity.toLowerCase()) ? NEON : RED
}

/** Fire a "+N XP" floater from anywhere in the app. The mounted
 *  <XpFloater /> overlay (see MainLayout) listens to this event and
 *  animates a pill upward. The pill is neon-green for rare spots, red
 *  otherwise. Calling this from N places at once stacks the floaters
 *  cleanly — each gets its own animation lifecycle. */
export function floatXp(amount: number, rarity?: string) {
  if (!Number.isFinite(amount) || amount <= 0) return
  window.dispatchEvent(
    new CustomEvent<{ amount: number; color: string }>(CHANNEL, {
      detail: { amount, color: colorForRarity(rarity) },
    }),
  )
}

/** Global floater overlay. Mount once near the root (MainLayout).
 *  Renders a stack of fading "+N XP" pills triggered by `floatXp()`. */
export default function XpFloater() {
  const [events, setEvents] = useState<FloatEvent[]>([])

  useEffect(() => {
    const handler = (e: Event) => {
      const { amount, color } = (
        e as CustomEvent<{ amount: number; color: string }>
      ).detail
      const id = nextId++
      setEvents((cur) => [...cur, { id, amount, color: color ?? RED }])
      // Remove after the animation finishes (1.6s — matches CSS).
      window.setTimeout(() => {
        setEvents((cur) => cur.filter((ev) => ev.id !== id))
      }, 1700)
    }
    window.addEventListener(CHANNEL, handler)
    return () => window.removeEventListener(CHANNEL, handler)
  }, [])

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 bottom-28 z-[60] flex flex-col items-center"
    >
      {events.map((ev) => (
        <div
          key={ev.id}
          className="xp-float absolute left-1/2 flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-extrabold uppercase tracking-wider"
          style={{
            background: ev.color,
            color: ev.color === RED ? '#fff' : '#04210d',
            boxShadow: `0 6px 24px ${ev.color}66`,
          }}
        >
          <Zap className="h-4 w-4" />+{ev.amount} XP
        </div>
      ))}
    </div>
  )
}
