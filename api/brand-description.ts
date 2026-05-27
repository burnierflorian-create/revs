import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const MODEL = 'claude-sonnet-4-6'

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// Same shape as in src/lib/brands.ts — duplicated here because Vercel
// serverless functions can't import from the Vite client tree. Kept
// intentionally minimal (no logos / colors needed server-side).
const KNOWN: Record<string, { name: string; type: 'brand' | 'tuner' }> = {
  ferrari: { name: 'Ferrari', type: 'brand' },
  lamborghini: { name: 'Lamborghini', type: 'brand' },
  mclaren: { name: 'McLaren', type: 'brand' },
  bugatti: { name: 'Bugatti', type: 'brand' },
  pagani: { name: 'Pagani', type: 'brand' },
  koenigsegg: { name: 'Koenigsegg', type: 'brand' },
  rimac: { name: 'Rimac', type: 'brand' },
  'aston-martin': { name: 'Aston Martin', type: 'brand' },
  porsche: { name: 'Porsche', type: 'brand' },
  maserati: { name: 'Maserati', type: 'brand' },
  'alfa-romeo': { name: 'Alfa Romeo', type: 'brand' },
  lotus: { name: 'Lotus', type: 'brand' },
  'mercedes-benz': { name: 'Mercedes-Benz', type: 'brand' },
  bmw: { name: 'BMW', type: 'brand' },
  audi: { name: 'Audi', type: 'brand' },
  lexus: { name: 'Lexus', type: 'brand' },
  alpine: { name: 'Alpine', type: 'brand' },
  toyota: { name: 'Toyota', type: 'brand' },
  nissan: { name: 'Nissan', type: 'brand' },
  honda: { name: 'Honda', type: 'brand' },
  subaru: { name: 'Subaru', type: 'brand' },
  mazda: { name: 'Mazda', type: 'brand' },
  mitsubishi: { name: 'Mitsubishi', type: 'brand' },
  chevrolet: { name: 'Chevrolet', type: 'brand' },
  dodge: { name: 'Dodge', type: 'brand' },
  ford: { name: 'Ford', type: 'brand' },
  shelby: { name: 'Shelby', type: 'brand' },
  bentley: { name: 'Bentley', type: 'brand' },
  'rolls-royce': { name: 'Rolls-Royce', type: 'brand' },
  'range-rover': { name: 'Range Rover', type: 'brand' },
  brabus: { name: 'Brabus', type: 'tuner' },
  mansory: { name: 'Mansory', type: 'tuner' },
  ruf: { name: 'RUF', type: 'tuner' },
  abt: { name: 'ABT', type: 'tuner' },
  cupra: { name: 'Cupra', type: 'brand' },
  'hyundai-n': { name: 'Hyundai N', type: 'brand' },
}

const BRAND_SYSTEM = `Tu es un journaliste automobile francophone. Décris la marque automobile demandée en français, dans un ton enthousiaste mais factuel. Tu dois renvoyer EXACTEMENT 2 à 3 phrases (40 à 70 mots au total), en texte brut, sans markdown, sans titre, sans listes. Mentionne brièvement son histoire, son ADN (sport, luxe, hypercar…) et un ou deux modèles iconiques. Pas de superlatifs creux du type "la meilleure marque du monde".`

const TUNER_SYSTEM = `Tu es un journaliste automobile francophone. Décris ce PRÉPARATEUR automobile en français, dans un ton enthousiaste mais factuel. Tu dois renvoyer EXACTEMENT 2 à 3 phrases (50 à 80 mots au total), en texte brut, sans markdown, sans titre, sans listes. Explique CLAIREMENT : (1) qu'il s'agit d'un préparateur (pas d'un constructeur), (2) son histoire / ses origines, (3) quelles marques de voitures il transforme et ce qui caractérise son style (puissance extrême, esthétique chargée, fidélité au châssis d'origine, etc.).`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée.' })
    return
  }
  if (!SUPABASE_URL || !SERVICE_ROLE || !process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Service indisponible — réessaie plus tard.' })
    return
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  })

  // Require a valid Supabase user — the call hits the paid Claude API.
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const { data: u } = token
    ? await admin.auth.getUser(token)
    : { data: { user: null } }
  if (!u?.user) {
    res.status(401).json({ error: 'Non autorisé. Reconnecte-toi.' })
    return
  }

  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  const slug = String((body as { brand?: string }).brand ?? '').toLowerCase()
  const meta = KNOWN[slug]
  if (!slug || !meta) {
    res.status(400).json({ error: 'Marque inconnue.' })
    return
  }

  // Cache hit: return immediately, skip Claude entirely.
  const { data: cached } = await admin
    .from('brand_descriptions')
    .select('description')
    .eq('brand', slug)
    .maybeSingle()
  if (cached?.description) {
    res.status(200).json({ description: cached.description, cached: true })
    return
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const system = meta.type === 'tuner' ? TUNER_SYSTEM : BRAND_SYSTEM
  try {
    const r = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 350,
      system: [
        { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        {
          role: 'user',
          content:
            meta.type === 'tuner'
              ? `Préparateur : ${meta.name}.`
              : `Marque : ${meta.name}.`,
        },
      ],
    })
    const block = r.content.find((b) => b.type === 'text')
    const text = block && 'text' in block ? block.text.trim() : ''
    if (!text) {
      res.status(502).json({ error: 'Description indisponible — réessaie plus tard.' })
      return
    }
    await admin
      .from('brand_descriptions')
      .upsert({ brand: slug, description: text }, { onConflict: 'brand' })
    res.status(200).json({ description: text, cached: false })
  } catch (e) {
    console.error('[brand-description] failed:', e)
    res.status(500).json({ error: 'Description indisponible — réessaie plus tard.' })
  }
}
