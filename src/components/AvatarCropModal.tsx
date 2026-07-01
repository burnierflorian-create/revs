import { useCallback, useState } from 'react'
import Cropper from 'react-easy-crop'
import type { Area } from 'react-easy-crop'
import { useTranslation } from 'react-i18next'

// Full-screen avatar cropper — circular crop matching the round avatar,
// pinch-to-zoom + drag (native to react-easy-crop) plus a zoom slider.
// On confirm it renders the selected region to a 512×512 canvas and hands
// back a JPEG Blob ready for Supabase Storage. Dark #0a0a0a, glassmorphism.

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.addEventListener('load', () => resolve(img))
    img.addEventListener('error', reject)
    img.src = url
  })
}

// Draw the cropped area (in source-pixel coords) onto a square 512 canvas.
async function getCroppedBlob(src: string, area: Area): Promise<Blob> {
  const image = await createImage(src)
  const SIZE = 512
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    SIZE,
    SIZE,
  )
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      0.85,
    )
  })
}

export default function AvatarCropModal({
  imageSrc,
  onCancel,
  onConfirm,
}: {
  imageSrc: string
  onCancel: () => void
  onConfirm: (blob: Blob) => void
}) {
  const { t } = useTranslation()
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [areaPixels, setAreaPixels] = useState<Area | null>(null)
  const [busy, setBusy] = useState(false)

  const onCropComplete = useCallback(
    (_: Area, px: Area) => setAreaPixels(px),
    [],
  )

  async function confirm() {
    if (!areaPixels || busy) return
    setBusy(true)
    try {
      const blob = await getCroppedBlob(imageSrc, areaPixels)
      onConfirm(blob)
    } catch {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[140] flex flex-col"
      style={{ background: '#0a0a0a', color: '#fff' }}
    >
      <div
        className="flex items-center justify-center px-5 pb-3"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <span className="font-display text-[17px] font-bold">
          {t('settingspage.crop.title')}
        </span>
      </div>

      {/* Crop surface — react-easy-crop fills its relative parent. */}
      <div className="relative flex-1">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={1}
          cropShape="round"
          showGrid={false}
          minZoom={1}
          maxZoom={4}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
        />
      </div>

      {/* Controls */}
      <div
        className="px-6 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        style={{ background: '#0a0a0a' }}
      >
        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label={t('settingspage.crop.zoom')}
          className="mb-5 w-full accent-[#E8203A]"
        />
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="tappable flex-1 rounded-full py-3.5 text-sm font-bold text-white/85 transition-opacity disabled:opacity-50"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.14)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
          >
            {t('settingspage.crop.cancel')}
          </button>
          <button
            onClick={confirm}
            disabled={busy || !areaPixels}
            className="tappable flex-1 rounded-full py-3.5 text-sm font-extrabold text-white transition-opacity disabled:opacity-50"
            style={{
              background: '#E8203A',
              boxShadow: '0 8px 22px rgba(232,32,58,0.45)',
            }}
          >
            {busy ? '…' : t('settingspage.crop.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
