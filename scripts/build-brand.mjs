// ════════════════════════════════════════════════════════════════════════
//  REVS — générateur d'identité visuelle
// ════════════════════════════════════════════════════════════════════════
//
// Source unique de TOUS les assets de marque. Les SVG et PNG de public/brand/,
// public/icons/, public/splashscreens/ et des projets natifs sont des SORTIES
// de ce fichier : ne pas les éditer à la main, relancer `npm run brand`.
//
// POURQUOI un générateur plutôt que des SVG écrits à la main : la charte
// impose que toutes les déclinaisons (couleur, monochrome, fond clair,
// favicon, icône, splash, OG) partagent EXACTEMENT la même géométrie. Avec
// des fichiers séparés, la première retouche les fait diverger. Ici la
// géométrie est déclarée une fois et toutes les variantes sont dérivées.
//
// ─────────────────────── Construction du monogramme ───────────────────────
//
// Le monogramme est un R et un V qui PARTAGENT une seule diagonale : le
// jambage du R est aussi le bras gauche du V. Ce n'est donc pas une
// superposition de deux lettres — il y a un seul trait à cet endroit, et il
// est rouge. C'est lui qui fait tenir la fusion.
//
// Tout est construit sur une grille verticale de 120 unités (hauteur de
// capitale) avec une graisse unique de 24 unités, puis l'ensemble est incliné
// de 10° d'un seul coup. L'inclinaison est APPLIQUÉE AUX COORDONNÉES (pas
// laissée en transform) pour que les SVG maîtres n'aient aucune
// transformation à interpréter : ils s'ouvrent proprement dans n'importe quel
// outil vectoriel.
//
// Effet secondaire recherché de l'inclinaison : les deux bras du V n'ont plus
// la même pente (le gauche s'adoucit, le droit se redresse). C'est ce
// déséquilibre qui donne la sensation de mouvement, sans aucun artifice
// ajouté — pas de glow, pas de dégradé, pas de « lignes de vitesse ».
//
// ───────────────────────────── Contraintes ─────────────────────────────
//   · un seul rouge : #E8203A (= --color-accent du design system)
//   · aucun dégradé, aucun glow dans les fichiers maîtres
//   · aucun <text> : tout est en tracés, donc zéro dépendance à une police
//   · le master d'icône est CARRÉ, sans coins arrondis dessinés
//
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = (p) => {
  const full = resolve(ROOT, p)
  mkdirSync(dirname(full), { recursive: true })
  return full
}

// ─────────────────────────────── Couleurs ───────────────────────────────
const RED = '#E8203A' // = --color-accent (232 32 58). Le seul rouge REVS.
const BLACK = '#0B0B0B'
const WHITE = '#FFFFFF'
const GRAY = '#9A9A9A'
// Gris de la tagline SUR FOND CLAIR. --revs-gray (#9A9A9A) est calibré pour le
// fond noir ; posé sur blanc il tombe à un contraste de 2.8:1, illisible. Ce
// n'est pas un sixième gris de charte, c'est la même valeur de rôle réglée
// pour l'autre fond.
const GRAY_ON_LIGHT = '#6B6B6B'

// ──────────────────────────── Outils géométrie ────────────────────────────
const SLANT = 10 // degrés d'inclinaison italique
const TAN = Math.tan((SLANT * Math.PI) / 180)

/** Incline un point : plus il est bas, plus il recule. y=0 est la référence. */
const shear = ([x, y]) => [x, y] // géométrie déjà en coordonnées finales

const r2 = (n) => Math.round(n * 100) / 100

/** Polygone → attribut `d`. Les points sont inclinés puis décalés. */
function poly(points, dx = 0, dy = 0) {
  const p = points
    .map(shear)
    .map(([x, y]) => `${r2(x + dx)},${r2(y + dy)}`)
    .join(' L')
  return `M${p} Z`
}

/** Boîte englobante d'une liste de polygones déjà inclinés. */
function bbox(polys) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const pts of polys)
    for (const [x, y] of pts.map(shear)) {
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }
}

