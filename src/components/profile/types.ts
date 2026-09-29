// Types partagés du profil.
//
// Ils vivent hors des composants pour que chaque fichier de composant
// n'exporte QU'un composant : c'est ce qu'exige le rafraîchissement à chaud de
// Vite, et c'est la raison pour laquelle ProfileStat et ProfileTabKey ne sont
// pas déclarés à côté de leur JSX.

export type ProfileStat = {
  key: string
  value: number
  label: string
  prefix?: string
  /** Absent → la statistique est affichée mais non cliquable. */
  to?: string
  /** Action interne (changer d'onglet) plutôt qu'une navigation. */
  onPress?: () => void
  /** Rien à afficher (rang inconnu) → un tiret plutôt qu'un zéro trompeur. */
  empty?: boolean
}

export type ProfileTabKey = 'garage' | 'collection' | 'badges' | 'rewards'

export const PROFILE_TABS: ProfileTabKey[] = [
  'garage',
  'collection',
  'badges',
  'rewards',
]
