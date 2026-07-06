// Custom PNG icons that replace emojis. Dark medallion art with a red
// #E8203A accent. Challenge icons live in ../assets/icons, the badge
// medallions in ../assets/badges. Callers display them inside a rounded
// container so the dark square reads as an intentional tile.

// ── Challenge icons (Home speedometers) ──
import chTrophy from '../assets/icons/challenge-trophy.png'
import chFlag from '../assets/icons/challenge-flag.png'
import chTarget from '../assets/icons/challenge-target.png'

// ── Badge medallions ──
import bPremierSpot from '../assets/badges/badge-premier-spot.png'
import bSerie10 from '../assets/badges/badge-serie-10.png'
import bCenturion from '../assets/badges/badge-centurion.png'
import bSpeedSpotter from '../assets/badges/badge-speed-spotter.png'
import bSniper from '../assets/badges/badge-sniper.png'
import bPhotographe from '../assets/badges/badge-photographe.png'
import bHypercarFirst from '../assets/badges/badge-hypercar-first.png'
import bSupercarSpotter from '../assets/badges/badge-supercar-spotter.png'
import bHypercarHunter from '../assets/badges/badge-hypercar-hunter.png'
import bSpeedDemon from '../assets/badges/badge-speed-demon.png'
import bRareFind from '../assets/badges/badge-rare-find.png'
import bCollectionneur from '../assets/badges/badge-collectionneur.png'
import bMillionClub from '../assets/badges/badge-million-club.png'
import bUltraRare from '../assets/badges/badge-ultra-rare.png'
import bStreak7 from '../assets/badges/badge-streak-7.png'
import bStreak30 from '../assets/badges/badge-streak-30.png'
import bExplorateur from '../assets/badges/badge-explorateur.png'
import bGlobetrotter from '../assets/badges/badge-globetrotter.png'
import bNightOwl from '../assets/badges/badge-night-owl.png'
import bEarlyBird from '../assets/badges/badge-early-bird.png'
import bFestivalier from '../assets/badges/badge-festivalier.png'
import bJdmFan from '../assets/badges/badge-jdm-fan.png'
import bFerrariHunter from '../assets/badges/badge-ferrari-hunter.png'
import bLamboSpotter from '../assets/badges/badge-lambo-spotter.png'
import bSocial10 from '../assets/badges/badge-social-10.png'
import bInfluenceur from '../assets/badges/badge-influenceur.png'
import bTop3 from '../assets/badges/badge-top-3.png'
import bNumero1 from '../assets/badges/badge-numero-1.png'
import bSupporterStarter from '../assets/badges/badge-supporter-starter.png'
import bPremiumPlan from '../assets/badges/badge-premium-plan.png'
import bVipPlan from '../assets/badges/badge-vip-plan.png'
import bRaceFirstBlood from '../assets/badges/badge-race-first-blood.png'
import bRaceUnderdog from '../assets/badges/badge-race-underdog.png'
import bRaceStreak5 from '../assets/badges/badge-race-streak-5.png'
import bRaceChampion from '../assets/badges/badge-race-champion.png'
import bRaceDavidGoliath from '../assets/badges/badge-race-david-goliath.png'
import bRacePerfect10 from '../assets/badges/badge-race-perfect-10.png'
import bEarlyAdopter from '../assets/badges/badge-early-adopter.png'
import bLegendaire from '../assets/badges/badge-legendaire.png'
import bOrganisateur from '../assets/badges/badge-organisateur.png'
import bFanBmw from '../assets/badges/badge-fan-bmw.png'
import bFanRolls from '../assets/badges/badge-fan-rolls-royce.png'
import bFanChevrolet from '../assets/badges/badge-fan-chevrolet.png'
import bFanMercedes from '../assets/badges/badge-fan-mercedes.png'

const BADGE_ICONS: Record<string, string> = {
  'premier-spot': bPremierSpot,
  'serie-10': bSerie10,
  centurion: bCenturion,
  'speed-spotter': bSpeedSpotter,
  sniper: bSniper,
  photographe: bPhotographe,
  'hypercar-first': bHypercarFirst,
  'supercar-spotter': bSupercarSpotter,
  'hypercar-hunter': bHypercarHunter,
  'speed-demon': bSpeedDemon,
  'rare-find': bRareFind,
  collectionneur: bCollectionneur,
  'million-club': bMillionClub,
  'ultra-rare': bUltraRare,
  'streak-7': bStreak7,
  'streak-30': bStreak30,
  explorateur: bExplorateur,
  globetrotter: bGlobetrotter,
  'night-owl': bNightOwl,
  'early-bird': bEarlyBird,
  festivalier: bFestivalier,
  'jdm-fan': bJdmFan,
  'ferrari-hunter': bFerrariHunter,
  'lambo-spotter': bLamboSpotter,
  'social-10': bSocial10,
  influenceur: bInfluenceur,
  'top-3': bTop3,
  'numero-1': bNumero1,
  'supporter-starter': bSupporterStarter,
  'premium-plan': bPremiumPlan,
  'vip-plan': bVipPlan,
  'race-first-blood': bRaceFirstBlood,
  'race-underdog': bRaceUnderdog,
  'race-streak-5': bRaceStreak5,
  'race-champion': bRaceChampion,
  'race-david-goliath': bRaceDavidGoliath,
  'race-perfect-10': bRacePerfect10,
  'early-adopter': bEarlyAdopter,
  legendaire: bLegendaire,
  organisateur: bOrganisateur,
}

/** Custom icon for a badge slug (incl. dynamic `fan-<brand>` slugs for the
 *  brands we have art for), or undefined to keep its emoji. */
export function badgeIcon(slug: string): string | undefined {
  const direct = BADGE_ICONS[slug]
  if (direct) return direct
  if (slug.startsWith('fan-')) {
    const b = slug.slice(4)
    if (b.includes('bmw')) return bFanBmw
    if (b.includes('rolls')) return bFanRolls
    if (b.includes('chevrolet') || b.includes('chevy')) return bFanChevrolet
    if (b.includes('mercedes')) return bFanMercedes
  }
  return undefined
}

/** Custom icon for a challenge: Lamborghini hunt → target, lap/"tour" →
 *  checkered flag, everything else → trophy. */
export function challengeIcon(c: {
  title?: string | null
  target_brand?: string | null
  target_category?: string | null
}): string {
  const s = [c.title, c.target_brand, c.target_category]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (s.includes('lambo')) return chTarget
  if (
    s.includes('tour') ||
    s.includes('circuit') ||
    s.includes('lap') ||
    s.includes('course')
  )
    return chFlag
  return chTrophy
}
