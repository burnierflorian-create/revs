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

// `valid` defaults to true so an infra/parse failure never hard-blocks
// the publish flow. Brand and model never come back empty either —
// even worst-case we emit "Voiture" / "Modèle indéterminé" so the form
// auto-fills and the user just tweaks if needed.
const NEVER_EMPTY_BRAND = 'Voiture'
const NEVER_EMPTY_MODEL = 'Modèle indéterminé'

const BASE = {
  brand: '',
  model: '',
  year: null,
  color: '',
  category: 'other',
  confidence: 0,
  alternatives: [],
  details_used: [],
  valid: true,
  reason: '',
  estimated_price: null,
  rarity: 'standard',
  production: null,
}

const FALLBACK = {
  ...BASE,
  brand: NEVER_EMPTY_BRAND,
  model: NEVER_EMPTY_MODEL,
  confidence: 20,
}

// ─────────────────────── Prompts ───────────────────────

const SYSTEM_FULL = `Tu es un expert mondial en identification automobile avec 20 ans d'expérience. Tu identifies TOUTES les voitures, même partiellement visibles, même de dos, même de côté, même la nuit. Tu ne réponds JAMAIS "indéterminé" ou "inconnue" — tu donnes toujours ta meilleure estimation basée sur les indices visuels disponibles : forme de carrosserie, phares, feux, calandre, jantes, lignes de design, proportions, badges visibles.

Pour chaque photo, analyse dans cet ordre :
1. Silhouette générale (supercar, berline, SUV, coupé...)
2. Indices de marque (forme des phares, calandre, badge)
3. Modèle exact (proportions, détails spécifiques)
4. Année approximative (génération du modèle)
5. Couleur principale

Pour les McLaren spécifiquement : porte papillon, nez pointu, prises d'air latérales, ligne de toit très basse, feux en boomerang.
Pour les Ferrari : avant proéminent, grille centrale, ligne latérale tendue, logo cheval cabré.
Pour les Lamborghini : angles très marqués, portes en ciseaux sur certains modèles, design angulaire agressif.

Réponds TOUJOURS en JSON avec : car_brand, car_model, car_year, car_color, car_category (Supercar/Hypercar/Sportcar/SUV/Berline/Autre), confidence (0-100), estimated_price, rarity_reason. Si vraiment impossible à identifier : car_brand="Inconnu", car_model="Véhicule non identifiable" — jamais de champs vides.`

const SYSTEM_SIMPLE = `Tu es un expert automobile. Identifie la voiture sur la photo. Tu dois TOUJOURS répondre — au pire avec la marque seule + "Modèle indéterminé" + confidence: 20.

Réponds UNIQUEMENT par ce JSON, rien d'autre, pas de markdown :
{"brand":"Marque","model":"Modèle","year":2022,"color":"couleur","category":"supercar|hypercar|classic|youngtimer|JDM|other","confidence":80,"price_estimate":100000,"details_used":["…"],"valid":true,"reason":""}`

const SYSTEM_MINIMAL = `Identifie la voiture. Réponds UNIQUEMENT en JSON avec au minimum brand et model. Pas de markdown, pas de texte. Exemple : {"brand":"Ferrari","model":"488 GTB"}`

// ─────────────────────── Helpers ───────────────────────

/** Tolerant JSON extraction — handles markdown code fences, leading
 *  text, trailing prose, and balanced-brace recovery. Returns null if
 *  no parseable object is found. */
function extractJSON(text) {
  if (typeof text !== 'string') return null
  let t = text.trim()
  // Strip ```json ... ``` or ``` ... ``` fences if Claude wraps the JSON.
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) t = fenced[1].trim()
  // Direct parse first.
  try {
    return JSON.parse(t)
  } catch {
    /* fall through */
  }
  // Pull the largest balanced {...} block we can find.
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

const VALID_CATEGORIES = new Set([
  'supercar',
  'hypercar',
  'classic',
  'youngtimer',
  'JDM',
  'other',
])
const VALID_RARITY = new Set([
  'standard',
  'premium',
  'performance',
  'exclusif',
  'supercar',
  'hypercar',
])

