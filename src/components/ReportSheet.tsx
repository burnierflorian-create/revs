// ═══════ SIGNALER UN CONTENU ═══════
//
// Une seule feuille pour les quatre cibles — spot, commentaire, story,
// profil. Le motif change ce qu'un modérateur verra en premier ; il ne
// déclenche aucune sanction.
//
// ── CE QU'ON NE DIT PAS À L'UTILISATEUR ──
// Ni « ce contenu sera supprimé », ni « ce compte sera sanctionné ». Un
// signalement ouvre un dossier, rien de plus. Promettre une suite, c'est
// mentir une fois sur deux, et transformer l'outil en arme pour celui qui y
// croit.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, Flag, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { hapticTap } from '../lib/haptic'

export type ReportTarget = 'spot' | 'comment' | 'story' | 'profile'

/** Les huit motifs. L'ordre compte : du plus fréquent au plus rare, pour que
 *  le doigt ne descende pas pour rien. */
const REASONS = [
  'spam',
  'harassment',
  'inappropriate',
  'violent',
  'scam',
  'fake_account',
  'misleading_car',
  'other',
] as const

export default function ReportSheet({
  open,
  targetType,
  targetId,
  label,
  onClose,
}: {
  open: boolean
  targetType: ReportTarget
  targetId: string
  /** Ce qui est signalé, affiché en titre — pour ne pas se tromper de cible. */
  label: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [reason, setReason] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    if (!reason || busy) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('report_content', {
      p_target_type: targetType,
      p_target_id: targetId,
      p_reason: reason,
      p_note: note.trim() || null,
    })
    setBusy(false)
    if (err) {
      // Les cas prévus par la base ont un message clair ; on le montre plutôt
      // qu'un « une erreur est survenue » qui n'aide personne.
      setError(err.message || t('report.failed'))
      return
    }
    hapticTap()
    setDone(true)
    // Le tri automatique est lancé APRÈS la réponse, sans l'attendre : il ne
    // doit ni ralentir la confirmation ni, en échouant, faire croire que le
    // signalement n'est pas parti. Le dossier existe déjà en base ; si
    // l'analyse ne répond pas, il reste simplement « ouvert » et un humain le
    // verra — le défaut en cas de panne est « quelqu'un regarde ».
    void fetch('/api/moderate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ case_id: null }),
    }).catch(() => {})
    // On laisse le temps de lire le remerciement avant de refermer.
    setTimeout(() => {
      setDone(false)
      setReason(null)
      setNote('')
      onClose()
    }, 1800)
  }

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-end"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={() => !busy && onClose()}
      data-swipe-x=""
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sheet-rise w-full rounded-t-3xl"
        style={{
          background: 'rgb(var(--color-card))',
          borderTop: '1px solid var(--color-border)',
          maxHeight: '88vh',
          overflowY: 'auto',
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        }}
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-1 pt-4">
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold text-fg">{t('report.title')}</h2>
            <p className="truncate text-[12.5px] text-fg2">{label}</p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label={t('common.close')}
            className="tappable flex h-8 w-8 flex-none items-center justify-center rounded-full text-fg2 disabled:opacity-40"
            style={{ background: 'rgb(var(--color-fg) / 0.07)' }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-3 px-8 py-12 text-center">
            <span
              className="flex h-14 w-14 items-center justify-center rounded-full"
              style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)' }}
            >
              <Check className="h-7 w-7" style={{ color: '#22C55E' }} />
            </span>
            <p className="text-[15px] font-bold text-fg">{t('report.thanks')}</p>
            <p className="max-w-[18rem] text-[13px] leading-relaxed text-fg2">
              {t('report.thanksBody')}
            </p>
          </div>
        ) : (
          <div className="px-3 pb-2 pt-2">
            {REASONS.map((r) => {
              const on = reason === r
              return (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  aria-pressed={on}
                  className="tappable flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left"
                  style={{ background: on ? 'rgb(var(--color-accent) / 0.14)' : 'transparent' }}
                >
                  <span
                    aria-hidden
                    className="flex h-5 w-5 flex-none items-center justify-center rounded-full"
                    style={{
                      border: on
                        ? '6px solid var(--revs-red)'
                        : '2px solid rgb(var(--color-fg) / 0.25)',
                    }}
                  />
                  <span className="text-[14.5px] font-medium text-fg">
                    {t(`report.reason.${r}`)}
                  </span>
                </button>
              )
            })}

            <div className="px-2 pt-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 400))}
                placeholder={t('report.notePlaceholder')}
                aria-label={t('report.notePlaceholder')}
                rows={2}
                className="w-full resize-none rounded-xl px-4 py-3 text-fg outline-none placeholder:text-fg2"
                style={{
                  fontSize: '16px',
                  background: 'rgb(var(--color-fg) / 0.06)',
                  border: '1px solid var(--color-border)',
                }}
              />
            </div>

            {error && (
              <p className="px-4 pt-2 text-center text-[13px] text-accent">{error}</p>
            )}

            <div className="px-2 pt-3">
              <button
                onClick={() => void send()}
                disabled={!reason || busy}
                className="tappable flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[15px] font-bold text-white disabled:opacity-40"
                style={{ background: 'var(--revs-red)' }}
              >
                <Flag className="h-4 w-4" />
                {busy ? t('report.sending') : t('report.send')}
              </button>
              <p className="px-4 pb-1 pt-3 text-center text-[11.5px] leading-relaxed text-fg2">
                {t('report.disclaimer')}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
