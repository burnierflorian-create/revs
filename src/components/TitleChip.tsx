import { effectiveTitle } from '../lib/titles'

/** Inline chip rendering a user's title (XP-derived or manual special).
 *  Pass the user's XP and their `profiles.title` value — the chip picks
 *  the right label, color and (gold) styling. */
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
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ${pad} ${t.chipClass} ${t.textClass}`}
    >
      {t.emoji && <span aria-hidden>{t.emoji}</span>}
      {t.label}
    </span>
  )
}
