// Custom PNG icons that replace emojis. Dark medallion art with a red
// #E8203A accent. Challenge icons live in ../assets/icons, the badge
// medallions in ../assets/badges. Callers display them inside a rounded
// container so the dark square reads as an intentional tile.

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

// ─────────────────────────────────────────────────────────────────────────
//  Challenge medallions (Piste A) — one round medallion, 8 central emblems.
//  Same metallic base + polished rim + red #E8203A glow ring for every type;
//  only the central emblem changes. Pure inline SVG returned as a data URL so
//  it drops into <img src>; uniform viewBox 0 0 120 120, crisp at any size
//  (24/48/96). No animation lives in the SVG — the pulse/glow and stagger are
//  CSS on the consuming component.
// ─────────────────────────────────────────────────────────────────────────

export type ChallengeType =
  | 'streak' // série → flamme
  | 'marque' // marque ciblée → blason
  | 'hypercar' // hypercar → silhouette
  | 'photo' // photo → obturateur
  | 'rarete' // rareté → diamant
  | 'distance' // exploration → boussole
  | 'classement' // classement → couronne de laurier
  | 'vitesse' // vitesse → compteur

const RED = '#E8203A'
const RED2 = '#FF5A6E'
const WHITE = '#F5F5F7'

const toRad = (d: number) => (d * Math.PI) / 180
const pt = (cx: number, cy: number, r: number, d: number) =>
  `${(cx + r * Math.cos(toRad(d))).toFixed(1)} ${(cy + r * Math.sin(toRad(d))).toFixed(1)}`
const svgArc = (cx: number, cy: number, r: number, d0: number, d1: number) =>
  `M ${pt(cx, cy, r, d0)} A ${r} ${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${pt(cx, cy, r, d1)}`
function starPath(cx: number, cy: number, ro: number, ri: number, n = 5, rot = -90) {
  let p = ''
  for (let i = 0; i < n * 2; i += 1) {
    const r = i % 2 ? ri : ro
    p += (i ? 'L' : 'M') + pt(cx, cy, r, rot + (i * 180) / n) + ' '
  }
  return `${p}Z`
}

const GLOW = 'url(#g)'
// white primary shape with a soft red glow copy behind it
const glowFill = (d: string) =>
  `<g filter="${GLOW}" fill="${RED2}"><path d="${d}"/></g><g fill="${WHITE}"><path d="${d}"/></g>`

const FLAME =
  'M60 32 C 63 44 73 50 73 63 C 73 74 66 81 60 87 C 54 81 47 74 47 63 C 47 55 52 52 54 44 C 56 49 58 50 61 50 C 62 43 60 37 60 32 Z'
const FLAME_CORE =
  'M60 60 C 63 64 66 68 63 74 C 62 78 58 78 57 74 C 54 68 57 64 60 60 Z'
const SHIELD = 'M60 33 L83 42 L83 60 C83 73 72 82 60 88 C48 82 37 73 37 60 L37 42 Z'
const CAR_BODY =
  'M22 69 C22 65 26 63 33 62 L41 62 C44 55 51 51 60 51 C68 51 75 53 81 57 L89 61 C94 62 98 64 98 69 L88 69 A8 8 0 0 0 72 69 L48 69 A8 8 0 0 0 32 69 Z'
const DIAMOND = 'M46 50 L74 50 L86 60 L60 88 L34 60 Z'

