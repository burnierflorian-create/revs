import { useEffect, useState } from 'react'
import { prefersReducedMotion, vibrate } from '../lib/motion'
import { XP_LADDER, xpLevel } from '../lib/xp'
import { supabase } from '../lib/supabase'

const CHANNEL = 'revs:level-up'
const LAST_LEVEL_KEY = 'revs_last_level'
const COLORS = ['#E8203A', '#C8A96E', '#ffffff']

type LevelUpDetail = { from: string; to: string }

/** Fire the full-screen level-up sequence directly (old → new tier). */
export function triggerLevelUp(from: string, to: string) {
  window.dispatchEvent(
    new CustomEvent<LevelUpDetail>(CHANNEL, { detail: { from, to } }),
  )
}

function ladderIndex(name: string): number {
  return XP_LADDER.findIndex((l) => l.name === name)
}

/** Compare the user's current tier against the last one we saw (stored in
 *  localStorage) and fire the overlay if they advanced. Pass a known XP
 *  total to skip the network round-trip; otherwise it reads my_xp. The
 *  first call ever just seeds the baseline silently (no false positive). */
export async function checkLevelUp(knownXp?: number): Promise<void> {
  let xp = knownXp
  if (xp == null) {
    try {
      const { data } = await supabase.rpc('my_xp')
      xp = (data as number | null) ?? 0
    } catch {
      return
    }
  }
  const current = xpLevel(xp).name
  let previous: string | null = null
  try {
    previous = localStorage.getItem(LAST_LEVEL_KEY)
  } catch {
    /* storage unavailable */
  }
  try {
    localStorage.setItem(LAST_LEVEL_KEY, current)
  } catch {
    /* ignore */
  }
  // No baseline yet → seed only, never celebrate on first run.
  if (!previous || previous === current) return
  if (ladderIndex(current) > ladderIndex(previous)) {
    triggerLevelUp(previous, current)
  }
}

type Particle = {
  dx: number
  dy: number
  rot: number
  color: string
  circle: boolean
}

function makeParticles(): Particle[] {
  return Array.from({ length: 30 }, () => {
    const angle = Math.random() * Math.PI * 2
    const dist = 120 + Math.random() * 160
    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      rot: (Math.random() - 0.5) * 900,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      circle: Math.random() > 0.5,
    }
  })
}

function Particles({ particles }: { particles: Particle[] }) {
  return (
    <>
      {particles.map((p, i) => (
        <span
          key={i}
          className="fx-levelup-particle"
          style={
            {
              '--dx': `${p.dx}px`,
              '--dy': `${p.dy}px`,
              '--rot': `${p.rot}deg`,
              '--col': p.color,
              '--rad': p.circle ? '50%' : '1px',
            } as React.CSSProperties
          }
        />
      ))}
    </>
  )
}

/** Global mount (MainLayout). Plays the 2.5s level-up sequence; tap to
 *  dismiss early. Skipped under reduced motion. */
export default function LevelUpOverlay() {
  const [data, setData] = useState<
    (LevelUpDetail & { particles: Particle[] }) | null
  >(null)

  useEffect(() => {
    const handler = (e: Event) => {
      if (prefersReducedMotion()) return
      vibrate([200, 100, 200, 100, 300])
      const detail = (e as CustomEvent<LevelUpDetail>).detail
      // Particles built in the handler (not render) to keep render pure.
      setData({ ...detail, particles: makeParticles() })
      window.setTimeout(() => setData(null), 2500)
    }
    window.addEventListener(CHANNEL, handler)
    return () => window.removeEventListener(CHANNEL, handler)
  }, [])

  if (!data) return null
  return (
    <div className="fx-levelup" onClick={() => setData(null)} role="presentation">
      <div className="fx-levelup-old">{data.from}</div>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        <Particles particles={data.particles} />
        <div className="fx-levelup-new">{data.to}</div>
      </div>
      <div className="fx-levelup-label">Niveau supérieur !</div>
    </div>
  )
}
