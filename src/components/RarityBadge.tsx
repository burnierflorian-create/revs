import { type Rarity } from '../lib/spots'

/** Visual style per rarity. Each ships a subtle radial-or-linear
 *  gradient (rather than a flat tint) so the chips read as small
 *  jewels — Apple-style refinement called out in the May 2026 home
 *  polish pass. `glow` keeps the légendaire chip on a slow pulse. */
const STYLE: Record<
  Rarity,
  { label: string; bg: string; ring: string; color: string; glow?: boolean }
> = {
  commun: {
    label: 'COMMUN',
    bg:
      'linear-gradient(135deg, rgba(190, 220, 196, 0.16) 0%, rgba(120, 180, 140, 0.08) 100%)',
    ring: '1px solid rgba(180, 220, 196, 0.32)',
    color: '#C8E6CC',
  },
  rare: {
    label: 'RARE',
    bg:
      'linear-gradient(135deg, rgba(59, 130, 246, 0.24) 0%, rgba(59, 130, 246, 0.10) 100%)',
    ring: '1px solid rgba(59, 130, 246, 0.55)',
    color: '#BFDBFE',
  },
  ultra_rare: {
    label: 'ULTRA RARE ✨',
    bg:
      'linear-gradient(135deg, rgba(167, 139, 250, 0.28) 0%, rgba(167, 139, 250, 0.10) 100%)',
    ring: '1px solid rgba(167, 139, 250, 0.60)',
    color: '#E9D5FF',
  },
  unique: {
    label: 'LÉGENDAIRE 👑',
    bg:
      'linear-gradient(120deg, rgba(224, 179, 65, 0.36) 0%, rgba(255, 215, 0, 0.20) 45%, rgba(184, 134, 11, 0.20) 100%)',
    ring: '1px solid rgba(224, 179, 65, 0.70)',
    color: '#FFE38A',
    glow: true,
  },
}

export default function RarityBadge({
  rarity,
  size = 'sm',
}: {
  rarity: Rarity | null | undefined
  size?: 'xs' | 'sm' | 'md'
}) {
  const r = (rarity && STYLE[rarity] ? rarity : 'commun') as Rarity
  const s = STYLE[r]
  const pad =
    size === 'xs'
      ? 'px-2 py-0.5 text-[10px]'
      : size === 'md'
        ? 'px-3.5 py-1.5 text-sm'
        : 'px-2.5 py-1 text-xs'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-bold tracking-wider ${pad} ${
        s.glow ? 'animate-pulse-soft' : ''
      }`}
      style={{
        background: s.bg,
        border: s.ring,
        color: s.color,
        boxShadow: s.glow ? '0 6px 18px rgba(224, 179, 65, 0.25)' : undefined,
      }}
    >
      {s.label}
    </span>
  )
}
