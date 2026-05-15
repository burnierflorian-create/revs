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
  { value: 'classic', label: 'Classic' },
  { value: 'youngtimer', label: 'Youngtimer' },
  { value: 'JDM', label: 'JDM' },
  { value: 'other', label: 'Autre' },
]

export function categoryLabel(c: string): string {
  return CATEGORIES.find((x) => x.value === c)?.label ?? 'Autre'
}

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
  lat: number
  lng: number
  created_at: string
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

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
