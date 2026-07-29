import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Car, Star } from 'lucide-react'
import type { Spot } from '../lib/spots'
import { cardBadge } from '../lib/cardLevels'

// Full-screen history + hero-photo picker for one evolving card. Shows every
// spot of the car (photo, date, time), a mini-map of all capture locations,
// and lets the user pin any photo as the card's main. No data is ever lost —
// this is the full history the évolutive-cards system preserves.

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

export default function CardSpotsSheet({
  open,
  onClose,
  brand,
  model,
  level,
  count,
  spots,
  mainPhotoUrl,
  onSetMain,
  busy = false,
}: {
  open: boolean
  onClose: () => void
  brand: string
  model: string
  level: number
  count: number
  spots: Spot[]
  mainPhotoUrl: string | null
  onSetMain: (spot: Spot) => void
  busy?: boolean
}) {
  const navigate = useNavigate()

  // Lock body scroll while the sheet is open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  const byNewest = spots
    .slice()
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  const badge = cardBadge(level)

  const geo = spots.filter(
    (s) => typeof s.lat === 'number' && typeof s.lng === 'number' && (s.lat || s.lng),
  )
  const mapUrl =
    geo.length && TOKEN
      ? `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${geo
          .map((s) => `pin-s+e8203a(${s.lng.toFixed(5)},${s.lat.toFixed(5)})`)
          .join(',')}/auto/640x280@2x?padding=50&access_token=${TOKEN}`
      : null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgb(var(--color-bg))',
        color: 'rgb(var(--color-fg))',
        display: 'flex',
        flexDirection: 'column',
        animation: 'sheet-slide-up 0.28s cubic-bezier(0.22,1,0.36,1) both',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 16px',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <button
          onClick={onClose}
          className="tappable"
          aria-label="Fermer"
          style={{ display: 'grid', placeItems: 'center', height: 34, width: 34, borderRadius: 9999, background: 'rgb(var(--color-card))', border: '1px solid var(--color-border)' }}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display, inherit)', fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {brand} {model}
          </div>
          <div style={{ fontSize: 11.5, color: 'rgb(var(--color-fg2))', marginTop: 1 }}>
            Spotté ×{count}
            {badge ? ` · Nv${level} ${badge}` : ` · Nv${level}`}
          </div>
        </div>
      </div>

      {/* Scroll body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 40px' }}>
        {mapUrl && (
          <img
            src={mapUrl}
            alt="Lieux de capture"
            style={{ width: '100%', height: 'auto', borderRadius: 16, border: '1px solid var(--color-border)', marginBottom: 18, display: 'block' }}
          />
        )}

        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgb(var(--color-fg2))', marginBottom: 10 }}>
          Mes spots ({count}) — touche l'étoile pour la photo de la carte
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {byNewest.map((s) => {
            const d = new Date(s.created_at)
            const isMain = !!s.photo_url && s.photo_url === mainPhotoUrl
            return (
              <div
                key={s.id}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 8, borderRadius: 14, background: 'rgb(var(--color-card))', border: `1px solid ${isMain ? '#E8203A' : 'var(--color-border)'}` }}
              >
                <button
                  onClick={() => navigate(`/spot/${s.id}`)}
                  className="tappable"
                  style={{ flexShrink: 0, height: 64, width: 64, borderRadius: 10, overflow: 'hidden', border: 'none', padding: 0, background: '#141418', display: 'grid', placeItems: 'center' }}
                  aria-label="Ouvrir le spot"
                >
                  {s.photo_url ? (
                    <img src={s.photo_url} alt="" style={{ height: '100%', width: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Car className="h-6 w-6" style={{ color: 'rgba(255,255,255,0.3)' }} />
                  )}
                </button>
                <button
                  onClick={() => navigate(`/spot/${s.id}`)}
                  className="tappable"
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'transparent', padding: 0, color: 'inherit' }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                    {d.toLocaleDateString('fr-FR')}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgb(var(--color-fg2))', marginTop: 2 }}>
                    {d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    {s.lat && s.lng ? ` · ${s.lat.toFixed(3)}, ${s.lng.toFixed(3)}` : ''}
                  </div>
                </button>
                <button
                  onClick={() => !isMain && !busy && s.photo_url && onSetMain(s)}
                  disabled={isMain || busy || !s.photo_url}
                  className="tappable"
                  aria-label={isMain ? 'Photo principale' : 'Définir comme photo principale'}
                  style={{ flexShrink: 0, display: 'grid', placeItems: 'center', height: 40, width: 40, borderRadius: 9999, border: 'none', background: isMain ? 'rgba(232,32,58,0.15)' : 'transparent', cursor: isMain ? 'default' : 'pointer' }}
                >
                  <Star className="h-5 w-5" style={{ color: isMain ? '#E8203A' : 'rgb(var(--color-fg2))', fill: isMain ? '#E8203A' : 'transparent' }} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