/** The central emblem (SVG fragment, centred in a 120×120 box) for a type. */
function emblem(type: ChallengeType): string {
  switch (type) {
    case 'streak':
      return `${glowFill(FLAME)}<path d="${FLAME_CORE}" fill="${RED}"/>`
    case 'marque':
      return glowFill(SHIELD)
    case 'hypercar':
      return `${glowFill(CAR_BODY)}<g><circle cx="40" cy="69" r="7.5" fill="#0b0b0d"/><circle cx="80" cy="69" r="7.5" fill="#0b0b0d"/><circle cx="40" cy="69" r="7.5" fill="none" stroke="${WHITE}" stroke-width="2.5"/><circle cx="80" cy="69" r="7.5" fill="none" stroke="${WHITE}" stroke-width="2.5"/></g>`
    case 'photo': {
      let blades = ''
      for (let i = 0; i < 6; i += 1) {
        blades += `<path transform="rotate(${i * 60} 60 60)" d="M60 37 L74 45 L66 58 Z" fill="${i % 2 ? RED2 : WHITE}" opacity="${i % 2 ? 0.9 : 0.95}"/>`
      }
      return `<circle cx="60" cy="60" r="24" fill="none" stroke="${WHITE}" stroke-width="3"/><g filter="${GLOW}"><circle cx="60" cy="60" r="24" fill="none" stroke="${RED2}" stroke-width="1.5"/></g>${blades}<circle cx="60" cy="60" r="6" fill="#0b0b0d"/>`
    }
    case 'rarete':
      return `${glowFill(DIAMOND)}<g stroke="#0b0b0d" stroke-width="1.6" fill="none" opacity="0.5"><path d="M46 50 L52 60 L34 60 M74 50 L68 60 L86 60 M52 60 L68 60 M52 60 L60 88 M68 60 L60 88"/></g>`
    case 'distance':
      return `<circle cx="60" cy="60" r="25" fill="none" stroke="${WHITE}" stroke-width="3"/><g filter="${GLOW}"><circle cx="60" cy="60" r="25" fill="none" stroke="${RED2}" stroke-width="1.2"/></g><path d="M60 60 L70 50 L60 43 Z" fill="${RED2}" filter="${GLOW}"/><path d="M60 60 L70 50 L60 43 Z" fill="${RED}"/><path d="M60 60 L50 70 L60 77 Z" fill="${WHITE}"/><circle cx="60" cy="60" r="4" fill="#0b0b0d" stroke="${WHITE}" stroke-width="1.5"/>`
    case 'classement': {
      const leaf = (cx: number, cy: number, a: number) =>
        `<ellipse cx="${cx}" cy="${cy}" rx="6" ry="2.8" transform="rotate(${a} ${cx} ${cy})"/>`
      const branch = (s: number) => {
        let l = ''
        for (let i = 0; i < 5; i += 1) {
          const t = i / 4
          const y = 46 + t * 32
          const x = 60 + s * (20 - Math.sin(t * Math.PI) * 7)
          l += leaf(x, y, s > 0 ? -42 - t * 18 : 222 + t * 18)
        }
        return `<path d="M ${60 + s * 8} 42 C ${60 + s * 26} 52 ${60 + s * 26} 70 ${60 + s * 6} 84" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>${l}`
      }
      const inner = `${branch(-1)}${branch(1)}`
      const st = starPath(60, 62, 8, 3.4)
      return `<g filter="${GLOW}" fill="${RED2}" color="${RED2}">${inner}</g><g fill="${WHITE}" color="${WHITE}">${inner}</g><path d="${st}" fill="${RED}" filter="${GLOW}"/><path d="${st}" fill="${RED}"/>`
    }
    case 'vitesse': {
      const cx = 60
      const cy = 64
      const R = 24
      const start = 150
      const end = 390
      const split = end - 55
      return `<path d="${svgArc(cx, cy, R, start, split)}" fill="none" stroke="#9a9aa2" stroke-width="5" stroke-linecap="round"/><path d="${svgArc(cx, cy, R, split, end)}" fill="none" stroke="${RED}" stroke-width="5" stroke-linecap="round"/><g filter="${GLOW}"><path d="${svgArc(cx, cy, R, split, end)}" fill="none" stroke="${RED2}" stroke-width="2" stroke-linecap="round"/></g><line x1="${cx}" y1="${cy}" x2="${cx + R - 6}" y2="${cy}" stroke="${WHITE}" stroke-width="3" stroke-linecap="round" transform="rotate(${split - 6} ${cx} ${cy})"/><circle cx="${cx}" cy="${cy}" r="5" fill="#0b0b0d" stroke="${WHITE}" stroke-width="2"/>`
    }
  }
}

