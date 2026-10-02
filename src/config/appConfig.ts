export const appConfig = {
  // AUTH — providers OAuth masqués tant que les credentials ne sont pas
  // configurés (Supabase + Google Cloud Console / Apple Developer).
  // Repasser à true une fois les Client ID/Secret en place pour réafficher
  // les boutons sur Connexion ET Inscription.
  SHOW_GOOGLE_AUTH: false,
  SHOW_APPLE_AUTH: false,

  // F1 driver/team artwork: false = stylised SVG (helmet + monoplace tinted
  // to the livery colour) — zero image rights, auto-updates with the grid.
  // Flip to true only once official photo rights are secured.
  SHOW_F1_PHOTOS: false,

  // MAP — boutons masqués temporairement (réactivables en repassant à true)
  SHOW_REPLAY: false, // pastille "REPLAY" (haut gauche, sous la recherche)
  SHOW_MAP_INFO: false, // bouton sparkles/info IA (haut droite)

  // PHASE 2 - mois 2
  SHOW_REVS_RACE: true,
  SHOW_COLLECTIONS_TO_COMPLETE: true,
  SHOW_CARD_LEVEL_UP: true,
  SHOW_CARD_COLLECTION: true,

  // PHASE 3 - mois 4
  SHOW_F1_MOTORSPORT: true,
  SHOW_SPOT_WARS: true,
  SHOW_VIP_PLAN: true,

  // ── ABONNEMENTS : VISIBLES, PAS ACHETABLES (02/10/2026) ──
  //
  // Pendant la bêta, aucun paiement ne doit partir de l'application. Les
  // offres restent AFFICHÉES — elles disent où va le produit — mais leurs
  // boutons sont verrouillés et aucun checkout ne s'ouvre.
  //
  // Un seul drapeau commande tout : les cartes, les boutons et le garde
  // serveur de `create-checkout-session`. Le repasser à true rouvrira la
  // vente sans retoucher Stripe, le webhook, les tiers ni les quotas — qui
  // restent entièrement opérationnels et testés.
  //
  // ⚠️ Ce drapeau ne doit JAMAIS être la seule protection : le garde
  // équivalent côté serveur est dans api/create-checkout-session.ts. Un
  // drapeau de bundle ne protège rien contre une requête forgée.
  SUBSCRIPTIONS_ENABLED: false,
}
