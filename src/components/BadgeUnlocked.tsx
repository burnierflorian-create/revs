import { useEffect, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion'

const CHANNEL = 'revs:badge-unlocked'

type BadgeNote = { emoji: string; name: string }

/** Queue a "badge unlocked" notification. Multiple calls stack and play
 *  one after the other. No-op under reduced motion (handled in the host). */
export function notifyBadgeUnlocked(badge: BadgeNote) {
  window.dispatchEvent(new CustomEvent<BadgeNote>(CHANNEL, { detail: badge }))
}

/** Global host (MainLayout). Shows one premium slide-up card at a time,
 *  ~3.6s each, draining the queue. */
export default function BadgeUnlocked() {
  const [queue, setQueue] = useState<BadgeNote[]>([])

  useEffect(() => {
    const handler = (e: Event) => {
      if (prefersReducedMotion()) return
      setQueue((q) => [...q, (e as CustomEvent<BadgeNote>).detail])
    }
    window.addEventListener(CHANNEL, handler)
    return () => window.removeEventListener(CHANNEL, handler)
  }, [])

  const current = queue[0]

  useEffect(() => {
    if (!current) return
    // Matches the CSS: 0.4s in + 3s hold + 0.3s out.
    const t = window.setTimeout(() => setQueue((q) => q.slice(1)), 3700)
    return () => window.clearTimeout(t)
    // Re-arm whenever the visible badge changes.
  }, [current?.name])

  if (!current) return null
  return (
    <div className="badge-unlocked" key={current.name} role="status">
      <span className="badge-unlocked-emoji">{current.emoji}</span>
      <div className="min-w-0">
        <p style={{ fontSize: 12, color: '#9aa0a6', fontWeight: 600 }}>
          Badge débloqué !
        </p>
        <p
          className="truncate"
          style={{ fontSize: 16, color: '#fff', fontWeight: 800 }}
        >
          {current.name}
        </p>
      </div>
    </div>
  )
}
