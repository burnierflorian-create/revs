import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const MODEL = 'claude-sonnet-4-6'

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const FIELDS = [
  'name',
  'engine',
  'horsepower',
  'torque',
  'zero_to_100',
  'top_speed',
  'msrp_eur',
  'production',
  'history',
] as const
type Field = (typeof FIELDS)[number]
type CarInfo = Record<Field, string>

const SYSTEM = `Tu es un expert automobile. Pour la voiture demandée, recherche les specs exactes sur internet via l'outil web_search. Règles strictes :

- Tu DOIS utiliser l'outil web_search au moins une fois pour vérifier les données ; n'invente ni n'estime jamais une valeur.
- Si une donnée est introuvable ou incertaine, mets exactement la chaîne "N/A". Ne mets PAS d'approximation.
- Toutes les valeurs sont rédigées en français, unités lisibles ("ch", "Nm", "s", "km/h", "€").

Réponds UNIQUEMENT par un objet JSON valide, sans markdown, sans texte avant ou après, conforme exactement à ce schéma :
{
  "name": string,         // nom exact du modèle, ex: "Ferrari SF90 Stradale Spider"
  "engine": string,       // type, cylindrée, turbo/hybride si applicable
  "horsepower": string,   // ex: "1000 ch" ou "N/A"
  "torque": string,       // ex: "800 Nm" ou "N/A"
  "zero_to_100": string,  // ex: "2,5 s" ou "N/A"
  "top_speed": string,    // ex: "340 km/h" ou "N/A"
  "msrp_eur": string,     // prix neuf de lancement en euros, ex: "500 000 €" ou "N/A"
  "production": string,   // nombre d'exemplaires si édition limitée ("1248"), sinon "Série", "N/A" si inconnu
  "history": string       // 2 à 3 phrases en français sur l'histoire / le contexte du modèle
}

Aucun champ ne doit être omis. Pas de markdown, pas d'explication hors JSON.`

function extractJSON(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    /* try to extract the first {...} block */
  }
  const m = trimmed.match(/\{[\s\S]*\}/)
  if (m) {
    try {
      return JSON.parse(m[0])
    } catch {
      /* fall through */
    }
  }
  return null
}

function normalize(raw: unknown): CarInfo {
  const o = (raw ?? {}) as Record<string, unknown>
  const out = {} as CarInfo
  for (const k of FIELDS) {
    const v = o[k]
    out[k] =
      typeof v === 'string' && v.trim() ? v.trim() : 'N/A'
  }
  return out
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!SUPABASE_URL || !SERVICE_ROLE || !process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Not configured' })
    return
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  })

  // Require a valid Supabase user — the call hits the paid Claude API
  // and shouldn't be triggerable anonymously.
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const { data: u } = token
    ? await admin.auth.getUser(token)
    : { data: { user: null } }
  if (!u?.user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  const spotId = (body as { spot_id?: string }).spot_id
  if (!spotId) {
    res.status(400).json({ error: 'Missing spot_id' })
    return
  }

  const { data: spot } = await admin
    .from('spots')
    .select('id, brand, model, year, car_info')
    .eq('id', spotId)
    .maybeSingle()
  if (!spot) {
    res.status(404).json({ error: 'Spot not found' })
    return
  }
  // Cached: return as-is so the panel opens instantly on subsequent
  // expands across users.
  if (spot.car_info) {
    res.status(200).json({ car_info: spot.car_info, cached: true })
    return
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const yearPart = spot.year ? ` (${spot.year})` : ''
  const userMsg = `Voiture : ${spot.brand} ${spot.model}${yearPart}.`

  try {
    const r = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userMsg }],
      // Server-side web_search tool: Anthropic executes the search,
      // we don't run a tool loop. max_uses bounds the search cost.
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 5,
        },
      ] as unknown as Anthropic.Messages.ToolUnion[],
    })

    // Final text block carries the JSON; earlier blocks are tool calls
    // / tool results executed server-side.
    const textBlocks = r.content.filter(
      (b): b is Anthropic.Messages.TextBlock => b.type === 'text',
    )
    const last = textBlocks[textBlocks.length - 1]
    const parsed = last ? extractJSON(last.text) : null
    if (!parsed) {
      res
        .status(502)
        .json({ error: 'Could not parse Claude JSON', raw: last?.text ?? '' })
      return
    }
    const info = normalize(parsed)

    // Persist so subsequent opens skip Claude entirely.
    await admin.from('spots').update({ car_info: info }).eq('id', spotId)
    res.status(200).json({ car_info: info, cached: false })
  } catch (e) {
    const err = e as { message?: string }
    console.error('[car-info] failed:', err)
    res.status(500).json({ error: err?.message || String(e) })
  }
}