function normalizeCategory(c) {
  if (typeof c !== 'string') return 'other'
  const v = c.trim()
  if (VALID_CATEGORIES.has(v)) return v
  const low = v.toLowerCase()
  if (low === 'jdm') return 'JDM'
  if (low === 'autre' || low === 'unknown' || low === 'inconnu') return 'other'
  // The 20-year-expert prompt emits capitalised, broader labels
  // ("Supercar", "Sportcar", "SUV", "Berline", "Coupé") — map them
  // back to the small enum the rest of the app speaks.
  if (low === 'supercar') return 'supercar'
  if (low === 'hypercar') return 'hypercar'
  if (
    low === 'sportcar' ||
    low === 'sportscar' ||
    low === 'sport' ||
    low === 'jdm sport'
  )
    return 'JDM'
  if (low === 'suv' || low === 'crossover' || low === 'berline' || low === 'sedan' || low === 'coupé' || low === 'coupe')
    return 'other'
  if (VALID_CATEGORIES.has(low)) return low
  return 'other'
}

/** "2020-2023" → 2020, "2022" → 2022, 2022 → 2022, else null. */
function normalizeYear(v) {
  if (typeof v === 'number' && Number.isFinite(v) && v > 1900 && v < 2100) {
    return Math.floor(v)
  }
  if (typeof v === 'string') {
    const m = v.match(/\b(19|20)\d{2}\b/)
    if (m) return parseInt(m[0], 10)
  }
  return null
}

function normalizeInt(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v)
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/[^0-9-]/g, ''), 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

function normalizeString(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function normalizeStringArray(v) {
  if (!Array.isArray(v)) return []
  return v
    .filter((x) => typeof x === 'string' && x.trim())
    .map((s) => s.trim())
    .slice(0, 8)
}

/** Final normalization: takes any object Claude produced and forces it
 *  to match the response contract. NEVER returns empty brand/model.
 *  Accepts BOTH the legacy keys (`brand`, `model`, `year`, …) and the
 *  20-year-expert prompt's `car_*` keys — whichever Claude emits, the
 *  shape returned to the client is always the legacy one. */
function finalize(raw) {
  const o = raw ?? {}
  // Field aliases — try the legacy name first, fall back to `car_*`.
  const brandRaw = normalizeString(o.brand ?? o.car_brand)
  const modelRaw = cleanModelName(normalizeString(o.model ?? o.car_model))
  // "Inconnu" / "Véhicule non identifiable" from the prompt's fallback
  // path collapse into the same NEVER_EMPTY pair we used before, so
  // downstream code (form pre-fill, rarity rules, etc.) never has to
  // worry about a new sentinel.
  const isUnknownBrand = /^inconnu(e)?$/i.test(brandRaw)
  const isUnknownModel = /^v[ée]hicule non identifiable$/i.test(modelRaw)
  const brand = !brandRaw || isUnknownBrand ? NEVER_EMPTY_BRAND : brandRaw
  const model =
    !modelRaw || isUnknownModel ? NEVER_EMPTY_MODEL : modelRaw
  const confidence = (() => {
    const n = normalizeInt(o.confidence)
    if (n === null) return brandRaw && modelRaw ? 60 : 20
    return Math.min(100, Math.max(0, n))
  })()
  // The new prompt no longer demands a `valid` boolean; default to true
  // (matches BASE) so the publish flow never blocks on missing fields.
  const valid = typeof o.valid === 'boolean' ? o.valid : true
  return {
    brand,
    model,
    year: normalizeYear(o.year ?? o.car_year),
    color: normalizeString(o.color ?? o.car_color),
    category: normalizeCategory(o.category ?? o.car_category),
    confidence,
    alternatives: Array.isArray(o.alternatives)
      ? o.alternatives
          .filter((a) => a && typeof a === 'object')
          .map((a) => ({
            brand: normalizeString(a.brand),
            model: normalizeString(a.model),
            year: normalizeYear(a.year),
          }))
          .filter((a) => a.brand || a.model)
          .slice(0, 2)
      : [],
    details_used: normalizeStringArray(o.details_used),
    valid,
    reason: normalizeString(o.reason ?? o.rarity_reason),
    estimated_price:
      valid !== false
        ? normalizeInt(o.price_estimate ?? o.estimated_price)
        : null,
    rarity: VALID_RARITY.has(o.rarity) ? o.rarity : 'standard',
    production: (() => {
      const v = o.production
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v)
      if (typeof v === 'string') {
        const n = parseInt(v.replace(/[^0-9]/g, ''), 10)
        if (Number.isFinite(n) && n > 0) return n
      }
      return null
    })(),
  }
}

