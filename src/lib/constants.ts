// Constantes d'identité de la version, affichées à l'utilisateur.
//
// SOURCE UNIQUE : les deux valeurs ci-dessous sont les seules à modifier pour
// passer en bêta suivante puis en v1.0. Consommées par :
//   - src/components/TitleChip.tsx  → StageChip, le badge à côté du greeting
//   - src/pages/Settings.tsx        → « REVS v… » en pied de page
//
// Purement informatif : aucune fonctionnalité n'est gardée derrière.
export const APP_VERSION = '0.1.0-beta'

/** Étiquette courte du palier, pour les chips. */
export const APP_STAGE = 'BÊTA'

/**
 * L'adresse de contact de REVS.
 *
 * Elle était écrite en dur dans le pied des Paramètres. La refonte du 30/09 a
 * ajouté une ligne « Aide & contact » qui doit mener au même endroit : deux
 * adresses écrites à deux endroits finiraient par diverger, et l'une des deux
 * ne serait plus relevée.
 */
export const CONTACT_EMAIL = 'contact@revs.app'
