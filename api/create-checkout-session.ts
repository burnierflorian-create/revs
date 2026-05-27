import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// Subscription tier catalogue. Each entry is wired to a pre-created
// Stripe price via `priceEnv`, OR (legacy fallback) builds an inline
// price via `price_data` when the env var is missing. Once the four
// STRIPE_PRICE_* env vars are set in Vercel + .env.local, the inline
// branch is never taken again.
const PLANS: Record<
  string,
  {
    name: string
    amount: number
    interval: 'month' | 'year'
    priceEnv: string
    // 7-day free trial only on Premium plans — VIP starts billing
    // immediately so we don't dilute the "cercle fermé" perception.
    trial?: boolean
  }
> = {
  premium_monthly: {
    name: 'REVS Premium',
    amount: 799,
    interval: 'month',
    priceEnv: 'STRIPE_PRICE_PREMIUM_MONTHLY',
    trial: true,
  },
  premium_yearly: {
    name: 'REVS Premium — annuel',
    amount: 7999,
    interval: 'year',
    priceEnv: 'STRIPE_PRICE_PREMIUM_YEARLY',
    trial: true,
  },
  vip_monthly: {
    name: 'REVS VIP',
    amount: 2499,
    interval: 'month',
    priceEnv: 'STRIPE_PRICE_VIP_MONTHLY',
  },
  vip_yearly: {
    name: 'REVS VIP — annuel',
    amount: 24999,
    interval: 'year',
    priceEnv: 'STRIPE_PRICE_VIP_YEARLY',
  },
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function setCors(res: VercelResponse) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
}

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// ─────────────────────── Portal mode ───────────────────────
// `?action=portal` opens a Stripe Customer Portal session for the
// signed-in user. Returns { url } so the caller redirects. Combined
// into this endpoint (instead of a separate file) to stay within the
// 12-function Hobby plan cap.
async function handlePortal(req: VercelRequest, res: VercelResponse) {
  if (!process.env.STRIPE_SECRET_KEY) {
    res.status(500).json({ error: 'Service indisponible.' })
    return
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    res.status(500).json({ error: 'Service indisponible.' })
    return
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  })
  const authH = req.headers.authorization || ''
  const token = authH.startsWith('Bearer ') ? authH.slice(7) : ''
  const { data: u } = token
    ? await admin.auth.getUser(token)
    : { data: { user: null } }
  if (!u?.user) {
    res.status(401).json({ error: 'Non autorisé. Reconnecte-toi.' })
    return
  }

  const { data: sub } = await admin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', u.user.id)
    .maybeSingle()
  const customerId = (sub as { stripe_customer_id?: string } | null)
    ?.stripe_customer_id
  if (!customerId) {
    res.status(400).json({ error: "Aucun abonnement actif à gérer." })
    return
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const origin =
    req.headers.origin ||
    (req.headers.host ? `https://${req.headers.host}` : '')
  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/profile`,
    })
    res.status(200).json({ url: portal.url })
  } catch (e) {
    console.error('[portal] stripe failed:', e)
    res.status(500).json({
      error:
        "Portail indisponible — vérifie que le Customer Portal est activé dans Stripe.",
    })
  }
}

// ─────────────────────── Checkout mode (default) ───────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    setCors(res)
    res.status(204).end()
    return
  }
  setCors(res)

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée.' })
    return
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    res.status(500).json({ error: 'Paiement indisponible — réessaie plus tard.' })
    return
  }

  if (req.query.action === 'portal') return handlePortal(req, res)

  // Public diagnostic — returns ONLY whether the configured Stripe
  // secret is test or live. The key itself is never exposed; we just
  // surface its prefix family so the dashboard can confirm without
  // hitting Vercel's "Sensitive" wall.
  if (req.query.action === 'mode') {
    const key = process.env.STRIPE_SECRET_KEY ?? ''
    const mode = key.startsWith('sk_live_')
      ? 'live'
      : key.startsWith('sk_test_')
        ? 'test'
        : 'unset'
    res.status(200).json({ mode })
    return
  }

  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  const { plan, userId, email } = body as {
    plan?: string
    userId?: string
    email?: string
  }

  const selected = plan ? PLANS[plan] : undefined
  if (!plan || !selected || !userId) {
    res.status(400).json({ error: 'Formule invalide ou utilisateur manquant.' })
    return
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const origin =
    req.headers.origin ||
    (req.headers.host ? `https://${req.headers.host}` : '')

  // Pre-created price wins when set. The inline price_data fallback
  // keeps checkout working before the env vars are provisioned.
  const priceId = process.env[selected.priceEnv]
  type LineItem = NonNullable<
    Stripe.Checkout.SessionCreateParams['line_items']
  >[number]
  const lineItem: LineItem = priceId
    ? { quantity: 1, price: priceId }
    : {
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: selected.amount,
          recurring: { interval: selected.interval },
          product_data: { name: selected.name },
        },
      }
  if (!priceId) {
    console.warn(
      `[checkout] using inline price_data for ${plan} — set ${selected.priceEnv} to migrate to a pre-created Stripe price.`,
    )
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [lineItem],
      customer_email: email,
      client_reference_id: userId,
      metadata: { user_id: userId, plan, interval: selected.interval },
      subscription_data: {
        metadata: { user_id: userId, plan, interval: selected.interval },
        // Trial fires only on Premium plans (per business spec). The
        // card is collected up-front; auto-charge kicks in after 7 d.
        ...(selected.trial ? { trial_period_days: 7 } : {}),
      },
      // Land on the home tab so the celebration overlay rises over
      // the user's own app rather than the Premium pricing page.
      // `tier` is passed through so the overlay can pick the right
      // palette + perk list without polling Supabase (the webhook
      // may not have committed yet when the redirect lands).
      success_url: `${origin}/?status=success&tier=${plan.startsWith('vip') ? 'vip' : 'premium'}`,
      cancel_url: `${origin}/premium?status=cancel`,
    })

    res.status(200).json({ url: session.url })
  } catch (err) {
    console.error('[checkout] stripe failed:', err)
    res.status(500).json({ error: 'Impossible de démarrer le paiement — réessaie plus tard.' })
  }
}
