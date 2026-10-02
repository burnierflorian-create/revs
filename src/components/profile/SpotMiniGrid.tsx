// ═══════ GRILLE DE SPOTS — LIKES ET FAVORIS ═══════
//
// Deux onglets du profil montrent une liste de spots qui ne sont PAS ceux de
// l'utilisateur : ceux qu'il a aimés, et ceux qu'il a mis de côté. La vignette
// est la même dans les deux cas — seule la source change — donc un seul
// composant, et pas deux qui divergeraient au premier correctif.
//
// ── CE QU'ELLE N'EST PAS ──
// Ce n'est pas la carte du Fil : pas d'auteur, pas d'actions, pas de
// commentaires. On est ici dans une liste de rappel, pas dans un fil social.
// La vignette porte donc le strict nécessaire pour reconnaître la voiture et
// y retourner.

import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Car, Heart } from 'lucide-react'
import type { Spot } from '../../lib/spots'
import { rarityBadge } from '../../lib/rarityStyle'

export default function SpotMiniGrid({
  spots,
  loading,
  emptyTitle,
  emptyBody,
  ctaLabel,
  onCta,
}: {
  spots: Spot[] | null
  loading: boolean
  emptyTitle: string
  emptyBody: string
  ctaLabel?: string
  onCta?: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  if (loading || spots === null) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="aspect-[4/5] animate-pulse rounded-2xl"
            style={{ background: 'rgb(var(--color-fg) / 0.05)' }}
          />
        ))}
      </div>
    )
  }

  if (spots.length === 0) {
    return (
      <div className="flex flex-col items-center px-6 py-12 text-center">
        <span
          className="flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ background: 'rgb(var(--color-fg) / 0.06)' }}
        >
          <Car className="h-7 w-7 text-fg2" />
        </span>
        <p className="mt-4 text-[15px] font-semibold text-fg">{emptyTitle}</p>
        <p className="mt-1.5 max-w-[17rem] text-[13px] leading-relaxed text-fg2">{emptyBody}</p>
        {ctaLabel && onCta && (
          <button
            onClick={onCta}
            className="tappable mt-5 rounded-full px-5 py-2.5 text-[13px] font-bold text-white"
            style={{
              background: 'var(--revs-red)',
              boxShadow: '0 6px 20px rgb(var(--color-accent) / 0.4)',
            }}
          >
            {ctaLabel}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {spots.map((s) => {
        const rb = rarityBadge(s.rarity)
        // Le rendu Garage d'abord : c'est l'image la plus lisible à cette
        // taille. La photo du spot reste le repli, et la silhouette le dernier.
        const img = s.garage_render_url ?? s.photo_url
        return (
          <button
            key={s.id}
            onClick={() => navigate(`/spot/${s.id}`)}
            aria-label={`${s.brand} ${s.model}`}
            className="tappable relative aspect-[4/5] overflow-hidden rounded-2xl text-left"
            style={{ background: 'rgb(var(--color-card))', border: '1px solid var(--color-border)' }}
          >
            {img ? (
              <img
                src={img}
                alt=""
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <span className="absolute inset-0 grid place-items-center">
                <Car className="h-8 w-8 text-fg2/40" />
              </span>
            )}
            {rb && (
              <span
                className="absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[9px] font-extrabold"
                style={{
                  background: rb.bg,
                  color: rb.fg,
                  border: `1px solid ${rb.border}`,
                  letterSpacing: '0.05em',
                }}
              >
                {rb.label}
              </span>
            )}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5"
              style={{
                background:
                  'linear-gradient(to top, rgba(6,6,8,0.95) 0%, rgba(6,6,8,0.6) 45%, transparent 100%)',
              }}
            />
            <span className="absolute inset-x-0 bottom-0 px-2.5 pb-2.5">
              {s.brand && (
                <span className="block truncate text-[9.5px] font-semibold uppercase tracking-[0.1em] text-white/65">
                  {s.brand}
                </span>
              )}
              <span className="block truncate text-[13px] font-bold leading-tight text-white">
                {s.model || s.brand || t('feedpage.defaultCar')}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Compteur de likes, pour l'en-tête de l'onglet. Isolé ici parce que les deux
 *  onglets affichent le même format de titre. */
export function TabCount({ n, label }: { n: number; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[13px] text-fg2">
      <Heart className="h-3.5 w-3.5" />
      <span className="font-bold tabular-nums text-fg">{n}</span>
      {label}
    </span>
  )
}
