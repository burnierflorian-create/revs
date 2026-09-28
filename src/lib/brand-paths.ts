// GÉNÉRÉ PAR scripts/build-brand.mjs — NE PAS ÉDITER À LA MAIN.
// Relancer `npm run brand` après toute retouche de la géométrie.
//
// Les mêmes tracés alimentent les SVG de public/brand/, les icônes, le splash
// et les composants React : il n'existe qu'un seul dessin du logo REVS.

/** 'light' = masses blanc/argent · 'accent' = la diagonale rouge partagée. */
export type BrandPart = {
  role: 'light' | 'accent'
  /** 'R' ou 'V' — utilisé par l'animation d'intro, qui trace le R puis le V. */
  group?: 'R' | 'V'
  rule?: 'evenodd'
  d: string
}

/** Monogramme R+V seul. */
export const MONOGRAM = {
  w: 265.3,
  h: 144,
  parts: [
  { role: 'accent', group: 'R' as const, d: 'M37.2,76 L61.2,76 L36,132 L12,132 Z' },
  { role: 'light', group: 'R' as const, rule: 'evenodd' as const, d: 'M34.2,12 L128.2,12 L148.2,32 L148.2,56 L128.2,76 L66.2,76 Z M46.2,36 L116.2,36 L124.2,42 L124.2,46 L116.2,52 L54.2,52 Z' },
  { role: 'light', group: 'R' as const, d: 'M120.2,56 L144.2,56 L176.12,132 L152.12,132 Z' },
  { role: 'accent', group: 'V' as const, d: 'M135.72,12 L159.72,12 L193.31,91.98 L193.31,132 L186.12,132 Z' },
  { role: 'light', group: 'V' as const, d: 'M193.31,91.98 L229.3,12 L253.3,12 L199.3,132 L193.31,132 Z' },
  ] as BrandPart[],
}

/** Le mot REVS seul. */
export const WORDMARK = {
  w: 443.63,
  h: 124,
  parts: [
  { role: 'light', rule: 'evenodd' as const, d: 'M29.63,12 L55.63,12 L38,112 L12,112 Z M55.63,12 L95.63,12 L113.75,34 L109.52,58 L83.64,80 L43.64,80 Z M51.05,38 L85.05,38 L86.7,40 L84.58,52 L82.23,54 L48.23,54 Z' },
  { role: 'light', d: 'M76.82,62 L102.82,62 L112,112 L86,112 Z' },
  { role: 'light', d: 'M141.63,12 L167.63,12 L150,112 L124,112 Z M167.63,12 L225.63,12 L209.05,38 L163.05,38 Z M161.11,49 L209.11,49 L192.52,75 L156.52,75 Z M154.58,86 L212.58,86 L196,112 L150,112 Z' },
  { role: 'accent', d: 'M237.63,12 L263.63,12 L277.52,58 L268,112 Z' },
  { role: 'light', d: 'M277.52,58 L307.63,12 L333.63,12 L268,112 Z' },
  { role: 'light', d: 'M345.63,12 L431.63,12 L427.05,38 L367.05,38 L365.11,49 L425.11,49 L414,112 L328,112 L332.58,86 L392.58,86 L394.52,75 L334.52,75 Z' },
  ] as BrandPart[],
}

/**
 * Tagline CARS. SPOTS. PASSION., dessinée au trait.
 * Coordonnées propres : hauteur de capitale 100, contour `strokeWidth`.
 */
