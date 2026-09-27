// Single source of truth for the subscription tier system. Used by
// Premium.tsx (checkout), Settings.tsx (current plan label),
// Profile.tsx (premium badges), and anywhere we need to gate features
// like the Radar mode.
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

// ─────────────────────── Contenu des offres ───────────────────────
// Réaligné le 26/09/2026 sur ce que le code livre RÉELLEMENT.
//
// Deux familles de promesses ont été retirées :
//   1. « Spots illimités » / « sans aucune limite journalière » — le portail
//      IA (server/ai-gate.js) applique des plafonds fermes. Ces chiffres sont
//      la référence, répliquée par le trigger de la migration 0068 :
//        free / starter  5  ·  premium  30  ·  vip  300
//      Annoncer l'illimité était faux.
//   2. Track days, concours, tirages au sort, paddock F1, invitations Monaco,
//      accès anticipé aux événements — aucune de ces contreparties n'existe,
//      ni dans le logiciel ni en dehors.
//   3. « Statistiques avancées » et « Profil mis en avant dans le classement »
//      (retirés le 27/09/2026) — aucune implémentation : pas de carte de
//      chaleur, aucune statistique conditionnée au tier, et Leaderboard.tsx
//      ne connaît ni tier ni premium. isPremiumOrAbove() et isVip() ne
//      gardent aucune fonctionnalité dans tout src/. À remettre le jour où
//      elles existent, pas avant.
//
// Règle pour la suite : ne rien ajouter ici qui ne soit pas vérifiable dans
// le code ou déjà contractualisé.

// Short labels used on the main /premium grid cards (one-liners).
export const PREMIUM_PERKS = [
  '30 spots IA par jour',
  'Mode Radar — notif en temps réel quand une supercar est près de toi',
  'Badge Premium ⚡',
]

export const VIP_PERKS = [
  '300 spots IA par jour',
  'Tout le Premium inclus',
  'Support prioritaire',
  'Badge VIP exclusif 👑',
]

export const FREE_PERKS = [
  '5 spots IA par jour',
  'Garage et collection de cartes',
  'Carte et fil',
  'XP, niveaux et badges',
]

// Detailed perks used in the full-screen /premium/checkout pages —
// each item gets an emoji icon, a bold title, and a longer body.
export type DetailedPerk = { icon: string; title: string; body: string }

export const PREMIUM_PERKS_DETAILED: DetailedPerk[] = [
  {
    icon: '⚡',
    title: '30 spots IA par jour',
    body: 'Passe de 5 à 30 reconnaissances par jour — de quoi couvrir un rassemblement entier.',
  },
  {
    icon: '🎯',
    title: 'Mode Radar',
    body: 'Reçois une notification dès qu’une supercar est spottée à moins de 10 km de toi en temps réel.',
  },
  {
    icon: '⚡',
    title: 'Badge Premium',
    body: 'Un badge exclusif visible sur tous tes spots et ton profil.',
  },
]

export const VIP_PERKS_DETAILED: DetailedPerk[] = [
  {
    icon: '⚡',
    title: '300 spots IA par jour',
    body: 'Le plafond le plus haut de REVS : 300 reconnaissances par jour, pour les spotteurs qui sortent tous les jours.',
  },
  {
    icon: '✨',
    title: 'Tout le Premium inclus',
    body: 'Le Mode Radar et le badge Premium, inclus dans le VIP.',
  },
  {
    icon: '💬',
    title: 'Support prioritaire',
    body: 'Tes messages passent devant : une réponse en priorité sur toute question ou tout souci technique.',
  },
  {
    icon: '👑',
    title: 'Badge VIP exclusif',
    body: 'Le badge le plus rare de REVS, visible sur tous tes spots et ton profil.',
  },
]