// ══════════════════════════════════════════════════════════════════════
//  MONOGRAMME R+V — d'après la planche de référence du 28/09/2026
// ══════════════════════════════════════════════════════════════════════
//
// Le mark est construit sur DEUX familles de diagonales, et c'est ce qui
// fait sa lecture :
//   · les obliques « descendantes-gauche » (pente -0.38) : hampe du R, bras
//     droit du V, et la dalle rouge ;
//   · les obliques « descendantes-droite » (pente +0.36) : jambage du R et
//     bras gauche du V, qui courent en parallèle à 8 unités d'écart.
//
// RÉPARTITION DES COULEURS — relevée sur la planche, pas déduite :
//   ROUGE : la dalle inclinée en bas à gauche (écho de la hampe du R) et le
//           bras gauche du V, c'est-à-dire la diagonale centrale ;
//   BLANC : la panse du R avec son contrepoinçon, sa hampe, son jambage, et
//           le bras droit du V.
//
// La panse du R reste donc CLAIRE. C'est elle qui porte la lisibilité : la
// passer en rouge ferait perdre le contraste qui distingue le R du V, et la
// référence ne la montre pas rouge.
//
// Aucune inclinaison globale n'est appliquée ici : contrairement à la version
// précédente, les obliques sont dessinées directement dans leurs coordonnées
// finales. Les deux pentes sont volontairement DIFFÉRENTES (-0.38 / +0.36),
// ce qui est impossible à obtenir avec un skew uniforme et c'est précisément
// ce déséquilibre qui donne son allure au monogramme.

const SL_L = -0.45 // obliques descendantes-gauche
const SL_R = 0.42 // obliques descendantes-droite
const WGT = 24 // graisse unique
const BOWL_SL = 0.5 // biais du flanc gauche du R

/** Parallélogramme oblique : bord gauche en (x0,y0), pente `sl`, jusqu'à y1. */
const bar = (x0, y0, y1, sl, w = WGT) => [
  [x0, y0],
  [x0 + w, y0],
  [x0 + w + sl * (y1 - y0), y1],
  [x0 + sl * (y1 - y0), y1],
]

// ── Le R ──
// Panse COMPACTE : 118 de large pour 64 de haut. La première tentative l'avait
// faite deux fois trop grande, ce qui la faisait lire comme un « F ». Le
// contrepoinçon est une fente courte, pas une ouverture.
const R_BOWL_OUT = [
  [6, 0],
  [100, 0],
  [120, 20],
  [120, 44],
  [100, 64],
  [6 + BOWL_SL * 64, 64],
]
const R_BOWL_IN = [
  [6 + BOWL_SL * 24, 24],
  [88, 24],
  [96, 30],
  [96, 34],
  [88, 40],
  [6 + BOWL_SL * 40, 40],
]

// Jambage : part de l'intérieur de la panse (y=40) et descend à droite.
const R_LEG = bar(92, 44, 120, SL_R)

// Dalle ROUGE — tient la place de la hampe, détachée d'environ 5 unités du
// flanc gauche de la panse. Même graisse et même famille d'angle que les
// lettres : c'est une contre-forme, pas un trait de vitesse.
const RED_SLAB = bar(9, 64, 120, SL_L)

// ── Le V ──
// Bras gauche ROUGE, parallèle au jambage du R à 10 unités d'écart constant.
const V_LX = 116 + SL_R * (0 - 44) + 10
const V_RX = 201.1
const V_VY = (V_RX - (V_LX + WGT)) / (SL_R - SL_L)
const V_VX = V_LX + WGT + SL_R * V_VY

const V_LEFT = [
  [V_LX, 0],
  [V_LX + WGT, 0],
  [V_VX, V_VY],
  [V_VX, 120],
  [V_LX + SL_R * 120, 120],
]
const V_RIGHT = [
  [V_VX, V_VY],
  [V_RX, 0],
  [V_RX + WGT, 0],
  [V_RX + WGT + SL_L * 120, 120],
  [V_VX, 120],
]

const MONO_BOX = bbox([R_BOWL_OUT, R_LEG, RED_SLAB, V_LEFT, V_RIGHT])

function monogramParts(dx, dy, k = 1) {
  const S = (pts) => pts.map(([x, y]) => [x * k, y * k])
  // `group` sert à l'animation d'intro, qui trace le R puis le V. La dalle
  // rouge appartient au R : elle occupe la place de sa hampe.
  return [
    { role: 'accent', group: 'R', d: poly(S(RED_SLAB), dx, dy) },
    {
      role: 'light',
      group: 'R',
      rule: 'evenodd',
      d: `${poly(S(R_BOWL_OUT), dx, dy)} ${poly(S(R_BOWL_IN), dx, dy)}`,
    },
    { role: 'light', group: 'R', d: poly(S(R_LEG), dx, dy) },
    { role: 'accent', group: 'V', d: poly(S(V_LEFT), dx, dy) },
    { role: 'light', group: 'V', d: poly(S(V_RIGHT), dx, dy) },
  ]
}

const partsToSvg = (parts, light, accent) =>
  parts
    .map(
      (p) =>
        `<path fill="${p.role === 'accent' ? accent : light}"${p.rule ? ` fill-rule="${p.rule}"` : ''} d="${p.d}"/>`,
    )
    .join('\n  ')

function monogramBody(light, accent, dx, dy) {
  return partsToSvg(monogramParts(dx, dy), light, accent)
}

