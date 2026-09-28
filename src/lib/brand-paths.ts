// GÉNÉRÉ PAR scripts/build-brand.mjs — NE PAS ÉDITER À LA MAIN.
// Relancer `npm run brand` après toute retouche de la géométrie.
//
// Les mêmes tracés alimentent les SVG de public/brand/, les icônes, le splash
// et les composants React : il n'existe qu'un seul dessin du logo REVS.

/** 'light' = masses blanc/argent · 'accent' = la diagonale rouge partagée. */
export type BrandPart = { role: 'light' | 'accent'; rule?: 'evenodd'; d: string }

/** Monogramme R+V seul. */
export const MONOGRAM = {
  w: 270.16,
  h: 144,
  parts: [
  { role: 'light', rule: 'evenodd' as const, d: 'M33.16,12 L57.16,12 L36,132 L12,132 Z M57.16,12 L109.16,12 L128.93,36 L124.7,60 L96.46,84 L44.46,84 Z M52.93,36 L100.93,36 L104.22,40 L101.4,56 L96.7,60 L48.7,60 Z' },
  { role: 'light', d: 'M86.7,60 L110.7,60 L130,132 L106,132 Z' },
  { role: 'accent', d: 'M113.16,12 L137.16,12 L169.64,100 L164,132 L158,132 Z' },
  { role: 'light', d: 'M169.64,100 L234.16,12 L258.16,12 L171,132 L164,132 Z' },
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

/** Verrou horizontal : monogramme + REVS, sans tagline. */
export const LOCKUP = {
  w: 735.79,
  h: 144,
  parts: [
  { role: 'light', rule: 'evenodd' as const, d: 'M33.16,12 L57.16,12 L36,132 L12,132 Z M57.16,12 L109.16,12 L128.93,36 L124.7,60 L96.46,84 L44.46,84 Z M52.93,36 L100.93,36 L104.22,40 L101.4,56 L96.7,60 L48.7,60 Z' },
  { role: 'light', d: 'M86.7,60 L110.7,60 L130,132 L106,132 Z' },
  { role: 'accent', d: 'M113.16,12 L137.16,12 L169.64,100 L164,132 L158,132 Z' },
  { role: 'light', d: 'M169.64,100 L234.16,12 L258.16,12 L171,132 L164,132 Z' },
  { role: 'light', rule: 'evenodd' as const, d: 'M308.04,22 L334.04,22 L316.41,122 L290.41,122 Z M334.04,22 L374.04,22 L392.16,44 L387.93,68 L362.05,90 L322.05,90 Z M329.45,48 L363.45,48 L365.1,50 L362.99,62 L360.63,64 L326.63,64 Z' },
  { role: 'light', d: 'M355.22,72 L381.22,72 L390.41,122 L364.41,122 Z' },
  { role: 'light', d: 'M420.04,22 L446.04,22 L428.41,122 L402.41,122 Z M446.04,22 L504.04,22 L487.45,48 L441.45,48 Z M439.51,59 L487.51,59 L470.93,85 L434.93,85 Z M432.99,96 L490.99,96 L474.41,122 L428.41,122 Z' },
  { role: 'accent', d: 'M516.04,22 L542.04,22 L555.93,68 L546.41,122 Z' },
  { role: 'light', d: 'M555.93,68 L586.04,22 L612.04,22 L546.41,122 Z' },
  { role: 'light', d: 'M624.04,22 L710.04,22 L705.45,48 L645.45,48 L643.51,59 L703.51,59 L692.41,122 L606.41,122 L610.99,96 L670.99,96 L672.93,85 L612.93,85 Z' },
  ] as BrandPart[],
}