/** Last-ditch effort: regex-extract a brand and model from raw prose.
 *  Used only when all 3 retries returned non-JSON text. */
function rescueFromProse(text) {
  if (typeof text !== 'string') return null
  // Look for "Brand : X" / "Brand: X" / "Marque : X" patterns.
  const brandRe = /(?:brand|marque)\s*[:=]\s*["“]?([A-Z][A-Za-zÀ-ÿ' -]{1,30})/i
  const modelRe = /(?:model|modèle|modele)\s*[:=]\s*["“]?([A-Za-z0-9À-ÿ' -]{1,40})/i
  const yearRe = /\b(19|20)\d{2}\b/
  const b = brandRe.exec(text)
  const m = modelRe.exec(text)
  const y = yearRe.exec(text)
  if (!b && !m) return null
  return {
    brand: b ? b[1].trim() : '',
    model: m ? m[1].trim() : '',
    year: y ? parseInt(y[0], 10) : null,
    confidence: 25,
  }
}

// Strips any "(stuff)" trailer or in-string parenthetical from a model
// name. Safety net in case Claude ignores the no-parens rule in the
// prompt — we don't want chassis codes leaking to the UI.
function cleanModelName(s) {
  if (typeof s !== 'string') return s
  return s.replace(/\s*\([^)]*\)/g, '').trim()
}

// Second-stage call: web-grounded lookup of the new EU price for a
// (brand, model, year) triplet. Forces Claude to consult 2-3 distinct
// sources and return them as JSON ; we then take the median, which is
// robust against one source being inflated (configurator with packs,
// fully-optioned listing, DE pricing scraped from a comparison site,
// etc.). Returns an integer (€) or null. Best-effort — failures fall
// back to the model's initial estimate.
async function refinePriceFromWeb(client, brand, model, year) {
  if (!brand || !model) return null
  const yearPart = year ? ` ${year}` : ''
  const userMsg =
    `Recherche le prix CATALOGUE NEUF de base (version standard sans option ni pack, ` +
    `marché français ou européen) de la ${brand} ${model}${yearPart}.\n\n` +
    `Consulte 2 ou 3 sources distinctes (constructeur officiel comme porsche.fr / ` +
    `ferrari.com / mercedes-benz.fr, presse spécialisée comme caradisiac.com / largus.fr / ` +
    `motor1.com, ou comparateurs sérieux). Refuse les pages avec une voiture déjà optionnée.\n\n` +
    `Réponds UNIQUEMENT par ce JSON, sans markdown :\n` +
    `{"prices":[{"source":"caradisiac.com","price_eur":170000},{"source":"porsche.fr","price_eur":168000},{"source":"largus.fr","price_eur":175000}]}\n\n` +
    `Règles :\n` +
    `- Chaque "price_eur" est un entier en EUROS TTC, version de BASE catalogue France.\n` +
    `- Au moins 2 sources distinctes si possible.\n` +
    `- Si une source ne donne que le prix avec options, soustrais les options listées.\n` +
    `- Si vraiment aucune source fiable n'est trouvée, renvoie {"prices":[]}.\n` +
    `- Aucun texte avant ou après le JSON.`
  try {
    const r = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: userMsg }],
      tools: [
        { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
      ],
    })
    const text = r.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
    const parsed = extractJSON(text)
    const rows = Array.isArray(parsed?.prices) ? parsed.prices : []
    const prices = rows
      .map((row) => {
        const n =
          typeof row?.price_eur === 'number'
            ? Math.floor(row.price_eur)
            : parseInt(
                String(row?.price_eur ?? '').replace(/[^0-9]/g, ''),
                10,
              )
        return Number.isFinite(n) && n > 0 && n < 5_000_000_000 ? n : null
      })
      .filter((n) => n !== null)
      .sort((a, b) => a - b)
    if (prices.length === 0) return null
    // Median: middle element for odd count, average of two middles for
    // even. Rounded down so the eventual XP threshold stays predictable.
    const mid = Math.floor(prices.length / 2)
    const median =
      prices.length % 2 === 1
        ? prices[mid]
        : Math.floor((prices[mid - 1] + prices[mid]) / 2)
    return median
  } catch (e) {
    console.error('[identify-car] price refine failed:', e?.message ?? e)
    return null
  }
}

