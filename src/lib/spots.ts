// exifr is dynamically imported inside readPhotoMeta — that move drops
// ~30 KB gzipped out of the initial paint chunk because lib/spots.ts is
// transitively pulled by every tab (Home, Map, Feed, Profile, …) yet
// EXIF parsing is only ever used by NewSpot. The library is fetched
// the first time NewSpot reads a photo, then cached by the browser.

export type SpotCategory =
  | 'supercar'
  | 'hypercar'
  | 'classic'
  | 'youngtimer'
  | 'JDM'
  | 'other'

export const CATEGORIES: { value: SpotCategory; label: string }[] = [
  { value: 'supercar', label: 'Supercar' },
  { value: 'hypercar', label: 'Hypercar' },
  { value: 'youngtimer', label: 'Youngtimer' },
  { value: 'JDM', label: 'JDM' },
  { value: 'other', label: 'Autre' },
]

export function categoryLabel(c: string): string {
  return CATEGORIES.find((x) => x.value === c)?.label ?? 'Autre'
}

export type CarInfo = {
  name: string
  engine: string
  horsepower: string
  torque: string
  zero_to_100: string
  top_speed: string
  msrp_eur: string
  production: string
  history: string
}

/** 6-tier rarity scale (2026-06-01 upgrade). Migration 0040 mapped
 *  the legacy 4-tier vocabulary as: commun → standard, rare →
 *  premium, ultra_rare → supercar, unique → hypercar. The two new
 *  tiers — `performance` and `exclusif` — start empty and the AI
 *  prompt produces them for new spots. */
export type Rarity =
  | 'standard'
  | 'premium'
  | 'performance'
  | 'exclusif'
  | 'supercar'
  | 'hypercar'

export type Spot = {
  id: string
  user_id: string
  brand: string
  model: string
  year: number | null
  color: string
  category: SpotCategory
  description: string | null
  photo_url: string | null
  confidence: number | null
  estimated_price: number | null
  car_info: CarInfo | null
  lat: number
  lng: number
  expires_at: string
  created_at: string
  event_id?: string | null
  garage_image_url?: string | null
  rarity?: Rarity | null
  production?: number | null
  /** Optional realistic render for the Showroom; falls back to photo_url.
   *  Enriched progressively (per-spot or via the car_renders library). */
  realistic_render_url?: string | null
  /** Photo de l'utilisateur, détourée hors ligne (migration 0087). Fond
   *  transparent → la voiture se pose sur le sol du Showroom. NULL tant que
   *  le détourage n'a pas tourné : on retombe alors sur `photo_url`. */
  garage_render_url?: string | null
}

// Flat per-rarity XP ladder — mirrors the 6-tier table in
// award_xp_spot() (migration 0040). Keep both numbers in sync.
// Bonus de rareté du nouveau barème (migration 0077). Miroir exact du SQL.
// Il n'est versé QUE sur une carte inédite : la rareté récompense la
// découverte, pas la répétition.
const XP_RARITY_BONUS: Record<Rarity, number> = {
  standard: 0,
  premium: 2,
  performance: 5,
  exclusif: 10,
  supercar: 15,
  hypercar: 20,
}
/**
 * Plancher d'XP d'un spot : base + bonus de rareté.
 *
 * ── POURQUOI UN PLANCHER ET PLUS UNE PROMESSE ──
 * L'ancienne version renvoyait le montant plein par rareté et IGNORAIT la
 * décote appliquée par le serveur : au 4ᵉ exemplaire d'une même voiture,
 * l'interface annonçait « +150 XP » pendant que la base en créditait 15.
 *
 * Depuis la refonte du 29/09/2026, le client ne peut PAS connaître le total
 * exact avant publication : les bonus de découverte (marque, modèle,
 * catégorie inédits) dépendent de l'historique du joueur, que seule la base
 * connaît. Cette fonction renvoie donc ce qui est GARANTI — la base et, quand
 * la carte est inédite, le bonus de rareté — et l'interface l'affiche comme un
 * minimum. Le montant réellement crédité est lu après coup dans le grand
 * livre, par `source_id`.
 */
export function xpFloorForSpot(rarity: Rarity | null | undefined): number {
  return 10 + (XP_RARITY_BONUS[(rarity ?? 'standard') as Rarity] ?? 0)
}

/** Ancien nom, conservé pour les appelants existants. */
export function xpForSpot(
  _price: number | null | undefined,
  rarity: Rarity | null | undefined,
): number {
  return xpFloorForSpot(rarity)
}

