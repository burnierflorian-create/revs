// ═══════════════ MARQUAGE MANUEL DES PLAQUES ═══════════════
//
// POURQUOI CET ÉCRAN EXISTE
// Le détecteur automatique s'est révélé inexploitable : vérifié sur photos
// réelles, il encadrait une enseigne à l'arrière-plan sur l'une, trois bouts de
// chaussée sur l'autre, en laissant les vraies plaques parfaitement lisibles.
// Il renvoyait pourtant un JSON valide — donc aucune alarme ne se déclenchait,
// ni côté serveur ni côté client. C'est la pire défaillance possible pour un
// système de confidentialité : celle qui se croit réussie.
//
// Tant qu'un détecteur fiable n'est pas en place, la seule garantie possible
// est celle-ci : l'œil de la personne qui a pris la photo. Elle sait où est la
// plaque. On lui demande de la désigner.
//
// LE GESTE
// Glisser pour tracer un rectangle, ou toucher pour poser une boîte au gabarit
// d'une plaque européenne. Toucher une boîte existante la retire. Plusieurs
// plaques sont attendues — une photo de rue en contient souvent deux ou trois.
//
// CE QUI N'EST PAS PROPOSÉ
// Aucun pré-remplissage par le détecteur actuel. Des boîtes fausses affichées
// comme des propositions seraient pires que rien : elles déplaceraient
// l'attention hors de la vraie plaque. Le jour où le détecteur local (ONNX)
// sera en place, il alimentera cet écran — l'utilisateur confirmera au lieu de
// tout tracer.

import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Trash2 } from 'lucide-react'
import type { BBox } from '../lib/spots'

/** Rapport largeur/hauteur d'une plaque européenne (520 × 110 mm). */
const PLATE_RATIO = 4.7
/** Largeur par défaut d'une boîte posée d'un simple toucher, en fraction. */
const TAP_WIDTH = 0.16
/** En deçà, le geste est un toucher, pas un tracé. */
const DRAG_MIN = 0.02

export default function PlateMarker({
  photoUrl,
  onConfirm,
  onNone,
}: {
  photoUrl: string
  /** Au moins une plaque marquée. Coordonnées normalisées 0..1. */
  onConfirm: (boxes: BBox[]) => void
  /** L'utilisateur déclare qu'aucune plaque n'est lisible. */
  onNone: () => void
}) {
  const { t } = useTranslation()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [boxes, setBoxes] = useState<BBox[]>([])
  const [draft, setDraft] = useState<BBox | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)

  /** Position du pointeur en fraction de l'image, bornée à [0,1]. */
  const norm = (e: React.PointerEvent) => {
    const r = surfaceRef.current?.getBoundingClientRect()
    if (!r) return null
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    }
  }

  function onDown(e: React.PointerEvent) {
    const p = norm(e)
    if (!p) return
    // Toucher une boîte existante la retire — pas de bouton de suppression par
    // boîte, qui serait minuscule et manqué une fois sur deux.
    const hit = boxes.findIndex(
      (b) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height,
    )
    if (hit >= 0) {
      setBoxes((prev) => prev.filter((_, i) => i !== hit))
      return
    }
    startRef.current = p
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onMove(e: React.PointerEvent) {
    const s = startRef.current
    const p = norm(e)
    if (!s || !p) return
    setDraft({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      width: Math.abs(p.x - s.x),
      height: Math.abs(p.y - s.y),
    })
  }

  function onUp(e: React.PointerEvent) {
    const s = startRef.current
    const p = norm(e)
    startRef.current = null
    setDraft(null)
    if (!s || !p) return

    const w = Math.abs(p.x - s.x)
    const h = Math.abs(p.y - s.y)

    // Tracé trop court → l'intention était un toucher. On pose une boîte au
    // gabarit d'une plaque, centrée sur le doigt : plus rapide que de tracer un
    // rectangle de 3 mm sur un écran de téléphone.
    const surface = surfaceRef.current
    const ratio = surface ? surface.clientWidth / Math.max(1, surface.clientHeight) : 1
    const box =
      w < DRAG_MIN || h < DRAG_MIN
        ? {
            x: Math.max(0, Math.min(1 - TAP_WIDTH, p.x - TAP_WIDTH / 2)),
            y: Math.max(
              0,
              Math.min(1, p.y - (TAP_WIDTH / PLATE_RATIO) * ratio * 0.5),
            ),
            width: TAP_WIDTH,
            height: (TAP_WIDTH / PLATE_RATIO) * ratio,
          }
        : { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), width: w, height: h }

    setBoxes((prev) => [...prev, box])
  }

  const shown = draft ? [...boxes, draft] : boxes

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-[19px] font-black leading-tight tracking-tight">
          {t('plate.title')}
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-snug text-fg2">
          {t('plate.help')}
        </p>
      </div>

      <div
        ref={surfaceRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        // `touch-none` : sans lui, le tracé déclenche le défilement de la page
        // et la boîte ne suit pas le doigt.
        className="relative w-full touch-none overflow-hidden rounded-2xl"
        style={{ border: '1px solid var(--color-border)', cursor: 'crosshair' }}
      >
        <img
          src={photoUrl}
          alt=""
          draggable={false}
          className="block w-full select-none"
        />
        {shown.map((b, i) => (
          <div
            key={i}
            aria-hidden
            className="absolute"
            style={{
              left: `${b.x * 100}%`,
              top: `${b.y * 100}%`,
              width: `${b.width * 100}%`,
              height: `${b.height * 100}%`,
              border: '2px solid rgb(var(--color-accent))',
              background: 'rgba(232,32,58,0.28)',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              borderRadius: 3,
            }}
          />
        ))}
      </div>

      {boxes.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] font-semibold text-fg2">
            {t('plate.marked', { count: boxes.length })}
          </span>
          <button
            onClick={() => setBoxes([])}
            className="tappable inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-fg2 underline underline-offset-4"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('plate.clear')}
          </button>
        </div>
      )}

      <div className="space-y-2.5">
        <button
          onClick={() => onConfirm(boxes)}
          disabled={boxes.length === 0}
          className="tappable flex w-full items-center justify-center gap-2 rounded-full bg-accent py-3.5 text-sm font-extrabold tracking-wider text-fg disabled:opacity-40"
          style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
        >
          <Check className="h-4 w-4" />
          {t('plate.confirm')}
        </button>
        {/* Sortie honnête : beaucoup de photos n'ont réellement aucune plaque
            lisible (voiture de profil, de dos, trop loin). La refuser
            pousserait à marquer n'importe quoi pour passer l'étape. */}
        <button
          onClick={onNone}
          className="tappable w-full rounded-full py-3 text-sm font-bold tracking-wide text-fg2"
          style={{ border: '1px solid var(--color-border)' }}
        >
          {t('plate.none')}
        </button>
      </div>
    </div>
  )
}
