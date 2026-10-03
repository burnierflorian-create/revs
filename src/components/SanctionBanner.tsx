// ═══════ CE QUE VOIT UN COMPTE SANCTIONNÉ ═══════
//
// Une sanction qu'on ne peut ni lire ni contester n'est pas une sanction,
// c'est une panne. Ce bandeau dit quoi, pourquoi, jusqu'à quand, et offre le
// seul recours qui compte : demander une révision.
//
// ── CE QU'IL NE DIT PAS ──
// Ni qui a signalé, ni combien de personnes. Donner ces éléments à la
// personne sanctionnée transformerait chaque décision en règlement de
// comptes entre membres.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Scale } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Sanction = {
  id: string
  kind: string
  reason: string
  until: string | null
  at: string
  appeal: { status: string; at: string } | null
}

export default function SanctionBanner() {
  const { t } = useTranslation()
  const [list, setList] = useState<Sanction[]>([])
  const [openFor, setOpenFor] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('my_moderation_status')
    const s = (data as { sanctions?: Sanction[] } | null)?.sanctions ?? []
    setList(s)
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      const { data } = await supabase.rpc('my_moderation_status')
      if (!active) return
      setList(((data as { sanctions?: Sanction[] } | null)?.sanctions ?? []) as Sanction[])
    })()
    return () => {
      active = false
    }
  }, [])

  async function sendAppeal(sanctionId: string) {
    const text = message.trim()
    // La base exige dix caractères : on le dit ici plutôt que de laisser
    // l'envoi échouer sur une contrainte.
    if (text.length < 10) {
      setError(t('appeal.tooShort'))
      return
    }
    setBusy(true)
    setError(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setBusy(false)
      return
    }
    const { error: err } = await supabase.from('moderation_appeals').insert({
      sanction_id: sanctionId,
      user_id: user.id,
      message: text,
    })
    setBusy(false)
    if (err) {
      setError(err.code === '23505' ? t('appeal.already') : err.message)
      return
    }
    setOpenFor(null)
    setMessage('')
    void load()
  }

  if (list.length === 0) return null

  return (
    <div className="space-y-2 px-4 pb-2">
      {list.map((s) => (
        <div
          key={s.id}
          className="rounded-2xl px-4 py-3"
          style={{
            background: 'rgba(232,32,58,0.10)',
            border: '1px solid rgba(232,32,58,0.35)',
          }}
        >
          <p className="flex items-center gap-2 text-[14px] font-bold text-fg">
            <AlertTriangle className="h-4 w-4 flex-none" style={{ color: 'var(--revs-red)' }} />
            {t(`moderation.sanction.${s.kind}`)}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-fg2">
            {t('appeal.reason')} : {s.reason}
            {s.until ? ` · ${t('appeal.until', { date: new Date(s.until).toLocaleDateString() })}` : ''}
          </p>

          {s.appeal ? (
            <p className="mt-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-fg2">
              <Scale className="h-3.5 w-3.5" />
              {t('appeal.yours')} · {t(`moderation.appealStatus.${s.appeal.status}`)}
            </p>
          ) : openFor === s.id ? (
            <div className="mt-2.5">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
                placeholder={t('appeal.placeholder')}
                aria-label={t('appeal.placeholder')}
                rows={3}
                className="w-full resize-none rounded-xl px-3.5 py-2.5 text-fg outline-none placeholder:text-fg2"
                style={{
                  fontSize: '16px',
                  background: 'rgb(var(--color-fg) / 0.06)',
                  border: '1px solid var(--color-border)',
                }}
              />
              {error && <p className="pt-1.5 text-[12.5px] text-accent">{error}</p>}
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => void sendAppeal(s.id)}
                  disabled={busy}
                  className="tappable flex-1 rounded-full py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
                  style={{ background: 'var(--revs-red)' }}
                >
                  {busy ? t('appeal.sending') : t('appeal.send')}
                </button>
                <button
                  onClick={() => {
                    setOpenFor(null)
                    setError(null)
                  }}
                  className="tappable flex-1 rounded-full py-2.5 text-[13px] font-semibold text-fg"
                  style={{ background: 'rgb(var(--color-fg) / 0.08)' }}
                >
                  {t('common.close')}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setOpenFor(s.id)}
              className="tappable mt-2.5 w-full rounded-full py-2.5 text-[13px] font-bold text-fg"
              style={{ background: 'rgb(var(--color-fg) / 0.08)' }}
            >
              {t('appeal.open')}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