// ══════════════════════════════════════════════════════════════════════
//  MOT « REVS » — grille cap 100, graisse 26
// ══════════════════════════════════════════════════════════════════════
//
// Lettres construites sur la même logique que le monogramme : angles nets,
// terminaisons du E coupées en biais sur la pente du V pour que tout
// l'alphabet appartienne au même dessin.
//
// Le V du mot reçoit le MÊME bras gauche rouge que le monogramme. Ce n'est
// pas une lettre mise en couleur au hasard : c'est la règle du système —
// le V est toujours l'endroit où le rouge apparaît.
//
const W_R = [
  {
    fill: 'light',
    rule: 'evenodd',
    parts: [
      [
        [0, 0],
        [26, 0],
        [26, 100],
        [0, 100],
      ],
      [
        [26, 0],
        [66, 0],
        [88, 22],
        [88, 46],
        [66, 68],
        [26, 68],
      ],
      [
        [26, 26],
        [60, 26],
        [62, 28],
        [62, 40],
        [60, 42],
        [26, 42],
      ],
    ],
  },
  {
    fill: 'light',
    parts: [
      [
        [56, 50],
        [82, 50],
        [100, 100],
        [74, 100],
      ],
    ],
  },
]
const W_E = [
  {
    fill: 'light',
    parts: [
      [
        [0, 0],
        [26, 0],
        [26, 100],
        [0, 100],
      ],
      [
        [26, 0],
        [84, 0],
        [72, 26],
        [26, 26],
      ],
      [
        [26, 37],
        [74, 37],
        [62, 63],
        [26, 63],
      ],
      [
        [26, 74],
        [84, 74],
        [72, 100],
        [26, 100],
      ],
    ],
  },
]
const W_V = [
  {
    fill: 'accent',
    parts: [
      [
        [0, 0],
        [26, 0],
        [48, 46],
        [48, 100],
      ],
    ],
  },
  {
    fill: 'light',
    parts: [
      [
        [48, 46],
        [70, 0],
        [96, 0],
        [48, 100],
      ],
    ],
  },
]
const W_S = [
  {
    fill: 'light',
    parts: [
      [
        [0, 0],
        [86, 0],
        [86, 26],
        [26, 26],
        [26, 37],
        [86, 37],
        [86, 100],
        [0, 100],
        [0, 74],
        [60, 74],
        [60, 63],
        [0, 63],
      ],
    ],
  },
]

const WORD = [
  { g: W_R, w: 100 },
  { g: W_E, w: 84 },
  { g: W_V, w: 96 },
  { g: W_S, w: 86 },
]
const TRACK = 12
const WORD_W = WORD.reduce((s, l) => s + l.w, 0) + TRACK * (WORD.length - 1)

/** Le mot REVS, en coordonnées locales cap-100. */
const WORD_SLANT = Math.tan((10 * Math.PI) / 180)

function wordmarkParts(dx, dy, scale = 1) {
  // Inclinaison propre au mot (10°). Le monogramme, lui, tient son élan de
  // ses deux pentes dissymétriques et n'est pas incliné globalement.
  const ital = ([x, y]) => [x - WORD_SLANT * y, y]
  let x = 0
  const parts = []
  for (const { g, w } of WORD) {
    for (const grp of g) {
      parts.push({
        role: grp.fill,
        rule: grp.rule,
        d: grp.parts
          .map((pts) =>
            poly(
              pts.map(([px, py]) => ital([(px + x) * scale, py * scale])),
              dx,
              dy,
            ),
          )
          .join(' '),
      })
    }
    x += w + TRACK
  }
  return parts
}

function wordmarkBody(light, accent, dx, dy, scale = 1) {
  return partsToSvg(wordmarkParts(dx, dy, scale), light, accent)
}

// ══════════════════════════════════════════════════════════════════════
//  TAGLINE « CARS. SPOTS. PASSION. »
// ══════════════════════════════════════════════════════════════════════
//
// Capitales linéales très espacées. Dessinées au TRAIT (stroke) et non en
// masse : à cette taille un contour plein serait plus lourd que le logo
// lui-même. Toujours zéro <text>, donc toujours zéro police requise.
//
const TAG_CAP = 100
const TAG_SW = 11
const GLYPHS = {
  C: { w: 62, d: 'M48,11.9 A28,44 0 1 0 48,88.1' },
  A: { w: 60, d: 'M2,94 L30,6 L58,94 M12,66 L48,66' },
  R: { w: 62, d: 'M6,94 L6,6 L38,6 A22,22 0 0 1 38,50 L6,50 M30,50 L58,94' },
  S: {
    w: 66,
    d: 'M56,22 C56,11 46,6 32,6 C16,6 8,13 8,26 C8,38 18,43 34,47 C50,51 60,57 60,71 C60,86 50,94 32,94 C18,94 8,89 6,78',
  },
  P: { w: 62, d: 'M6,94 L6,6 L38,6 A24,24 0 0 1 38,54 L6,54' },
  O: { w: 68, d: 'M6,50 A28,44 0 1 1 62,50 A28,44 0 1 1 6,50' },
  T: { w: 56, d: 'M0,6 L56,6 M28,6 L28,94' },
  N: { w: 64, d: 'M6,94 L6,6 L58,94 L58,6' },
  I: { w: 12, d: 'M6,6 L6,94' },
  // Point : segment de longueur nulle + linecap rond = un vrai point, de
  // diamètre exactement égal à la graisse du reste. Rien à accorder.
  '.': { w: 12, d: 'M6,94 L6,94' },
  ' ': { w: 26, d: '' },
}
const TAG_TEXT = 'CARS. SPOTS. PASSION.'
const TAG_TRACK = 26

