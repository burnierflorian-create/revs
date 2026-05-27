import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Crown, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { translateError } from '../lib/errors'
import {
  MONTHLY_PRICES,
  PREMIUM_PERKS_DETAILED,
  VIP_PERKS_DETAILED,
  YEARLY_PRICES,
  type DetailedPerk,
  type Interval,
} from '../lib/plans'

type Tier = 'premium' | 'vip'

type CheckoutPlanId =
  | 'premium_monthly'
  | 'premium_yearly'
  | 'vip_monthly'
  | 'vip_yearly'

// Full-screen confirmation step between /premium and Stripe Checkout.
// Renders as a stack route so it slides in over the kept-alive tabs —
// the layout-level push/pop transition handles the appearance.
export default function PremiumCheckout() {
  const navigate = useNavigate()
  const { tier: tierParam } = useParams<{ tier: string }>()
  const [params] = useSearchParams()
  const intervalParam = params.get('interval')

  const tier: Tier | null =
    tierParam === 'premium' || tierParam === 'vip' ? tierParam : null
  const interval: Interval = intervalParam === 'year' ? 'year' : 'month'

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Invalid tier in the URL → bounce back to the Premium grid.
  useEffect(() => {
    if (!tier) navigate('/premium', { replace: true })
  }, [tier, navigate])

  if (!tier) return null

  const isVip = tier === 'vip'
  const price = isVip
    ? interval === 'year'
      ? YEARLY_PRICES.vip
      : MONTHLY_PRICES.vip
    : interval === 'year'
      ? YEARLY_PRICES.premium
      : MONTHLY_PRICES.premium
  const perks: DetailedPerk[] = isVip ? VIP_PERKS_DETAILED : PREMIUM_PERKS_DETAILED
  const planId: CheckoutPlanId = `${tier}_${interval === 'year' ? 'yearly' : 'monthly'}`

  async function payNow() {
    setError(null)
    setBusy(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Non authentifié')
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: planId,
          userId: user.id,
          email: user.email,
        }),
      })
      const data = (await res.json()) as { url?: string; error?: string }
      if (data.url) {
        window.location.href = data.url
        return
      }
      throw new Error(data.error || 'Impossible de démarrer le paiement')
    } catch (e) {
      setError(translateError(e))
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* ─────────────── HERO ─────────────── */}
      <header
        className="relative overflow-hidden"
        style={{
          background: isVip
            ? 'radial-gradient(130% 90% at 50% 0%, rgba(255,215,0,0.30) 0%, rgba(212,175,55,0.18) 35%, rgba(184,134,11,0.10) 65%, #0a0a0a 100%)'
            : 'radial-gradient(130% 90% at 50% 0%, rgba(230,57,70,0.50) 0%, rgba(230,57,70,0.22) 35%, rgba(230,57,70,0.08) 65%, #0a0a0a 100%)',
        }}
      >
        <button
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="tappable absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/30 backdrop-blur"
          style={{ border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <ArrowLeft className="h-5 w-5 text-fg" />
        </button>

        <div className="relative flex flex-col items-center px-6 pb-10 pt-[calc(env(safe-area-inset-top)+4.5rem)] text-center">
          <div
            className="flex h-20 w-20 items-center justify-center rounded-full"
            style={
              isVip
                ? {
                    background:
                      'linear-gradient(135deg, #d4af37 0%, #ffd700 50%, #b8860b 100%)',
                    boxShadow: '0 12px 40px rgba(212,175,55,0.45)',
                    border: '2px solid rgba(255,255,255,0.18)',
                  }
                : {
                    background:
                      'linear-gradient(135deg, var(--color-accent) 0%, #ff6b76 100%)',
                    boxShadow: '0 12px 40px rgba(232,32,58,0.45)',
                    border: '2px solid rgba(255,255,255,0.18)',
                  }
            }
          >
            {isVip ? (
              <Crown className="h-10 w-10 text-black" strokeWidth={2.2} />
            ) : (
              <Sparkles className="h-10 w-10 text-fg" strokeWidth={2.2} />
            )}
          </div>
          <h1
            className={`mt-5 font-display text-[34px] font-extrabold leading-none tracking-tighter ${
              isVip ? 'text-[#ffd700]' : 'text-white'
            }`}
          >
            {isVip ? 'Cercle VIP' : 'Premium'}
          </h1>
          <p className="mt-2 text-sm text-white/65">
            {isVip
              ? 'L’expérience REVS au sommet'
              : 'Débloque l’expérience complète'}
          </p>

          {/* Big price card */}
          <div
            className="mt-6 flex items-baseline gap-2 rounded-3xl px-6 py-4"
            style={{
              background: isVip
                ? 'rgba(212,175,55,0.12)'
                : 'rgba(232,32,58,0.12)',
              border: isVip
                ? '1px solid rgba(212,175,55,0.30)'
                : '1px solid rgba(232,32,58,0.30)',
            }}
          >
            <span
              className={`font-display text-5xl font-extrabold tracking-tighter ${
                isVip ? 'text-[#ffd700]' : 'text-white'
              }`}
            >
              {price}
            </span>
            <span className="text-sm text-white/55">
              / {interval === 'year' ? 'an' : 'mois'}
            </span>
          </div>
          {interval === 'year' ? (
            <p className="label-up mt-3 text-[11px] text-white/70">
              🎁 2 mois offerts vs le tarif mensuel
            </p>
          ) : (
            <button
              onClick={() =>
                navigate(`/premium/checkout/${tier}?interval=year`, {
                  replace: true,
                })
              }
              className={`tappable mt-3 text-[12px] font-extrabold tracking-wide underline-offset-2 hover:underline ${
                isVip ? 'text-[#ffd700]/85' : 'text-accent/90'
              }`}
            >
              ou {isVip ? '249,99 €' : '79,99 €'} / an — économise 2 mois
            </button>
          )}

          {/* 7-day trial pitch (Premium only) */}
          {!isVip && (
            <p className="mt-4 max-w-[28ch] text-center text-[12px] leading-relaxed text-white/70">
              ✨ Tu ne seras pas débité pendant{' '}
              <strong className="text-white">7 jours</strong>.
              <br />
              Annule à tout moment avant la fin de l'essai.
            </p>
          )}
        </div>
      </header>

      {/* ─────────────── PERKS LIST ─────────────── */}
      <main className="space-y-3 px-5 pb-8 pt-7">
        {perks.map((p, i) => (
          <article
            key={`${p.title}-${i}`}
            className="flex gap-4 rounded-3xl bg-card p-4"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <span
              className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl text-xl"
              style={{
                background: isVip
                  ? 'rgba(212,175,55,0.16)'
                  : 'rgba(232,32,58,0.16)',
                border: isVip
                  ? '1px solid rgba(212,175,55,0.30)'
                  : '1px solid rgba(232,32,58,0.30)',
              }}
              aria-hidden
            >
              {p.icon}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-[15px] font-extrabold leading-tight tracking-tighter text-fg">
                {p.title}
              </h3>
              <p className="mt-1 text-[13px] leading-relaxed text-fg2">
                {p.body}
              </p>
            </div>
          </article>
        ))}

        {error && (
          <p
            className="rounded-2xl px-4 py-3 text-sm text-accent"
            style={{
              background: 'rgba(232,32,58,0.10)',
              border: '1px solid rgba(232,32,58,0.40)',
            }}
          >
            {error}
          </p>
        )}

        {/* CTA */}
        <div className="pt-3">
          <button
            onClick={payNow}
            disabled={busy}
            className={`tappable w-full rounded-full py-4 text-[15px] font-extrabold tracking-wider uppercase disabled:opacity-50 ${
              isVip
                ? 'relative overflow-hidden text-black'
                : 'bg-accent text-fg'
            }`}
            style={
              isVip
                ? {
                    background:
                      'linear-gradient(120deg, #d4af37 0%, #ffd700 45%, #b8860b 100%)',
                    boxShadow: '0 12px 36px rgba(212,175,55,0.45)',
                  }
                : { boxShadow: '0 12px 36px rgba(232,32,58,0.45)' }
            }
          >
            <span className="relative z-10">
              {busy
                ? 'Redirection…'
                : isVip
                  ? 'REJOINDRE LE CERCLE VIP'
                  : 'CONTINUER VERS LE PAIEMENT'}
            </span>
          </button>
          <button
            onClick={() => navigate(-1)}
            className="tappable mt-2 block w-full py-2.5 text-center text-xs text-fg2 hover:text-fg"
          >
            Annuler
          </button>
          <p className="label-up mt-4 text-center text-[10px] text-fg2/70">
            Paiement sécurisé Stripe · Résiliation libre à tout moment
          </p>
        </div>
      </main>
    </div>
  )
}
