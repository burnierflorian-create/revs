import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-4-6'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

// valid defaults to true so an infra/parse failure never hard-blocks the
// user — only an explicit model judgment (valid:false) rejects a photo.
const EMPTY = {
  brand: '',
  model: '',
  year: null,
  color: '',
  category: 'other',
  confidence: 0,
  alternatives: [],
  valid: true,
  reason: '',
}

const SYSTEM = `You are an expert automotive identifier. Given a single photo, identify the car and judge whether it is authentic.

Rules:
- "category" must be exactly one of: "supercar", "hypercar", "classic", "youngtimer", "JDM", "other".
- "confidence" is an integer 0-100 reflecting how sure you are of brand + model.
- "year" is the model year as an integer, or null if you cannot tell.
- "alternatives": at most 2 plausible other identifications, only if there is genuine doubt; otherwise an empty array.
- If the image does not clearly contain a car, or you cannot identify it, return empty strings, year null, category "other", confidence 0, and an empty alternatives array.
- "valid": true ONLY if this is a genuine photograph of a real car taken live in real-world conditions. Set "valid": false if the image is a photo of a screen/monitor/phone display, a printed photo, a magazine or poster, a 3D render or video-game capture, a scale model or toy car, or anything that is not a real car photographed on the spot.
- "reason": when "valid" is false, a short user-facing explanation IN FRENCH (e.g. "Photo d'un écran détectée", "Ceci ressemble à une miniature", "Image imprimée détectée"). Empty string when "valid" is true.`

const SCHEMA = {
  type: 'object',
  properties: {
    brand: { type: 'string' },
    model: { type: 'string' },
    year: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    color: { type: 'string' },
    category: {
      type: 'string',
      enum: ['supercar', 'hypercar', 'classic', 'youngtimer', 'JDM', 'other'],
    },
    confidence: { type: 'integer' },
    alternatives: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          brand: { type: 'string' },
          model: { type: 'string' },
          year: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        },
        required: ['brand', 'model', 'year'],
        additionalProperties: false,
      },
    },
    valid: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: [
    'brand',
    'model',
    'year',
    'color',
    'category',
    'confidence',
    'alternatives',
    'valid',
    'reason',
  ],
  additionalProperties: false,
}

function sendJson(res, body, status = 200) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
  res.status(status).json(body)
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    return sendJson(res, EMPTY, 405)
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return sendJson(res, EMPTY, 500)
  }

  let imageBase64
  let mimeType
  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    imageBase64 = body.imageBase64
    mimeType = body.mimeType
  } catch {
    return sendJson(res, EMPTY, 400)
  }

  if (
    typeof imageBase64 !== 'string' ||
    !imageBase64 ||
    !ALLOWED_MIME.has(mimeType)
  ) {
    return sendJson(res, EMPTY, 400)
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
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
            { type: 'text', text: 'Identify this car.' },
          ],
        },
      ],
      output_config: {
        format: { type: 'json_schema', schema: SCHEMA },
        effort: 'low',
      },
    })

    if (response.stop_reason === 'refusal') {
      return sendJson(res, EMPTY)
    }

    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock) return sendJson(res, EMPTY)

    const parsed = JSON.parse(textBlock.text)
    return sendJson(res, { ...EMPTY, ...parsed })
  } catch {
    return sendJson(res, EMPTY)
  }
}
