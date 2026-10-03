// ═══════ LE MENU « … » D'UNE PUBLICATION ═══════
//
// Trois actions, et seulement trois : copier le lien, partager, signaler.
// L'auteur voit une quatrième entrée — supprimer la sienne.
//
// ── POURQUOI UNE FEUILLE ET PAS UN MENU DÉROULANT ──
// Un menu ancré au bouton « … » tombe hors de l'écran dès que la carte est
// en bas du fil, et il faut viser un bouton de 32 px avec le pouce. Une
// feuille montée du bas est toujours atteignable, quelle que soit la carte.
//
// ── POURQUOI createPortal ──
// La carte du Fil porte son propre contexte d'empilement (transformations de
// parallaxe, overflow caché). Un enfant n'en sort pas, quel que soit son
// z-index : la feuille passerait sous la photo suivante.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Flag, Link2, Share2, Trash2, X } from 'lucide-react'
import { APP_ORIGIN } from '../lib/referrals'
import { hapticTap } from '../lib/haptic'

export type SpotMenuAction = 'report' | 'delete'

export default function SpotMenu({
  spotId,
  label,
  isMine,
  open,
  onClose,
  onAction,
}: {
  spotId: string
  /** « Porsche Cayman » — ce qui part dans le texte partagé. */
  label: string
  isMine: boolean
  open: boolean
  onClose: () => void
  onAction: (a: SpotMenuAction) => void
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  // L'URL réelle de la publication, pas celle de la page courante : on peut
  // ouvrir ce menu depuis le Fil, et c'est le spot qu'on partage.
  const url = `${APP_ORIGIN}/spot/${spotId}`

  async function copy() {
    hapticTap()
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      // Le menu reste ouvert une seconde pour que « Copié » soit lu. Fermer
      // tout de suite laisserait l'utilisateur sans la moindre confirmation.
      setTimeout(() => {
        setCopied(false)
        onClose()
      }, 900)
    } catch {
      setCopied(false)
    }
  }

  async function share() {
    hapticTap()
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: label, text: label, url })
        onClose()
        return
      }
    } catch {
      // Partage annulé ou refusé : on retombe sur la copie plutôt que de ne
      // rien faire — un bouton qui ne produit aucun effet visible passe pour
      // cassé.
    }
    await copy()
  }

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[115] flex items-end"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
      data-swipe-x=""
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sheet-rise w-full rounded-t-3xl pb-2"
        style={{
          background: 'rgb(var(--color-card))',
          borderTop: '1px solid var(--color-border)',
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
        }}
      >
        <div className="flex items-center justify-between px-5 pb-1 pt-4">
          <h2 className="truncate pr-3 text-[16px] font-bold text-fg">{label}</h2>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="tappable flex h-8 w-8 flex-none items-center justify-center rounded-full text-fg2"
            style={{ background: 'rgb(var(--color-fg) / 0.07)' }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3 pb-1 pt-1">
          <Row
            icon={<Link2 className="h-[18px] w-[18px]" />}
            label={copied ? t('spotmenu.copied') : t('spotmenu.copyLink')}
            onClick={() => void copy()}
          />
          <Row
            icon={<Share2 className="h-[18px] w-[18px]" />}
            label={t('spotmenu.share')}
            onClick={() => void share()}
          />
          <Row
            icon={<Flag className="h-[18px] w-[18px]" />}
            label={t('spotmenu.report')}
            onClick={() => {
              onAction('report')
              onClose()
            }}
          />
          {isMine && (
            <Row
              icon={<Trash2 className="h-[18px] w-[18px]" />}
              label={t('spotmenu.delete')}
              danger
              onClick={() => {
                onAction('delete')
                onClose()
              }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Row({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="tappable flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left"
      style={{ color: danger ? 'var(--revs-red)' : undefined }}
    >
      <span className={danger ? '' : 'text-fg2'}>{icon}</span>
      <span className={`text-[15px] font-semibold ${danger ? '' : 'text-fg'}`}>{label}</span>
    </button>
  )
}