// Third-stage call: web-grounded rarity lookup. Returns
// { production: int|null, rarity: <6-tier value> } — defaults to
// 'standard' when the answer is missing or unparseable, which is the
// conservative XP-floor choice. The 6-tier scale (standard → hypercar)
// landed in migration 0040; the prompt mixes positioning and
// production cues since strict count thresholds alone can't tell a
// 1000-unit JDM youngtimer apart from a 1000-unit hypercar.

async function refineRarityFromWeb(client, brand, model, year) {
  if (!brand || !model) return { production: null, rarity: 'standard' }
  const yearPart = year ? ` ${year}` : ''
  const userMsg =
    `Recherche combien d'exemplaires de la ${brand} ${model}${yearPart} ont été ` +
    `produits au total. Cherche sur les sites officiels du constructeur, ` +
    `Wikipedia, presse auto. Si la production est encore en cours, donne le total ` +
    `cumulé connu (sinon une estimation crédible).\n\n` +
    `Réponds UNIQUEMENT par ce JSON, sans markdown :\n` +
    `{"production": 499, "rarity": "supercar"}\n\n` +
    `Échelle de rareté à 6 niveaux (positionnement segment + volume) :\n` +
    `- "standard" : voiture de tous les jours, segment de masse (ex: Nissan Juke, ` +
    `Renault Clio, VW Golf de base). Volume élevé.\n` +
    `- "premium" : modèle haut de gamme quotidien, finition supérieure (ex: ` +
    `Mercedes CLA AMG Line, BMW Série 2, Audi A3). Volume élevé mais positionnement ` +
    `premium.\n` +
    `- "performance" : sportive pure, dérivée de la même plateforme qu'un modèle ` +
    `civil (ex: Audi TT RS, BMW M2, Porsche 718 Cayman). Sportivité = ADN.\n` +
    `- "exclusif" : SUV de sport ou grosse berline de performance à très ` +
    `forte présence (ex: Mercedes-AMG GLE 63 S Coupé, Porsche Cayenne Coupé, ` +
    `BMW X5 M, Audi RS Q8, Bentley Bentayga, Maserati Levante Trofeo). ` +
    `Carrosserie SUV/grande berline + moteur de sport + 4 places utilisables.\n` +
    `- "supercar" : voiture de sport exotique à moteur central ou flagship ` +
    `d'une marque spécialiste, exclusivité radicale (ex: McLaren 570S Spider, ` +
    `Audi R8 V10, Porsche 911 GT3 RS, Ferrari 488, Lamborghini Huracán). ` +
    `Biplace ou 2+2, layout typiquement moteur central / propulsion, ` +
    `moins de 5 000 / an.\n` +
    `- "hypercar" : sommet absolu — top-flagship moteur central, série très limitée ` +
    `ou édition one-off (ex: Mercedes-AMG GT 63 S E Performance flagship, Bugatti ` +
    `Chiron, Pagani Huayra, Koenigsegg, McLaren P1). Souvent < 500 exemplaires.\n\n` +
    `Si la production exacte est inconnue, mets production: null mais TOUJOURS un rarity ` +
    `cohérent avec le positionnement du modèle. En cas de doute, descends d'un cran ` +
    `(une supercar douteuse = "performance", pas "supercar"). Aucun texte avant ou ` +
    `après le JSON.`
  try {
    const r = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: userMsg }],
      tools: [
        { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
      ],
    })
    const text = r.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
    const parsed = extractJSON(text)
    const rarity = VALID_RARITY.has(parsed?.rarity) ? parsed.rarity : 'standard'
    const production = (() => {
      const v = parsed?.production
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v)
      if (typeof v === 'string') {
        const n = parseInt(v.replace(/[^0-9]/g, ''), 10)
        if (Number.isFinite(n) && n > 0) return n
      }
      return null
    })()
    return { production, rarity }
  } catch (e) {
    console.error('[identify-car] rarity refine failed:', e?.message ?? e)
    return { production: null, rarity: 'standard' }
  }
}