const RARITY_LABEL: Record<Rarity, string> = {
  standard: 'STANDARD',
  premium: 'PREMIUM',
  performance: 'PERFORMANCE',
  exclusif: 'EXCLUSIF',
  supercar: 'SUPERCAR ✨',
  hypercar: 'HYPERCAR 👑',
}

export function rarityLabel(r: Rarity | null | undefined): string {
  return r && r in RARITY_LABEL ? RARITY_LABEL[r] : RARITY_LABEL.standard
}

export function formatPrice(price: number | null | undefined): string | null {
  if (price == null || price <= 0) return null
  return `~${new Intl.NumberFormat('fr-FR').format(price)} €`
}

export type IdentifyAlternative = {
  brand: string
  model: string
  year: number | null
}

export type IdentifyResult = {
  brand: string
  model: string
  year: number | null
  color: string
  category: SpotCategory
  confidence: number
  alternatives: IdentifyAlternative[]
  valid: boolean
  reason: string
  estimated_price: number | null
  /** Brouillon d'une phrase généré par le prompt vision, pré-rempli dans le
   *  champ Description de l'étape 3 et librement réécrit par l'utilisateur. */
  description?: string
  rarity?: Rarity | null
  production?: number | null
}

export type PhotoMeta = {
  takenAt: Date | null
  lat: number | null
  lng: number | null
}

// Read EXIF from the ORIGINAL file (canvas re-encoding strips it, so this
// must run before resizeImageToJpeg). Missing tags are returned as null —
// browser camera captures often omit GPS and sometimes the timestamp.
// exifr is imported dynamically so the ~30 KB lib stays out of the
// initial paint chunk; it only loads on the first NewSpot photo read.
export async function readPhotoMeta(file: File): Promise<PhotoMeta> {
  try {
    const { default: exifr } = await import('exifr')
    const meta = await exifr.parse(file, { gps: true })
    if (!meta) return { takenAt: null, lat: null, lng: null }
    const raw = meta.DateTimeOriginal ?? meta.CreateDate ?? null
    const takenAt =
      raw instanceof Date ? raw : raw ? new Date(raw) : null
    return {
      takenAt: takenAt && !isNaN(takenAt.getTime()) ? takenAt : null,
      lat: typeof meta.latitude === 'number' ? meta.latitude : null,
      lng: typeof meta.longitude === 'number' ? meta.longitude : null,
    }
  } catch {
    return { takenAt: null, lat: null, lng: null }
  }
}

// Haversine distance in metres.
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `il y a ${hours} h`
  const days = Math.floor(hours / 24)
  return `il y a ${days} j`
}

export function spotterLevel(spotCount: number): string {
  if (spotCount >= 100) return 'Légende'
  if (spotCount >= 50) return 'Élite'
  if (spotCount >= 20) return 'Expert'
  if (spotCount >= 5) return 'Spotter'
  return 'Débutant'
}

