// ═══════════════════════ PROFIL — PARRAINAGE ═══════════════════════
//
// Branché sur le système de parrainage EXISTANT : `profiles.invite_code`
// (posé par déclencheur), la table `referrals`, `claim_referral()` qui bloque
// l'auto-parrainage, et `my_referral_stats()`. Rien n'est recréé.
//
// ── INSCRITS vs ACTIFS ──
// La migration 0084 ajoute `active_count` : un filleul n'est « actif » que
// s'il a publié au moins un spot. C'est cette valeur qui est mise en avant,
// parce que c'est celle qui a un coût — créer un compte n'en a aucun, et
// récompenser l'inscription seule serait récompenser le faux compte.
//
// ── AUCUNE RÉCOMPENSE N'EST PROMISE ──
// La spec énumère des récompenses possibles (badge Ambassadeur, cadre de
// profil…), mais aucune n'existe côté serveur. Les annoncer serait répéter
// l'erreur des badges, qui affichaient 675 XP jamais versés. On montre donc la
// mesure, pas une promesse.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Share2 } from 'lucide-react'
import type { ReferralStats } from '../../lib/referrals'

export default function ReferralCard({
  stats,
  onShare,
}: {
  stats: ReferralStats | null
  onShare: () => void
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const code = stats?.invite_code ?? null
  const signed = stats?.referred_count ?? 0
  const active = stats?.active_count ?? 0

  async function copy() {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* presse-papiers bloqué — le bouton Partager reste disponible */
    }
  }

  return (
    <section
      className="overflow-hidden rounded-3xl p-4"
      style={{
        background: 'var(--color-glass-mid)',
        border: '1px solid var(--color-border)',
      }}
    >
      <h2 className="font-display text-[17px] font-extrabold tracking-tight text-fg">
        {t('profilepage.referral.title')}
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-fg2">
        {t('profilepage.referral.body')}
      </p>

      {code && (
        <button
          onClick={() => void copy()}
          className="tappable mt-3.5 flex w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-3 text-left transition-transform active:scale-[0.98]"
          style={{
            background: 'rgb(var(--color-accent) / 0.10)',
            border: '1px solid rgb(var(--color-accent) / 0.35)',
          }}
          aria-label={t('profilepage.referral.copyAria')}
        >
          <span className="min-w-0">
            <span className="label-up block text-[9px] text-fg/45">
              {t('profilepage.referral.codeLabel')}
            </span>
            <span
              className="mt-0.5 block font-mono text-[19px] font-bold tracking-[0.1em]"
              style={{ color: 'rgb(var(--color-accent))' }}
            >
              {code}
            </span>
          </span>
          {copied ? (
            <Check className="h-[18px] w-[18px] flex-none text-emerald-400" />
          ) : (
            <Copy className="h-[18px] w-[18px] flex-none text-fg2" />
          )}
        </button>
      )}

      {/* Mesure, pas promesse : deux chiffres, et l'écart entre les deux. */}
      <div className="mt-3.5 flex items-baseline justify-between text-[12px]">
        <span className="font-semibold text-fg">
          {t('profilepage.referral.activeCount', { count: active })}
        </span>
        <span className="text-fg/45">
          {t('profilepage.referral.signedCount', { count: signed })}
        </span>
      </div>
      <div
        className="mt-2 h-[5px] w-full overflow-hidden rounded-full"
        style={{ background: 'var(--color-ring-track)' }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${signed > 0 ? Math.round((active / signed) * 100) : 0}%`,
            background: 'rgb(var(--color-accent))',
            transition: 'width 800ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
      </div>

      <button
        onClick={onShare}
        className="tappable mt-4 flex w-full items-center justify-center gap-2 rounded-full py-3 transition-transform active:scale-[0.97]"
        style={{
          background: 'rgb(var(--color-accent))',
          boxShadow: '0 6px 20px rgb(var(--color-accent) / 0.35)',
        }}
      >
        <Share2 className="h-4 w-4 text-white" aria-hidden />
        <span className="text-[13px] font-extrabold uppercase tracking-[0.1em] text-white">
          {t('profilepage.shareApp.cta')}
        </span>
      </button>
    </section>
  )
}
