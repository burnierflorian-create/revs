import { accountStatus, effectiveTitle } from '../lib/titles'
import type { TitleStyle } from '../lib/titles'
import { APP_STAGE } from '../lib/constants'

/** Une pastille. Le traitement or animé est réservé au statut « Fondateur ». */
function Chip({ t, size }: { t: TitleStyle; size: 'xs' | 'sm' }) {
  const pad = size === 'xs' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
  const isFounder = t.label === 'Fondateur'
  // Sous le traitement Fondateur, on laisse tomber chipClass : le ring de
  // Tailwind se battrait avec la bordure et l'ombre personnalisées.
  const chipExtra = isFounder ? t.textClass : `${t.chipClass} ${t.textClass}`
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ${pad} ${chipExtra}`}
      style={
        isFounder
          ? {
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

/**
 * Pastilles d'identité d'un utilisateur.
 *
 * ── DEUX PASTILLES, PLUS UNE SEULE (refonte du 29/09/2026) ──
 * Avant, un `profiles.title` non vide ÉCRASAIT le titre de niveau : un
 * « Fondateur » n'affichait plus jamais sa progression, son titre restait figé
 * quel que soit son XP. Les deux notions sont désormais distinctes et
 * cohabitent : le statut de compte d'abord (rare, attribué à la main), puis le
 * titre de niveau (dérivé, qui bouge en jouant).
 *
 * Un compte sans statut n'affiche qu'une pastille — le cas courant.
 */
export default function TitleChip({
  xp,
  title,
  size = 'sm',
  prestigeBase = 0,
}: {
  xp: number
  title?: string | null
  size?: 'xs' | 'sm'
  /** XP au dernier prestige, pour que le titre suive le cycle en cours. */
  prestigeBase?: number
}) {
  const status = accountStatus(title)
  const level = effectiveTitle(xp, null, prestigeBase)
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {status && <Chip t={status} size={size} />}
      <Chip t={level} size={size} />
    </span>
  )
}

/** Chip du palier de version (« 🧪 BÊTA »), posé à côté de TitleChip dans
 *  l'en-tête de l'accueil. Même gabarit que TitleChip — mêmes paddings, même
 *  arrondi, même graisse — pour que les deux se lisent comme une paire, mais
 *  en ambre/orange plutôt qu'en or ou en rouge : le palier est une information
 *  d'état, pas une distinction. */
export function StageChip({ size = 'sm' }: { size?: 'xs' | 'sm' }) {
  const pad =
    size === 'xs' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-xs'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-bold ${pad}`}
      style={{
        background:
          'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(249,115,22,0.10))',
        borderColor: 'rgba(245,158,11,0.4)',
        color: '#f59e0b',
      }}
    >
      <span aria-hidden>🧪</span>
      {APP_STAGE}
    </span>
  )
}
