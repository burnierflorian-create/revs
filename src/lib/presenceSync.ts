// ═══════ LE COMPTEUR « EN LIGNE », AU MÊME INSTANT PARTOUT ═══════
//
// L'accueil et le panneau Membres posent la MÊME question à la base, avec la
// même définition depuis la migration 0113 — mais pas au même moment. Chacun
// rafraîchit de son côté toutes les 60 s, et le panneau rebat en plus la
// présence de celui qui l'ouvre.
//
// Résultat observé en production : l'accueil annonçait « 2 en ligne » pendant
// que le panneau ouvert par-dessus en listait 3. Les deux chiffres étaient
// justes, à une minute d'intervalle. Pour quelqu'un qui les voit côte à côte
// sur le même écran, c'est un bug.
//
// Ce module n'interroge rien. Il transporte simplement le nombre que la
// source la plus fraîche vient d'obtenir vers tous les compteurs affichés.

type Listener = (onlineNow: number) => void

const listeners = new Set<Listener>()
/** Le dernier chiffre connu, pour qu'un compteur qui se monte après coup
 *  n'affiche pas une valeur plus ancienne que celle déjà à l'écran. */
let last: number | null = null

/** Annonce un décompte fraîchement lu. */
export function publishOnlineCount(n: number): void {
  last = n
  for (const l of listeners) l(n)
}

/** S'abonne aux décomptes. Reçoit immédiatement le dernier connu, s'il y en
 *  a un. Renvoie la fonction de désabonnement. */
export function onOnlineCount(listener: Listener): () => void {
  listeners.add(listener)
  if (last != null) listener(last)
  return () => {
    listeners.delete(listener)
  }
}
