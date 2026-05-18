import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Plan = {
  id: 'starter' | 'premium' | 'vip'
  name: string
  price: string
  perks: string[]
  popular?: boolean
}

const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '3€',
    perks: ['Spots illimités', 'Badge Supporter exclusif'],
  },
  {
    id: 'premium',
    name: 'Premium',
    price: '8€',
    popular: true,
    perks: [
      'Spots illimités',
      'Reconnaissance IA prioritaire',
      'Badge Premium',
      'Sans publicité',
    ],
  },
  {
    id: 'vip',
    name: 'VIP',
    price: '25€',
    perks: [
      'Tous les avantages Premium',
      'Accès anticipé aux événements',
      'Statistiques avancées',
      'Support prioritaire',
      'Badge VIP 👑',
    ],
  },
]

export default function Premium() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const status = params.get('status')

  useEffect(() => {
    if (status) {
      const t = setTimeout(() => navigate('/premium', { replace: true }), 4000)
      return () => clearTimeout(t)
    }
  }, [status, navigate])

  async function subscribe(plan: Plan['id']) {
    setError(null)
    setBusy(plan)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Non authentifié')

      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, userId: user.id, email: user.email }),
      })
      const data = (await res.json()) as { url?: string; error?: string }
      if (data.url) {
        window.location.href = data.url
        return
      }
      throw new Error(data.error || 'Impossible de démarrer le paiement')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
      setBusy(null)
    }
  }

  return (
    <div className="min-h-screen bg-bg px-5 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="flex items-center gap-4 py-4">
        <button
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="text-fg/60 transition-colors hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="text-2xl font-bold">Passe au niveau supérieur</h1>
      </div>

      {status === 'success' && (
        <div className="mb-4 rounded-xl bg-accent/15 px-4 py-3 text-sm">
          Abonnement activé 🔥 Merci !
        </div>
      )}
      {status === 'cancel' && (
        <div className="mb-4 rounded-xl bg-card px-4 py-3 text-sm text-fg/60">
          Paiement annulé — aucun montant n'a été débité.
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-xl bg-accent/15 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 pb-8">
        {PLANS.map((plan) => (
          <section
            key={plan.id}
            className={`relative flex flex-col rounded-2xl bg-card p-3 ${
              plan.popular
                ? 'ring-2 ring-accent'
                : 'ring-1 ring-white/5'
            }`}
          >
            {plan.popular && (
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-accent px-2.5 py-0.5 text-[9px] font-bold tracking-wide text-fg">
                POPULAIRE
              </span>
            )}
            <h2 className="mt-1 text-center text-base font-bold">
              {plan.name}
            </h2>
            <div className="mt-1 text-center">
              <span className="font-display text-2xl font-bold">
                {plan.price}
              </span>
              <span className="block text-[10px] text-fg/40">/ mois</span>
            </div>

            <ul className="mt-3 flex-1 space-y-1.5">
              {plan.perks.map((perk) => (
                <li
                  key={perk}
                  className="flex items-start gap-1 text-[11px] leading-tight text-fg/75"
                >
                  <Check className="mt-0.5 h-3 w-3 flex-none text-accent" />
                  {perk}
                </li>
              ))}
            </ul>

            <button
              onClick={() => subscribe(plan.id)}
              disabled={busy !== null}
              className={`mt-3 w-full rounded-full py-2.5 text-xs font-semibold disabled:opacity-50 ${
                plan.popular
                  ? 'bg-accent text-fg'
                  : 'bg-white/10 text-fg hover:bg-white/15'
              }`}
            >
              {busy === plan.id ? '…' : 'Choisir'}
            </button>
          </section>
        ))}
      </div>
    </div>
  )
}
