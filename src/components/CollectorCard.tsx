import { Zap } from 'lucide-react'
import type { Spot, Rarity } from '../lib/spots'
import { xpForSpot } from '../lib/spots'

/** Visual config per rarity tier. Order in the consts matters because
 *  it's also used as the sort key (higher index → rarer). */
const RARITY_ORDER: Rarity[] = ['commun', 'rare', 'ultra_rare', 'unique']

export function rarityRank(r: Rarity | null | undefined): number {
  return RARITY_ORDER.indexOf((r ?? 'commun') as Rarity)
}

const RARITY_LABEL: Record<Rarity, string> = {
  commun: 'COMMUN',
  rare: 'RARE',
  ultra_rare: 'ULTRA RARE',
  unique: 'LÉGENDAIRE',
}

const RARITY_STYLE: Record<Rarity, { bg: string; fg: string; border: string; glow?: string }> = {
  commun: {
    bg: 'rgba(156, 163, 175, 0.18)',
    fg: '#E5E7EB',
    border: '1px solid rgba(156, 163, 175, 0.45)',
  },
  rare: {
    bg: 'rgba(59, 130, 246, 0.22)',
    fg: '#BFDBFE',
    border: '1px solid rgba(59, 130, 246, 0.55)',
  },
  ultra_rare: {
    bg: 'rgba(168, 85, 247, 0.28)',
    fg: '#E9D5FF',
    border: '1px solid rgba(168, 85, 247, 0.65)',
    glow: '0 0 14px rgba(168, 85, 247, 0.55)',
  },
  unique: {
    bg: 'linear-gradient(120deg, #E0B341 0%, #FFD700 45%, #B8860B 100%)',
    fg: '#1a1306',
    border: '1px solid rgba(255, 215, 0, 0.85)',
    glow: '0 0 18px rgba(255, 215, 0, 0.55)',
  },
}

function dateLabel(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  }).format(new Date(iso))
}

/** Collector card — 3:4 ratio, photo background, rarity & XP chips.
 *  Ultra rare and unique tiers get a holographic shimmer overlay
 *  (CSS-only, animated via the `holo-shimmer` keyframe). The `large`
 *  variant scales up type sizes for the modal preview. */
export default function CollectorCard({
  spot,
  large = false,
}: {
  spot: Spot
  large?: boolean
}) {
  const rarity = (spot.rarity ?? 'commun') as Rarity
  const tier = RARITY_STYLE[rarity]
  const xp = xpForSpot(spot.estimated_price, spot.rarity)
  const holo = rarity === 'ultra_rare' || rarity === 'unique'

  return (
    <div
      className="collector-card relative w-full overflow-hidden"
      style={{
        aspectRatio: '3 / 4',
        borderRadius: '16px',
        background: '#0a0a0a',
        boxShadow: tier.glow
          ? `0 10px 28px rgba(0,0,0,0.55), ${tier.glow}`
          : '0 10px 24px rgba(0,0,0,0.5)',
        border: '1px solid var(--color-border)',
      }}
    >
      {/* Photo layer */}
      {spot.photo_url ? (
        <img
          src={spot.photo_url}
          alt={`${spot.brand} ${spot.model}`}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-card">
          <span className={`text-fg2 ${large ? 'text-lg' : 'text-xs'}`}>
            pas de photo
          </span>
        </div>
      )}

      {/* Holographic shimmer (ultra_rare + unique only). Moves a
          rainbow conic gradient diagonally in a loop, with screen
          blend mode so the photo still reads clearly through it. */}
      {holo && <div className="collector-holo absolute inset-0 pointer-events-none" />}

      {/* Dark gradient at the bottom for text legibility. */}
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{
          height: '62%',
          background:
            'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.65) 38%, rgba(0,0,0,0) 100%)',
        }}
      />

      {/* XP chip — top-left */}
      <div
        className="absolute left-2 top-2 flex items-center gap-0.5 rounded-full bg-accent font-extrabold text-white"
        style={{
          padding: large ? '4px 10px' : '3px 7px',
          fontSize: large ? '12px' : '10px',
          boxShadow: '0 6px 16px rgba(232, 32, 58, 0.45)',
          letterSpacing: '0.02em',
        }}
      >
        <Zap className={large ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5'} fill="currentColor" />
        {xp}
      </div>

      {/* Rarity chip — top-right */}
      <div
        className="absolute right-2 top-2 rounded-full font-extrabold uppercase tracking-wider"
        style={{
          background: tier.bg,
          color: tier.fg,
          border: tier.border,
          padding: large ? '4px 10px' : '3px 7px',
          fontSize: large ? '10px' : '8.5px',
          letterSpacing: '0.08em',
          ...(rarity === 'unique'
            ? { backgroundSize: '200% 100%', animation: 'holo-shimmer 3.2s linear infinite' }
            : {}),
        }}
      >
        {RARITY_LABEL[rarity]}
      </div>

      {/* Text block — bottom */}
      <div
        className="absolute inset-x-0 bottom-0 text-white"
        style={{ padding: large ? '14px 16px' : '10px 12px' }}
      >
        <p
          className="uppercase tracking-widest text-white/55"
          style={{ fontSize: large ? '10px' : '8.5px' }}
        >
          {spot.brand}
        </p>
        <h3
          className="truncate font-display font-extrabold tracking-tight text-white"
          style={{
            fontSize: large ? '20px' : '14px',
            lineHeight: 1.1,
            marginTop: '2px',
          }}
        >
          {spot.model}
          {spot.year ? <span className="text-white/65"> · {spot.year}</span> : null}
        </h3>
        <p
          className="mt-1 text-white/55"
          style={{ fontSize: large ? '11px' : '9px' }}
        >
          {dateLabel(spot.created_at)}
        </p>
      </div>
    </div>
  )
}
