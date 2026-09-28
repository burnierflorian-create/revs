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
// MONOGRAM et LOCKUP ne sont plus consommés ici : le monogramme vient
// désormais du PNG de référence. Seuls le mot et la tagline restent en
// tracés — voir RevsMark plus bas.
import { TAGLINE, WORDMARK, type BrandPart } from '../lib/brand-paths'

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
 * Monogramme R+V — l'image de référence, pas un tracé.
 *
 * Sur demande explicite du 28/09/2026, le monogramme n'est plus redessiné en
 * SVG : c'est le PNG découpé dans la planche de référence (voir
 * scripts/extract-brand-png.mjs).
 *
 * CE QUE CE CHOIX IMPLIQUE, et qui n'existait pas avec le tracé :
 *  · le dessin ne suit plus `currentColor`. Le monogramme de référence est
 *    blanc et rouge, donc invisible sur fond clair — d'où les DEUX fichiers
 *    et la bascule ci-dessous sur le thème ;
 *  · il ne monte plus indéfiniment en taille : la source utile mesure
 *    428 × 175 px. Au-delà d'environ 400 px de large, l'agrandissement se
 *    voit.
 *
 * Le ratio est figé ici pour réserver la place avant le chargement de
 * l'image : sans width/height, la mise en page saute au premier affichage.
 */
const MARK_RATIO = 428 / 175

export function RevsMark({
  height = 32,
  title = 'REVS',
  onLight,
}: {
  height?: number
  /** Force la variante sombre (monogramme noir + rouge), pour fond clair. */
  onLight?: boolean
  title?: string
}) {
  const dark = onLight ?? false
  return (
    <img
      src={dark ? '/brand/revs-monogram-dark.png' : '/brand/revs-monogram.png'}
      width={Math.round(height * MARK_RATIO)}
      height={height}
      alt={title}
      decoding="async"
      style={{ height, width: 'auto', display: 'block' }}
    />
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
 * Verrou horizontal : monogramme (PNG de référence) + REVS.
 *
 * Le MOT reste en tracés. Ce n'est pas une entorse à « plus de SVG » : la
 * demande visait le monogramme, qui ne ressemblait pas à la référence. Le mot,
 * lui, correspond — et le recomposer avec une police système redonnerait une
 * forme différente d'un appareil à l'autre, ce que la charte a corrigé.
 */
export function RevsLogo({
  height = 28,
  color = SILVER,
  accent = RED,
  onLight,
  title = 'REVS',
}: {
  height?: number
  color?: string
  accent?: string
  onLight?: boolean
  title?: string
}) {
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: height * 0.42 }}
      role="img"
      aria-label={title}
    >
      <RevsMark height={height * 1.2} onLight={onLight} title="" />
      <RevsWordmark height={height} color={color} accent={accent} title="" />
    </span>
  )
}
