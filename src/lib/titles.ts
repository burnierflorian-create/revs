// User titles — manual special titles (stored in profiles.title) take
// precedence over the XP-derived one. The display layer just calls
// `effectiveTitle(xp, profile.title)` and trusts the result.

export type TitleStyle = {
  /** Display text shown to users. */
  label: string
  /** Tailwind text color class for the title chip. */
  textClass: string
  /** Background / ring chip style (Tailwind). */
  chipClass: string
  /** Optional emoji prefix (e.g. 🏅, ⭐, 👑). */
  emoji?: string
  /** True when this is one of the gold/manual prestige titles. */
  gold?: boolean
}

// ─────────────────────── XP-based ladder ───────────────────────

const XP_TIERS: { name: string; min: number }[] = [
  { name: 'Rookie',         min: 0 },
  { name: 'Chasseur',       min: 100 },
  { name: 'Expert',         min: 300 },
  { name: 'Élite',          min: 700 },
  { name: 'Maître Spotter', min: 1500 },
  { name: 'Légende',        min: 3000 },
]

function xpTitleName(xp: number): string {
  const safe = Math.max(0, Math.floor(xp))
  let name = XP_TIERS[0].name
  for (const t of XP_TIERS) {
    if (safe >= t.min) name = t.name
  }
  return name
}

// ─────────────────────── Style lookup ───────────────────────

const XP_STYLE: Record<string, Omit<TitleStyle, 'label'>> = {
  Rookie:          { textClass: 'text-fg/55',  chipClass: 'bg-white/8 ring-1 ring-white/10' },
  Chasseur:        { textClass: 'text-[#8AB4F8]', chipClass: 'bg-[#8AB4F8]/12 ring-1 ring-[#8AB4F8]/30' },
  Expert:          { textClass: 'text-[#34D399]', chipClass: 'bg-[#34D399]/12 ring-1 ring-[#34D399]/30' },
  'Élite':         { textClass: 'text-[#A78BFA]', chipClass: 'bg-[#A78BFA]/12 ring-1 ring-[#A78BFA]/30' },
  'Maître Spotter':{ textClass: 'text-[#F472B6]', chipClass: 'bg-[#F472B6]/12 ring-1 ring-[#F472B6]/30' },
  'Légende':       { textClass: 'text-accent',    chipClass: 'bg-accent/15 ring-1 ring-accent/40' },
}

const MANUAL_STYLE: Record<string, Omit<TitleStyle, 'label'>> = {
  // Florian + Niko — co-founders. Gold + medal emoji, can't be missed.
  Fondateur: {
    emoji: '🏅',
    textClass: 'text-[#E0B341]',
    chipClass:
      'bg-gradient-to-r from-[#E0B341]/25 to-[#B8860B]/15 ring-1 ring-[#E0B341]/55',
    gold: true,
  },
  // Verified event organizers — blue-tinted star.
  'Organisateur Vérifié': {
    emoji: '⭐',
    textClass: 'text-[#3B82F6]',
    chipClass: 'bg-[#3B82F6]/15 ring-1 ring-[#3B82F6]/40',
  },
  // VIP subscribers — purple crown.
  'VIP Member': {
    emoji: '👑',
    textClass: 'text-[#A78BFA]',
    chipClass: 'bg-[#A78BFA]/15 ring-1 ring-[#A78BFA]/40',
  },
}

/** Resolves the title to display for a user. `manualTitle` is the
 *  `profiles.title` column value — when set, it always wins over the
 *  XP-based ladder. */
export function effectiveTitle(
  xp: number,
  manualTitle: string | null | undefined,
): TitleStyle {
  const m = manualTitle?.trim()
  if (m && MANUAL_STYLE[m]) {
    return { label: m, ...MANUAL_STYLE[m] }
  }
  // Allow a custom manual string that doesn't match a known special.
  if (m) {
    return { label: m, textClass: 'text-fg/70', chipClass: 'bg-white/8 ring-1 ring-white/10' }
  }
  const name = xpTitleName(xp)
  return { label: name, ...(XP_STYLE[name] ?? XP_STYLE.Rookie) }
}

export const XP_TITLE_LADDER: ReadonlyArray<{ name: string; min: number }> = XP_TIERS
