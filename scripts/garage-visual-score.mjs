// ═══════ GARAGE VISUAL — NOTATION AUTOMATIQUE D'UN RENDU ═══════
//
// ── CE QUE CET OUTIL FAIT, ET CE QU'IL NE FERA JAMAIS ──
// Il mesure ce qui est mesurable sur des pixels : résolution, obscurité du
// fond, marge autour du sujet, famille de couleur de la carrosserie. Ces
// quatre mesures suffisent à écarter les ratés FRANCS — fond clair, voiture
// coupée, couleur fausse, image minuscule.
//
// Elles ne disent RIEN de la fidélité du modèle. Qu'une Classe C soit bien
// une Classe C et non une Classe E ne se lit pas dans un histogramme. Ce
// critère-là — le plus important des dix — reste un jugement humain, et
// l'outil le déclare ouvertement plutôt que d'inventer une note.
//
// C'est le point du cahier des charges §11 : refuser automatiquement un
// mauvais rendu. Un rendu refusé n'est jamais affiché ; le Garage retombe
// sur la photo du spot, qui est réelle.
//
// USAGE
//   node scripts/garage-visual-score.mjs <image> [couleur attendue]
//   node scripts/garage-visual-score.mjs rendu.png "noir obsidien"
//
// N'ÉCRIT RIEN EN BASE. Outil d'évaluation, pas pipeline.

import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { colourFamily } from '../server/garage-visual.js'

const [file, expectedColour] = process.argv.slice(2)
if (!file) {
  console.error('usage : node scripts/garage-visual-score.mjs <image> [couleur attendue]')
  process.exit(1)
}

const W = 320
const img = sharp(readFileSync(file))
const meta = await img.metadata()
const { data, info } = await img
  .resize({ width: W, fit: 'inside' })
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })
const w = info.width
const h = info.height
const ch = info.channels
const at = (x, y) => {
  const i = (y * w + x) * ch
  return [data[i], data[i + 1], data[i + 2]]
}
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

// ── 1. RÉSOLUTION ──
// Une carte de Garage s'affiche sur un écran à 3× : sous 900 px de large, la
// voiture est molle. C'est le seul critère qui ne dépend pas du contenu.
const resOk = (meta.width ?? 0) >= 900

// ── 2. OBSCURITÉ DU FOND ──
// Le showroom REVS est sombre. On échantillonne une bande sur le pourtour :
// si elle est claire, le fond n'est pas un studio — c'est souvent le signe
// que la photo d'origine a été conservée.
const band = Math.max(2, Math.round(h * 0.06))
let edgeSum = 0
let edgeN = 0
for (let y = 0; y < h; y += 1) {
  for (let x = 0; x < w; x += 1) {
    const onEdge = y < band || y >= h - band || x < band || x >= w - band
    if (!onEdge) continue
    edgeSum += lum(at(x, y))
    edgeN += 1
  }
}
const edgeLum = edgeSum / edgeN
const darkOk = edgeLum < 0.3

// ── 3. MARGE AUTOUR DU SUJET ──
// Une voiture coupée au bord n'est pas composable. On cherche, sur chaque
// bord, la proportion de pixels nettement plus clairs que le fond : au-delà
// d'un seuil, du sujet touche ce bord.
const bright = (v) => v > edgeLum + 0.18
const edgeHit = (pts) => pts.filter((p) => bright(lum(at(p[0], p[1])))).length / pts.length
const row = (y) => Array.from({ length: w }, (_, x) => [x, y])
const col = (x) => Array.from({ length: h }, (_, y) => [x, y])
const touches = [
  ['haut', edgeHit(row(1))],
  ['bas', edgeHit(row(h - 2))],
  ['gauche', edgeHit(col(1))],
  ['droite', edgeHit(col(w - 2))],
].filter(([, v]) => v > 0.12)
const marginOk = touches.length <= 1