export function spotterName(email: string | null | undefined): string {
  if (!email) return 'Anonyme'
  const handle = email.split('@')[0]
  return handle || 'Anonyme'
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// A normalized 0–1 bounding box, as returned by /api/detect-plate.
export type BBox = { x: number; y: number; width: number; height: number }

// Anonymise les régions données d'un JPEG en DÉTRUISANT l'information
// qu'elles contiennent, puis ré-encode à la résolution d'origine.
//
// ── POURQUOI PIXELISER ET NON FLOUTER (01/10/2026) ──
// Cette fonction appliquait un flou gaussien de rayon FIXE (28 px). Deux
// défauts, tous deux mesurés :
//
//  1. Un rayon fixe ne tient pas compte de la taille de la plaque. Sur une
//     plaque lointaine 28 px l'effacent ; sur un gros plan ils l'adoucissent
//     à peine et les caractères restent lisibles.
//  2. Un flou gaussien est une convolution : l'information n'est pas
//     détruite, elle est étalée. Elle se déconvolue partiellement.
//
// On réduit donc la région à ~1/12 de sa taille puis on la ré-agrandit au
// plus proche voisin. Les pixels intermédiaires n'existent plus : il n'y a
// rien à reconstruire. C'est le traitement déjà appliqué par
// `scripts/blur-plates-onnx.mjs`, celui qu'on voit sur la Tesla et que ce
// chemin aurait dû appliquer depuis le début.
//
// Le facteur 1/12 est relatif à la région, donc le résultat est le même sur
// une plaque de 40 px et sur une de 600 px — c'est précisément ce que le
// rayon fixe ne savait pas faire.
//
// Les bords restent adoucis par un masque flouté, pour que le rectangle ne
// saute pas aux yeux ; l'adoucissement ne porte QUE sur la transition, jamais
// sur le contenu, qui est déjà détruit.
// `blurPx` a disparu de la signature : il n'avait plus de sens une fois le
// rayon rendu relatif à la plaque, et le garder n'aurait servi qu'à laisser
// croire qu'on peut régler une force de floutage. Aucun appelant ne le
// passait.
export async function blurRegions(
  blob: Blob,
  regions: BBox[],
  quality = 0.85,
): Promise<{ blob: Blob; base64: string }> {
  if (regions.length === 0) return blobToJpegResult(blob, quality)

  const img = await blobToImage(blob)
  const W = img.naturalWidth || img.width
  const H = img.naturalHeight || img.height

  const main = document.createElement('canvas')
  main.width = W
  main.height = H
  const mctx = main.getContext('2d')
  if (!mctx) throw new Error('Canvas non supporté')
  mctx.drawImage(img, 0, 0)

  // Copie pixelisée : chaque région est réduite puis ré-agrandie au plus
  // proche voisin, INDIVIDUELLEMENT, pour que le pas de pixelisation soit
  // proportionnel à la plaque et non à l'image.
  const blurred = document.createElement('canvas')
  blurred.width = W
  blurred.height = H
  const bctx = blurred.getContext('2d')
  if (!bctx) throw new Error('Canvas non supporté')
  bctx.imageSmoothingEnabled = false
  for (const r of regions) {
    const x = clamp(r.x * W, 0, W)
    const y = clamp(r.y * H, 0, H)
    const w = clamp(r.width * W, 0, W - x)
    const h = clamp(r.height * H, 0, H - y)
    if (w < 1 || h < 1) continue
    // On déborde de 25 % avant de pixeliser : le masque adouci mord sur ses
    // propres bords, et sans cette marge un liseré net de la plaque
    // subsisterait au pourtour de la zone traitée.
    const px = w * 0.25
    const py = h * 0.25
    const sx = Math.max(0, x - px)
    const sy = Math.max(0, y - py)
    const sw = Math.min(W - sx, w + 2 * px)
    const sh = Math.min(H - sy, h + 2 * py)
    // ~12 pixels sur la plus grande dimension : assez pour que la silhouette
    // de la voiture reste cohérente, bien trop peu pour qu'un caractère
    // survive. Plancher à 2 pour les très petites régions.
    const steps = 12
    const tw = Math.max(2, Math.round(sw / Math.max(sw, sh) * steps))
    const th = Math.max(2, Math.round(sh / Math.max(sw, sh) * steps))
    const tiny = document.createElement('canvas')
    tiny.width = tw
    tiny.height = th
    const tctx = tiny.getContext('2d')
    if (!tctx) throw new Error('Canvas non supporté')
    tctx.imageSmoothingEnabled = true // moyenne les pixels sources
    tctx.drawImage(img, sx, sy, sw, sh, 0, 0, tw, th)
    // Ré-agrandissement sans interpolation : l'information est détruite.
    bctx.drawImage(tiny, 0, 0, tw, th, sx, sy, sw, sh)
  }

  // ── MASQUE ADOUCI : RAYON RELATIF À LA PLAQUE, PAS À L'IMAGE ──
  //
  // Le rayon valait `blurPx * 0.6`, soit ~17 px fixes. Sur une plaque haute de
  // 36 px, flouter le masque de 17 px empêche son centre d'atteindre
  // l'opacité : le `destination-in` ne conservait alors la pixelisation qu'en
  // semi-transparence, et l'ORIGINAL NET transparaissait dessous.
  // Vérifié au navigateur : « DM-107-SE » restait lisible en filigrane alors
  // que la pixelisation avait bien été calculée. Le traitement était bon,
  // c'est le masque qui le laissait fuir.
  //
  // Le rayon est donc dérivé de la plus petite dimension de la plus petite
  // région, et plafonné. L'inflation du rectangle vaut exactement ce rayon,
  // ce qui garantit deux choses : le cœur du masque est pleinement opaque
  // (demi-dimension > rayon), et le masque reste à l'intérieur de la zone
  // pixelisée, qui déborde elle de 25 %.
  const minDim = Math.min(
    ...regions.map((r) => Math.min(r.width * W, r.height * H)).filter((v) => v > 0),
  )
  const feather = Math.max(2, Math.min(10, Math.round((minDim || 20) * 0.2)))

  const mask = document.createElement('canvas')
  mask.width = W
  mask.height = H
  const xctx = mask.getContext('2d')
  if (!xctx) throw new Error('Canvas non supporté')
  xctx.fillStyle = 'white'
  for (const r of regions) {
    const x = clamp(r.x * W, 0, W)
    const y = clamp(r.y * H, 0, H)
    const w = clamp(r.width * W, 0, W - x)
    const h = clamp(r.height * H, 0, H - y)
    if (w <= 0 || h <= 0) continue
    xctx.fillRect(
      Math.max(0, x - feather),
      Math.max(0, y - feather),
      Math.min(W, w + 2 * feather),
      Math.min(H, h + 2 * feather),
    )
  }
  // On floute le masque lui-même → dégradé d'alpha sur ses seuls bords.
  const featheredMask = document.createElement('canvas')
  featheredMask.width = W
  featheredMask.height = H
  const fctx = featheredMask.getContext('2d')
  if (!fctx) throw new Error('Canvas non supporté')
  fctx.filter = `blur(${feather}px)`
  fctx.drawImage(mask, 0, 0)
  fctx.filter = 'none'

  // Cut the blurred image to the feathered mask.
  bctx.globalCompositeOperation = 'destination-in'
  bctx.drawImage(featheredMask, 0, 0)
  bctx.globalCompositeOperation = 'source-over'

  // Final compose: masked blur on top of the original sharp image.
  mctx.drawImage(blurred, 0, 0)

  const out = await new Promise<Blob>((resolve, reject) => {
    main.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Encodage JPEG échoué'))),
      'image/jpeg',
      quality,
    )
  })
  return blobToJpegResult(out, quality)
}

