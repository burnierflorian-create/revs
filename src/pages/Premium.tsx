import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, Crown, Lock, Sparkles, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  FREE_PERKS,
  MONTHLY_PRICES,
  planTier,
  PREMIUM_PERKS,
  VIP_CONCOURS,
  VIP_PERKS,
  YEARLY_PRICES,
  type Interval,
} from '../lib/plans'
import { translateError } from '../lib/errors'
import { appConfig } from '../config/appConfig'

/** VIP tier visibility — now driven by the central phase config. The card
 *  component and all the supporting copy / checkout wiring are left intact
 *  so re-enabling is a one-line flip in appConfig. Existing VIP subscribers
 *  keep their perks regardless; this only hides the new-signup entry point. */
const SHOW_VIP_TIER = appConfig.SHOW_VIP_PLAN

type Tier = 'premium' | 'vip'

export default function Premium() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const status = params.get('status')

  // Default toggle = monthly per the spec — the user picks annual
  // explicitly when they see the "2 mois offerts" badge.
  const [interval, setInterval] = useState<Interval>('month')
  const [currentPlan, setCurrentPlan] = useState<string | null>(null)
  const [memberCount, setMemberCount] = useState<number | null>(null)
  const [portalBusy, setPortalBusy] = useState(false)
  const [portalErr, setPortalErr] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (active && user) {
        const { data } = await supabase
          .from('subscriptions')
          .select('plan, status')
          .eq('user_id', user.id)
          .maybeSingle()
        if (!active) return
        const s = data as { plan?: string; status?: string } | null
        if (s?.status === 'active' || s?.status === 'trialing') {
          setCurrentPlan(s.plan ?? null)
        }
      }
      // Social proof — published count of paying subscribers.
      const { data: cnt } = await supabase.rpc('premium_member_count')
      if (active && typeof cnt === 'number') setMemberCount(cnt)
    })()
    return () => {
      active = false
    }
  }, [])

  // Auto-clear the cancel banner after 4s. Success no longer auto-
  // clears — the celebration overlay owns the user attention until
  // they tap "C'est parti !".
  useEffect(() => {
    if (status !== 'cancel') return
    const t = setTimeout(() => navigate('/premium', { replace: true }), 4000)
    return () => clearTimeout(t)
  }, [status, navigate])

  const tier = planTier(currentPlan)
  const hasActive = tier === 'premium' || tier === 'vip'

  // Sends the already-subscribed user to the Stripe Customer Portal
  // instead of opening a second checkout — guards against duplicate
  // subscriptions.
  async function openPortal() {
    if (portalBusy) return
    setPortalErr(null)
    setPortalBusy(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Session introuvable')
      const res = await fetch('/api/create-checkout-session?action=portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
      const data = (await res.json()) as { url?: string; error?: string }
      if (data.url) {
        window.location.href = data.url
        return
      }
      throw new Error(data.error || 'Portail indisponible')
    } catch (e) {
      setPortalErr(translateError(e))
      setPortalBusy(false)
    }
  }

  function goCheckout(t: Tier) {
    if (hasActive) {
      void openPortal()
      return
    }
    navigate(`/premium/checkout/${t}?interval=${interval}`)
  }

  return (
    <div className="min-h-screen bg-bg text-fg">
      <div className="px-5 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-4 py-4">
          <button
            onClick={() => navigate(-1)}
            aria-label="Retour"
            className="tappable text-fg2 hover:text-fg"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <h1 className="display-xl text-fg">Premium</h1>
        </div>

        {/* ─────────────── LAUNCH BANNER ─────────────── */}
        <div
          className="launch-pulse mb-5 flex items-center gap-2 rounded-2xl px-4 py-2.5 text-[12px] font-semibold text-white"
          style={{
            background:
              'linear-gradient(135deg, rgba(232,32,58,0.22) 0%, rgba(232,32,58,0.08) 100%)',
            border: '1px solid rgba(232,32,58,0.4)',
          }}
          role="note"
        >
          <span aria-hidden>🚀</span>
          <span className="leading-tight">
            <strong>Offre de lancement</strong> — prix garanti à vie pour les
            premiers membres
          </span>
        </div>

        {status === 'success' && (
          <div className="mb-4 rounded-2xl bg-accent/15 px-4 py-3 text-sm">
            🔥 Bienvenue ! Ton abonnement est activé.
          </div>
        )}
        {portalErr && (
          <div className="mb-4 rounded-2xl bg-accent/15 px-4 py-3 text-sm">
            {portalErr}
          </div>
        )}
        {status === 'cancel' && (
          <div
            className="mb-4 rounded-2xl bg-card px-4 py-3 text-sm text-fg2"
            style={{ border: '1px solid var(--color-border)' }}
          >
            Paiement annulé — aucun montant n'a été débité.
          </div>
        )}

        {/* ─────────────── SOCIAL PROOF ─────────────── */}
        <div className="mb-6 flex items-center justify-center gap-2 text-sm text-fg2">
          <Users className="h-4 w-4 text-accent" />
          {memberCount && memberCount > 0 ? (
            <span>
              Rejoins les{' '}
              <strong className="font-extrabold text-fg">{memberCount}</strong>{' '}
              spotters Premium 🔥
            </span>
          ) : (
            <span>Rejoins les spotters Premium 🔥</span>
          )}
        </div>

        {/* ─────────────── INTERVAL TOGGLE ─────────────── */}
        <div className="flex justify-center">
          <div
            className="relative inline-flex rounded-full bg-card p-1"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <button
              onClick={() => setInterval('month')}
              className={`tappable relative z-10 rounded-full px-5 py-2 text-sm font-bold tracking-wide transition-colors ${
                interval === 'month' ? 'bg-fg text-bg' : 'text-fg2'
              }`}
            >
              Mensuel
            </button>
            <button
              onClick={() => setInterval('year')}
              className={`tappable relative z-10 rounded-full px-5 py-2 text-sm font-bold tracking-wide transition-colors ${
                interval === 'year' ? 'bg-fg text-bg' : 'text-fg2'
              }`}
            >
              Annuel
            </button>
          </div>
        </div>
        <p
          className={`mt-2 text-center text-xs font-bold tracking-wider transition-opacity ${
            interval === 'year' ? 'text-accent opacity-100' : 'text-fg2/70 opacity-70'
          }`}
        >
          🎁 2 mois offerts sur l'année
        </p>

        {/* ─────────────── TIER CARDS ─────────────── */}
        <div className="mt-6 space-y-4">
          <FreeCard current={tier === 'free'} />
          <PremiumCard
            price={
              interval === 'year' ? YEARLY_PRICES.premium : MONTHLY_PRICES.premium
            }
            interval={interval}
            current={tier === 'premium'}
            hasActive={hasActive}
            portalBusy={portalBusy}
            onPick={() => goCheckout('premium')}
          />
          {/* VIP stays VISIBLE for hype but locked while SHOW_VIP_PLAN is
              off — SOON badge + disabled CTA. The Premium card above is
              untouched and stays fully purchasable. */}
          <VipCard
            price={interval === 'year' ? YEARLY_PRICES.vip : MONTHLY_PRICES.vip}
            interval={interval}
            current={tier === 'vip'}
            hasActive={hasActive}
            portalBusy={portalBusy}
            onPick={() => goCheckout('vip')}
            locked={!SHOW_VIP_TIER}
          />
        </div>

        {/* Nav clearance handled by .stack-overlay CSS; this extra
            padding gives breathing room on long-scroll devices. */}
        <div className="h-6" />
      </div>
    </div>
  )
}

