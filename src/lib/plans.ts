// Single source of truth for the subscription tier system. Used by
// Premium.tsx (checkout), Settings.tsx (current plan label),
// Profile.tsx (premium badges), and anywhere we need to gate features
// like the Radar mode or advanced stats.
//
// `subscriptions.plan` in Supabase can hold either:
//   - a current plan ID like "premium_monthly" / "vip_yearly"
//   - a legacy ID from the previous pricing ("starter", "premium", "vip")
// Both shapes are recognised on read; only the current shape is ever
// written by /api/create-checkout-session.

export type Tier = 'free' | 'premium' | 'vip' | 'starter'
export type Interval = 'month' | 'year'

export function planTier(plan: string | null | undefined): Tier {
  if (!plan) return 'free'
  if (plan.startsWith('vip')) return 'vip'
  if (plan.startsWith('premium')) return 'premium'
  if (plan === 'starter') return 'starter'
  return 'free'
}

export function planInterval(plan: string | null | undefined): Interval {
  if (!plan) return 'month'
  return plan.endsWith('_yearly') ? 'year' : 'month'
}

// Pretty label for a plan, used in Settings & badges. Legacy "starter"
// stays surfaced so users who bought it still see their tier name.
export function planDisplayName(plan: string | null | undefined): string {
  switch (planTier(plan)) {
    case 'vip':
      return 'VIP'
    case 'premium':
      return 'Premium'
    case 'starter':
      return 'Starter'
    default:
      return 'Gratuit'
  }
}

// A subscription is "premium-grade" when the user paid for Premium OR
// VIP (either monthly or yearly). Legacy "premium" counts; "starter"
// does not (it was a cheaper tier that didn't include Premium perks).
export function isPremiumOrAbove(
  plan: string | null | undefined,
  status: string | null | undefined,
): boolean {
  if (status !== 'active' && status !== 'trialing') return false
  const t = planTier(plan)
  return t === 'premium' || t === 'vip'
}

export function isVip(
  plan: string | null | undefined,
  status: string | null | undefined,
): boolean {
  if (status !== 'active' && status !== 'trialing') return false
  return planTier(plan) === 'vip'
}

// Catalogue used to render the Premium page. Centralised here so the
// page stays declarative.
export type PlanCard = {
  id: 'premium_monthly' | 'premium_yearly' | 'vip_monthly' | 'vip_yearly'
  tier: 'premium' | 'vip'
  interval: Interval
  priceLabel: string
  perks: string[]
  popular?: boolean
}

export const MONTHLY_PRICES: Record<'premium' | 'vip', string> = {
  premium: '7,99 €',
  vip: '24,99 €',
}
export const YEARLY_PRICES: Record<'premium' | 'vip', string> = {
  premium: '79,99 €',
  vip: '249,99 €',
}

// Short labels used on the main /premium grid cards (one-liners).
export const PREMIUM_PERKS = [
  'Spots illimités',
  'Mode Radar — notif en temps réel quand une supercar est près de toi',
  'Statistiques avancées',
  'Profil mis en avant dans le classement',
  'Badge Premium ⚡',
]

export const VIP_PERKS = [
  'Tout le Premium inclus',
  '🔥 Accès anticipé aux événements 48h avant tout le monde',
  'Badge Propriétaire certifié',
  'Events exclusifs et track days privés',
  'Badge VIP 👑',
]

// Concours VIP — surfaced separately on the main grid card AND in
// the checkout page so it reads as a true hero perk, not an item
// buried in a list.
export const VIP_CONCOURS = {
  title: 'Concours exclusifs VIP',
  body: 'Chaque mois, les membres VIP participent automatiquement à des tirages au sort pour gagner des expériences uniques : tours en supercar, invitations à Monaco, accès paddock F1, meets privés avec des propriétaires de supercars. Plus tu restes VIP longtemps, plus tu accumules de chances de gagner.',
}

export const FREE_PERKS = ['Carte et fil', '5 spots / jour', 'Events publics']

// Detailed perks used in the full-screen /premium/checkout pages —
// each item gets an emoji icon, a bold title, and a longer body.
export type DetailedPerk = { icon: string; title: string; body: string }

export const PREMIUM_PERKS_DETAILED: DetailedPerk[] = [
  {
    icon: '⚡',
    title: 'Spots illimités',
    body: 'Poste autant de spots que tu veux, sans aucune limite journalière.',
  },
  {
    icon: '🎯',
    title: 'Mode Radar',
    body: 'Reçois une notification dès qu’une supercar est spottée à moins de 10 km de toi en temps réel.',
  },
  {
    icon: '📊',
    title: 'Statistiques avancées',
    body: 'Carte de chaleur de tes spots, marques favorites, évolution XP semaine par semaine, heures de spotting.',
  },
  {
    icon: '👤',
    title: 'Profil mis en avant',
    body: 'Ton profil apparaît en priorité dans le classement global.',
  },
  {
    icon: '⚡',
    title: 'Badge Premium',
    body: 'Un badge exclusif visible sur tous tes spots et ton profil.',
  },
]

export const VIP_PERKS_DETAILED: DetailedPerk[] = [
  {
    icon: '✨',
    title: 'Tout le Premium inclus',
    body: 'L’intégralité des avantages Premium, inclus dans le VIP.',
  },
  {
    icon: '🏅',
    title: 'Badge Propriétaire certifié',
    body: 'Certifie que tu possèdes une supercar — un badge unique sur ton profil qui te distingue de la communauté.',
  },
  {
    icon: '🏁',
    title: 'Events exclusifs et track days privés',
    body: 'Accès à des events réservés aux membres VIP — track days privés, meets exclusifs, rencontres avec des collectionneurs.',
  },
  {
    icon: '👑',
    title: 'Badge VIP',
    body: 'Le badge le plus rare de REVS, visible sur tous tes spots et ton profil.',
  },
  {
    icon: '🎰',
    title: VIP_CONCOURS.title,
    body: VIP_CONCOURS.body,
  },
]
