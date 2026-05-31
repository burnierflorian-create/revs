import { effectiveTitle } from '../lib/titles'

/** Inline chip rendering a user's title (XP-derived or manual special).
 *  Pass the user's XP and their `profiles.title` value — the chip picks
 *  the right label, color and (gold) styling. The Fondateur label gets
 *  an extra animated gold-gradient border to read as the highest-prestige
 *  manual title (May 2026 polish pass). */
export default function TitleChip({
  xp,
  title,
  size = 'sm',
}: {
  xp: number
  title?: string | null
  size?: 'xs' | 'sm'
}) {
  const t = effectiveTitle(xp, title)
  const pad = size === 'xs' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
  const isFounder = t.label === 'Fondateur'
  // When the founder treatment kicks in, drop the default chipClass to
  // avoid the Tailwind ring fighting the custom border / shadow stack.
  const chipExtra = isFounder ? t.textClass : `${t.chipClass} ${t.textClass}`
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ${pad} ${chipExtra}`}
      style={
        isFounder
          ? {
              // Gold gradient that drifts via founder-shimmer keyframe.
              // Replaces the default chipClass background so the chip
              // reads as polished metal rather than a flat tint.
              background:
                'linear-gradient(120deg, rgba(224, 179, 65, 0.45) 0%, rgba(255, 215, 0, 0.28) 25%, rgba(255, 246, 200, 0.42) 50%, rgba(255, 215, 0, 0.28) 75%, rgba(184, 134, 11, 0.40) 100%)',
              backgroundSize: '200% 100%',
              animation: 'founder-shimmer 4.2s linear infinite',
              border: '1px solid rgba(255, 215, 0, 0.55)',
              boxShadow: '0 6px 18px rgba(255, 200, 50, 0.30)',
            }
          : undefined
      }
    >
      {t.emoji && <span aria-hidden>{t.emoji}</span>}
      {t.label}
    </span>
  )
}
