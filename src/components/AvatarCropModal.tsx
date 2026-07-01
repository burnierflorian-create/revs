import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

// From-scratch circular avatar cropper — NO external library (react-easy-crop
// rendered a black screen under React 19). Pure canvas + pointer/touch math.
//
// Geometry: the crop circle (diameter D) is centered in the crop area. The
// image is drawn "cover" so it always fills the circle, then the user pans
// (drag / 1 finger) and zooms (pinch / slider / wheel). On confirm we map the
// circle back to source-image pixels and drawImage into a 512×512 canvas.

const OUT = 512

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
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
  const areaRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  const [box, setBox] = useState({ w: 0, h: 0 }) // crop-area size (px)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null) // natural
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 }) // image-center vs area-center
  const [busy, setBusy] = useState(false)

  // Gesture bookkeeping.
  const pan = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const pinch = useRef<{ dist: number; zoom: number } | null>(null)

  // Measure the crop area (and keep it in sync on resize / orientation).
  useLayoutEffect(() => {
    const measure = () => {
      const el = areaRef.current
      if (el) setBox({ w: el.clientWidth, h: el.clientHeight })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [])

  // Load the picked image to get its natural size.
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      setNat({ w: img.naturalWidth, h: img.naturalHeight })
      setZoom(1)
      setOffset({ x: 0, y: 0 })
    }
    img.src = imageSrc
  }, [imageSrc])

  // Derived geometry.
  const D = box.w && box.h ? Math.min(box.w, box.h) * 0.82 : 0
  const baseScale = nat && D ? D / Math.min(nat.w, nat.h) : 1
  const scale = baseScale * zoom
  const dispW = nat ? nat.w * scale : 0
  const dispH = nat ? nat.h * scale : 0
  const ready = !!nat && D > 0

  // Keep the circle fully covered: clamp the pan so no gap shows.
  function clampOffset(o: { x: number; y: number }, z = zoom) {
    if (!nat) return o
    const dw = nat.w * baseScale * z
    const dh = nat.h * baseScale * z
    const maxX = Math.max(0, (dw - D) / 2)
    const maxY = Math.max(0, (dh - D) / 2)
    return { x: clamp(o.x, -maxX, maxX), y: clamp(o.y, -maxY, maxY) }
  }

  function setZoomClamped(z: number) {
    const nz = clamp(z, 1, 4)
    setZoom(nz)
    setOffset((o) => clampOffset(o, nz))
  }

  // ── Touch (mobile Safari) ──
  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 1) {
      pan.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        ox: offset.x,
        oy: offset.y,
      }
      pinch.current = null
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      pinch.current = { dist: Math.hypot(dx, dy), zoom }
      pan.current = null
    }
  }
  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinch.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.hypot(dx, dy)
      setZoomClamped(pinch.current.zoom * (dist / pinch.current.dist))
    } else if (e.touches.length === 1 && pan.current) {
      const nx = pan.current.ox + (e.touches[0].clientX - pan.current.x)
      const ny = pan.current.oy + (e.touches[0].clientY - pan.current.y)
      setOffset(clampOffset({ x: nx, y: ny }))
    }
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (e.touches.length === 0) {
      pan.current = null
      pinch.current = null
    } else if (e.touches.length === 1) {
      // Went from pinch → single finger: restart panning from here.
      pinch.current = null
      pan.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        ox: offset.x,
        oy: offset.y,
      }
    }
  }

  // ── Mouse (desktop) ──
  function onMouseDown(e: React.MouseEvent) {
    pan.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!pan.current) return
    const nx = pan.current.ox + (e.clientX - pan.current.x)
    const ny = pan.current.oy + (e.clientY - pan.current.y)
    setOffset(clampOffset({ x: nx, y: ny }))
  }
  function endMouse() {
    pan.current = null
  }
  function onWheel(e: React.WheelEvent) {
    setZoomClamped(zoom - e.deltaY * 0.0015)
  }

  // ── Confirm → crop to a 512² canvas ──
  function confirm() {
    const img = imgRef.current
    if (!img || !nat || busy) return
    setBusy(true)
    try {
      const ratio = 1 / scale // displayed px → source px
      const sx = (dispW / 2 - D / 2 - offset.x) * ratio
      const sy = (dispH / 2 - D / 2 - offset.y) * ratio
      const sSize = D * ratio
      const canvas = document.createElement('canvas')
      canvas.width = OUT
      canvas.height = OUT
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        setBusy(false)
        return
      }
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUT, OUT)
      canvas.toBlob(
        (b) => {
          if (b) onConfirm(b)
          else setBusy(false)
        },
        'image/jpeg',
        0.85,
      )
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

      {/* Crop surface — touch-action:none lets our JS own the gestures. */}
      <div
        ref={areaRef}
        className="relative flex-1 cursor-grab select-none overflow-hidden active:cursor-grabbing"
        style={{ touchAction: 'none' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endMouse}
        onMouseLeave={endMouse}
        onWheel={onWheel}
      >
        {ready && (
          <img
            src={imageSrc}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none"
            style={{
              left: box.w / 2 + offset.x - dispW / 2,
              top: box.h / 2 + offset.y - dispH / 2,
              width: dispW,
              height: dispH,
            }}
          />
        )}
        {/* Circular cut-out: white ring + darkened outside via huge shadow. */}
        {ready && (
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-full"
            style={{
              width: D,
              height: D,
              left: (box.w - D) / 2,
              top: (box.h - D) / 2,
              border: '2px solid rgba(255,255,255,0.9)',
              boxShadow: '0 0 0 9999px rgba(10,10,10,0.62)',
            }}
          />
        )}
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
          onChange={(e) => setZoomClamped(Number(e.target.value))}
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
            disabled={busy || !ready}
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
