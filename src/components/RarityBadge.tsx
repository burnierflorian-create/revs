import { type Rarity } from '../lib/spots'

/** Visual style per rarity. Each ships a subtle radial-or-linear
 *  gradient (rather than a flat tint) so the chips read as small
 *  jewels — Apple-style refinement called out in the May 2026 home
 *  polish pass. `glow` keeps the légendaire chip on a slow pulse. */
const STYLE: Record<
  Rarity,
  { label: string; bg: string; ring: string; color: string; glow?: boolean }
> = {
  standard: {
    label: 'STANDARD',
    bg:
      'linear-gradient(135deg, rgba(180, 180, 180, 0.16) 0%, rgba(120, 120, 120, 0.08) 100%)',
    ring: '1px solid rgba(180, 180, 180, 0.32)',
    color: '#E5E7EB',
  },
  premium: {
    label: 'PREMIUM',
    bg:
      'linear-gradient(135deg, rgba(59, 130, 246, 0.24) 0%, rgba(59, 130, 246, 0.10) 100%)',
    ring: '1px solid rgba(59, 130, 246, 0.55)',
    color: '#BFDBFE',
  },
  performance: {
    label: 'PERFORMANCE',
    bg:
      'linear-gradient(135deg, rgba(239, 68, 68, 0.26) 0%, rgba(239, 68, 68, 0.10) 100%)',
    ring: '1px solid rgba(239, 68, 68, 0.55)',
    color: '#FECACA',
  },
  exclusif: {
    // Brushed bronze — warmer than blue, less flashy than gold
    label: 'EXCLUSIF',
    bg:
      'linear-gradient(135deg, rgba(184, 115, 51, 0.28) 0%, rgba(184, 115, 51, 0.10) 100%)',
    ring: '1px solid rgba(184, 115, 51, 0.60)',
    color: '#F3D7B0',
  },
  supercar: {
    label: 'SUPERCAR ✨',
    bg:
      'linear-gradient(135deg, rgba(167, 139, 250, 0.28) 0%, rgba(167, 139, 250, 0.10) 100%)',
    ring: '1px solid rgba(167, 139, 250, 0.60)',
    color: '#E9D5FF',
  },
  hypercar: {
    label: 'HYPERCAR 👑',
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
  const r = (rarity && STYLE[rarity] ? rarity : 'standard') as Rarity
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
