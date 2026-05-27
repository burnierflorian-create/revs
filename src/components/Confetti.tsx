import { useEffect, useState } from 'react'

const COLORS = ['#E8203A', '#F59E0B', '#34D399', '#3B82F6', '#A78BFA', '#FFFFFF']

type Piece = {
  id: number
  left: string
  delay: number
  duration: number
  drift: number
  rotation: number
  color: string
  size: number
}

/** Fires `count` pieces of confetti for `duration` ms then auto-removes
 *  itself from the DOM. Stateless trigger : key the parent (e.g.
 *  `<Confetti key={epoch} />`) when you want it to replay. */
export default function Confetti({
  count = 36,
  duration = 2400,
}: {
  count?: number
  duration?: number
}) {
  const [pieces, setPieces] = useState<Piece[] | null>(null)

  useEffect(() => {
    const list: Piece[] = []
    for (let i = 0; i < count; i += 1) {
      list.push({
        id: i,
        left: `${Math.random() * 100}%`,
        delay: Math.random() * 200,
        duration: duration + Math.random() * 600,
        drift: (Math.random() - 0.5) * 240, // -120 → +120 px
        rotation: 360 + Math.random() * 540,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        size: 0.7 + Math.random() * 0.7,
      })
    }
    setPieces(list)
    const t = setTimeout(() => setPieces(null), duration + 800)
    return () => clearTimeout(t)
  }, [count, duration])

  if (!pieces) return null

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={
            {
              left: p.left,
              backgroundColor: p.color,
              animationDelay: `${p.delay}ms`,
              animationDuration: `${p.duration}ms`,
              transform: `scale(${p.size})`,
              ['--cx' as string]: `${p.drift}px`,
              ['--cr' as string]: `${p.rotation}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}
