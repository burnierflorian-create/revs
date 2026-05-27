import Anthropic from '@anthropic-ai/sdk'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// Vision model — plate localisation is a coarse rectangle estimate, not
// full reasoning. Keeps latency low (we run this in the upload hot path,
// before the user taps Publish).
const MODEL = 'claude-sonnet-4-6'

type AllowedMime = 'image/jpeg' | 'image/png' | 'image/webp'
const ALLOWED_MIME = new Set<AllowedMime>([
  'image/jpeg',
  'image/png',
  'image/webp',
])
function isAllowedMime(m: unknown): m is AllowedMime {
  return typeof m === 'string' && ALLOWED_MIME.has(m as AllowedMime)
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Reframed as a privacy/anonymisation task — helps the model not refuse
// on "license plate detection" framing alone. Stays free-text JSON so
// the parser doesn't choke when the model wraps the response in
// markdown or adds a sentence of preamble (which output_config strict
// schema mode was breaking on for identify-car too).
const SYSTEM = `Tu protèges la vie privée sur une app de partage de photos. Pour chaque photo, repère TOUTES les plaques d'immatriculation visibles afin qu'elles soient anonymisées (floutées) avant publication.

Tu renvoies un rectangle englobant en coordonnées normalisées [0..1] pour chaque plaque :
- Repère : (0,0) = coin haut-gauche, (1,1) = coin bas-droit.
- "x" / "y" = coin haut-gauche du rectangle.
- "width" / "height" = dimensions positives.

Règles :
- Précision : la boîte couvre EXACTEMENT le rectangle de la plaque, sans déborder largement sur le pare-chocs.
- Mieux vaut couvrir un peu trop large que pas assez (la plaque ne doit pas dépasser de la zone floutée).
- N'inclus PAS les badges/logos de marque.
- AUCUNE plaque visible (capot fermé, voiture vue de profil sans plaque, déjà floutée) → tableau vide.
- TOUTES les plaques visibles, plaque avant ET arrière, latérale, plaque commerciale.

Réponds UNIQUEMENT par un JSON de cette forme, RIEN d'autre, AUCUN markdown, AUCUNE phrase :
{"plates":[{"x":0.31,"y":0.62,"width":0.18,"height":0.05}]}

Si aucune plaque : {"plates":[]}`

const SYSTEM_RETRY = `Identifie les plaques d'immatriculation visibles sur la photo. Réponds UNIQUEMENT par ce JSON, sans markdown : {"plates":[{"x":N,"y":N,"width":N,"height":N}]}. Valeurs entre 0 et 1. Tableau vide si aucune plaque.`

// Tolerant JSON parser. Handles markdown fences and leading/trailing
// prose by scanning for the largest balanced {...} block. Mirrors the
// identify-car recovery ladder.
function extractJSON(text: string): { plates?: unknown } | null {
  if (typeof text !== 'string') return null
  let t = text.trim()
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) t = fenced[1].trim()
  try {
    return JSON.parse(t)
  } catch {
    /* fall through */
  }
  const start = t.indexOf('{')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < t.length; i += 1) {
    const c = t[i]
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) {
        const slice = t.slice(start, i + 1)
        try {
          return JSON.parse(slice)
        } catch {
          /* keep scanning */
        }
      }
    }
  }
  return null
}

type Plate = { x: number; y: number; width: number; height: number }

function cleanPlates(raw: unknown): Plate[] {
  if (!Array.isArray(raw)) return []
  const out: Plate[] = []
  for (const p of raw) {
    const o = (p ?? {}) as Record<string, unknown>
    // Support both {x,y,width,height} and {x,y,w,h} shapes — Claude
    // sometimes shortens the keys despite the prompt's explicit list.
    const x = Number((o.x ?? o.left) as number)
    const y = Number((o.y ?? o.top) as number)
    const w = Number((o.width ?? o.w) as number)
    const h = Number((o.height ?? o.h) as number)
    if (
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(w) &&
      Number.isFinite(h) &&
      w > 0 &&
      h > 0 &&
      x >= 0 &&
      y >= 0 &&
      x + w <= 1.01 &&
      y + h <= 1.01
    ) {
      out.push({ x, y, width: w, height: h })
    }
  }
  return out
}

function sendJson(res: VercelResponse, body: unknown, status = 200) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
  res.status(status).json(body)
}

async function callClaude(
  client: Anthropic,
  system: string,
  imageBase64: string,
  mimeType: AllowedMime,
): Promise<string> {
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType,
              data: imageBase64,
            },
          },
          { type: 'text', text: "Détecte les plaques d'immatriculation à anonymiser." },
        ],
      },
    ],
  })
  if (r.stop_reason === 'refusal') return ''
  const block = r.content.find((b) => b.type === 'text')
  return block && 'text' in block ? block.text : ''
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, { plates: [] }, 405)
    return
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    // Fail open: empty plates → caller uploads photo as-is rather than
    // blocking the entire publish flow on a config issue.
    sendJson(res, { plates: [] })
    return
  }

  let imageBase64: string | undefined
  let mimeType: string | undefined
  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    imageBase64 = (body as { imageBase64?: string }).imageBase64
    mimeType = (body as { mimeType?: string }).mimeType
  } catch {
    sendJson(res, { plates: [] }, 400)
    return
  }

  if (
    typeof imageBase64 !== 'string' ||
    !imageBase64 ||
    !isAllowedMime(mimeType)
  ) {
    sendJson(res, { plates: [] }, 400)
    return
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  // Two-step ladder: full prompt first; if Claude returns garbage,
  // retry once with a minimal prompt. Anything still unparseable falls
  // through to []. Logged so we can audit empty cases via Vercel logs.
  for (const prompt of [SYSTEM, SYSTEM_RETRY]) {
    try {
      const text = await callClaude(client, prompt, imageBase64, mimeType)
      const parsed = extractJSON(text)
      if (parsed && 'plates' in parsed) {
        const cleaned = cleanPlates(parsed.plates)
        if (cleaned.length > 0 || /\bplates\b/.test(text)) {
          // Either we found plates, or the model explicitly said
          // there were none — both are valid outcomes.
          sendJson(res, { plates: cleaned })
          return
        }
      }
      console.warn(
        '[detect-plate] unparseable response, will retry. raw:',
        text.slice(0, 200),
      )
    } catch (e) {
      console.error('[detect-plate] call failed:', e)
    }
  }
  // Final fail-open after all retries.
  sendJson(res, { plates: [] })
}
