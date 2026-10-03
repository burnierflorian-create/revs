// ═══════ LE MENU « … » D'UN PROFIL ═══════
//
// Bloquer, débloquer, signaler. Trois entrées, pas une de plus.
//
// ── CE QUE BLOQUER FAIT VRAIMENT ──
// Le masquage n'est pas appliqué par cet écran : il vit dans les policies de
// lecture de `spots` et `comments` (migration 0119), et il joue DANS LES DEUX
// SENS. Bloquer quelqu'un le fait disparaître de votre fil, et vous fait
// disparaître du sien — sans quoi la personne bloquée continuerait de vous
// lire et de vous répondre, et le blocage ne protégerait personne.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Flag, UserMinus, UserPlus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { hapticTap } from '../lib/haptic'
import ReportSheet from './ReportSheet'

export default function ProfileActionsSheet({
  open,
  userId,
  pseudo,
  blocked,
  onClose,
  onBlockedChange,
}: {
  open: boolean
  userId: string
  pseudo: string
  blocked: boolean
  onClose: () => void
  onBlockedChange: (next: boolean) => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggleBlock() {
    if (busy) return
    setBusy(true)
    setError(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setBusy(false)
      return
    }
    const { error: err } = blocked
      ? await supabase
          .from('user_blocks')
          .delete()
          .eq('blocker_id', user.id)
          .eq('blocked_id', userId)
      : await supabase
          .from('user_blocks')
          .insert({ blocker_id: user.id, blocked_id: userId })
    setBusy(false)
    // 23505 = déjà bloqué : l'état visé est atteint, ce n'est pas un échec.
    if (err && err.code !== '23505') {
      setError(err.message)
      return
    }
    hapticTap()
    onBlockedChange(!blocked)
    onClose()
  }

  if (!open && !reportOpen) return null

  return (
    <>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[125] flex items-end"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={() => !busy && onClose()}
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
                <h2 className="truncate pr-3 text-[16px] font-bold text-fg">{pseudo}</h2>
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
                <button
                  onClick={() => void toggleBlock()}
                  disabled={busy}
                  className="tappable flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left disabled:opacity-50"
                  style={{ color: blocked ? undefined : 'var(--revs-red)' }}
                >
                  {blocked ? (
                    <UserPlus className="h-[18px] w-[18px] text-fg2" />
                  ) : (
                    <UserMinus className="h-[18px] w-[18px]" />
                  )}
                  <span
                    className={`text-[15px] font-semibold ${blocked ? 'text-fg' : ''}`}
                  >
                    {blocked ? t('block.unblock') : t('block.block')}
                  </span>
                </button>
                <button
                  onClick={() => {
                    onClose()
                    setReportOpen(true)
                  }}
                  className="tappable flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left"
                >
                  <Flag className="h-[18px] w-[18px] text-fg2" />
                  <span className="text-[15px] font-semibold text-fg">
                    {t('block.reportProfile')}
                  </span>
                </button>
                {!blocked && (
                  <p className="px-4 pb-1 pt-2 text-[11.5px] leading-relaxed text-fg2">
                    {t('block.explain')}
                  </p>
                )}
                {error && (
                  <p className="px-4 pt-2 text-center text-[13px] text-accent">{error}</p>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      <ReportSheet
        open={reportOpen}
        targetType="profile"
        targetId={userId}
        label={pseudo}
        onClose={() => setReportOpen(false)}
      />
    </>
  )
}
