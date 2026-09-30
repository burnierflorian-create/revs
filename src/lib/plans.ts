// Single source of truth for the subscription tier system. Used by
// Premium.tsx (checkout), Settings.tsx (current plan label),
// Profile.tsx (premium badges), and anywhere we need to gate features
// for tier-gated features.
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
//   1. « Sans aucune limite journalière » — le portail IA (server/ai-gate.js)
//      applique des plafonds fermes sur les ANALYSES :
//        free / starter  10  ·  premium  30  ·  vip  300
//      Annoncer l'illimité sur l'IA était faux. En revanche, depuis le
//      30/09/2026, la PUBLICATION de spots est bel et bien illimitée dans tous
//      les paliers : elle ne consomme aucune IA, et la plafonner revenait à
//      faire payer ce qui ne coûte rien.
//   2. Track days, concours, tirages au sort, paddock F1, invitations Monaco,
//      accès anticipé aux événements — aucune de ces contreparties n'existe,
//      ni dans le logiciel ni en dehors.
//   3. Mode Radar — retiré des perks le 27/09/2026. La fonctionnalité EXISTE
//      et fonctionne (gardée côté SQL par 0020-radar.sql via user_tier), mais
//      elle n'a pas de sens tant que la densité d'utilisateurs est trop faible
//      pour qu'une notification de proximité se déclenche. Le code est
//      conservé — src/pages/Radar.tsx, src/lib/radar.ts, la section des
//      réglages — seule la page est masquée. À remettre quand la densité
//      suivra.
//   4. « Statistiques avancées » et « Profil mis en avant dans le classement »
//      (retirés le 27/09/2026) — aucune implémentation : pas de carte de
//      chaleur, aucune statistique conditionnée au tier, et Leaderboard.tsx
//      ne connaît ni tier ni premium. isPremiumOrAbove() et isVip() ne
//      gardent aucune fonctionnalité dans tout src/. À remettre le jour où
//      elles existent, pas avant.
//
// Règle pour la suite : ne rien ajouter ici qui ne soit pas vérifiable dans
// le code ou déjà contractualisé.

// Short labels used on the main /premium grid cards (one-liners).
// 30/09/2026 — « spots IA » devient « analyses IA ». Le mot « spots » laissait
// croire que le nombre de voitures PUBLIABLES était plafonné. Il ne l'est plus
// (et ne l'aurait jamais dû, publier ne coûtant rien) : seules les analyses
// Claude sont comptées. Les chiffres, eux, sont inchangés pour Premium et VIP.
export const PREMIUM_PERKS = [
  '30 analyses IA par jour',
  'Badge Premium ⚡',
]

export const VIP_PERKS = [
  '300 analyses IA par jour',
  'Tout le Premium inclus',
  'Support prioritaire',
  'Badge VIP exclusif 👑',
]

export const FREE_PERKS = [
  '10 analyses IA par jour',
  'Spots illimités',
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
    title: '30 analyses IA par jour',
    body: 'Passe de 10 à 30 reconnaissances par jour — de quoi couvrir un rassemblement entier. Publier des spots reste illimité dans tous les paliers.',
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
    title: '300 analyses IA par jour',
    body: 'Le plafond le plus haut de REVS : 300 reconnaissances par jour, pour les spotteurs qui sortent tous les jours.',
  },
  {
    icon: '✨',
    title: 'Tout le Premium inclus',
    body: 'Le badge Premium et tous les avantages du palier, inclus dans le VIP.',
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
