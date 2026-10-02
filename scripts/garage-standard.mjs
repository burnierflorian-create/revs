// ═══════ LE STANDARD GARAGE VISUAL ═══════
//
// Une seule spécification, pour tous les véhicules, présents et futurs.
//
// ── POURQUOI UN STANDARD, ET PAS UN RÉGLAGE PAR VOITURE ──
// Mesuré le 02/10 sur les 21 rendus de production : le prompt obtient bien un
// 3/4 avant à chaque fois, mais il ne contrôle NI le format de sortie NI
// l'échelle. Gemini rendait tantôt du portrait 3:4, tantôt du paysage 4:3, et
// la part de largeur occupée par la voiture allait de 71 % à 91 %.
//
// À l'écran, le cadre du Garage est portrait. Un rendu paysage y est donc
// réduit pour tenir dans la largeur, et la voiture paraît minuscule entre deux
// bandes vides : c'est exactement ce que montre la Rolls-Royce Ghost à côté
// d'une Model Y. Le problème n'est pas la voiture, c'est le FORMAT.
//
// ── CE QUE LE STANDARD FIXE ──
// Un format unique, et une bande d'échelle. Pas une valeur unique : exiger
// 86,0 % obligerait à recadrer des rendus déjà bons, pour un gain invisible.
export const STANDARD = {
  /** Portrait 3:4 — le format que Gemini produit spontanément 16 fois sur 18.
   *  On s'aligne sur la majorité plutôt que de recadrer tout le monde. */
  width: 896,
  height: 1195,
  ratio: 896 / 1195,
  ratioLabel: '3:4 portrait',
  /** Tolérance sur le ratio du fichier source avant de le juger hors format. */
  ratioTolerance: 0.04,
  /** Part de la LARGEUR du cadre occupée par la carrosserie.
   *  Bande volontairement large : au-delà de 92 % le véhicule frôle les bords
   *  et paraît à l'étroit ; en dessous de 78 % il flotte. */
  minWidthPct: 78,
  maxWidthPct: 92,
  /** Cible visée par le recadrage automatique, au centre de la bande. */
  targetWidthPct: 86,
}

/**
 * Le verdict d'un rendu, sur des mesures.
 *
 * Trois états seulement, et une liste de raisons : « non conforme » sans
 * raison n'apprend rien et ne se corrige pas.
 */
export function verdictFor({ width, height, vision, expectedColour, conformity, colourMismatch }) {
  const raisons = []
  const ratio = width / height
  if (Math.abs(ratio - STANDARD.ratio) > STANDARD.ratioTolerance) {
    raisons.push(`format ${ratio > STANDARD.ratio ? 'paysage' : 'hors norme'} (${ratio.toFixed(2)})`)
  }
  const w = vision?.width_pct
  if (typeof w === 'number') {
    if (w < STANDARD.minWidthPct) raisons.push(`véhicule trop petit (${w} %)`)
    else if (w > STANDARD.maxWidthPct) raisons.push(`véhicule trop grand (${w} %)`)
  }
  const c = conformity(vision)
  for (const p of c.problems) if (!/cadrage large/.test(p)) raisons.push(p)
  const cm = colourMismatch(vision, expectedColour)
  if (cm) raisons.push(cm)
  return { statut: raisons.length ? 'NEEDS_REGENERATION' : 'VALID', raisons }
}

/**
 * La fenêtre de recadrage qui amène un rendu au standard.
 *
 * ── POURQUOI RECADRER PLUTÔT QUE REGÉNÉRER ──
 * Une régénération coûte 0,067 $ et redonne une image différente — donc une
 * voiture potentiellement différente, un angle différent, une loterie. Un
 * recadrage ne coûte rien, ne change pas le véhicule, et agit sur la SEULE
 * chose qui n'allait pas : la place qu'il occupe.
 *
 * On ne fabrique jamais de pixels : la fenêtre est toujours prise DANS l'image.
 * Si l'image est trop étroite pour atteindre la cible, on prend le maximum
 * disponible et l'appelant le saura.
 *
 * @param box  boîte du véhicule en fractions de l'image (vision)
 * @returns {{left,top,width,height,reachedPct}|null}
 */
export function cropToStandard({ width, height, box }) {
  if (!box || ![box.x0, box.y0, box.x1, box.y1].every((v) => typeof v === 'number')) return null
  const cx0 = Math.max(0, Math.min(1, box.x0)) * width
  const cx1 = Math.max(0, Math.min(1, box.x1)) * width
  const cy0 = Math.max(0, Math.min(1, box.y0)) * height
  const cy1 = Math.max(0, Math.min(1, box.y1)) * height
  const carW = cx1 - cx0
  const carH = cy1 - cy0
  if (carW <= 4 || carH <= 4) return null

  // Largeur de fenêtre pour que la voiture occupe la cible.
  let winW = carW / (STANDARD.targetWidthPct / 100)
  let winH = winW / STANDARD.ratio
  // Jamais plus grand que l'image : on ne complète pas avec du vide.
  const scale = Math.min(1, width / winW, height / winH)
  winW *= scale
  winH *= scale

  // Centrée sur la voiture, puis ramenée dans l'image.
  const carCx = (cx0 + cx1) / 2
  const carCy = (cy0 + cy1) / 2
  let left = Math.round(carCx - winW / 2)
  let top = Math.round(carCy - winH / 2)
  left = Math.max(0, Math.min(Math.round(width - winW), left))
  top = Math.max(0, Math.min(Math.round(height - winH), top))

  const w = Math.round(winW)
  const h = Math.round(winH)
  // Si la voiture dépasse la fenêtre, le recadrage la couperait : on renonce.
  if (cx0 < left - 1 || cx1 > left + w + 1 || cy0 < top - 1 || cy1 > top + h + 1) return null
  return { left, top, width: w, height: h, reachedPct: Math.round((carW / w) * 100) }
}
