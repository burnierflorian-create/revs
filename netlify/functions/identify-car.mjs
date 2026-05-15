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

const EMPTY = {
  brand: '',
  model: '',
  year: null,
  color: '',
  category: 'other',
  confidence: 0,
  alternatives: [],
}

const SYSTEM = `You are an expert automotive identifier. Given a single photo, identify the car.

Rules:
- "category" must be exactly one of: "supercar", "hypercar", "classic", "youngtimer", "JDM", "other".
- "confidence" is an integer 0-100 reflecting how sure you are of brand + model.
- "year" is the model year as an integer, or null if you cannot tell.
- "alternatives": at most 2 plausible other identifications, only if there is genuine doubt; otherwise an empty array.
- If the image does not clearly contain a car, or you cannot identify it, return empty strings, year null, category "other", confidence 0, and an empty alternatives array.`

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
  },
  required: [
    'brand',
    'model',
    'year',
    'color',
    'category',
    'confidence',
    'alternatives',
  ],
  additionalProperties: false,
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (req.method !== 'POST') {
    return json(EMPTY, 405)
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return json(EMPTY, 500)
  }

  let imageBase64
  let mimeType
  try {
    const body = await req.json()
    imageBase64 = body.imageBase64
    mimeType = body.mimeType
  } catch {
    return json(EMPTY, 400)
  }

  if (
    typeof imageBase64 !== 'string' ||
    !imageBase64 ||
    !ALLOWED_MIME.has(mimeType)
  ) {
    return json(EMPTY, 400)
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
      return json(EMPTY)
    }

    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock) return json(EMPTY)

    const parsed = JSON.parse(textBlock.text)
    return json({ ...EMPTY, ...parsed })
  } catch {
    return json(EMPTY)
  }
}
