import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Plan = {
  id: 'premium' | 'vip'
  name: string
  price: string
  perks: string[]
  highlight?: boolean
}

const PLANS: Plan[] = [
  {
    id: 'premium',
    name: 'Premium',
    price: '8€',
    perks: [
      'Spots illimités',
      'Reconnaissance IA prioritaire',
      'Badge Premium sur ton profil',
      'Expérience sans publicité',
    ],
  },
  {
    id: 'vip',
    name: 'VIP',
    price: '25€',
    highlight: true,
    perks: [
      'Tous les avantages Premium',
      'Accès anticipé aux événements',
      'Statistiques avancées',
      'Support prioritaire',
      'Badge VIP exclusif 👑',
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

      <div className="space-y-4 pb-8">
        {PLANS.map((plan) => (
          <section
            key={plan.id}
            className={`rounded-2xl bg-card p-5 ${
              plan.highlight ? 'ring-1 ring-accent' : ''
            }`}
          >
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-bold">{plan.name}</h2>
              <div className="text-right">
                <span className="text-2xl font-bold">{plan.price}</span>
                <span className="text-sm text-fg/50"> / mois</span>
              </div>
            </div>

            <ul className="mt-4 space-y-2">
              {plan.perks.map((perk) => (
                <li
                  key={perk}
                  className="flex items-center gap-2 text-sm text-fg/80"
                >
                  <Check className="h-4 w-4 flex-none text-accent" />
                  {perk}
                </li>
              ))}
            </ul>

            <button
              onClick={() => subscribe(plan.id)}
              disabled={busy !== null}
              className="mt-5 w-full rounded-full bg-accent py-3 text-sm font-medium disabled:opacity-50"
            >
              {busy === plan.id ? '…' : `Choisir ${plan.name}`}
            </button>
          </section>
        ))}
      </div>
    </div>
  )
}
