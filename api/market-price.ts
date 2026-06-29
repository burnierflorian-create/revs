import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// On-demand market-price lookup for a spot whose estimated_price is
// missing/zero. Runs the cheap Haiku text model server-side (the key must
// never reach the browser), then persists the result with the service role
// (bypasses RLS, so it works for any spot — not just the viewer's own) so
// the next view is instant. Mirrors the price rule in api/identify-car.js.

const PRICE_MODEL = 'claude-haiku-4-5-20251001'
const MIN_PRICE = 1000
const MAX_PRICE = 10_000_000

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const PRICE_SYSTEM = `Tu donnes le prix du MARCHÉ actuel en euros — la cote réelle de revente aujourd'hui en France pour l'année indiquée, en bon état. PAS le prix neuf. Jamais le prix neuf si la voiture a plus de 2 ans. Références : Lamborghini Huracán 2020 = 195000, McLaren GT 2022 = 165000, Porsche 911 GT3 2021 = 175000, Ferrari 488 GTB 2019 = 165000. Réponds UNIQUEMENT par le nombre entier en euros, rien d'autre.`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'no_api_key' })
    return
  }

  let spotId: string | undefined
  let brand = ''
  let model = ''
  let year: number | null = null
  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    spotId = typeof body.spotId === 'string' ? body.spotId : undefined
    brand = String(body.brand ?? '').trim()
    model = String(body.model ?? '').trim()
    year =
      typeof body.year === 'number' && Number.isFinite(body.year)
        ? body.year
        : null
  } catch {
    res.status(400).json({ error: 'bad_request' })
    return
  }

  if (!brand && !model) {
    res.status(400).json({ error: 'missing_car' })
    return
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  let price: number | null = null
  try {
    const yearPart = year ? ` ${year}` : ''
    const r = await client.messages.create({
      model: PRICE_MODEL,
      max_tokens: 20,
      system: PRICE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Prix marché ${brand} ${model}${yearPart} en France, répondre uniquement avec le nombre entier en euros.`,
        },
      ],
    })
    const text = r.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
    const n = parseInt(String(text).replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(n) && n >= MIN_PRICE && n <= MAX_PRICE) price = n
  } catch (e) {
    console.error('[market-price] lookup failed:', (e as Error)?.message ?? e)
    res.status(502).json({ error: 'lookup_failed' })
    return
  }

  if (price == null) {
    res.status(200).json({ price: null })
    return
  }

  // Persist so the next view is instant. Best-effort — never blocks the
  // response (the price is already computed and useful even if the write
  // fails). Service role bypasses RLS so any spot can be updated.
  if (spotId && SUPABASE_URL && SERVICE_ROLE) {
    try {
      const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
        auth: { persistSession: false },
      })
      await supabase
        .from('spots')
        .update({ estimated_price: price })
        .eq('id', spotId)
    } catch (e) {
      console.error('[market-price] persist failed:', (e as Error)?.message ?? e)
    }
  }

  res.status(200).json({ price })
}
