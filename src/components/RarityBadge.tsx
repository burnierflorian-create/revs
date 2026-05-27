import { type Rarity } from '../lib/spots'

const STYLE: Record<Rarity, { label: string; chip: string; text: string; glow?: boolean }> = {
  commun: {
    label: 'COMMUN',
    chip: 'bg-white/10 ring-1 ring-white/15',
    text: 'text-fg/70',
  },
  rare: {
    label: 'RARE',
    chip: 'bg-[#3B82F6]/18 ring-1 ring-[#3B82F6]/45',
    text: 'text-[#8AB4F8]',
  },
  ultra_rare: {
    label: 'ULTRA RARE ✨',
    chip: 'bg-[#A78BFA]/20 ring-1 ring-[#A78BFA]/50',
    text: 'text-[#C4B5FD]',
  },
  unique: {
    label: 'LÉGENDAIRE 👑',
    chip: 'bg-gradient-to-r from-[#E0B341]/30 to-[#B8860B]/15 ring-1 ring-[#E0B341]/60',
    text: 'text-[#E0B341]',
    glow: true,
  },
}

/** Renders the rarity chip for a spot (commun → grey, rare → blue,
 *  ultra_rare → purple, unique → animated gold). Unknown / null rarity
 *  falls back to "COMMUN". */
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
      className={`inline-flex items-center gap-1 rounded-full font-bold tracking-wider ${pad} ${s.chip} ${s.text} ${
        s.glow ? 'animate-pulse-soft' : ''
      }`}
    >
      {s.label}
    </span>
  )
}
