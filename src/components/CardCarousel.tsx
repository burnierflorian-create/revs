// ═══════ CARROUSEL DE CARTES — UNE CARTE À LA FOIS ═══════
//
// La collection s'affiche en grille de deux colonnes : bon pour embrasser ce
// que l'on possède, mauvais pour REGARDER une carte — à cette taille, le
// numéro d'édition et les caractéristiques ne se lisent plus, et le retourner
// montre un verso de la taille d'un timbre.
//
// Ce carrousel est la vue « une carte », telle que la référence du 02/10 la
// montre : la carte en grand au centre, la bande de miniatures en bas, et le
// défilement horizontal pour passer de l'une à l'autre.
//
// ── CE QU'IL NE FAIT PAS ──
// Il ne redessine AUCUNE carte. Le recto, le verso, la rareté, le numéro, les
// caractéristiques et l'animation de retournement viennent tous de
// `CollectorCard`, inchangé. Une seconde implémentation de la carte aurait
// divergé de la première au premier correctif.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import CollectorCard from './CollectorCard'
import type { CardEvolution } from './CollectorCardV2'
import type { Spot } from '../lib/spots'
import { hapticSelection } from '../lib/haptic'

export type CarouselCard = {
  key: string
  spot: Spot
  cardNumber: number
  spotsCount: number
  isFirstOnRevs: boolean
  evolution: CardEvolution
  onViewSpots?: () => void
}

export default function CardCarousel({
  cards,
  startIndex = 0,
  onClose,
}: {
  cards: CarouselCard[]
  startIndex?: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(() =>
    Math.max(0, Math.min(startIndex, cards.length - 1)),
  )
  const stripRef = useRef<HTMLDivElement>(null)
  const startX = useRef<number | null>(null)

  // La touche Échap ferme — l'overlay couvre tout l'écran, et sur un
  // navigateur de bureau il n'y a pas de geste de retour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, cards.length - 1))
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cards.length, onClose])

  // La miniature active reste visible dans la bande, même quand on change de
  // carte au doigt plutôt qu'en tapant la miniature.
  useEffect(() => {
    const strip = stripRef.current
    const el = strip?.children[index] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [index])

  const card = cards[index]
  if (!card) return null

  /** Glissement horizontal pour changer de carte.
   *
   *  `data-swipe-x` neutralise le retour-arrière par glissement de
   *  useSwipeBack : sans lui, faire défiler les cartes vers la droite
   *  quitterait l'écran. Le seuil de 48 px laisse passer les appuis et les
   *  petits tremblements — en dessous, un simple tap sur la carte la faisait
   *  changer au lieu de la retourner.
   */
  function onPointerDown(e: React.PointerEvent) {
    startX.current = e.clientX
  }
  function onPointerUp(e: React.PointerEvent) {
    const from = startX.current
    startX.current = null
    if (from == null) return
    const dx = e.clientX - from
    if (Math.abs(dx) < 48) return
    setIndex((i) => {
      const next = dx < 0 ? i + 1 : i - 1
      if (next < 0 || next > cards.length - 1) return i
      hapticSelection()
      return next
    })
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col"
      style={{ background: 'rgba(6,6,8,0.96)', backdropFilter: 'blur(18px)' }}
      data-swipe-x=""
    >
      <div
        className="flex items-center justify-between px-4"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <span className="text-[15px] font-bold text-white">
          {t('card.carouselTitle', { n: index + 1, total: cards.length })}
        </span>
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          className="tappable flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* La carte — elle garde sa largeur naturelle, centrée. */}
      <div
        className="flex min-h-0 flex-1 items-center justify-center px-8"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <div key={card.key} className="w-full max-w-[320px]">
          <CollectorCard
            spot={card.spot}
            cardNumber={card.cardNumber}
            spotsCount={card.spotsCount}
            isFirstOnRevs={card.isFirstOnRevs}
            evolution={card.evolution}
            onViewSpots={card.onViewSpots}
            showShare
          />
        </div>
      </div>

      {/* Points de navigation — demandés nommément par la référence. Ils ne
          s'affichent qu'au-delà d'une carte, et au-delà de douze ils
          deviendraient une ligne illisible : la bande de miniatures suffit
          alors à se repérer. */}
      {cards.length > 1 && cards.length <= 12 && (
        <div className="flex justify-center gap-1.5 pb-3">
          {cards.map((c, i) => (
            <span
              key={c.key}
              aria-hidden
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === index ? 18 : 6,
                background: i === index ? 'var(--revs-red)' : 'rgba(255,255,255,0.25)',
              }}
            />
          ))}
        </div>
      )}

      {/* Bande de miniatures. */}
      <div
        ref={stripRef}
        className="flex gap-2 overflow-x-auto px-4"
        style={{
          scrollbarWidth: 'none',
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
        }}
      >
        {cards.map((c, i) => {
          const on = i === index
          const img = c.spot.garage_render_url ?? c.spot.photo_url
          return (
            <button
              key={c.key}
              onClick={() => {
                hapticSelection()
                setIndex(i)
              }}
              aria-label={`${c.spot.brand} ${c.spot.model}`}
              aria-current={on}
              className="tappable h-[64px] w-[84px] flex-none overflow-hidden rounded-xl transition-all"
              style={{
                border: on ? '2px solid var(--revs-red)' : '1px solid rgba(255,255,255,0.12)',
                boxShadow: on ? '0 0 14px rgb(var(--color-accent) / 0.45)' : undefined,
                opacity: on ? 1 : 0.55,
                background: '#121214',
              }}
            >
              {img ? (
                <img
                  src={img}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
