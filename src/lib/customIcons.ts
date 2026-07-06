// Custom PNG icons that replace specific emojis in the app. Only the
// badges / challenges we have artwork for are mapped here; everything else
// keeps its emoji. The source art is a dark-background square medallion, so
// callers display it inside a rounded container (object-cover) which reads
// as an intentional tile on the app's dark UI.

import trophy from '../assets/icons/challenge-trophy.png'
import flag from '../assets/icons/challenge-flag.png'
import target from '../assets/icons/challenge-target.png'
import rocket from '../assets/icons/badge-rocket.png'
import ten from '../assets/icons/badge-10.png'
import lightning from '../assets/icons/badge-lightning.png'
import firstBlood from '../assets/icons/badge-first-blood.png'

// Badge slug → custom icon.
const BADGE_ICONS: Record<string, string> = {
  'premier-spot': rocket, //   🚀 launch achievement
  'serie-10': ten, //          🔟 "10" milestone
  'speed-spotter': lightning, // ⚡ energy achievement
  'race-first-blood': firstBlood, // 🏁 First Blood
}

/** Custom icon URL for a badge slug, or undefined to keep its emoji. */
export function badgeIcon(slug: string): string | undefined {
  return BADGE_ICONS[slug]
}

/** Custom icon for a challenge: Lamborghini hunt → target, lap/"tour" →
 *  checkered flag, everything else → trophy. Only three challenge icons
 *  exist, so brand challenges other than Lamborghini use the generic
 *  trophy. */
export function challengeIcon(c: {
  title?: string | null
  target_brand?: string | null
  target_category?: string | null
}): string {
  const s = [c.title, c.target_brand, c.target_category]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (s.includes('lambo')) return target
  if (
    s.includes('tour') ||
    s.includes('circuit') ||
    s.includes('lap') ||
    s.includes('course')
  )
    return flag
  return trophy
}
