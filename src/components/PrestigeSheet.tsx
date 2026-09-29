// ═══════════════════════════ PRESTIGE ═══════════════════════════
//
// Le niveau 100 n'est pas la fin : le prestige rouvre la courbe. Cet écran est
// le seul endroit d'où l'on peut le franchir.
//
// ── POURQUOI UN PASSAGE RÉCLAMÉ, ET PAS AUTOMATIQUE ──
// Un prestige accordé tout seul serait vécu comme une RÉGRESSION : l'écran
// afficherait soudain « Niveau 1 » sans qu'on ait rien demandé. Ici, le joueur
// lit ce qu'il garde, ce qu'il recommence, et décide. Rien ne l'oblige à
// prestiger — il peut rester au niveau 100 aussi longtemps qu'il veut, son XP
// continue de s'accumuler et sera reportée le jour où il franchit le pas.
//
// ── CE QUE LE SERVEUR GARANTIT ──
// `claim_prestige()` revérifie le niveau 100 avant d'écrire. Ce composant ne
// fait qu'afficher et demander ; il ne peut pas obtenir un prestige que la
// base refuse. Voir supabase/0076-xp-foundations.sql.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  claimPrestige,
  fetchProgress,
  PRESTIGE_EVENT,
  romanPrestige,
  type Progress,
} from '../lib/xp'
import { prefersReducedMotion, vibrate } from '../lib/motion'

type Phase = 'confirm' | 'working' | 'done' | 'refused'

export default function PrestigeSheet() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('confirm')
  const [prog, setProg] = useState<Progress | null>(null)
  const [result, setResult] = useState<{ prestige: number; level: number } | null>(null)

  useEffect(() => {
    const onOpen = () => {
      setPhase('confirm')
      setResult(null)
      setOpen(true)
      void fetchProgress().then(setProg)
    }
    window.addEventListener(PRESTIGE_EVENT, onOpen as EventListener)
    return () => window.removeEventListener(PRESTIGE_EVENT, onOpen as EventListener)
  }, [])

  // Verrouille le défilement de fond tant que la feuille est ouverte.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  async function confirm() {
    setPhase('working')
    const r = await claimPrestige()
    if (!r.ok) {
      // Le serveur a refusé : niveau insuffisant, ou session perdue. On ne
      // devine pas la raison, on le dit.
      setPhase('refused')
      return
    }
    setResult({ prestige: r.prestige, level: r.level })
    setPhase('done')
    if (!prefersReducedMotion()) vibrate(24)
    // Recharge la progression pour que l'accueil reflète le nouveau cycle dès
    // la fermeture.
    void fetchProgress().then(setProg)
  }

  const nextPrestige = (prog?.prestige ?? 0) + 1

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
      style={{ background: 'rgb(0 0 0 / 0.72)', backdropFilter: 'blur(6px)' }}
      role="dialog"
      aria-modal="true"
      aria-label={t('prestige.title')}
      onClick={() => phase !== 'working' && setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] rounded-t-[28px] px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-5 sm:rounded-[28px] sm:pb-6"
        style={{
          background: 'rgb(var(--color-card))',
          border: '1px solid var(--color-border)',
          boxShadow: '0 -12px 44px rgb(0 0 0 / 0.5)',
        }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p
              className="label-up text-[10px]"
              style={{ color: 'rgb(var(--color-accent))' }}
            >
              {t('prestige.eyebrow')}
            </p>
            <h2 className="mt-1 font-display text-[22px] font-extrabold tracking-tight text-fg">
              {phase === 'done'
                ? t('prestige.doneTitle', { n: romanPrestige(result?.prestige ?? 1) })
                : t('prestige.title', { n: romanPrestige(nextPrestige) })}
            </h2>
          </div>
          {phase !== 'working' && (
            <button
              onClick={() => setOpen(false)}
              aria-label={t('prestige.close')}
              className="tappable -mr-1 -mt-1 flex h-9 w-9 flex-none items-center justify-center rounded-full text-fg2"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* ── Anneau, façon carte XP de l'accueil ── */}
        <div className="mb-5 flex items-center justify-center">
          <div className="relative h-[104px] w-[104px]">
            <svg viewBox="0 0 104 104" className="h-full w-full -rotate-90">
              <circle
                cx="52" cy="52" r="46" fill="none" strokeWidth="6"
                stroke="rgb(var(--color-fg) / 0.12)"
              />
              <circle
                cx="52" cy="52" r="46" fill="none" strokeWidth="6"
                strokeLinecap="round"
                stroke="rgb(var(--color-accent))"
                strokeDasharray={2 * Math.PI * 46}
                strokeDashoffset={phase === 'done' ? 2 * Math.PI * 46 : 0}
                style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.22,1,0.36,1)' }}
              />
            </svg>
            <span className="absolute inset-0 flex flex-col items-center justify-center">
              <span
                className="font-display text-[26px] font-black leading-none"
                style={{ color: 'rgb(var(--color-accent))' }}
              >
                {romanPrestige(phase === 'done' ? (result?.prestige ?? 1) : nextPrestige)}
              </span>
              <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-fg2">
                {t('prestige.short')}
              </span>
            </span>
          </div>
        </div>

        {phase === 'done' ? (
          <>
            <p className="mb-4 text-center text-[14px] leading-relaxed text-fg2">
              {t('prestige.doneBody', { level: result?.level ?? 1 })}
            </p>
            <button
              onClick={() => setOpen(false)}
              className="tappable w-full rounded-full py-3.5 text-[14px] font-extrabold uppercase tracking-[0.12em] text-white"
              style={{ background: 'rgb(var(--color-accent))' }}
            >
              {t('prestige.continue')}
            </button>
          </>
        ) : phase === 'refused' ? (
          <>
            <p className="mb-4 text-center text-[14px] leading-relaxed text-fg2">
              {t('prestige.refused')}
            </p>
            <button
              onClick={() => setOpen(false)}
              className="tappable w-full rounded-full py-3.5 text-[14px] font-bold text-fg2"
              style={{ border: '1px solid var(--color-border)' }}
            >
              {t('prestige.close')}
            </button>
          </>
        ) : (
          <>
            {/* Ce qui est conservé / ce qui recommence. C'est LA question que
                se pose quelqu'un devant un bouton « prestige » : on y répond
                avant de la lui faire poser. */}
            <div
              className="mb-4 space-y-2.5 rounded-2xl p-4"
              style={{ background: 'var(--color-glass-mid)', border: '1px solid var(--color-border)' }}
            >
              <p className="text-[13px] leading-relaxed text-fg2">
                <span className="font-bold text-fg">{t('prestige.keepTitle')}</span>{' '}
                {t('prestige.keepBody')}
              </p>
              <p className="text-[13px] leading-relaxed text-fg2">
                <span className="font-bold text-fg">{t('prestige.resetTitle')}</span>{' '}
                {t('prestige.resetBody')}
              </p>
            </div>

            <button
              onClick={() => void confirm()}
              disabled={phase === 'working'}
              className="tappable flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[14px] font-extrabold uppercase tracking-[0.12em] text-white disabled:opacity-60"
              style={{
                background: 'rgb(var(--color-accent))',
                boxShadow: '0 6px 24px rgb(var(--color-accent) / 0.4)',
              }}
            >
              {phase === 'working' && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('prestige.confirm', { n: romanPrestige(nextPrestige) })}
            </button>
            <p className="mt-3 text-center text-[11px] text-fg/40">
              {t('prestige.noRush')}
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