async function callClaude(client, mimeType, imageBase64, system, maxTokens) {
  return client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
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
          {
            type: 'text',
            text: "Identifie cette voiture. Renvoie uniquement le JSON, rien d'autre.",
          },
        ],
      },
    ],
  })
}

function lastText(response) {
  if (!response?.content) return ''
  const blocks = response.content.filter((b) => b.type === 'text')
  return blocks.length ? blocks[blocks.length - 1].text : ''
}

function sendJson(res, body, status = 200) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
  res.status(status).json(body)
}

// ─────────────────────── Handler ───────────────────────

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    return sendJson(res, FALLBACK, 405)
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return sendJson(res, FALLBACK, 500)
  }

  let imageBase64
  let mimeType
  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    imageBase64 = body.imageBase64
    mimeType = body.mimeType
  } catch {
    return sendJson(res, FALLBACK, 400)
  }

  if (
    typeof imageBase64 !== 'string' ||
    !imageBase64 ||
    !ALLOWED_MIME.has(mimeType)
  ) {
    return sendJson(res, FALLBACK, 400)
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // Three escalating attempts: full prompt → simple prompt → minimal
  // prompt. Each attempt keeps the same image. We stop at the first one
  // whose response yields a parseable JSON with at least a brand or
  // model — anything else, including refusals, falls through to the
  // next try.
  const attempts = [
    { system: SYSTEM_FULL,    max: 1500 },
    { system: SYSTEM_SIMPLE,  max: 600 },
    { system: SYSTEM_MINIMAL, max: 250 },
  ]
  let lastRawText = ''
  for (let i = 0; i < attempts.length; i += 1) {
    try {
      const r = await callClaude(
        client,
        mimeType,
        imageBase64,
        attempts[i].system,
        attempts[i].max,
      )
      if (r.stop_reason === 'refusal') {
        // Stop trying — model explicitly refused.
        break
      }
      const text = lastText(r)
      lastRawText = text || lastRawText
      const parsed = extractJSON(text)
      if (parsed && (parsed.brand || parsed.model)) {
        const finalized = finalize(parsed)
        // Second + third stage web-grounded refinement, in PARALLEL
        // to keep latency reasonable (each takes ~5-8s). Skipped when
        // we fell back to the "Voiture / Modèle indéterminé" rescue
        // — no point burning web_search quota on an unknown car.
        if (
          finalized.brand !== NEVER_EMPTY_BRAND &&
          finalized.model !== NEVER_EMPTY_MODEL &&
          finalized.valid !== false
        ) {
          const [refinedPrice, rarityRes] = await Promise.all([
            refinePriceFromWeb(
              client,
              finalized.brand,
              finalized.model,
              finalized.year,
            ),
            refineRarityFromWeb(
              client,
              finalized.brand,
              finalized.model,
              finalized.year,
            ),
          ])
          if (typeof refinedPrice === 'number' && refinedPrice > 0) {
            finalized.estimated_price = refinedPrice
          }
          finalized.rarity = rarityRes.rarity
          finalized.production = rarityRes.production
        }
        return sendJson(res, finalized)
      }
    } catch (e) {
      console.error(`[identify-car] attempt ${i + 1} threw:`, e?.message ?? e)
      // Continue to next attempt unless we're out.
    }
  }

  // All 3 attempts failed to produce a usable JSON. Try to salvage brand
  // and model from the raw prose of the last response.
  const rescued = rescueFromProse(lastRawText)
  if (rescued && (rescued.brand || rescued.model)) {
    return sendJson(res, finalize(rescued))
  }

  // Absolute last resort — the form still auto-fills with "Voiture /
  // Modèle indéterminé" and the user just edits.
  return sendJson(res, FALLBACK)
}
