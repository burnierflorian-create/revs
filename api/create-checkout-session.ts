import Stripe from 'stripe'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const PLANS: Record<string, { name: string; amount: number }> = {
  premium: { name: 'REVS Premium', amount: 800 },
  vip: { name: 'REVS VIP', amount: 2500 },
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function setCors(res: VercelResponse) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    setCors(res)
    res.status(204).end()
    return
  }
  setCors(res)

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    res.status(500).json({ error: 'Stripe not configured' })
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
    res.status(400).json({ error: 'Invalid plan or missing user' })
    return
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const origin =
    req.headers.origin ||
    (req.headers.host ? `https://${req.headers.host}` : '')

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: selected.amount,
            recurring: { interval: 'month' },
            product_data: { name: selected.name },
          },
        },
      ],
      customer_email: email,
      client_reference_id: userId,
      metadata: { user_id: userId, plan },
      subscription_data: { metadata: { user_id: userId, plan } },
      success_url: `${origin}/premium?status=success`,
      cancel_url: `${origin}/premium?status=cancel`,
    })

    res.status(200).json({ url: session.url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe error'
    res.status(500).json({ error: message })
  }
}