// One cached data URL per type (the SVG is static — size is set via CSS/attrs
// on the <img>, so a single 120-box render scales crisply to 24/48/96).
const MEDALLION_CACHE = new Map<ChallengeType, string>()

/** Round challenge medallion (Piste A) as a data-URL SVG for `<img src>`.
 *  Same metallic base + red glow ring for all types; only the emblem changes.
 *  `size` sets the intrinsic px (default 48); CSS on the img can override it. */
export function challengeMedallion(type: ChallengeType, size = 48): string {
  const cached = MEDALLION_CACHE.get(type)
  const body =
    cached ??
    (() => {
      const defs = `<defs><radialGradient id="met" cx="42%" cy="36%" r="72%"><stop offset="0%" stop-color="#3a3a42"/><stop offset="45%" stop-color="#1a1a1f"/><stop offset="100%" stop-color="#0a0a0d"/></radialGradient><linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#8a8a94"/><stop offset="45%" stop-color="#4a4a52"/><stop offset="100%" stop-color="#141418"/></linearGradient><radialGradient id="rg" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${RED}" stop-opacity="0.5"/><stop offset="60%" stop-color="${RED}" stop-opacity="0.07"/><stop offset="100%" stop-color="${RED}" stop-opacity="0"/></radialGradient><filter id="g" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.8"/></filter></defs>`
      const base = `<circle cx="60" cy="60" r="55" fill="url(#rim)"/><circle cx="60" cy="60" r="50" fill="url(#met)"/><circle cx="60" cy="60" r="50" fill="none" stroke="#000" stroke-opacity="0.5" stroke-width="1.5"/><path d="M 24 40 A 50 50 0 0 1 96 40" fill="none" stroke="#fff" stroke-opacity="0.22" stroke-width="2.5" stroke-linecap="round"/><circle cx="60" cy="60" r="40" fill="url(#rg)"/><circle cx="60" cy="60" r="40" fill="none" stroke="${RED}" stroke-width="1.8" stroke-opacity="0.6" filter="${GLOW}"/>`
      const s = `${defs}${base}${emblem(type)}`
      MEDALLION_CACHE.set(type, s)
      return s
    })()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 120 120">${body}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** Classify a challenge into one of the 8 medallion types from its metadata. */
export function challengeType(c: {
  title?: string | null
  target_brand?: string | null
  target_category?: string | null
}): ChallengeType {
  const s = [c.title, c.target_brand, c.target_category].filter(Boolean).join(' ').toLowerCase()
  // A named target brand → blason (marque), unless another cue is stronger.
  if (/s[ée]rie|streak|jour|consécutif|d'affil|flamme|feu|enchaîn/.test(s)) return 'streak'
  if (/hypercar|supercar|bugatti|koenigsegg|pagani|exotique/.test(s)) return 'hypercar'
  if (/photo|clich[ée]|snapshot|obturateur|appareil/.test(s)) return 'photo'
  if (/rare|raret[ée]|l[ée]gendaire|exclusi|collector|pi[èe]ce/.test(s)) return 'rarete'
  if (/km|kilom|distance|explor|d[ée]couvr|ville|voyage|parcour|carte/.test(s)) return 'distance'
  if (/classement|podium|top\s?\d|rang|leaderboard|num[ée]ro|1er|premier au/.test(s))
    return 'classement'
  if (/vitesse|rapide|chrono|speed|tour|circuit|lap|course/.test(s)) return 'vitesse'
  if (c.target_brand || /marque|blason|constructeur/.test(s)) return 'marque'
  return 'vitesse'
}

/** Custom medallion icon (data URL) for a challenge, keyed by its type. */
export function challengeIcon(
  c: {
    title?: string | null
    target_brand?: string | null
    target_category?: string | null
  },
  size = 48,
): string {
  return challengeMedallion(challengeType(c), size)
}
