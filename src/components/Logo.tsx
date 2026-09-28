// Identité visuelle REVS — surface React.
//
// Le dessin n'est PAS défini ici : il vient de src/lib/brand-paths.ts, généré
// par scripts/build-brand.mjs à partir de la même géométrie que les SVG de
// public/brand/, les icônes d'application, le favicon et le splash. Modifier
// le logo se fait donc dans le générateur puis `npm run brand` — jamais dans
// ce fichier.
//
// Remplace l'ancienne identité (un « R » italique barré de lignes de vitesse,
// et un mot REVS composé en Arial via un <span>). Deux raisons de l'avoir
// abandonnée : le mot dépendait d'une police système, donc il changeait de
// forme d'un appareil à l'autre ; et le symbole n'avait aucun rapport avec le
// monogramme R+V validé.
import {
  LOCKUP,
  MONOGRAM,
  TAGLINE,
  WORDMARK,
  type BrandPart,
} from '../lib/brand-paths'

// Les deux couleurs par défaut passent par le design system plutôt que par
// des hexadécimaux figés, pour deux raisons distinctes :
//
//  · `currentColor` rend le logo THÉMATIQUE. REVS a un thème clair : un logo
//    codé en blanc dur y serait invisible. Le parent impose la couleur avec
//    text-fg (ou text-white pour les surfaces toujours sombres comme le
//    splash), et le monogramme suit.
//  · `var(--revs-red)` est dérivé de --color-accent : il ne peut donc pas
//    exister deux rouges REVS qui divergent.
const RED = 'var(--revs-red)'
const SILVER = 'currentColor'

function Paths({
  parts,
  light,
  accent,
}: {
  parts: BrandPart[]
  light: string
  accent: string
}) {
  return (
    <>
      {parts.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={p.role === 'accent' ? accent : light}
          fillRule={p.rule}
        />
      ))}
    </>
  )
}

/**
 * Monogramme R+V seul — le symbole officiel de l'application.
 *
 * `height` pilote la taille : le monogramme est nettement plus large que haut
 * (ratio ~1.9), donc caler sur la hauteur évite les surprises de mise en page.
 * `mono` force une seule couleur, pour les fonds complexes et l'impression.
 */
export function RevsMark({
  height = 32,
  color = SILVER,
  accent = RED,
  mono = false,
  title = 'REVS',
}: {
  height?: number
  color?: string
  accent?: string
  mono?: boolean
  title?: string
}) {
  const w = (MONOGRAM.w / MONOGRAM.h) * height
  return (
    <svg
      width={w}
      height={height}
      viewBox={`0 0 ${MONOGRAM.w} ${MONOGRAM.h}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <Paths parts={MONOGRAM.parts} light={color} accent={mono ? color : accent} />
    </svg>
  )
}

/**
 * Le mot REVS seul, en tracés.
 *
 * Existe pour les compositions où le monogramme est déjà présent par ailleurs
 * — le splash, typiquement. Auparavant ce mot était du texte HTML en
 * « Arial Black » : sa forme dépendait des polices installées sur l'appareil,
 * et le S rouge ne correspondait à aucune règle du système. Ici c'est le même
 * dessin que partout ailleurs, et le rouge est sur le V.
 */
export function RevsWordmark({
  height = 32,
  color = SILVER,
  accent = RED,
  mono = false,
  title = 'REVS',
}: {
  height?: number
  color?: string
  accent?: string
  mono?: boolean
  title?: string
}) {
  const w = (WORDMARK.w / WORDMARK.h) * height
  return (
    <svg
      width={w}
      height={height}
      viewBox={`0 0 ${WORDMARK.w} ${WORDMARK.h}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <Paths parts={WORDMARK.parts} light={color} accent={mono ? color : accent} />
    </svg>
  )
}

/**
 * La tagline CARS. SPOTS. PASSION., en tracés.
 *
 * Dessinée au trait (et non en masse) : à cette taille un contour plein
 * pèserait plus lourd que le logo lui-même. Comme le reste de la charte, elle
 * ne dépend d'aucune police — la composer en HTML avec du letter-spacing
 * donnerait une forme différente selon l'appareil.
 */
export function RevsTagline({
  height = 12,
  color = 'currentColor',
}: {
  height?: number
  color?: string
}) {
  const w = (TAGLINE.w / TAGLINE.h) * height
  return (
    <svg
      width={w}
      height={height}
      viewBox={`0 0 ${TAGLINE.w} ${TAGLINE.h}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Cars. Spots. Passion."
    >
      <g
        fill="none"
        stroke={color}
        strokeWidth={TAGLINE.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {TAGLINE.glyphs.map((g, i) => (
          <path key={i} transform={g.t} d={g.d} />
        ))}
      </g>
    </svg>
  )
}

/**
 * Verrou horizontal officiel : monogramme + REVS.
 *
 * C'est la version destinée aux en-têtes. Pas de tagline ici — elle existe
 * uniquement dans public/brand/revs-logo-tagline.svg, pour les usages où le
 * logo dispose de place (réseaux sociaux, présentations, Open Graph).
 */
export function RevsLogo({
  height = 28,
  color = SILVER,
  accent = RED,
  mono = false,
  title = 'REVS',
}: {
  height?: number
  color?: string
  accent?: string
  mono?: boolean
  title?: string
}) {
  const w = (LOCKUP.w / LOCKUP.h) * height
  return (
    <svg
      width={w}
      height={height}
      viewBox={`0 0 ${LOCKUP.w} ${LOCKUP.h}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <Paths parts={LOCKUP.parts} light={color} accent={mono ? color : accent} />
    </svg>
  )
}
