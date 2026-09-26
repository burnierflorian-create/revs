import Anthropic from '@anthropic-ai/sdk'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAiAccess, AI_ENDPOINTS } from '../server/ai-gate.js'
import { checkRequestSize } from '../server/request-size.js'

// Vision model — plate localisation is a coarse rectangle estimate, not
// full reasoning. Keeps latency low (we run this in the upload hot path,
// before the user taps Publish).
//
// 26/09/2026 — bascule Haiku en premier passage. Localiser un rectangle est
// une tâche géométrique, pas du raisonnement : sur Sonnet elle coûtait
// ~0,0041 $, soit 44 % du coût total d'une capture — autant que
// l'identification complète de la voiture, qui tourne déjà sur Haiku.
// Sonnet reste en second passage si Haiku ne rend pas de JSON exploitable,
// sur le même principe d'escalade que identify-car.
const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
const SONNET_MODEL = 'claude-sonnet-4-6'

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
  // Authorization ajouté : l'endpoint exige désormais un jeton Bearer, et sans
  // cet en-tête le préflight d'un appel cross-origin échouerait.
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
  model: string,
): Promise<string> {
  const r = await client.messages.create({
    model,
    max_tokens: 600,
    // Pas de cache_control : ce prompt fait ~349 jetons, sous le minimum de
    // ~1024 requis pour qu'un préfixe soit réellement mis en cache. Le
    // marqueur était donc inerte.
    system: [{ type: 'text', text: system }],
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

  // Portail d'accès AVANT tout le reste — y compris avant la lecture du corps,
  // pour qu'une image de 10 Mo envoyée sans jeton soit rejetée au plus tôt.
  // Cet endpoint n'avait AUCUN contrôle jusqu'au 25/09/2026 : ni jeton, ni
  // quota, ni rate-limit, pour un appel Claude vision à chaque requête.
  //
  // Note : il compte sur sa propre ligne de quota (clé `detect-plate`), pas sur
  // celle d'identify-car. NewSpot déclenche les deux EN PARALLÈLE pour une seule
  // capture — un compteur partagé diviserait le quota gratuit par deux et le
  // cooldown de 3 s ferait échouer systématiquement le second des deux appels.
  // Taille du corps avant même l'authentification : inutile de consulter la
  // base pour une requête qu'on va refuser de toute façon.
  const tooLarge = checkRequestSize(req)
  if (tooLarge) {
    sendJson(res, tooLarge.body, tooLarge.status)
    return
  }

  const access = await requireAiAccess(req, AI_ENDPOINTS.DETECT_PLATE)
  if (!access.ok) {
    sendJson(res, access.body, access.status)
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
  // Échelle en deux temps : Haiku avec le prompt complet, puis — seulement si
  // la réponse est inexploitable — Sonnet avec un prompt minimal. Le second
  // passage est rare, donc le coût moyen suit celui de Haiku. Tout ce qui
  // reste illisible retombe sur []. Journalisé pour auditer les cas vides
  // via les logs Vercel.
  const attempts: { prompt: string; model: string }[] = [
    { prompt: SYSTEM, model: HAIKU_MODEL },
    { prompt: SYSTEM_RETRY, model: SONNET_MODEL },
  ]
  for (const { prompt, model } of attempts) {
    try {
      const text = await callClaude(client, prompt, imageBase64, mimeType, model)
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