/** Les glyphes de la tagline, en coordonnées locales, pour React. */
function taglineGlyphExport() {
  const off = WORD_SLANT * TAG_CAP + TAG_SW / 2
  let x = 0
  const rows = []
  for (const ch of TAG_TEXT) {
    const g = GLYPHS[ch]
    if (g.d)
      rows.push(
        `    { t: 'translate(${r2(off + x)} 0) skewX(-${SLANT})', d: '${g.d}' },`,
      )
    x += g.w + TAG_TRACK
  }
  return rows.join('\n')
}

function taglineMetrics() {
  let w = 0
  for (const ch of TAG_TEXT) w += GLYPHS[ch].w + TAG_TRACK
  return { w: w - TAG_TRACK, h: TAG_CAP }
}

/** Tagline inclinée comme le reste, à l'échelle `scale`. */
function taglineBody(color, dx, dy, scale) {
  let x = 0
  const parts = []
  for (const ch of TAG_TEXT) {
    const g = GLYPHS[ch]
    if (g.d) {
      // On incline en translatant chaque glyphe : la pente du trait suit la
      // même inclinaison que les lettres du logo.
      parts.push(
        `<g transform="translate(${r2(dx + x * scale)} ${r2(dy)}) scale(${r2(scale)}) skewX(-${SLANT})"><path d="${g.d}"/></g>`,
      )
    }
    x += g.w + TAG_TRACK
  }
  return `<g fill="none" stroke="${color}" stroke-width="${r2(TAG_SW)}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" style="stroke-width:${r2(TAG_SW)}">${parts.join('')}</g>`
}

// ══════════════════════════════════════════════════════════════════════
//  Assemblages
// ══════════════════════════════════════════════════════════════════════
const svg = (w, h, body, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(w)} ${r2(h)}" width="${r2(w)}" height="${r2(h)}"${extra}>\n  ${body}\n</svg>\n`

const PAD = 12

/** Monogramme seul, fond transparent. */
function monogramSvg(light, accent) {
  const w = MONO_BOX.w + PAD * 2
  const h = MONO_BOX.h + PAD * 2
  return svg(w, h, monogramBody(light, accent, PAD - MONO_BOX.x0, PAD))
}

// Verrou horizontal : monogramme (cap 120) + REVS (cap 100), REVS centré
// verticalement sur le monogramme.
const GAP = 46
const WORD_SCALE = 1
const WORD_BOX_W = WORD_W + WORD_SLANT * 100 // largeur après inclinaison

/** Logo horizontal. `tagline` ajoute CARS. SPOTS. PASSION. sous le mot. */
function logoSvg(light, accent, taglineColor = null) {
  const monoDx = PAD - MONO_BOX.x0
  const wordX = PAD + MONO_BOX.w + GAP
  const wordY = PAD + (MONO_BOX.h - 100) / 2
  // `poly` incline autour de y=0 ; on compense le décalage du mot.
  const wordDx = wordX + WORD_SLANT * 100

  let body =
    monogramBody(light, accent, monoDx, PAD) +
    '\n  ' +
    wordmarkBody(light, accent, wordDx, wordY, WORD_SCALE)

  let w = wordX + WORD_BOX_W + PAD
  let h = MONO_BOX.h + PAD * 2

  if (taglineColor) {
    const tm = taglineMetrics()
    // Tagline calée sur la largeur du mot, sous la ligne de base.
    const tScale = (WORD_BOX_W * 0.98) / tm.w
    const tY = PAD + MONO_BOX.h + 26
    body +=
      '\n  ' + taglineBody(taglineColor, wordX + WORD_SLANT * TAG_CAP * tScale, tY, tScale)
    h = tY + TAG_CAP * tScale + PAD
  }
  return svg(w, h, body)
}

