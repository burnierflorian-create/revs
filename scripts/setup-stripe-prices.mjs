// Idempotent provisioning of the REVS subscription products + prices
// in Stripe. Run once per environment (test / live):
//
//   STRIPE_SECRET_KEY=sk_live_xxx node scripts/setup-stripe-prices.mjs
//
// Without the env var, falls back to the key found in .env.local. The
// script:
//  1. Finds or creates the "REVS Premium" and "REVS VIP" products,
//     identified by `metadata.tier` (so a re-run never duplicates).
//  2. Finds or creates one recurring price per (tier × interval),
//     identified by Stripe's `lookup_key` (also de-duped on re-run).
//  3. Prints 4 env lines ready to paste into .env.local AND Vercel.
//
// Re-running is safe: existing products/prices are reused, never
// touched. To change a price amount you must archive the old one and
// re-run with a new lookup_key — Stripe forbids in-place edits.

import Stripe from 'stripe'
import { readFileSync } from 'node:fs'

function readEnvFile() {
  try {
    return readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  } catch {
    return ''
  }
}
function pickEnv(name, valueRe) {
  if (process.env[name]) return process.env[name]
  const re = new RegExp(`${name}\\s*=\\s*['"]?(${valueRe})`)
  const m = readEnvFile().match(re)
  return m ? m[1] : null
}

const key = pickEnv('STRIPE_SECRET_KEY', 'sk_[A-Za-z0-9_]+')
if (!key) {
  console.error('No STRIPE_SECRET_KEY in env or .env.local.')
  process.exit(1)
}
const isLive = key.startsWith('sk_live_')
console.log(`Using ${isLive ? 'LIVE' : 'TEST'} Stripe key.`)

const stripe = new Stripe(key)

const TIERS = [
  {
    name: 'REVS Premium',
    tier: 'premium',
    prices: [
      { key: 'premium_monthly', amount: 799, interval: 'month' },
      { key: 'premium_yearly', amount: 7999, interval: 'year' },
    ],
  },
  {
    name: 'REVS VIP',
    tier: 'vip',
    prices: [
      { key: 'vip_monthly', amount: 2499, interval: 'month' },
      { key: 'vip_yearly', amount: 24999, interval: 'year' },
    ],
  },
]

async function findOrCreateProduct(t) {
  // Search by metadata.tier (paged).
  for await (const p of stripe.products.list({ active: true, limit: 100 })) {
    if (p.metadata?.tier === t.tier) {
      console.log(`  product ${t.name}: ${p.id} (existing)`)
      return p
    }
  }
  const created = await stripe.products.create({
    name: t.name,
    metadata: { tier: t.tier, app: 'revs' },
  })
  console.log(`  product ${t.name}: ${created.id} (created)`)
  return created
}

async function findOrCreatePrice(productId, p) {
  const list = await stripe.prices.list({ lookup_keys: [p.key], limit: 1 })
  if (list.data.length > 0) {
    const ex = list.data[0]
    // Surface a warning if the existing price doesn't match the
    // current spec — caller has to archive + re-run with a new key.
    if (ex.unit_amount !== p.amount || ex.recurring?.interval !== p.interval) {
      console.warn(
        `  price ${p.key}: ${ex.id} (existing, MISMATCH — currently ${
          ex.unit_amount
        }¢ / ${ex.recurring?.interval}, wanted ${p.amount}¢ / ${p.interval})`,
      )
    } else {
      console.log(`  price ${p.key}: ${ex.id} (existing)`)
    }
    return ex
  }
  const created = await stripe.prices.create({
    product: productId,
    currency: 'eur',
    unit_amount: p.amount,
    recurring: { interval: p.interval },
    lookup_key: p.key,
    metadata: { tier: p.key.split('_')[0], interval: p.interval },
  })
  console.log(`  price ${p.key}: ${created.id} (created)`)
  return created
}

const envLines = []
for (const t of TIERS) {
  console.log(`\n${t.name}`)
  const product = await findOrCreateProduct(t)
  for (const p of t.prices) {
    const price = await findOrCreatePrice(product.id, p)
    envLines.push(`STRIPE_PRICE_${p.key.toUpperCase()}=${price.id}`)
  }
}

console.log('\n──────────── ENV VARS ────────────')
console.log('Add these to .env.local AND your Vercel project env vars:\n')
console.log(envLines.join('\n'))
console.log('\nFor Vercel:')
console.log('  for line in (above); do echo "$value" | vercel env add NAME production; done')
