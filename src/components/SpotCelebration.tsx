import { useEffect, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion'

const CHANNEL = 'revs:spot-celebrate'
const COLORS = ['#E8203A', '#C8A96E', '#ffffff']

type CelebrateDetail = { photoUrl?: string | null }

/** Fire the post-spot celebration (confetti burst + collector card that
 *  scales in then flies to the profile corner). Call right after a spot's
 *  insert succeeds. No-op under reduced motion (handled by the overlay). */
export function celebrateSpot(detail: CelebrateDetail = {}) {
  window.dispatchEvent(new CustomEvent<CelebrateDetail>(CHANNEL, { detail }))
}

type Burst = { id: number; photoUrl: string | null; particles: Particle[] }

type Particle = {
  dx: number
  dy: number
  rot: number
  size: number
  color: string
  dur: number
  circle: boolean
}

function makeParticles(): Particle[] {
  return Array.from({ length: 40 }, () => {
    const angle = Math.random() * Math.PI * 2
    const dist = 150 + Math.random() * 150 // 150–300px
    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      rot: (Math.random() - 0.5) * 1080,
      size: 4 + Math.random() * 4, // 4–8px
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      dur: 1 + Math.random() * 0.5, // 1–1.5s
      circle: Math.random() > 0.5,
    }
  })
}

function CelebrationOverlay({
  photoUrl,
  particles,
}: {
  photoUrl: string | null
  particles: Particle[]
}) {
  return (
    <div className="fx-overlay" aria-hidden>
      {particles.map((p, i) => (
        <span
          key={i}
          className="fx-confetti"
          style={
            {
              '--dx': `${p.dx}px`,
              '--dy': `${p.dy}px`,
              '--rot': `${p.rot}deg`,
              '--sz': `${p.size}px`,
              '--col': p.color,
              '--rad': p.circle ? '50%' : '1px',
              '--dur': `${p.dur}s`,
            } as React.CSSProperties
          }
        />
      ))}
      <div className="fx-collector-mini">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt=""
            className="h-full w-full object-cover"
            style={{ border: '2px solid #C8A96E', borderRadius: 14 }}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center font-display text-4xl font-black"
            style={{ color: '#E8203A' }}
          >
            R
          </div>
        )}
      </div>
    </div>
  )
}

/** Global mount (MainLayout). Listens for celebrateSpot() and plays the
 *  ~2.6s overlay once, then unmounts it. Skipped under reduced motion. */
export default function SpotCelebration() {
  const [burst, setBurst] = useState<Burst | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      if (prefersReducedMotion()) return
      const { photoUrl } = (e as CustomEvent<CelebrateDetail>).detail ?? {}
      // Generate particles in the handler (not render) so the overlay
      // render stays pure/idempotent.
      const id = Date.now()
      setBurst({ id, photoUrl: photoUrl ?? null, particles: makeParticles() })
      window.setTimeout(() => {
        setBurst((cur) => (cur?.id === id ? null : cur))
      }, 2800)
    }
    window.addEventListener(CHANNEL, handler)
    return () => window.removeEventListener(CHANNEL, handler)
  }, [])

  if (!burst) return null
  return (
    <CelebrationOverlay
      key={burst.id}
      photoUrl={burst.photoUrl}
      particles={burst.particles}
    />
  )
}