/** Le mot REVS seul, sans le monogramme. */
function wordmarkSvg(light, accent) {
  const w = WORD_BOX_W + PAD * 2
  const h = 100 + PAD * 2
  return svg(w, h, wordmarkBody(light, accent, PAD + WORD_SLANT * 100, PAD))
}

/**
 * Master d'icône CARRÉ, sans coins arrondis dessinés.
 * Utilisé pour les icônes natives et l'icône PWA `maskable`, où le système
 * pose lui-même son masque : des coins transparents y produiraient un double
 * arrondi sur iOS, et un canal alpha fait rejeter le binaire à l'App Store.
 */
function iconSvg(size, bg, light, accent, fill = 0.76) {
  const k = (size * fill) / MONO_BOX.w
  const w = MONO_BOX.w * k
  const h = MONO_BOX.h * k
  const dx = (size - w) / 2 - MONO_BOX.x0 * k
  const dy = (size - h) / 2
  const body =
    (bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>\n  ` : '') +
    partsToSvg(monogramParts(dx, dy, k), light, accent)
  return svg(size, size, body)
}

/**
 * Logo VERTICAL — la version principale de la charte :
 *   monogramme R+V, puis REVS dessous, puis la tagline.
 * Les deux blocs sont centrés l'un sur l'autre et calés à la même largeur.
 */
function verticalLogoSvg(light, accent, taglineColor = null) {
  const monoW = MONO_BOX.w
  // Le mot est mis à la largeur du monogramme : c'est ce qui donne au bloc
  // son alignement vertical franc, gauche comme droite.
  const wScale = monoW / WORD_BOX_W
  const wordH = 100 * wScale
  const GAP_V = 22

  const w = monoW + PAD * 2
  const monoDx = PAD - MONO_BOX.x0
  const wordY = PAD + MONO_BOX.h + GAP_V

  let body =
    monogramBody(light, accent, monoDx, PAD) +
    '\n  ' +
    wordmarkBody(light, accent, PAD + WORD_SLANT * 100 * wScale, wordY, wScale)

  let h = wordY + wordH + PAD

  if (taglineColor) {
    const tm = taglineMetrics()
    const tScale = (monoW * 0.92) / tm.w
    const tY = wordY + wordH + 26
    body +=
      '\n  ' +
      taglineBody(
        taglineColor,
        PAD + monoW * 0.04 + WORD_SLANT * TAG_CAP * tScale,
        tY,
        tScale,
      )
    h = tY + TAG_CAP * tScale + PAD
  }
  return svg(w, h, body)
}

/**
 * Icône à COINS ARRONDIS, avec un liseré rouge qui s'intensifie vers le bas.
 *
 * ⚠️ Réservée au web et à la communication. NE PAS l'utiliser comme icône
 * native : iOS applique déjà son propre masque (on obtiendrait un double
 * arrondi) et refuse un canal alpha à l'upload App Store, tandis que l'icône
 * adaptative Android exige une image à fond perdu. Les cibles natives passent
 * par iconSvg(), carrée.
 */
function roundedIconSvg(size, light, accent, fill = 0.66) {
  const r = size * 0.225 // proche du superellipse iOS
  const k = (size * fill) / MONO_BOX.w
  const w = MONO_BOX.w * k
  const h = MONO_BOX.h * k
  const dx = (size - w) / 2 - MONO_BOX.x0 * k
  const dy = (size - h) / 2
  const sw = Math.max(1, size * 0.011)
  const body = `<defs>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.35" stop-color="${accent}" stop-opacity="0"/>
      <stop offset="0.78" stop-color="${accent}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="1"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${size}" height="${size}" rx="${r2(r)}" fill="${BLACK}"/>
  ${partsToSvg(monogramParts(dx, dy, k), light, accent)}
  <rect x="${r2(sw / 2)}" y="${r2(sw / 2)}" width="${r2(size - sw)}" height="${r2(size - sw)}" rx="${r2(r - sw / 2)}" fill="none" stroke="url(#rim)" stroke-width="${r2(sw)}"/>`
  return svg(size, size, body)
}

// ══════════════════════════════════════════════════════════════════════
//  Écriture
// ══════════════════════════════════════════════════════════════════════
const written = []
const write = (p, content) => {
  writeFileSync(out(p), content)
  written.push(p)
}

// ── SVG maîtres : monogramme ──
write('public/brand/revs-monogram.svg', monogramSvg(WHITE, RED))
write('public/brand/revs-monogram-light.svg', monogramSvg(BLACK, RED))
write('public/brand/revs-monogram-white.svg', monogramSvg(WHITE, WHITE))
write('public/brand/revs-monogram-black.svg', monogramSvg(BLACK, BLACK))

// ── Logo PRINCIPAL : vertical (monogramme / REVS / tagline) ──
// C'est la version 01 de la planche de référence.
const LOGO_PRIMARY = verticalLogoSvg(WHITE, RED, GRAY)
write('public/brand/revs-logo-primary.svg', LOGO_PRIMARY)
write('public/brand/revs-logo-vertical.svg', LOGO_PRIMARY)
write(
  'public/brand/revs-logo-primary-light.svg',
  verticalLogoSvg(BLACK, RED, GRAY_ON_LIGHT),
)

// ── Logo HORIZONTAL : monogramme + REVS sur une ligne ──
write('public/brand/revs-logo-horizontal.svg', logoSvg(WHITE, RED))
write(
  'public/brand/revs-logo-horizontal-tagline.svg',
  logoSvg(WHITE, RED, GRAY),
)
write('public/brand/revs-logo-dark.svg', logoSvg(WHITE, RED))
write('public/brand/revs-logo-light.svg', logoSvg(BLACK, RED))
write(
  'public/brand/revs-logo-horizontal-light.svg',
  logoSvg(BLACK, RED, GRAY_ON_LIGHT),
)
write('public/brand/revs-logo-monochrome-white.svg', logoSvg(WHITE, WHITE))
write('public/brand/revs-logo-monochrome-black.svg', logoSvg(BLACK, BLACK))

// ── SVG maîtres : mot seul ──
write('public/brand/revs-wordmark.svg', wordmarkSvg(WHITE, RED))
write('public/brand/revs-wordmark-light.svg', wordmarkSvg(BLACK, RED))

// ── Master d'icône (carré, fond noir) ──
const ICON_MASTER = iconSvg(1024, BLACK, WHITE, RED)
write('public/brand/revs-icon-master.svg', ICON_MASTER)

// ── Favicon : même dessin, moins de marge pour tenir à 16 px ──
const FAVICON = iconSvg(64, BLACK, WHITE, RED, 0.86)
write('public/brand/favicon.svg', FAVICON)
write('public/favicon.svg', FAVICON)

// ── Tracés exportés vers React ──
// src/components/Logo.tsx consomme ce fichier au lieu de redessiner le logo.
// C'est ce qui garantit que le monogramme affiché dans l'application est
// rigoureusement le même que celui des SVG et des icônes.
{
  const monoW = MONO_BOX.w + PAD * 2
  const monoH = MONO_BOX.h + PAD * 2
  const wordX = PAD + MONO_BOX.w + GAP
  const wordY = PAD + (MONO_BOX.h - 100) / 2
  const lock = [
    ...monogramParts(PAD - MONO_BOX.x0, PAD),
    ...wordmarkParts(wordX + WORD_SLANT * 100, wordY, WORD_SCALE),
  ]
  const fmt = (parts) =>
    parts
      .map(
        (p) =>
          `  { role: '${p.role}'${p.group ? `, group: '${p.group}' as const` : ''}${p.rule ? `, rule: '${p.rule}' as const` : ''}, d: '${p.d}' },`,
      )
      .join('\n')

  write(
    'src/lib/brand-paths.ts',
    `// GÉNÉRÉ PAR scripts/build-brand.mjs — NE PAS ÉDITER À LA MAIN.
// Relancer \`npm run brand\` après toute retouche de la géométrie.
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
  w: ${r2(monoW)},
  h: ${r2(monoH)},
  parts: [
${fmt(monogramParts(PAD - MONO_BOX.x0, PAD))}
  ] as BrandPart[],
}

/** Le mot REVS seul. */
export const WORDMARK = {
  w: ${r2(WORD_BOX_W + PAD * 2)},
  h: ${r2(100 + PAD * 2)},
  parts: [
${fmt(wordmarkParts(PAD + WORD_SLANT * 100, PAD, WORD_SCALE))}
  ] as BrandPart[],
}

/**
 * Tagline CARS. SPOTS. PASSION., dessinée au trait.
 * Coordonnées propres : hauteur de capitale 100, contour \`strokeWidth\`.
 */
export const TAGLINE = {
  w: ${r2(taglineMetrics().w + WORD_SLANT * TAG_CAP + TAG_SW)},
  h: ${r2(TAG_CAP)},
  strokeWidth: ${TAG_SW},
  glyphs: [
${taglineGlyphExport()}
  ] as { t: string; d: string }[],
}

/** Verrou horizontal : monogramme + REVS, sans tagline. */
export const LOCKUP = {
  w: ${r2(wordX + WORD_BOX_W + PAD)},
  h: ${r2(monoH)},
  parts: [
${fmt(lock)}
  ] as BrandPart[],
}
`,
  )
}

console.log('SVG écrits :', written.length)

// ══════════════════════════════════════════════════════════════════════
//  Rastérisation
// ══════════════════════════════════════════════════════════════════════
const png = (svgStr, size, dest) =>
  sharp(Buffer.from(svgStr), { density: 384 })
    .resize(size, size, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toFile(out(dest))
    .then(() => written.push(dest))

// ── Icônes de marque : coins arrondis + liseré rouge en bas ──
// Le liseré est un contour dégradé, transparent en haut et plein en bas.
// C'est la seule pièce de la charte qui utilise un dégradé : les SVG maîtres
// du logo restent en aplats.
const ICON_ROUNDED = roundedIconSvg(1024, WHITE, RED)
write('public/brand/revs-icon-rounded.svg', ICON_ROUNDED)
for (const s of [1024, 512, 256, 128])
  await png(ICON_ROUNDED, s, `public/brand/revs-icon-${s}.png`)

// ── Logo principal en PNG (fond transparent) ──
{
  const m = LOGO_PRIMARY.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  await sharp(Buffer.from(LOGO_PRIMARY), { density: 900 })
    .resize({ width: 1200, height: Math.round((1200 * +m[2]) / +m[1]) })
    .png({ compressionLevel: 9 })
    .toFile(out('public/brand/revs-logo-primary.png'))
  written.push('public/brand/revs-logo-primary.png')

  const hz = logoSvg(WHITE, RED)
  const mh = hz.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  await sharp(Buffer.from(hz), { density: 900 })
    .resize({ width: 1200, height: Math.round((1200 * +mh[2]) / +mh[1]) })
    .png({ compressionLevel: 9 })
    .toFile(out('public/brand/revs-logo-horizontal.png'))
  written.push('public/brand/revs-logo-horizontal.png')
}

// Favicons
for (const s of [32, 16]) await png(FAVICON, s, `public/brand/favicon-${s}.png`)

// Icônes PWA / iOS déjà référencées par index.html et le manifest
for (const s of [152, 167, 180, 192, 512])
  await png(ICON_MASTER, s, `public/icons/icon-${s}x${s}.png`)
write('public/icons/master.svg', ICON_MASTER)

// ── Open Graph 1200×630 : logo + tagline, centré sur fond noir ──
const OG_W = 1200
const OG_H = 630
{
  const logo = logoSvg(WHITE, RED, GRAY)
  const m = logo.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  const lw = +m[1]
  const lh = +m[2]
  const s = (OG_W * 0.62) / lw
  const body = `<rect width="${OG_W}" height="${OG_H}" fill="${BLACK}"/>
  <g transform="translate(${r2((OG_W - lw * s) / 2)} ${r2((OG_H - lh * s) / 2)}) scale(${r2(s)})">${logo.replace(/^[\s\S]*?>\n?/, '').replace(/<\/svg>\s*$/, '')}</g>`
  const ogSvg = svg(OG_W, OG_H, body)
  writeFileSync(out('public/brand/revs-og-image.svg'), ogSvg)
  await sharp(Buffer.from(ogSvg), { density: 200 })
    .resize(OG_W, OG_H, { fit: 'fill' })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toFile(out('public/brand/revs-og-image.jpg'))
  written.push('public/brand/revs-og-image.svg', 'public/brand/revs-og-image.jpg')
}

// ── Splash 2732×2732 : monogramme centré sur fond noir ──
// Carré : Capacitor l'utilise pour toutes les tailles d'écran en le rognant.
const SPLASH = iconSvg(2732, BLACK, WHITE, RED, 0.42)
write('public/brand/revs-splash.svg', SPLASH)
writeFileSync(out('public/splashscreens/master-splash.svg'), SPLASH)
await png(SPLASH, 2732, 'public/brand/revs-splash.png')
written.push('public/splashscreens/master-splash.svg')

// Splash iOS legacy référencé par index.html (iPhone 14 — 1170×2532)
await sharp(Buffer.from(iconSvg(2532, BLACK, WHITE, RED, 0.5)), { density: 200 })
  .resize(1170, 2532, { fit: 'cover' })
  .png({ compressionLevel: 9 })
  .toFile(out('public/splashscreens/iphone14.png'))
written.push('public/splashscreens/iphone14.png')

console.log('\nAssets générés :')
for (const w of written.sort()) console.log('  ' + w)
console.log(`\nTotal : ${written.length} fichiers`)

// ══════════════════════════════════════════════════════════════════════
//  Assets natifs (Capacitor)
// ══════════════════════════════════════════════════════════════════════
//
// Ces fichiers sont posés par `npx cap add` avec le logo Capacitor par
// défaut. On les écrase ici pour que l'icône native soit la même que celle
// du web. Ils survivent à `cap sync` (qui ne recopie que les assets web),
// mais PAS à une suppression/recréation de la plateforme — dans ce cas,
// relancer `npm run brand`.

const ANDROID = 'android/app/src/main/res'
const IOS = 'ios/App/App/Assets.xcassets'

// ── Fond de l'icône adaptative ──
// Capacitor livre #FFFFFF : sur un lanceur clair l'icône disparaîtrait.
write(
  `${ANDROID}/values/ic_launcher_background.xml`,
  `<?xml version="1.0" encoding="utf-8"?>
<!-- Généré par scripts/build-brand.mjs — fond de l'icône adaptative Android.
     Aligné sur --revs-black de la charte (#0B0B0B). -->
<resources>
    <color name="ic_launcher_background">${BLACK}</color>
</resources>
`,
)

const DPI = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
]

for (const [dpi, legacy, adaptive] of DPI) {
  // Icône héritée (API < 26) : carrée, fond compris.
  await png(iconSvg(1024, BLACK, WHITE, RED, 0.72), legacy, `${ANDROID}/mipmap-${dpi}/ic_launcher.png`)

  // Variante ronde : même dessin, masqué par un cercle.
  const round = await sharp(Buffer.from(iconSvg(1024, BLACK, WHITE, RED, 0.72)), {
    density: 384,
  })
    .resize(legacy, legacy)
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}" fill="#fff"/></svg>`,
        ),
        blend: 'dest-in',
      },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer()
  writeFileSync(out(`${ANDROID}/mipmap-${dpi}/ic_launcher_round.png`), round)
  written.push(`${ANDROID}/mipmap-${dpi}/ic_launcher_round.png`)

  // Avant-plan de l'icône adaptative : FOND TRANSPARENT, et le dessin doit
  // tenir dans la zone sûre centrale (66 % du côté) — le lanceur peut rogner
  // tout le reste selon la forme choisie par l'utilisateur. À 0.52 de large,
  // la diagonale du monogramme vaut 0.59 du côté : il reste dans le cercle.
  await png(iconSvg(1024, null, WHITE, RED, 0.52), adaptive, `${ANDROID}/mipmap-${dpi}/ic_launcher_foreground.png`)
}