// ─────────────────────── Cards ───────────────────────

function FreeCard({ current }: { current: boolean }) {
  return (
    <section
      className="relative overflow-hidden rounded-3xl bg-card p-5"
      style={{ border: '1px solid var(--color-border)' }}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-xl font-extrabold tracking-tighter text-fg">
          Gratuit
          {current && (
            <span className="label-up ml-2 align-middle text-[10px] text-fg2">
              · Actuel
            </span>
          )}
        </h3>
        <div className="font-display text-2xl font-extrabold tracking-tighter text-fg">
          0 €
        </div>
      </header>
      <ul className="mt-4 space-y-2">
        {FREE_PERKS.map((p) => (
          <li
            key={p}
            className="flex items-start gap-2 text-sm leading-snug text-fg/85"
          >
            <Check className="mt-0.5 h-4 w-4 flex-none text-fg2" />
            {p}
          </li>
        ))}
      </ul>
    </section>
  )
}

function PremiumCard({
  price,
  interval,
  current,
  hasActive,
  portalBusy,
  onPick,
}: {
  price: string
  interval: Interval
  current: boolean
  hasActive: boolean
  portalBusy: boolean
  onPick: () => void
}) {
  // Subscribed users (any tier) never see a checkout CTA — the button
  // morphs into the portal redirect. Prevents double subscriptions
  // and gives them one-tap access to cancel / change card.
  const ctaLabel = hasActive
    ? portalBusy
      ? 'Ouverture…'
      : 'Gérer mon abonnement'
    : 'Voir les avantages Premium ⚡'
  const disabled = portalBusy
  return (
    <section
      className="relative overflow-hidden rounded-3xl bg-card p-5"
      style={{
        border: '1.5px solid rgba(232,32,58,0.55)',
        boxShadow: '0 10px 32px rgba(232,32,58,0.18)',
      }}
    >
      <span className="label-up absolute -top-px right-5 rounded-b-md bg-accent px-2.5 py-1 text-[10px] text-fg">
        POPULAIRE
      </span>
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-1.5 font-display text-xl font-extrabold tracking-tighter text-fg">
          Premium
          <Sparkles className="h-4 w-4 text-accent" />
          {current && (
            <span className="label-up ml-2 align-middle text-[10px] text-fg2">
              · Actuel
            </span>
          )}
        </h3>
        <div className="text-right">
          <div className="font-display text-3xl font-extrabold tracking-tighter text-fg">
            {price}
          </div>
          <div className="-mt-0.5 text-[11px] text-fg2">
            / {interval === 'year' ? 'an' : 'mois'}
          </div>
        </div>
      </header>
      <ul className="mt-4 space-y-2">
        {PREMIUM_PERKS.map((p) => (
          <li
            key={p}
            className="flex items-start gap-2 text-sm leading-snug text-fg/85"
          >
            <Check className="mt-0.5 h-4 w-4 flex-none text-accent" />
            {p}
          </li>
        ))}
      </ul>
      <button
        onClick={onPick}
        disabled={disabled}
        className="tappable mt-5 w-full rounded-full bg-accent py-3.5 text-sm font-extrabold tracking-wider text-fg transition-colors disabled:opacity-50"
        style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
      >
        {ctaLabel}
      </button>
      {!disabled && (
        <p className="mt-2 text-center text-[11px] text-fg2">
          ✨ 7 jours gratuits — annule quand tu veux
        </p>
      )}
    </section>
  )
}