export const TAGLINE = {
  w: 1602.63,
  h: 100,
  strokeWidth: 11,
  glyphs: [
    { t: 'translate(23.13 0) skewX(-10)', d: 'M48,11.9 A28,44 0 1 0 48,88.1' },
    { t: 'translate(111.13 0) skewX(-10)', d: 'M2,94 L30,6 L58,94 M12,66 L48,66' },
    { t: 'translate(197.13 0) skewX(-10)', d: 'M6,94 L6,6 L38,6 A22,22 0 0 1 38,50 L6,50 M30,50 L58,94' },
    { t: 'translate(285.13 0) skewX(-10)', d: 'M56,22 C56,11 46,6 32,6 C16,6 8,13 8,26 C8,38 18,43 34,47 C50,51 60,57 60,71 C60,86 50,94 32,94 C18,94 8,89 6,78' },
    { t: 'translate(377.13 0) skewX(-10)', d: 'M6,94 L6,94' },
    { t: 'translate(467.13 0) skewX(-10)', d: 'M56,22 C56,11 46,6 32,6 C16,6 8,13 8,26 C8,38 18,43 34,47 C50,51 60,57 60,71 C60,86 50,94 32,94 C18,94 8,89 6,78' },
    { t: 'translate(559.13 0) skewX(-10)', d: 'M6,94 L6,6 L38,6 A24,24 0 0 1 38,54 L6,54' },
    { t: 'translate(647.13 0) skewX(-10)', d: 'M6,50 A28,44 0 1 1 62,50 A28,44 0 1 1 6,50' },
    { t: 'translate(741.13 0) skewX(-10)', d: 'M0,6 L56,6 M28,6 L28,94' },
    { t: 'translate(823.13 0) skewX(-10)', d: 'M56,22 C56,11 46,6 32,6 C16,6 8,13 8,26 C8,38 18,43 34,47 C50,51 60,57 60,71 C60,86 50,94 32,94 C18,94 8,89 6,78' },
    { t: 'translate(915.13 0) skewX(-10)', d: 'M6,94 L6,94' },
    { t: 'translate(1005.13 0) skewX(-10)', d: 'M6,94 L6,6 L38,6 A24,24 0 0 1 38,54 L6,54' },
    { t: 'translate(1093.13 0) skewX(-10)', d: 'M2,94 L30,6 L58,94 M12,66 L48,66' },
    { t: 'translate(1179.13 0) skewX(-10)', d: 'M56,22 C56,11 46,6 32,6 C16,6 8,13 8,26 C8,38 18,43 34,47 C50,51 60,57 60,71 C60,86 50,94 32,94 C18,94 8,89 6,78' },
    { t: 'translate(1271.13 0) skewX(-10)', d: 'M56,22 C56,11 46,6 32,6 C16,6 8,13 8,26 C8,38 18,43 34,47 C50,51 60,57 60,71 C60,86 50,94 32,94 C18,94 8,89 6,78' },
    { t: 'translate(1363.13 0) skewX(-10)', d: 'M6,6 L6,94' },
    { t: 'translate(1401.13 0) skewX(-10)', d: 'M6,50 A28,44 0 1 1 62,50 A28,44 0 1 1 6,50' },
    { t: 'translate(1495.13 0) skewX(-10)', d: 'M6,94 L6,6 L58,94 L58,6' },
    { t: 'translate(1585.13 0) skewX(-10)', d: 'M6,94 L6,94' },
  ] as { t: string; d: string }[],
}

/** Verrou horizontal : monogramme + REVS, sans tagline. */
export const LOCKUP = {
  w: 730.93,
  h: 144,
  parts: [
  { role: 'accent', group: 'R' as const, d: 'M37.2,76 L61.2,76 L36,132 L12,132 Z' },
  { role: 'light', group: 'R' as const, rule: 'evenodd' as const, d: 'M34.2,12 L128.2,12 L148.2,32 L148.2,56 L128.2,76 L66.2,76 Z M46.2,36 L116.2,36 L124.2,42 L124.2,46 L116.2,52 L54.2,52 Z' },
  { role: 'light', group: 'R' as const, d: 'M120.2,56 L144.2,56 L176.12,132 L152.12,132 Z' },
  { role: 'accent', group: 'V' as const, d: 'M135.72,12 L159.72,12 L193.31,91.98 L193.31,132 L186.12,132 Z' },
  { role: 'light', group: 'V' as const, d: 'M193.31,91.98 L229.3,12 L253.3,12 L199.3,132 L193.31,132 Z' },
  { role: 'light', rule: 'evenodd' as const, d: 'M316.93,22 L342.93,22 L325.3,122 L299.3,122 Z M342.93,22 L382.93,22 L401.05,44 L396.82,68 L370.94,90 L330.94,90 Z M338.35,48 L372.35,48 L374,50 L371.88,62 L369.53,64 L335.53,64 Z' },
  { role: 'light', d: 'M364.12,72 L390.12,72 L399.3,122 L373.3,122 Z' },
  { role: 'light', d: 'M428.93,22 L454.93,22 L437.3,122 L411.3,122 Z M454.93,22 L512.93,22 L496.35,48 L450.35,48 Z M448.41,59 L496.41,59 L479.82,85 L443.82,85 Z M441.88,96 L499.88,96 L483.3,122 L437.3,122 Z' },
  { role: 'accent', d: 'M524.93,22 L550.93,22 L564.82,68 L555.3,122 Z' },
  { role: 'light', d: 'M564.82,68 L594.93,22 L620.93,22 L555.3,122 Z' },
  { role: 'light', d: 'M632.93,22 L718.93,22 L714.35,48 L654.35,48 L652.41,59 L712.41,59 L701.3,122 L615.3,122 L619.88,96 L679.88,96 L681.82,85 L621.82,85 Z' },
  ] as BrandPart[],
}
