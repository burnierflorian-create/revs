import { titleForLevel, levelForXp } from './xp'
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

// ─────────────────────── Titre de niveau ───────────────────────
//
// L'échelle XP vivait ICI en double de src/lib/xp.ts — deux listes de seuils à
// maintenir à la main, qui pouvaient diverger sans que rien ne le signale.
// Elle a disparu : ce fichier ne connaît plus que les STYLES, et demande le
// nom du titre à xp.ts, seule source client.

// ─────────────────────── Style lookup ───────────────────────

// One style per ladder tier. The four new tiers (Icône REVS / Fantôme /
// Mythique / REVS OG) escalate visually — gold → ethereal → deep
// violet → animated gold-on-fire — so prestige is immediately readable
// in the leaderboard chips.
// Un style par palier de titre. La montée est lisible d'un coup d'œil :
// neutre → froid → vert → violet → rose → rouge REVS → or → éthéré → violet
// profond → or animé.
const XP_STYLE: Record<string, Omit<TitleStyle, 'label'>> = {
  Rookie:        { textClass: 'text-fg/55',     chipClass: 'bg-fg/8 ring-1 ring-fg/10' },
  Spotter:       { textClass: 'text-[#8AB4F8]', chipClass: 'bg-[#8AB4F8]/12 ring-1 ring-[#8AB4F8]/30' },
  Explorer:      { textClass: 'text-[#34D399]', chipClass: 'bg-[#34D399]/12 ring-1 ring-[#34D399]/30' },
  Hunter:        { textClass: 'text-[#A78BFA]', chipClass: 'bg-[#A78BFA]/12 ring-1 ring-[#A78BFA]/30' },
  Collector:     { textClass: 'text-[#F472B6]', chipClass: 'bg-[#F472B6]/12 ring-1 ring-[#F472B6]/30' },
  'Pro Spotter': { textClass: 'text-accent',    chipClass: 'bg-accent/15 ring-1 ring-accent/40' },
  Master:        { textClass: 'text-[#FFD700]', chipClass: 'bg-[#FFD700]/12 ring-1 ring-[#FFD700]/45', emoji: '🪩' },
  Elite:         { textClass: 'text-[#E0F2FE]', chipClass: 'bg-[#E0F2FE]/10 ring-1 ring-[#E0F2FE]/30', emoji: '👻' },
  Legend:        { textClass: 'text-[#C084FC]', chipClass: 'bg-gradient-to-r from-[#7C3AED]/25 to-[#C084FC]/15 ring-1 ring-[#C084FC]/45', emoji: '🔮' },
  Icon:          { textClass: 'text-[#FFB347]', chipClass: 'bg-gradient-to-r from-[#FFD700]/25 via-[#FFA500]/18 to-[#E8203A]/20 ring-1 ring-[#FFD700]/50', emoji: '⭐' },
  'REVS OG':     { textClass: 'text-[#FFB347]', chipClass: 'bg-gradient-to-r from-[#FFD700]/30 via-[#FFA500]/20 to-[#E8203A]/25 ring-1 ring-[#FFD700]/60', emoji: '👑', gold: true },
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

// ── SÉPARATION DU STATUT ET DE LA PROGRESSION (29/09/2026) ──
//
// Avant, un `profiles.title` non vide ÉCRASAIT le titre de niveau. Conséquence :
// un « Fondateur » n'affichait plus jamais sa progression — son titre restait
// figé quel que soit son XP. Les deux notions sont désormais distinctes et
// s'affichent ensemble :
//
//   STATUT DE COMPTE  — Fondateur, Organisateur Vérifié, VIP Member.
//                       Attribué à la main, ne change pas en jouant.
//   TITRE DE NIVEAU   — Rookie → REVS OG. Dérivé, automatique.

/** Titre de NIVEAU à afficher. Le statut de compte ne l'influence plus. */
export function effectiveTitle(
  xp: number,
  _manualTitle?: string | null,
  prestigeBase = 0,
): TitleStyle {
  const name = titleForLevel(levelForXp(Math.max(0, xp - prestigeBase)))
  return { label: name, ...(XP_STYLE[name] ?? XP_STYLE.Rookie) }
}

/** Statut de compte, ou `null` s'il n'y en a pas. Indépendant du niveau. */
export function accountStatus(
  manualTitle: string | null | undefined,
): TitleStyle | null {
  const m = manualTitle?.trim()
  if (!m) return null
  if (MANUAL_STYLE[m]) return { label: m, ...MANUAL_STYLE[m] }
  // Statut libre non catalogué : style neutre plutôt que rien.
  return { label: m, textClass: 'text-fg/70', chipClass: 'bg-fg/8 ring-1 ring-fg/10' }
}

export { XP_LADDER } from './xp'
