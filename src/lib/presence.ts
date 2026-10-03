// ═══════ PRÉSENCE : UNE SEULE FAÇON DE DIRE « LA DERNIÈRE FOIS » ═══════
//
// Le panneau Membres et le profil public affichent la même information. Tant
// qu'ils la formataient chacun de leur côté, rien ne garantissait qu'ils
// disent la même chose du même compte — et c'est précisément ce que la
// mission interdit.
//
// ── POURQUOI DES MINUTES ET PAS UNE DATE ──
// Le serveur renvoie `minutes_ago`, jamais `last_seen`. Trois raisons :
//
//  1. Vie privée. Un horodatage dirait à qui veut le lire à quelle heure
//     précise quelqu'un ouvre REVS, chaque jour. Un nombre de minutes dit
//     « récemment » ou « il y a longtemps », ce qui est tout ce dont
//     l'interface a besoin.
//  2. Horloges. L'écart est calculé côté serveur, avec une seule horloge. Un
//     téléphone mal réglé afficherait sinon « il y a -3 h ».
//  3. Fuseaux et heure d'été. Une durée n'a ni fuseau ni changement d'heure :
//     il n'y a rien à convertir, donc rien à rater.
//
// ── POURQUOI UNE CLÉ ET PAS UN TEXTE ──
// La fonction renvoie la clé i18n et ses variables plutôt que la phrase
// traduite. Recevoir `t` en paramètre obligerait à typer la signature de
// i18next, qui change d'une version à l'autre ; et la traduction doit se
// faire au point d'affichage pour suivre un changement de langue sans
// recalculer les données.

/** Une durée relative prête à traduire : la clé, et son éventuel nombre.
 *
 *  Le même nombre est fourni sous deux noms. `n` est celui qu'emploient les
 *  libellés fixes (« il y a 5 min ») ; `count` est le nom qu'i18next exige
 *  pour choisir un pluriel, et seule l'année en a besoin en français —
 *  « 1 an », « 2 ans », là où « min », « h », « j » et « mois » sont
 *  invariables. Fournir les deux évite d'avoir à se rappeler, au point
 *  d'affichage, laquelle des clés est pluralisée. */
export type SinceLabel = { key: string; n?: number; count?: number }

const MIN_HOUR = 60
const MIN_DAY = 60 * 24
const MIN_WEEK = MIN_DAY * 7
// Mois et année en jours moyens : on affiche « il y a 3 mois », pas une date
// d'anniversaire. Compter 30 ou 30,44 jours ne change jamais le libellé d'un
// cran à cette échelle.
const MIN_MONTH = MIN_DAY * 30
const MIN_YEAR = MIN_DAY * 365

/**
 * Transforme des minutes écoulées en clé de traduction.
 *
 * `null` signifie « aucune activité connue » — un compte dont l'inscription
 * n'est pas terminée. Ce n'est pas la même chose que zéro.
 */
export function sinceLabel(minutes: number | null | undefined): SinceLabel {
  if (minutes == null || !Number.isFinite(minutes)) return { key: 'members.never' }
  // Une valeur négative ne devrait plus arriver — la base ramène désormais
  // toute activité future au présent (migration 0113) — mais une seconde
  // d'écart de réplication suffirait à produire -0,02 minute.
  const m = Math.max(0, minutes)
  const at = (key: string, n: number): SinceLabel => ({ key, n, count: n })
  if (m < 1) return { key: 'members.agoNow' }
  if (m < MIN_HOUR) return at('members.agoMin', Math.round(m))
  if (m < MIN_DAY) return at('members.agoHour', Math.floor(m / MIN_HOUR))
  if (m < MIN_WEEK) return at('members.agoDay', Math.floor(m / MIN_DAY))
  if (m < MIN_MONTH) return at('members.agoWeek', Math.floor(m / MIN_WEEK))
  if (m < MIN_YEAR) return at('members.agoMonth', Math.floor(m / MIN_MONTH))
  return at('members.agoYear', Math.floor(m / MIN_YEAR))
}

/** Ce que toute surface affichant une présence reçoit du serveur. */
export type Presence = { online: boolean; minutes_ago: number | null }