async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Image illisible'))
      el.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function blobToJpegResult(
  blob: Blob,
  _quality: number,
): Promise<{ blob: Blob; base64: string }> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = () => reject(new Error('Lecture échouée'))
    reader.readAsDataURL(blob)
  })
  return { blob, base64 }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

// Phone photos are multi-MB; downscale before sending to the AI / storage.
// Returns a JPEG blob (for upload) and its raw base64 (no data: prefix, for the API).
export async function resizeImageToJpeg(
  file: File,
  maxDim = 1280,
  quality = 0.82,
): Promise<{ blob: Blob; base64: string }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Image illisible'))
      el.src = url
    })

    const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
    const w = Math.round(img.width * scale)
    const h = Math.round(img.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas non supporté')
    ctx.drawImage(img, 0, 0, w, h)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Encodage JPEG échoué'))),
        'image/jpeg',
        quality,
      )
    })

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const result = reader.result as string
        resolve(result.split(',')[1] ?? '')
      }
      reader.onerror = () => reject(new Error('Lecture échouée'))
      reader.readAsDataURL(blob)
    })

    return { blob, base64 }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Instant UTC de minuit, heure de Paris, du jour en cours.
 *
 * Sert de borne basse pour compter les spots publiés « aujourd'hui ». Miroir
 * volontaire de `parisDayStart()` dans server/ai-gate.js — le serveur reste
 * l'autorité, cette copie ne sert qu'au contrôle d'agrément côté client avant
 * l'upload. Si l'une change, changer l'autre.
 *
 * Paris est à UTC+1 en hiver et UTC+2 en été : on teste les deux décalages et
 * on retient l'instant qui retombe exactement sur 00:00 le bon jour. Le
 * passage à l'heure d'été saute 02:00, jamais minuit.
 */
export function parisDayStart(now = new Date()): Date {
  const fmtDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const today = fmtDay.format(now)
  const base = Date.parse(`${today}T00:00:00Z`)
  const fmtFull = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  for (const offsetHours of [1, 2]) {
    const candidate = new Date(base - offsetHours * 3600000)
    const p: Record<string, string> = {}
    for (const part of fmtFull.formatToParts(candidate)) {
      if (part.type !== 'literal') p[part.type] = part.value
    }
    if (
      `${p.year}-${p.month}-${p.day}` === today &&
      p.hour === '00' &&
      p.minute === '00'
    ) {
      return candidate
    }
  }
  return new Date(base)
}