function VipCard({
  price,
  interval,
  current,
  hasActive,
  portalBusy,
  onPick,
  locked = false,
}: {
  price: string
  interval: Interval
  current: boolean
  hasActive: boolean
  portalBusy: boolean
  onPick: () => void
  locked?: boolean
}) {
  const ctaLabel = hasActive
    ? portalBusy
      ? 'Ouverture…'
      : 'Gérer mon abonnement'
    : 'Découvrir le cercle VIP 👑'
  return (
    <section
      className="relative overflow-hidden rounded-3xl p-5"
      style={{
        background:
          'linear-gradient(155deg, rgba(212,175,55,0.22) 0%, rgba(255,215,0,0.08) 35%, rgba(15,15,15,0.95) 75%)',
        boxShadow:
          '0 12px 44px rgba(212,175,55,0.22), inset 0 0 0 1.5px rgba(212,175,55,0.6)',
      }}
    >
      <span className="label-up absolute -top-px right-5 inline-flex items-center gap-1 rounded-b-md bg-gradient-to-r from-[#d4af37] to-[#ffd700] px-2.5 py-1 text-[10px] text-black">
        {locked ? (
          <>
            <Lock className="h-3 w-3" strokeWidth={2.4} /> SOON
          </>
        ) : (
          'CERCLE FERMÉ'
        )}
      </span>
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-1.5 font-display text-xl font-extrabold tracking-tighter text-fg">
          VIP
          <Crown className="h-4 w-4 text-[#ffd700]" />
          {current && (
            <span className="label-up ml-2 align-middle text-[10px] text-fg2">
              · Actuel
            </span>
          )}
        </h3>
        <div className="text-right">
          <div className="font-display text-3xl font-extrabold tracking-tighter text-[#ffd700]">
            {price}
          </div>
          <div className="-mt-0.5 text-[11px] text-fg2">
            / {interval === 'year' ? 'an' : 'mois'}
          </div>
        </div>
      </header>
      <ul className="mt-4 space-y-2">
        {VIP_PERKS.map((p) => (
          <li
            key={p}
            className="flex items-start gap-2 text-sm leading-snug text-fg/85"
          >
            <Check className="mt-0.5 h-4 w-4 flex-none text-[#ffd700]" />
            {p}
          </li>
        ))}
      </ul>

      {/* Concours VIP — hero perk */}
      <div
        className="mt-4 rounded-2xl p-3.5"
        style={{
          border: '1px solid rgba(212,175,55,0.35)',
          background: 'rgba(212,175,55,0.07)',
        }}
      >
        <p className="flex items-center gap-2 text-sm font-extrabold tracking-tighter text-[#ffd700]">
          🎰 {VIP_CONCOURS.title}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-fg/75">
          {VIP_CONCOURS.body}
        </p>
      </div>

      <button
        onClick={locked ? undefined : onPick}
        disabled={portalBusy || locked}
        className="tappable gold-shimmer relative mt-5 w-full overflow-hidden rounded-full py-3.5 text-sm font-extrabold tracking-wider text-black disabled:opacity-50"
        style={{
          background:
            'linear-gradient(120deg, #d4af37 0%, #ffd700 45%, #b8860b 100%)',
          boxShadow: '0 10px 28px rgba(212,175,55,0.45)',
        }}
      >
        <span className="relative z-10 flex items-center justify-center gap-1.5">
          {locked && <Lock className="h-3.5 w-3.5" strokeWidth={2.4} />}
          {locked ? 'Bientôt disponible' : ctaLabel}
        </span>
      </button>
    </section>
  )
}
