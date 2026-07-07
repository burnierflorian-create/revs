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
}

// Flat per-rarity XP ladder — mirrors the 6-tier table in
// award_xp_spot() (migration 0040). Keep both numbers in sync.
const XP_BY_RARITY: Record<Rarity, number> = {
  standard: 10,
  premium: 25,
  performance: 50,
  exclusif: 90,
  supercar: 150,
  hypercar: 250,
}

/** UI helper for the "+X XP" badges. Returns the flat per-rarity
 *  amount that the SQL trigger writes to xp_transactions. The legacy
 *  `price` argument is ignored — kept so callers don't break.  */
export function xpForSpot(
  _price: number | null | undefined,
  rarity: Rarity | null | undefined,
): number {
  return XP_BY_RARITY[(rarity ?? 'standard') as Rarity] ?? XP_BY_RARITY.standard
}

// Backwards-compat alias — some callers still pass price only. Treated
// as `standard` rarity, which matches the SQL trigger's default.
export function xpForPrice(price: number | null | undefined): number {
  return xpForSpot(price, 'standard')
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

// Apply a heavy gaussian blur on the given normalized regions of a JPEG
// blob, with naturally feathered edges (no harsh rectangle), then
// re-encode at the original resolution. Used to anonymise license
// plates at upload time.
//
// Strategy:
//  1. Draw the source image on a base canvas (sharp everywhere).
//  2. Build a full-image blurred copy.
//  3. Build a white-on-black "mask" canvas with one rectangle per
//     plate region, then blur the MASK itself so its edges feather.
//  4. `destination-in` composite the blurred image with the feathered
//     mask → blur only survives where the mask is opaque, fading out
//     softly at the edges.
//  5. Paint the masked blur on top of the base canvas.
//
// `quality` is the JPEG re-encode quality; `blurPx` is the gaussian
// radius in image pixels (24 ≈ pixel-perfect plate scrub at 1280 px).
export async function blurRegions(
  blob: Blob,
  regions: BBox[],
  blurPx = 28,
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

  // Pre-blurred full image.
  const blurred = document.createElement('canvas')
  blurred.width = W
  blurred.height = H
  const bctx = blurred.getContext('2d')
  if (!bctx) throw new Error('Canvas non supporté')
  bctx.filter = `blur(${blurPx}px)`
  bctx.drawImage(img, 0, 0)
  bctx.filter = 'none'

  // Feathered mask: white rectangles slightly inflated, then blurred.
  // The 0.5× factor on the mask blur keeps the soft edge tight enough
  // that the plate stays fully covered while the transition feels
  // natural rather than mechanical.
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
    // Inflate by ~20% so the feathered edge still fully covers the
    // sharp plate inside (the blur on the mask eats into its bounds).
    const padX = w * 0.2
    const padY = h * 0.2
    xctx.fillRect(
      Math.max(0, x - padX),
      Math.max(0, y - padY),
      Math.min(W, w + 2 * padX),
      Math.min(H, h + 2 * padY),
    )
  }
  // Blur the mask itself → soft alpha gradient at the edges.
  const featheredMask = document.createElement('canvas')
  featheredMask.width = W
  featheredMask.height = H
  const fctx = featheredMask.getContext('2d')
  if (!fctx) throw new Error('Canvas non supporté')
  fctx.filter = `blur(${Math.round(blurPx * 0.6)}px)`
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
