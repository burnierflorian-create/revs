// ═══════════════════════ PROFIL — HERO ═══════════════════════
//
// Le haut du profil. Il répond à une seule question : à qui ai-je affaire ?
//
// ── L'IMAGE DE FOND ──
// Aucune architecture de stockage n'est créée pour cela : on réutilise la
// MEILLEURE photo du joueur — celle de son spot le plus rare — et à défaut
// l'image de hero déjà servie sur l'accueil. Le profil d'un collectionneur
// s'ouvre donc sur sa plus belle prise, ce qui est plus juste qu'une bannière
// générique, et ne coûte aucune requête supplémentaire.
//
// ── STATUT ET TITRE SÉPARÉS ──
// « Fondateur » est un STATUT DE COMPTE, « Collector » un TITRE DE NIVEAU.
// Depuis la refonte XP du 29/09, le premier n'écrase plus le second : les deux
// s'affichent côte à côte, et un Fondateur voit enfin sa progression.

import { useTranslation } from 'react-i18next'
import { BadgeCheck, AtSign, Car, Share2 } from 'lucide-react'
import type { Spot } from '../../lib/spots'
import { pickPrimaryVehicle } from '../../lib/primaryVehicle'
import { displayHandle, instagramUrl } from '../../lib/social'

export default function ProfileHero({
  pseudo,
  avatar,
  accountTitle,
  levelTitle,
  ville,
  dreamCar,
  instagram,
  garageBrand,
  primarySpotId,
  verified,
  spots,
  inviteCode,
  onShare,
}: {
  pseudo: string
  avatar: string | null
  /** Statut de compte — « Fondateur », « VIP »… ou null. */
  accountTitle: string | null
  /** Titre dérivé du niveau — « Rookie » → « REVS OG ». */
  levelTitle: string | null
  ville: string
  dreamCar: string | null
  /** Pseudo Instagram, forme canonique (sans « @ »). */
  instagram: string | null
  garageBrand: string | null
  primarySpotId: string | null
  verified: boolean
  spots: Spot[]
  inviteCode: string | null
  onShare: () => void
}) {
  const { t } = useTranslation()

  // Le véhicule principal — MÊME source que le profil public et les
  // Paramètres. `primarySpotId` est le choix de l'utilisateur ; le reste n'est
  // qu'une déduction pour ceux qui n'ont rien désigné.
  const vehicle = pickPrimaryVehicle(spots, garageBrand, primarySpotId)
  const cover = vehicle.photo
  const igUrl = instagramUrl(instagram)
  const igLabel = displayHandle(instagram)

  const idLine = [accountTitle, levelTitle, ville].filter(Boolean)

  return (
    <header className="relative isolate overflow-hidden">
      {cover ? (
        <img
          src={cover}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: 'center 45%' }}
        />
      ) : (
        <picture>
          <source srcSet="/images/hero-home.webp" type="image/webp" />
          <img
            src="/images/hero-home.png"
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </picture>
      )}

      {/* Voile : la photo doit rester perceptible, le texte parfaitement
          lisible. Le bas fond vers --color-bg pour rejoindre la page sans
          couture, y compris en thème clair. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, rgb(0 0 0 / 0.68) 0%, rgb(0 0 0 / 0.30) 38%,' +
            ' rgb(0 0 0 / 0.78) 76%, rgb(var(--color-bg)) 100%)',
        }}
      />

      {/* `min-h` porté par le CONTENU, pas par le <header> : sans hauteur
          propre, `justify-end` n'avait rien à répartir et l'identité restait
          collée en haut, au milieu de la photo. */}
      <div
        className="relative flex flex-col justify-end px-4 pb-4 pt-[calc(max(1rem,env(safe-area-inset-top))+14px)]"
        style={{ minHeight: 248 }}
      >
        {/* Partager REVS — en haut à droite, hors du flux de l'identité. */}
        <button
          onClick={onShare}
          className="tappable absolute right-4 top-[calc(max(1rem,env(safe-area-inset-top))+10px)] flex items-center gap-2 rounded-full px-3 py-2 transition-transform active:scale-95"
          style={{
            background: 'rgb(var(--color-accent))',
            boxShadow: '0 6px 20px rgb(var(--color-accent) / 0.4)',
          }}
        >
          <Share2 className="h-[15px] w-[15px] text-white" aria-hidden />
          <span className="flex flex-col items-start leading-none">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-white">
              {t('profilepage.shareApp.cta')}
            </span>
            {inviteCode && (
              <span className="mt-0.5 font-mono text-[9px] font-bold text-white/75">
                {inviteCode}
              </span>
            )}
          </span>
        </button>

        <div className="mt-auto flex items-end gap-3.5">
          {/* Avatar — anneau rouge REVS et halo discret. Pas un médaillon
              géant : il partage la ligne avec le nom. */}
          <span className="relative flex-none">
            <span
              className="block h-[76px] w-[76px] overflow-hidden rounded-full"
              style={{
                border: '2.5px solid rgb(var(--color-accent))',
                boxShadow: '0 0 18px rgb(var(--color-accent) / 0.45)',
                background: 'rgb(var(--color-card))',
              }}
            >
              {avatar ? (
                <img
                  src={avatar}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center font-display text-2xl font-black text-fg2">
                  {pseudo.slice(0, 1).toUpperCase()}
                </span>
              )}
            </span>
          </span>

          <div className="min-w-0 flex-1 pb-0.5">
            <h1 className="flex items-center gap-1.5 font-display text-[25px] font-black leading-none tracking-tight text-white">
              <span className="truncate">{pseudo}</span>
              {verified && (
                <BadgeCheck
                  className="h-[18px] w-[18px] flex-none"
                  style={{ color: 'rgb(var(--color-accent))' }}
                  aria-label={t('profilepage.verified')}
                />
              )}
            </h1>
            {idLine.length > 0 && (
              <p className="mt-1.5 truncate text-[12px] font-medium text-white/65">
                {idLine.join(' · ')}
              </p>
            )}
            {/* Instagram — facultatif, donc strictement rien quand il manque.
                `displayHandle` garantit un seul « @ » quelle que soit la forme
                saisie : c'est ce qui produisait « @@flr_brn ». */}
            {igUrl && igLabel && (
              <a
                href={igUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="tappable mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-white/80"
              >
                <AtSign className="h-3.5 w-3.5" aria-hidden />
                {igLabel}
              </a>
            )}
          </div>
        </div>

        {/* MON VÉHICULE — la voiture réellement possédée, distincte de la
            voiture de rêve juste en dessous. Les confondre était tout le
            problème : l'une est un fait, l'autre un souhait. */}
        {vehicle.label && (
          <div className="mt-3">
            <span
              className="inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1.5"
              style={{
                background: 'rgb(232 32 58 / 0.18)',
                border: '1px solid rgb(232 32 58 / 0.42)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
              }}
            >
              <Car className="h-3.5 w-3.5 flex-none text-white" aria-hidden />
              <span className="truncate text-[12px] font-bold text-white">
                {vehicle.label}
              </span>
            </span>
          </div>
        )}

        {/* Voiture de rêve — pastille discrète, pas un bloc. */}
        {dreamCar && (
          <div className="mt-3">
            <span
              className="inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1.5"
              style={{
                background: 'rgb(0 0 0 / 0.5)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: '1px solid rgb(255 255 255 / 0.14)',
              }}
            >
              <span aria-hidden className="text-[11px]">🏁</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/50">
                {t('profilepage.dreamCar.label')}
              </span>
              <span className="truncate text-[12px] font-bold text-white">
                {dreamCar}
              </span>
            </span>
          </div>
        )}
      </div>
    </header>
  )
}
