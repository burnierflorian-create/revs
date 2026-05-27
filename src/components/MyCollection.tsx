import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ImageOff } from 'lucide-react'
import type { Spot } from '../lib/spots'
import CollectorCard, { rarityRank } from './CollectorCard'

/** Renders the user's full spot collection as collector cards. Cards
 *  are derived from `spots` directly — sorted by rarity DESC then
 *  date DESC — so no extra schema is required. Each card owns its
 *  own tap-to-flip state; the back face carries a "Voir sur la
 *  carte" link to /spot/:id, so the legacy modal is no longer
 *  needed. */
export default function MyCollection({ spots }: { spots: Spot[] }) {
  const navigate = useNavigate()

  const sorted = useMemo(() => {
    return spots.slice().sort((a, b) => {
      const r = rarityRank(b.rarity) - rarityRank(a.rarity)
      if (r !== 0) return r
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    })
  }, [spots])

  if (spots.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-white/5 bg-card px-6 py-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
          <ImageOff className="h-8 w-8 text-accent/70" />
        </div>
        <p className="mt-4 max-w-[16rem] font-medium">
          Poste ton premier spot pour obtenir ta première carte !
        </p>
        <button
          onClick={() => navigate('/new-spot')}
          className="tappable mt-5 rounded-full bg-accent px-6 py-3 text-sm font-semibold"
        >
          Spotter
        </button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {sorted.map((s, i) => (
        <div
          key={s.id}
          className="collector-enter"
          style={{ animationDelay: `${Math.min(i, 11) * 35}ms` }}
        >
          <CollectorCard spot={s} />
        </div>
      ))}
    </div>
  )
}
