import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ImageOff, MapPin, X } from 'lucide-react'
import type { Spot } from '../lib/spots'
import CollectorCard, { rarityRank } from './CollectorCard'

/** Renders the user's full spot collection as collector cards. Cards
 *  are derived from `spots` directly — sorted by rarity DESC then
 *  date DESC — so no extra schema is required. Tap opens a modal
 *  with the card enlarged plus a shortcut back to the spot page. */
export default function MyCollection({ spots }: { spots: Spot[] }) {
  const navigate = useNavigate()
  const [activeId, setActiveId] = useState<string | null>(null)

  const sorted = useMemo(() => {
    return spots.slice().sort((a, b) => {
      const r = rarityRank(b.rarity) - rarityRank(a.rarity)
      if (r !== 0) return r
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    })
  }, [spots])

  const active = activeId ? sorted.find((s) => s.id === activeId) ?? null : null

  // Close modal on Escape; lock body scroll while open.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveId(null)
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [active])

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
    <>
      <div className="grid grid-cols-2 gap-3">
        {sorted.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setActiveId(s.id)}
            className="tappable collector-enter relative block w-full text-left"
            style={{ animationDelay: `${Math.min(i, 11) * 35}ms` }}
            aria-label={`Carte ${s.brand} ${s.model}`}
          >
            <CollectorCard spot={s} />
          </button>
        ))}
      </div>

      {active && <CardModal spot={active} onClose={() => setActiveId(null)} />}
    </>
  )
}

function CardModal({ spot, onClose }: { spot: Spot; onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      style={{
        paddingTop: 'max(env(safe-area-inset-top), 16px)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 16px)',
        paddingLeft: '16px',
        paddingRight: '16px',
        animation: 'fade-in 180ms ease-out both',
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-[360px]"
        style={{ animation: 'collector-modal-in 360ms var(--ease-spring) both' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button — sits above the card, top-right */}
        <button
          onClick={onClose}
          className="tappable absolute -right-1 -top-12 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md"
          aria-label="Fermer"
        >
          <X className="h-5 w-5" />
        </button>

        <CollectorCard spot={spot} large />

        {/* Details panel below the card */}
        <div className="mt-4 rounded-2xl bg-card p-4" style={{ border: '1px solid var(--color-border)' }}>
          {spot.color && (
            <p className="text-[12px] text-fg2">
              Couleur · <span className="text-fg">{spot.color}</span>
            </p>
          )}
          {spot.estimated_price ? (
            <p className="mt-1 text-[12px] text-fg2">
              Valeur estimée ·{' '}
              <span className="text-fg">
                {new Intl.NumberFormat('fr-FR').format(spot.estimated_price)} €
              </span>
            </p>
          ) : null}
          {spot.description && (
            <p className="mt-3 text-[13px] leading-snug text-fg/90">
              {spot.description}
            </p>
          )}
          <button
            onClick={() => navigate(`/spot/${spot.id}`)}
            className="tappable mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-accent py-3 text-sm font-semibold text-white"
            style={{ boxShadow: '0 8px 22px rgba(232, 32, 58, 0.45)' }}
          >
            <MapPin className="h-4 w-4" />
            Voir sur la carte
          </button>
        </div>
      </div>
    </div>
  )
}
