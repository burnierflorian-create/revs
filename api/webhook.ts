import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// Stripe signature verification needs the raw, unparsed request body.
export const config = { api: { bodyParser: false } }

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

async function upsertSubscription(row: {
  user_id: string
  stripe_customer_id: string | null
  plan: string | null
  status: string
  current_period_end: string | null
}) {
  if (!SUPABASE_URL || !SERVICE_ROLE) return
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  })
  await admin
    .from('subscriptions')
    .upsert({ ...row, updated_at: new Date().toISOString() }, {
      onConflict: 'user_id',
    })
}

function customerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (!customer) return null
  return typeof customer === 'string' ? customer : customer.id
}

// Stripe moved current_period_end from the subscription to its items.
function periodEndIso(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0]
  return item ? new Date(item.current_period_end * 1000).toISOString() : null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).end()
    return
  }
  const secret = process.env.STRIPE_SECRET_KEY
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || !whSecret) {
    res.status(500).json({ error: 'Stripe webhook not configured' })
    return
  }

  const stripe = new Stripe(secret)
  const sig = req.headers['stripe-signature']
  let event: Stripe.Event
  try {
    const raw = await readRawBody(req)
    event = stripe.webhooks.constructEvent(raw, sig as string, whSecret)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid signature'
    res.status(400).json({ error: message })
    return
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const userId = session.client_reference_id
        const plan = session.metadata?.plan ?? null
        if (userId && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(
            session.subscription as string,
          )
          await upsertSubscription({
            user_id: userId,
            stripe_customer_id: customerId(session.customer),
            plan,
            status: sub.status,
            current_period_end: periodEndIso(sub),
          })
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object
        const userId = sub.metadata?.user_id
        if (userId) {
          await upsertSubscription({
            user_id: userId,
            stripe_customer_id: customerId(sub.customer),
            plan: sub.metadata?.plan ?? null,
            status:
              event.type === 'customer.subscription.deleted'
                ? 'canceled'
                : sub.status,
            current_period_end: periodEndIso(sub),
          })
        }
        break
      }
      default:
        break
    }
    res.status(200).json({ received: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook handler error'
    res.status(500).json({ error: message })
  }
}