// ── Splash Android ──
const SPLASH_SIZES = [
  ['mdpi', 320, 480],
  ['hdpi', 480, 800],
  ['xhdpi', 720, 1280],
  ['xxhdpi', 960, 1600],
  ['xxxhdpi', 1280, 1920],
]
async function splashTo(w, h, dest) {
  // `contain` sur fond noir : le monogramme garde ses proportions quelle que
  // soit la forme de l'écran, et le fond reste #0B0B0B jusqu'aux bords.
  const side = Math.max(w, h)
  const buf = await sharp(Buffer.from(iconSvg(side, BLACK, WHITE, RED, 0.34)), {
    density: 200,
  })
    .resize(w, h, { fit: 'cover' })
    .flatten({ background: BLACK })
    .png({ compressionLevel: 9 })
    .toBuffer()
  writeFileSync(out(dest), buf)
  written.push(dest)
}
for (const [dpi, w, h] of SPLASH_SIZES) {
  await splashTo(w, h, `${ANDROID}/drawable-port-${dpi}/splash.png`)
  await splashTo(h, w, `${ANDROID}/drawable-land-${dpi}/splash.png`)
}
await splashTo(1280, 1920, `${ANDROID}/drawable/splash.png`)

// ── iOS ──
// L'icône App Store doit être OPAQUE : un canal alpha fait rejeter le binaire
// à l'upload. `flatten` le supprime.
{
  const buf = await sharp(Buffer.from(ICON_MASTER), { density: 384 })
    .resize(1024, 1024)
    .flatten({ background: BLACK })
    .png({ compressionLevel: 9 })
    .toBuffer()
  writeFileSync(out(`${IOS}/AppIcon.appiconset/AppIcon-512@2x.png`), buf)
  written.push(`${IOS}/AppIcon.appiconset/AppIcon-512@2x.png`)
}
{
  const buf = await sharp(Buffer.from(iconSvg(2732, BLACK, WHITE, RED, 0.42)), {
    density: 150,
  })
    .resize(2732, 2732)
    .flatten({ background: BLACK })
    .png({ compressionLevel: 9 })
    .toBuffer()
  // Les trois fichiers sont les variantes universelle / sombre / claire
  // déclarées dans Splash.imageset/Contents.json. REVS assume un splash
  // sombre dans les trois cas : l'écran de lancement n'est pas thématisé.
  for (const n of ['', '-1', '-2']) {
    const dest = `${IOS}/Splash.imageset/splash-2732x2732${n}.png`
    writeFileSync(out(dest), buf)
    written.push(dest)
  }
}

console.log(`\nAssets natifs mis à jour (Android + iOS).`)
