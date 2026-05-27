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
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    console.error('[webhook] supabase env missing — skipping upsert')
    return
  }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  })
  const { error } = await admin.from('subscriptions').upsert(
    { ...row, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )
  if (error) {
    console.error('[webhook] subscription upsert failed:', {
      user_id: row.user_id,
      plan: row.plan,
      status: row.status,
      message: error.message,
      code: error.code,
    })
  } else {
    console.log('[webhook] subscription synced:', {
      user_id: row.user_id,
      plan: row.plan,
      status: row.status,
    })
  }
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

// Stripe moved `subscription` off Invoice into `parent.subscription_details`.
function invoiceSubId(inv: Stripe.Invoice): string | null {
  const s = inv.parent?.subscription_details?.subscription
  if (!s) return null
  return typeof s === 'string' ? s : s.id
}

// Pull the user_id + plan from a subscription's metadata. They are
// written there by /api/create-checkout-session at checkout time.
function metaFrom(sub: Stripe.Subscription): {
  user_id: string | null
  plan: string | null
} {
  return {
    user_id: (sub.metadata?.user_id as string) ?? null,
    plan: (sub.metadata?.plan as string) ?? null,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).end()
    return
  }
  const secret = process.env.STRIPE_SECRET_KEY
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || !whSecret) {
    console.error('[webhook] missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET')
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
    console.error('[webhook] signature verification failed:', message)
    res.status(400).json({ error: message })
    return
  }

  console.log('[webhook] received:', event.type, '·', event.id)

  try {
    switch (event.type) {
      // First-touch sync the moment Stripe Checkout completes — fires
      // BEFORE customer.subscription.created in most flows, so it's
      // important we don't skip it.
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
        } else {
          console.warn('[webhook] checkout.session.completed missing ids:', {
            userId,
            subscription: session.subscription,
          })
        }
        break
      }

      // Subscription lifecycle — created/updated/deleted all funnel
      // through the same upsert. `deleted` forces status="canceled".
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object
        const { user_id, plan } = metaFrom(sub)
        if (user_id) {
          await upsertSubscription({
            user_id,
            stripe_customer_id: customerId(sub.customer),
            plan,
            status:
              event.type === 'customer.subscription.deleted'
                ? 'canceled'
                : sub.status,
            current_period_end: periodEndIso(sub),
          })
        } else {
          console.warn(
            '[webhook] subscription event without user_id metadata:',
            sub.id,
          )
        }
        break
      }

      // Renewal — Stripe fires this each successful charge of an
      // active sub. We refetch the subscription to capture the new
      // current_period_end and re-affirm status.
      case 'invoice.payment_succeeded': {
        const inv = event.data.object
        const subId = invoiceSubId(inv)
        if (!subId) break
        const sub = await stripe.subscriptions.retrieve(subId)
        const { user_id, plan } = metaFrom(sub)
        if (user_id) {
          await upsertSubscription({
            user_id,
            stripe_customer_id: customerId(sub.customer),
            plan,
            status: sub.status,
            current_period_end: periodEndIso(sub),
          })
        }
        break
      }

      // Renewal failure — leaves status in `past_due` / `unpaid`.
      // Surfaces immediately in the Profile card so the user can
      // update their card via the portal.
      case 'invoice.payment_failed': {
        const inv = event.data.object
        const subId = invoiceSubId(inv)
        if (!subId) break
        const sub = await stripe.subscriptions.retrieve(subId)
        const { user_id, plan } = metaFrom(sub)
        if (user_id) {
          await upsertSubscription({
            user_id,
            stripe_customer_id: customerId(sub.customer),
            plan,
            status: sub.status, // typically "past_due" or "unpaid"
            current_period_end: periodEndIso(sub),
          })
        }
        break
      }

      default:
        // Stripe sends many events we don't care about (charge.*,
        // payment_intent.*, etc.) — silent ignore keeps logs clean.
        break
    }
    res.status(200).json({ received: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook handler error'
    console.error('[webhook] handler crashed:', event.type, message)
    res.status(500).json({ error: message })
  }
}
