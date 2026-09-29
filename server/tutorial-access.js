// ─────────────────── Contrôle d'accès du REVS Master Tutorial ───────────────────
//
// ⚠️ TEMPORAIRE — V1.
// Le tutoriel est actuellement réservé au créateur / compte administrateur.
// À remplacer ultérieurement par un vrai système de rôles/permissions
// (colonne `profiles.role`, ou table `admins`) si d'autres comptes doivent
// y accéder. Tant que ce fichier existe sous cette forme, l'autorisation
// repose sur une seule adresse e-mail.
//
// POURQUOI CE FICHIER VIT ICI ET PAS DANS src/
// Il ne doit JAMAIS partir dans le bundle navigateur. L'adresse autorisée est
// une donnée personnelle ; la publier dans un fichier JS servi publiquement
// reviendrait à l'exposer à quiconque ouvre les outils de développement.
// `server/` est déjà la convention du projet pour le code partagé par les
// fonctions `api/` sans devenir lui-même une fonction serverless Vercel
// (voir server/ai-gate.js).
//
// CONSÉQUENCE POUR LE FRONTEND : le client ne connaît pas l'adresse. Il
// demande au serveur s'il a le droit (`GET /api/tutorial?probe=1`) et masque
// le lien selon la réponse. Le masquage n'est qu'un confort d'affichage —
// la vraie barrière est ici, côté serveur.

/** Valeur par défaut, utilisée quand REVS_TUTORIAL_EMAIL n'est pas défini. */
const DEFAULT_ALLOWED_EMAIL = 'burnier.florian13@gmail.com'

/**
 * Adresse e-mail unique autorisée. Surchargeable par la variable
 * d'environnement REVS_TUTORIAL_EMAIL pour ne pas avoir à redéployer le code
 * si l'adresse change.
 *
 * Lue à CHAQUE appel plutôt qu'une fois au chargement du module : une lecture
 * figée à l'import rend le comportement dépendant de l'ordre de chargement,
 * ce qui est invisible en production mais piège tout banc de test.
 *
 * @returns {string}
 */
export function tutorialAllowedEmail() {
  return (process.env.REVS_TUTORIAL_EMAIL || DEFAULT_ALLOWED_EMAIL)
    .trim()
    .toLowerCase()
}

/**
 * Comparaison insensible à la casse et aux espaces. Supabase normalise déjà
 * les adresses en minuscules, mais on ne s'appuie pas dessus : un jour où
 * cette garantie changerait, la comparaison stricte refuserait silencieusement
 * le bon compte.
 *
 * @param {string | null | undefined} email
 * @returns {boolean}
 */
export function isTutorialAllowed(email) {
  if (!email) return false
  return String(email).trim().toLowerCase() === tutorialAllowedEmail()
}
