import type { Spot } from './spots'
import { BRANDS, brandSlugFor, getBrand, type Brand } from './brands'
import { planTier } from './plans'

export type BadgeCategory =
  | 'spots'
  | 'streak'
  | 'discovery'
  | 'community'
  | 'premium'
  | 'brands'
  | 'special'

export type Badge = {
  slug: string
  emoji: string
  name: string
  desc: string
  condition: string
  category: BadgeCategory
  xp?: number
  gold?: boolean
  /** Display order within its category. Lower = first. */
  order?: number
}

export const CATEGORY_LABEL: Record<BadgeCategory, string> = {
  spots: 'Volume de spots',
  streak: 'Régularité',
  discovery: 'Découverte',
  community: 'Communauté',
  premium: 'Abonnement',
  brands: 'Marques',
  special: 'Édition spéciale',
}

const PROD_INT_RE = /(\d[\d\s.,]*)/

/** Parses production strings like "1 248", "1,248", "499 exemplaires"
 *  into an integer. Returns null when no numeric run is found. */
function parseProduction(p?: string | null): number | null {
  if (!p) return null
  const m = PROD_INT_RE.exec(p)
  if (!m) return null
  const cleaned = m[1].replace(/[^\d]/g, '')
  if (!cleaned) return null
  const n = parseInt(cleaned, 10)
  return Number.isFinite(n) ? n : null
}

/** Maximum consecutive-day streak (today included if active). */
function maxStreak(daysSet: Set<string>): number {
  if (daysSet.size === 0) return 0
  const list = [...daysSet].sort()
  let best = 1
  let cur = 1
  for (let i = 1; i < list.length; i += 1) {
    const prev = new Date(list[i - 1] + 'T00:00:00Z')
    const here = new Date(list[i] + 'T00:00:00Z')
    const diffDays = Math.round(
      (here.getTime() - prev.getTime()) / 86_400_000,
    )
    if (diffDays === 1) {
      cur += 1
      best = Math.max(best, cur)
    } else {
      cur = 1
    }
  }
  return best
}

/** Distinct ~11km grid cells from spot coordinates. Cheap proxy for
 *  "distinct cities/areas" without reverse-geocoding. */
function distinctCells(spots: Spot[]): number {
  const cells = new Set<string>()
  for (const s of spots) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue
    cells.add(`${s.lat.toFixed(1)}_${s.lng.toFixed(1)}`)
  }
  return cells.size
}

/** Largest number of spots created on a single calendar day (UTC). */
function maxDailyCount(spots: Spot[]): number {
  const by = new Map<string, number>()
  for (const s of spots) {
    const d = s.created_at.slice(0, 10)
    by.set(d, (by.get(d) ?? 0) + 1)
  }
  let max = 0
  for (const n of by.values()) max = Math.max(max, n)
  return max
}

export type BadgeContext = {
  spots: Spot[]
  hasEvent: boolean
  plan: string | null
  rank: number | null
  followers: number
  likesReceived: number
  daysWithSpot: Set<string>
  earlyAdopter: boolean
  /** REVS RACE counters. Optional so existing call sites keep working;
   *  unlocks for race badges no-op when this is absent. */
  raceStats?: {
    wins: number
    losses: number
    perfectStarts: number
  }
}

// ─────────────────────── Catalogue ───────────────────────

