import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ImageOff } from 'lucide-react'

// From-scratch circular avatar cropper — NO external library (react-easy-crop
// rendered a black screen under React 19). Pure canvas + pointer/touch math.
//
// Geometry: the crop circle (diameter D) is centered in the crop area. The
// image is drawn "cover" so it always fills the circle, then the user pans
// (drag / 1 finger) and zooms (pinch / slider / wheel). On confirm we map the
// circle back to source-image pixels and drawImage into a 512×512 canvas.

const OUT = 512

/** Plafond de pixels de la source avant recadrage.
 *
 *  Un iPhone récent produit du 48 Mpx (8064 × 6048). Au-delà d'environ
 *  16,7 Mpx, Safari iOS décode l'image mais `drawImage` la rend TRANSPARENTE
 *  sans lever d'erreur — et un canvas transparent exporté en JPEG donne un
 *  carré NOIR. C'est l'une des deux façons dont cet écran devenait noir.
 *
 *  On redescend donc la source sous ce plafond AVANT de recadrer. 12 Mpx
 *  laisse une marge confortable et reste très au-dessus des 512² de sortie :
 *  la réduction est invisible sur l'avatar final. */
const MAX_SOURCE_PX = 12_000_000

/** Ramène une image sous le plafond de pixels, en conservant ses
 *  proportions. Renvoie la source telle quelle si elle est déjà assez
 *  petite — on ne réencode pas pour rien. */
function downscaleIfHuge(img: HTMLImageElement): CanvasImageSource {
  const px = img.naturalWidth * img.naturalHeight
  if (px <= MAX_SOURCE_PX) return img
  const k = Math.sqrt(MAX_SOURCE_PX / px)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(img.naturalWidth * k))
  c.height = Math.max(1, Math.round(img.naturalHeight * k))
  const cx = c.getContext('2d')
  if (!cx) return img
  cx.imageSmoothingQuality = 'high'
  cx.drawImage(img, 0, 0, c.width, c.height)
  return c
}

/** Un canvas entièrement transparent ou noir signale un décodage raté — le
 *  mode d'échec silencieux décrit ci-dessus. On préfère le dire que
 *  d'enregistrer un avatar noir. */
function looksBlank(ctx: CanvasRenderingContext2D, size: number): boolean {
  // 64 points suffisent : une photo réelle ne peut pas être uniformément
  // transparente ni d'un noir parfait sur une grille régulière.
  const step = Math.max(1, Math.floor(size / 8))
  for (let y = step >> 1; y < size; y += step) {
    for (let x = step >> 1; x < size; x += step) {
      const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data
      if (a > 8 && (r > 10 || g > 10 || b > 10)) return false
    }
  }
  return true
}

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
  /** La source qui a échoué au décodage — et non un simple booléen : on
   *  dérive l'état d'échec en comparant à la source courante, ce qui évite de
   *  remettre un drapeau à zéro en plein effet à chaque changement d'image. */
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = failedSrc === imageSrc

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

  // Chargement de l'image choisie.
  //
  // `onerror` n'était pas traité. Un fichier que le navigateur ne sait pas
  // décoder — HEIC sur un navigateur sans support, fichier abîmé, extension
  // mensongère — laissait `nat` à null : la surface de recadrage ne rendait
  // RIEN sur un fond #0a0a0a, et « Valider » restait désactivé. Un écran
  // noir, sans explication, sans action possible autre que deviner qu'il
  // faut annuler. C'était le bug.
  useEffect(() => {
    let active = true
    const img = new Image()
    img.onload = () => {
      if (!active) return
      // Une image de 0 × 0 se charge « avec succès » dans certains
      // navigateurs quand le décodage échoue à moitié.
      if (!img.naturalWidth || !img.naturalHeight) {
        setFailedSrc(imageSrc)
        return
      }
      imgRef.current = img
      setNat({ w: img.naturalWidth, h: img.naturalHeight })
      setZoom(1)
      setOffset({ x: 0, y: 0 })
    }
    img.onerror = () => {
      if (active) setFailedSrc(imageSrc)
    }
    img.src = imageSrc
    return () => {
      active = false
    }
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
      // La source est ramenée sous le plafond de pixels si besoin, et les
      // coordonnées de découpe suivent le même facteur d'échelle.
      const src = downscaleIfHuge(img)
      const k =
        src === img
          ? 1
          : (src as HTMLCanvasElement).width / img.naturalWidth
      ctx.drawImage(src, sx * k, sy * k, sSize * k, sSize * k, 0, 0, OUT, OUT)
      if (looksBlank(ctx, OUT)) {
        setBusy(false)
        setFailedSrc(imageSrc)
        return
      }
      canvas.toBlob(
        (b) => {
          if (b) onConfirm(b)
          else {
            setBusy(false)
            setFailedSrc(imageSrc)
          }
        },
        'image/jpeg',
        0.85,
      )
    } catch {
      setBusy(false)
      setFailedSrc(imageSrc)
    }
  }

  // ── RENDU EN PORTAIL — C'EST ICI QUE NAISSAIT L'ÉCRAN NOIR ──
  //
  // Les Réglages vivent dans un `.tab-pane`, qui porte une transformation
  // pour l'animation d'onglet. Or un élément `position: fixed` placé sous un
  // ancêtre transformé ne se positionne PAS sur la fenêtre : il se
  // positionne sur cet ancêtre. `inset-0` donnait donc au recadrage la
  // hauteur de la page des Réglages — mesuré : 2785 px pour un écran de
  // 844 px.
  //
  // Conséquence exacte de ce que décrivait le signalement : la zone de
  // recadrage occupait les 2785 px, l'image était dessinée très au-dessous du
  // bord visible, et les boutons « Retour » et « Valider » se retrouvaient
  // hors de l'écran. Il ne restait à l'utilisateur qu'un rectangle noir
  // surmonté de « Recadre ta photo », sans aucun moyen d'en sortir.
  //
  // Monté sur document.body, le recadrage n'a plus d'ancêtre transformé :
  // `fixed inset-0` redevient la fenêtre.
  return createPortal(
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
        {/* Échec de décodage — on le DIT, au lieu de laisser un rectangle
            noir. Le bouton de gauche devient le seul chemin, et son libellé
            change pour le dire. */}
        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <span
              className="flex h-14 w-14 items-center justify-center rounded-full"
              style={{ background: 'rgba(232,32,58,0.15)', border: '1px solid rgba(232,32,58,0.4)' }}
            >
              <ImageOff className="h-7 w-7" style={{ color: '#E8203A' }} />
            </span>
            <p className="text-[15px] font-bold">{t('settingspage.crop.failedTitle')}</p>
            <p className="max-w-[18rem] text-[13px] leading-relaxed text-white/60">
              {t('settingspage.crop.failedBody')}
            </p>
          </div>
        )}
        {ready && !failed && (
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
        {ready && !failed && (
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
          disabled={!ready || failed}
          className="mb-5 w-full accent-[#E8203A] disabled:opacity-30"
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
            {failed ? t('settingspage.crop.back') : t('settingspage.crop.cancel')}
          </button>
          <button
            onClick={confirm}
            disabled={busy || !ready || failed}
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
    </div>,
    document.body,
  )
}
