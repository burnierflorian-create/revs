import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Copy, Share2, Users, Zap, Check } from 'lucide-react'
import {
  fetchMyReferralStats,
  type ReferralStats,
} from '../lib/referrals'
import { Skeleton } from '../components/Skeleton'

export default function Referral() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    fetchMyReferralStats().then((s) => {
      if (active) setStats(s)
    })
    return () => {
      active = false
    }
  }, [])

  async function copyCode() {
    if (!stats?.invite_code) return
    try {
      await navigator.clipboard.writeText(stats.invite_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  async function share() {
    if (!stats?.invite_code) return
    const text = t('miscpages.referral.shareText', { code: stats.invite_code })
    if (navigator.share) {
      try {
        await navigator.share({
          text,
          title: t('miscpages.referral.shareTitle'),
        })
        return
      } catch {
        // Fall through to clipboard fallback
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="flex items-center gap-4 py-4">
        <button
          onClick={() => navigate(-1)}
          aria-label={t('miscpages.referral.back')}
          className="tappable text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="flex items-center gap-2 display-xl text-fg">
          <Users className="h-7 w-7 text-accent" />
          {t('miscpages.referral.title')}
        </h1>
      </div>

      <p className="mb-6 text-sm text-fg2">
        {t('miscpages.referral.introBefore')}{' '}
        <span className="font-extrabold tracking-wider text-accent">
          {t('miscpages.referral.introXp')}
        </span>{' '}
        {t('miscpages.referral.introAfter')}
      </p>

      {stats === null ? (
        <Skeleton className="h-56 rounded-3xl" />
      ) : (
        <>
          {/* Hero — code en vedette avec halo rouge */}
          <div
            className="rounded-3xl p-6 text-center"
            style={{
              background:
                'linear-gradient(155deg, rgba(232,32,58,0.22) 0%, rgba(232,32,58,0.08) 40%, rgb(var(--color-card) / 0.95) 90%)',
              border: '1px solid rgba(232,32,58,0.4)',
              boxShadow: '0 12px 36px rgba(232,32,58,0.2)',
            }}
          >
            <p className="label-up text-[10px] text-fg2">
              {t('miscpages.referral.yourCode')}
            </p>
            <p
              className="mt-3 font-display font-extrabold text-fg"
              style={{
                fontSize: '52px',
                letterSpacing: '0.18em',
                lineHeight: 1,
              }}
            >
              {stats.invite_code ?? '—'}
            </p>

            <div className="mt-6 flex gap-2">
              <button
                onClick={copyCode}
                disabled={!stats.invite_code}
                className="tappable flex flex-1 items-center justify-center gap-2 rounded-full bg-fg/10 px-4 py-3 text-sm font-extrabold tracking-wider text-fg backdrop-blur transition-colors hover:bg-fg/15 disabled:opacity-40"
                style={{ border: '1px solid rgb(var(--color-fg) / 0.10)' }}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    {t('miscpages.referral.copied')}
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    {t('miscpages.referral.copy')}
                  </>
                )}
              </button>
              <button
                onClick={share}
                disabled={!stats.invite_code}
                className="tappable flex flex-1 items-center justify-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-extrabold tracking-wider text-fg disabled:opacity-40"
                style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
              >
                <Share2 className="h-4 w-4" />
                {t('miscpages.referral.share')}
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div
              className="rounded-3xl bg-card p-4"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center gap-1.5 text-fg2">
                <Users className="h-3.5 w-3.5" />
                <span className="label-up text-[10px]">
                  {t('miscpages.referral.friendsInvited')}
                </span>
              </div>
              <p className="mt-2 font-display text-3xl font-extrabold tracking-tighter text-fg">
                {stats.referred_count}
              </p>
            </div>
            <div
              className="rounded-3xl bg-card p-4"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center gap-1.5 text-fg2">
                <Zap className="h-3.5 w-3.5" />
                <span className="label-up text-[10px]">
                  {t('miscpages.referral.xpEarned')}
                </span>
              </div>
              <p className="mt-2 font-display text-3xl font-extrabold tracking-tighter text-accent">
                +{stats.xp_from_referrals}
              </p>
            </div>
          </div>

          <div
            className="mt-6 rounded-3xl bg-card p-5"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <p className="font-display text-base font-extrabold tracking-tighter text-fg">
              {t('miscpages.referral.howItWorks')}
            </p>
            <ol className="mt-3 space-y-2.5 text-sm text-fg/80">
              {[
                t('miscpages.referral.step1'),
                t('miscpages.referral.step2'),
                t('miscpages.referral.step3'),
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-accent/15 font-display text-xs font-extrabold text-accent">
                    {i + 1}
                  </span>
                  <span className="pt-0.5 leading-snug text-fg2">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </div>
  )
}