export const BADGES: Badge[] = [
  // Spots
  { slug: 'premier-spot',   emoji: '🚀', name: 'Premier Spot',   desc: 'Ton tout premier spot publié.', condition: 'Poste ton premier spot', xp: 5,  category: 'spots',  order: 1 },
  { slug: 'serie-10',       emoji: '🔟', name: 'Série de 10',    desc: 'Tu prends le rythme.',          condition: 'Atteins 10 spots au total',                                category: 'spots',  order: 2 },
  { slug: 'centurion',      emoji: '💯', name: 'Centurion',      desc: 'Un vrai chasseur.',             condition: 'Atteins 100 spots au total',                               category: 'spots',  order: 3 },
  { slug: 'speed-spotter',  emoji: '⚡', name: 'Speed Spotter',  desc: 'Trois spots en une journée.',   condition: 'Poste 3 spots le même jour',                               category: 'spots',  order: 4 },
  { slug: 'sniper',         emoji: '🎯', name: 'Sniper',         desc: 'L’IA est sûre à 95%+.',    condition: 'Poste un spot identifié à 95%+ par l’IA',             category: 'spots',  order: 5 },
  { slug: 'photographe',    emoji: '📸', name: 'Photographe',    desc: 'Tes photos plaisent.',          condition: 'Reçois 50 likes au total',                                 category: 'spots',  order: 6 },

  // Streak
  { slug: 'streak-7',       emoji: '🔥', name: 'Streak 7 jours',  desc: 'Une semaine sans rater un jour.', condition: 'Spotte 7 jours d’affilée',                          category: 'streak', order: 1 },
  { slug: 'streak-30',      emoji: '🔥', name: 'Streak 30 jours', desc: 'Un mois sans rater un jour.',     condition: 'Spotte 30 jours d’affilée', xp: 50,                  category: 'streak', order: 2, gold: true },

  // Discovery
  { slug: 'explorateur',    emoji: '📍', name: 'Explorateur',    desc: 'Spots dans 3 zones différentes.', condition: 'Spotte dans 3 endroits éloignés (>11 km)',                category: 'discovery', order: 1 },
  { slug: 'globetrotter',   emoji: '🌍', name: 'Globetrotter',   desc: 'Spots dans 5 zones différentes.', condition: 'Spotte dans 5 endroits éloignés (>11 km)',                category: 'discovery', order: 2 },
  { slug: 'night-owl',      emoji: '🌙', name: 'Night Owl',      desc: 'Un spot après 22h.',              condition: 'Publie un spot après 22h00',                              category: 'discovery', order: 3 },
  { slug: 'early-bird',     emoji: '🌅', name: 'Early Bird',     desc: 'Un spot avant 8h.',               condition: 'Publie un spot avant 08h00',                              category: 'discovery', order: 4 },
  { slug: 'festivalier',    emoji: '🎪', name: 'Festivalier',    desc: 'Participe à 3 events.',           condition: 'Poste des spots dans 3 events différents',                category: 'discovery', order: 5 },
  { slug: 'jdm-fan',        emoji: '🇯🇵', name: 'JDM Fan',         desc: 'La culture japonaise de la perf.', condition: 'Spotte une voiture catégorie JDM',                       category: 'discovery', order: 6 },
  { slug: 'ferrari-hunter', emoji: '🏎️', name: 'Ferrari Hunter', desc: 'Le Cheval cabré dans ton garage.', condition: 'Spotte une Ferrari',                                       category: 'brands',    order: 0 },
  { slug: 'lambo-spotter',  emoji: '🐂', name: 'Lambo Spotter',  desc: 'Le taureau, capturé.',             condition: 'Spotte une Lamborghini',                                  category: 'brands',    order: 1 },

  // Community
  { slug: 'social-10',      emoji: '🤝', name: 'Social',         desc: '10 abonnés.',                  condition: 'Atteins 10 abonnés',                                        category: 'community', order: 1 },
  { slug: 'influenceur',    emoji: '⭐', name: 'Influenceur',    desc: '50 abonnés.',                  condition: 'Atteins 50 abonnés', xp: 50,                                category: 'community', order: 2, gold: true },
  { slug: 'top-3',          emoji: '🏆', name: 'Top 3',          desc: 'Sur le podium global.',         condition: 'Atteins le top 3 du classement global',                    category: 'community', order: 3 },
  { slug: 'numero-1',       emoji: '👑', name: 'Numéro 1',       desc: 'Le sommet.',                    condition: 'Prends la 1ʳᵉ place du classement global', xp: 100, category: 'community', order: 4, gold: true },
  { slug: 'organisateur',   emoji: '📅', name: 'Organisateur',   desc: 'Tu fais vivre la communauté.',  condition: 'Crée un événement', xp: 20,                                category: 'community', order: 5 },

  // Voitures rares / hautes
  { slug: 'hypercar-first',   emoji: '⚡',   name: 'Hypercar',          desc: 'Tu vises haut de gamme.',         condition: 'Spotte une voiture à plus de 200 000 €', xp: 40, category: 'spots', order: 7 },
  { slug: 'supercar-spotter', emoji: '🔭',   name: 'Supercar Spotter',  desc: 'Œil de lynx.',                     condition: 'Spotte 10 voitures à plus de 80 000 €',          category: 'spots', order: 8 },
  { slug: 'hypercar-hunter',  emoji: '🦅',   name: 'Hypercar Hunter',   desc: 'Chasseur d’exception.',       condition: 'Spotte 5 voitures à plus de 200 000 €',          category: 'spots', order: 9 },
  { slug: 'speed-demon',      emoji: '🏎️',  name: 'Speed Demon',       desc: 'Une voiture à plus de 500 k€.', condition: 'Spotte une voiture à plus de 500 000 €',        category: 'spots', order: 10 },
  { slug: 'rare-find',        emoji: '💎',   name: 'Rare Find',         desc: 'Une perle rare.',                  condition: 'Édition limitée ou plus de 500 000 €',           category: 'spots', order: 11, gold: true },
  { slug: 'million-club',     emoji: '🏆',   name: 'Million Club',      desc: 'Club très fermé du million.',      condition: 'Spotte une voiture à plus de 1 000 000 €', xp: 100, category: 'spots', order: 12, gold: true },
  { slug: 'ultra-rare',       emoji: '🦄',   name: 'Ultra Rare',        desc: 'Production confidentielle.',       condition: 'Spotte une voiture produite à moins de 100 exemplaires', xp: 150, category: 'spots', order: 13, gold: true },
  { slug: 'collectionneur',   emoji: '💎',   name: 'Collectionneur',    desc: 'Tu connais le marché.',           condition: 'Spotte 10 marques différentes',                       category: 'discovery', order: 7 },

  // Premium
  { slug: 'supporter-starter', emoji: '🤝', name: 'Supporter',  desc: 'Tu soutiens REVS.',     condition: 'Abonne-toi au plan Starter',  category: 'premium', order: 1, gold: true },
  { slug: 'premium-plan',      emoji: '✨', name: 'Premium',    desc: 'Membre Premium.',       condition: 'Abonne-toi au plan Premium',  category: 'premium', order: 2 },
  { slug: 'vip-plan',          emoji: '👑', name: 'VIP',        desc: 'Le statut ultime.',     condition: 'Abonne-toi au plan VIP',      category: 'premium', order: 3, gold: true },

  // Spéciaux
  { slug: 'early-adopter', emoji: '🌅', name: 'Early Adopter', desc: 'Tu étais là dès le début.', condition: 'Parmi les 100 premiers inscrits', category: 'special', order: 1, gold: true },
  { slug: 'legendaire',    emoji: '👑', name: 'Légendaire',    desc: 'Badge doré ultra rare.',     condition: 'Débloque le Million Club',         category: 'special', order: 2, gold: true },

  // REVS RACE
  { slug: 'race-first-blood',     emoji: '🏁', name: 'First Blood',        desc: 'Première victoire en REVS RACE.',                condition: 'Gagne une course REVS RACE',                              xp: 20,  category: 'special', order: 10 },
  { slug: 'race-perfect-10',      emoji: '🎯', name: 'Perfect Start',      desc: 'Timing parfait 10 fois.',                       condition: 'Réussis un départ PARFAIT 10 fois',                        xp: 40,  category: 'special', order: 11 },
  // Phase 2 placeholders — locked until multiplayer + history land.
  { slug: 'race-underdog',        emoji: '⚡', name: 'Underdog',            desc: 'Gagner contre plus rare que toi.',              condition: 'Phase 2 — bat un adversaire de rareté supérieure',                  category: 'special', order: 12 },
  { slug: 'race-streak-5',        emoji: '🔥', name: 'Win Streak ×5',       desc: '5 victoires consécutives.',                     condition: 'Phase 2 — gagne 5 courses d’affilée',                              category: 'special', order: 13 },
  { slug: 'race-champion',        emoji: '👑', name: 'Champion',            desc: '50 victoires totales.',                          condition: 'Gagne 50 courses REVS RACE',                              xp: 100, category: 'special', order: 14, gold: true },
  { slug: 'race-david-goliath',   emoji: '💀', name: 'David vs Goliath',    desc: 'Bat un score deux fois plus élevé.',            condition: 'Phase 2 — bat une voiture deux fois plus puissante en score',     category: 'special', order: 15 },
]