// ── 4. COULEUR DE LA CARROSSERIE ──
// Une carrosserie rouge rendue en gris est un échec invisible aux trois
// autres mesures.
//
// ⚠️ LIMITE ASSUMÉE, trouvée en testant : moyenner la zone centrale mêle la
// voiture au fond du studio. Sur une Tesla BLANCHE posée sur un sol noir, la
// moyenne tombe dans le gris et l'outil refusait un rendu correct — un faux
// négatif, c'est-à-dire exactement le pire défaut pour un garde-fou.
//
// La mesure n'est donc tenue pour fiable que sur les teintes SATURÉES
// (rouge, bleu, vert, orange, jaune), qui se détachent du graphite quoi
// qu'il arrive. Pour le blanc, le noir et le gris, elle se déclare NON
// ÉVALUABLE au lieu de trancher à tort.
const cx0 = Math.round(w * 0.25)
const cx1 = Math.round(w * 0.75)
const cy0 = Math.round(h * 0.3)
const cy1 = Math.round(h * 0.8)
let rs = 0
let gs = 0
let bs = 0
let nc = 0
for (let y = cy0; y < cy1; y += 1) {
  for (let x = cx0; x < cx1; x += 1) {
    const px = at(x, y)
    if (lum(px) < 0.06) continue // ombre pure : ne dit rien de la teinte
    rs += px[0]
    gs += px[1]
    bs += px[2]
    nc += 1
  }
}
const avg = nc ? [rs / nc, gs / nc, bs / nc] : [0, 0, 0]
const [r, g, bb] = avg
const maxc = Math.max(r, g, bb)
const minc = Math.min(r, g, bb)
const sat = maxc === 0 ? 0 : (maxc - minc) / maxc
/** La famille observée, dans le même vocabulaire que la clé de cache. */
function observedFamily() {
  if (sat < 0.14) return maxc > 170 ? 'white' : maxc < 70 ? 'black' : 'grey'
  if (r > g && r > bb) return g > bb * 1.25 ? 'orange' : 'red'
  if (g > r && g > bb) return 'green'
  if (bb > r && bb > g) return 'blue'
  if (r > 150 && g > 130 && bb < 90) return 'yellow'
  return 'other'
}
const observed = observedFamily()
const expected = expectedColour ? colourFamily(expectedColour) : null
const ACHROMATIC = ['white', 'black', 'grey', 'other']
const colourTestable = expected !== null && !ACHROMATIC.includes(expected)
const colourOk = !colourTestable || expected === observed

// ── Verdict ──
const checks = [
  ['résolution ≥ 900 px', resOk, `${meta.width}×${meta.height}`],
  ['fond de studio sombre', darkOk, `luminance des bords ${edgeLum.toFixed(2)}`],
  ['voiture non coupée', marginOk, touches.length ? `touche : ${touches.map(([k]) => k).join(', ')}` : 'aucun bord touché'],
  [
    'couleur conservée',
    colourOk,
    !expected
      ? `observé ${observed} (aucune attente fournie)`
      : colourTestable
        ? `attendu ${expected}, observé ${observed}`
        : `${expected} — NON ÉVALUABLE sur fond sombre, non compté`,
  ],
]
const passed = checks.filter(([, ok]) => ok).length

console.log(`\n═══ ${file} ═══`)
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(26)} ${detail}`)
}
console.log(`\n  automatique : ${passed}/4`)
console.log(
  `  verdict     : ${passed === 4 ? 'RECEVABLE — à soumettre au jugement humain' : 'REFUSÉ — repli sur la photo du spot'}`,
)
console.log(`
  ⚠️  Ces 4 mesures ne couvrent PAS les 6 critères restants de la grille :
      identité du modèle, carrosserie, proportions, orientation, absence de
      parasites, qualité générale. L'identité du modèle en particulier — le
      critère éliminatoire — ne se mesure pas sur des pixels.
      Un « RECEVABLE » signifie « pas manifestement raté », jamais « validé ».`)
process.exit(passed === 4 ? 0 : 1)
