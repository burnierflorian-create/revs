export type TutorialChapter = {
  /** Identifiant d'ancre, ex. « ch-3 ». */
  id: string
  /** Numéro affiché : « 3 » pour un chapitre, « A » pour une annexe. */
  num: string
  title: string
  /** Résumé d'une ligne, affiché dans la navigation. */
  blurb: string
  markdown: string
}

export type TutorialDoc = {
  title: string
  version: string
  referenceCommit: string
  referenceDate: string
  lastVerified: string
  chapters: TutorialChapter[]
}

/** Contenu généré depuis docs/REVS_MASTER_TUTORIAL.md — ne pas éditer à la main. */
export declare const TUTORIAL: TutorialDoc