/** Dynamic per-brand fan badges. Generated only for brands the user
 *  has actually spotted (avoids 36+ empty cards). */
function brandFanBadges(spots: Spot[]): Badge[] {
  const counts = new Map<string, number>()
  for (const s of spots) {
    const slug = brandSlugFor(s.brand)
    if (slug) counts.set(slug, (counts.get(slug) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([slug, count]) => {
      const b = getBrand(slug)
      if (!b) return null
      return {
        slug: `fan-${b.slug}`,
        emoji: b.type === 'tuner' ? '🛠️' : '🏁',
        name: `Fan ${b.name}`,
        desc: `Tu as spotté ${count} ${b.name}.`,
        condition: `Spotte 5 ${b.name}`,
        category: 'brands' as BadgeCategory,
      } satisfies Badge
    })
    .filter((b): b is Badge => b !== null)
}

/** Static "Fan X" badge for any brand in the catalogue — used when
 *  navigating to /badges/:slug for a brand the user hasn't started
 *  spotting yet. Returns null if the slug doesn't map to a known brand. */
export function brandFanBadgeBySlug(slug: string): Badge | null {
  const m = /^fan-(.+)$/.exec(slug)
  if (!m) return null
  const b = BRANDS.find((x: Brand) => x.slug === m[1])
  if (!b) return null
  return {
    slug,
    emoji: b.type === 'tuner' ? '🛠️' : '🏁',
    name: `Fan ${b.name}`,
    desc: `Spots de la marque ${b.name}.`,
    condition: `Spotte 5 ${b.name}`,
    category: 'brands',
  }
}

/** Returns the complete badge list visible for this user: static
 *  catalogue + only-actually-active brand fan badges. */
export function allBadges(ctx: BadgeContext): Badge[] {
  return [...BADGES, ...brandFanBadges(ctx.spots)]
}

/** Returns the set of slugs unlocked given the user context. */
export function computeUnlocks(ctx: BadgeContext): Set<string> {
  const { spots, hasEvent, plan, rank, followers, likesReceived, daysWithSpot, earlyAdopter } = ctx
  const has = (pred: (s: Spot) => boolean) => spots.some(pred)
  const brandHas = (needle: string) =>
    has((s) => (s.brand ?? '').toLowerCase().includes(needle))
  const priceAtLeast = (min: number) =>
    spots.filter((s) => (s.estimated_price ?? 0) >= min).length
  const total = spots.length
  const uniqueBrands = new Set(spots.map((s) => s.brand.toLowerCase())).size
  const tier = planTier(plan)
  const streak = maxStreak(daysWithSpot)
  const cells = distinctCells(spots)
  const burst = maxDailyCount(spots)
  const eventCount = new Set(
    spots.map((s) => s.event_id).filter((id): id is string => !!id),
  ).size
  const out = new Set<string>()
  const add = (slug: string, cond: boolean) => {
    if (cond) out.add(slug)
  }

  // Spots
  add('premier-spot',      total >= 1)
  add('serie-10',          total >= 10)
  add('centurion',         total >= 100)
  add('speed-spotter',     burst >= 3)
  add('sniper',            has((s) => (s.confidence ?? 0) >= 95))
  add('photographe',       likesReceived >= 50)
  add('hypercar-first',    priceAtLeast(200_000) >= 1)
  add('supercar-spotter',  priceAtLeast(80_000) >= 10)
  add('hypercar-hunter',   priceAtLeast(200_000) >= 5)
  add('speed-demon',       priceAtLeast(500_000) >= 1)
  add('rare-find',         priceAtLeast(500_000) >= 1)
  add('million-club',      priceAtLeast(1_000_000) >= 1)
  add(
    'ultra-rare',
    has((s) => {
      const n = parseProduction(s.car_info?.production)
      return n !== null && n > 0 && n < 100
    }),
  )

  // Streak
  add('streak-7',          streak >= 7)
  add('streak-30',         streak >= 30)

  // Discovery
  add('explorateur',       cells >= 3)
  add('globetrotter',      cells >= 5)
  add('night-owl',         has((s) => new Date(s.created_at).getHours() >= 22))
  add('early-bird',        has((s) => new Date(s.created_at).getHours() < 8))
  add('festivalier',       eventCount >= 3)
  add('jdm-fan',           has((s) => s.category === 'JDM'))
  add('collectionneur',    uniqueBrands >= 10)

  // Community
  add('social-10',         followers >= 10)
  add('influenceur',       followers >= 50)
  add('top-3',             rank !== null && rank <= 3)
  add('numero-1',          rank === 1)
  add('organisateur',      hasEvent)

  // Premium
  add('supporter-starter', tier === 'starter')
  add('premium-plan',      tier === 'premium')
  add('vip-plan',          tier === 'vip')

  // Special
  add('early-adopter',     earlyAdopter)
  add('legendaire',        priceAtLeast(1_000_000) >= 1)

  // REVS RACE — only the two trivially-derivable badges are wired in
  // Phase 1. Phase 2 (multiplayer + race history) lights up the rest.
  const rs = ctx.raceStats
  add('race-first-blood', !!rs && rs.wins >= 1)
  add('race-perfect-10',  !!rs && rs.perfectStarts >= 10)
  add('race-champion',    !!rs && rs.wins >= 50)

  // Brand fans
  const brandCounts = new Map<string, number>()
  for (const s of spots) {
    const slug = brandSlugFor(s.brand)
    if (slug) brandCounts.set(slug, (brandCounts.get(slug) ?? 0) + 1)
  }
  for (const [slug, n] of brandCounts.entries()) {
    if (n >= 5) out.add(`fan-${slug}`)
  }

  // Ferrari Hunter / Lambo Spotter — keep backward-compat slugs.
  add('ferrari-hunter',  brandHas('ferrari'))
  add('lambo-spotter',   brandHas('lamborghini'))

  return out
}

/** Find a single badge (static or dynamic brand-fan) by slug. */
export function findBadge(slug: string): Badge | null {
  const known = BADGES.find((b) => b.slug === slug)
  if (known) return known
  return brandFanBadgeBySlug(slug)
}
