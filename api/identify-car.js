import Anthropic from '@anthropic-ai/sdk'

// Sonnet does the VISUAL recognition (image). The market price is a
// separate TEXT-ONLY call on Haiku (the cheapest model) — splitting the
// two cuts the price-side cost ~80% vs. asking Sonnet for everything.
const MODEL = 'claude-sonnet-4-6'
const PRICE_MODEL = 'claude-haiku-4-5-20251001'

// Market-price rule + real reference quotes (current resale value, NOT
// catalogue-new) so Haiku anchors on realistic numbers for the year.
const PRICE_SYSTEM = `Tu donnes le prix du MARCHÉ ACTUEL en euros — la cote réelle de revente aujourd'hui pour l'année indiquée, en bon état. PAS le prix neuf, PAS une estimation gonflée. Jamais le prix neuf si la voiture a plus de 2 ans.
Références de cote marché réelles :
- Ferrari 488 GTB 2019 → 165000
- McLaren 570S 2018 → 125000
- Lamborghini Huracán 2020 → 195000
- Porsche 911 Carrera S 992 2021 → 115000
- Mercedes-AMG GT 63 S 2024 → 195000
- BMW M3 Competition 2022 → 75000
- Audi RS6 Avant 2022 → 85000
- Range Rover Sport SVR 2021 → 90000
- Rolls-Royce Ghost 2012 → 95000
- Bentley Continental GT 2020 → 155000
Réponds UNIQUEMENT par le nombre entier en euros, rien d'autre (pas de symbole, pas de texte).`

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

// Last-resort labels. These are reached ONLY after the normal prompt
// ladder AND the insistent brand re-analysis in the handler ALL fail to
// name a real brand (should be extremely rare). We deliberately use
// "Inconnue" — NEVER "Voiture" — so the value is honest and the reprocess
// job can find these rows. The real "no empty brand" logic is the
// re-analysis pass (reanalyzeBrand) triggered whenever finalize() yields a
// generic brand, not this static string.
const NEVER_EMPTY_BRAND = 'Inconnue'
const NEVER_EMPTY_MODEL = 'Modèle inconnu'

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
  // Architecture line per the 2026-06-02 strict prompt — surfaces
  // "V8 BiTurbo / Transm. Intégrale" style spec instantly without
  // waiting for the card-specs RPC. Empty string when the prompt
  // didn't produce one.
  specs: '',
}

const FALLBACK = {
  ...BASE,
  brand: NEVER_EMPTY_BRAND,
  model: NEVER_EMPTY_MODEL,
  confidence: 20,
}

// ─────────────────────── Prompts ───────────────────────

// 2026-06-07 single-call identify engine (API-cost cleanup):
// - ONE static vision call with SYSTEM_STRICT — pure JSON, 6-tier
//   rarity, specs line, screen-detection guard. ~3-5 s latency.
// - NO web_search refine anymore. Rarity ships straight from the
//   prompt's static knowledge; the previous hypercar web check was the
//   only "à la volée" AI cost left in a spot's lifecycle and is gone.
//   Every later step (rarity, specs, history) is local or DB-cached.
// - SYSTEM_SIMPLE / SYSTEM_MINIMAL remain as escalating fallbacks in
//   case strict JSON parsing fails on the first attempt.
const SYSTEM_STRICT = `Tu es le moteur de détection officiel de l'application REVS. Ton rôle est d'analyser la photo d'un véhicule.
Tu réponds UNIQUEMENT par du JSON valide, sans markdown, sans texte avant ou après.

GARDE-FOU ANTI-TRICHE (conservateur — ne rejette qu'en cas de CERTITUDE) :
Ne rejette QUE si tu es certain à 90 %+ que ce n'est PAS une vraie voiture réelle, c'est-à-dire uniquement dans ces cas flagrants :
- une photo D'UN ÉCRAN (télé/ordi/téléphone) avec moirage marqué + bords d'écran/interface visibles,
- une MINIATURE de jouet évidente (jante carrée en plastique, proportions enfantines, décor de bureau),
- un DESSIN / rendu 3D / jeu vidéo manifeste,
- une photo D'UNE AUTRE PHOTO (bords de papier/affiche visibles).

NE rejette JAMAIS une vraie voiture pour ces raisons (ce sont des conditions NORMALES) :
- carrosserie noire ou foncée, peinture brillante/vernie, chrome, reflets, éblouissement ou flash,
- photo de nuit, faible luminosité, contre-jour, pluie, reflets de vitrine ou de flaque,
- voiture partielle, floue, de loin, de dos ou de côté, sous un angle inhabituel.

RÈGLE DU DOUTE : si tu hésites, ce N'EST PAS de la triche → considère que c'est une vraie voiture et IDENTIFIE-la (n'émets pas d'erreur). Le rejet doit rester rare.
Uniquement dans les cas flagrants ci-dessus, renvoie strictement :
{"error":"VIRTUAL_SCREEN_DETECTED"}

ÉCHELLE DE RARETÉ — basée EXCLUSIVEMENT sur le VOLUME DE PRODUCTION MONDIAL réel du modèle. Le prix N'A AUCUNE influence sur la rareté, ne le prends JAMAIS en compte :
- "standard"    : modèle premium classique de grande série, gros volume (Mercedes CLA, BMW Série 2, Audi A3, VW Golf).
- "premium"    : haut de gamme quotidien à fort volume, finition supérieure.
- "performance" : véhicule de grande série issu d'un département sportif officiel (Mercedes-AMG, BMW M, Audi RS, Porsche 718). Sportivité = ADN, mais produit en grande série.
- "exclusif"   : série limitée mondiale stricte < 500 exemplaires (édition spéciale / collector qui n'est pas une hypercar).
- "supercar"   : production mondiale TOTALE < 5 000 unités (ex: Ferrari 488 GTB, McLaren 570S, Audi R8 V10, Lamborghini Huracán).
- "hypercar"   : série ultra-limitée < 500 exemplaires, sommet absolu (Bugatti Chiron, Pagani Huayra, Koenigsegg, McLaren P1).

ANALYSE VISUELLE — observe la photo et croise ces indices AVANT de conclure :
- BADGE / LOGO : si un badge, sigle ou logo est clairement visible, utilise-le comme indice PRIORITAIRE pour la marque ET la version (ex: "AMG", "M", "RS", "S-Line", "Carrera S", "Quadrifoglio").
- Signature lumineuse des PHARES (LED, anneaux, flèches).
- Dessin de la CALANDRE (mono-cadre Audi, haricots BMW, étoile Mercedes, écusson…).
- JANTES (nombre de branches, design spécifique d'une finition sportive).
- ÉCHAPPEMENTS (nombre, forme ronde/trapézoïdale, position).
- PROPORTIONS (coupé, berline, SUV, break, cabriolet).
- COULEUR CARROSSERIE : identifie la teinte exacte en te basant sur les teintes constructeur officielles. Ex: "jaune Giallo Orion" (Lamborghini), "bleu Santorini" (BMW), "vert Goodwood" (Bentley), "rouge Rosso Corsa" (Ferrari).
- SPOILERS ET AÉRODYNAMISME : présence d'un aileron actif, diffuseur, prises d'air actives.
- ROUES : taille estimée, style (multi-branches, monobloc, turbine), couleur des étriers de frein.

SIGNATURES SUPERCARS — reconnais ces marques même de DERRIÈRE ou de CÔTÉ :

LAMBORGHINI — indices infaillibles :
- Lignes angulaires TRÈS prononcées, capot avant plat et extrêmement bas.
- Silhouette ultra-basse et angulaire, lignes en Y caractéristiques.
- Feux arrière LED en forme de Y ou hexagonaux (Huracán, Urus, Revuelto).
- Badge taureau doré sur le capot ou les ailes.
- Prises d'air latérales énormes sur les flancs.
- Huracán : feux arrière en Y, diffuseur agressif, sorties d'échappement centrales.
- Urus : SUV avec ligne de toit fuyante, feux en Y, calandre hexagonale massive.
- Revuelto (ex-Aventador) : portes en ciseaux, nez pointu extrême, ligne de toit très basse.
- Couleurs emblématiques : jaune Giallo Orion, vert Verde Mantis, orange Arancio Atlas, bleu Blu Cepheus.

FERRARI — indices infaillibles :
- Badge cheval cabré jaune sur fond rouge ou noir.
- Feux ronds (308, F40) ou feux LED fins (488, SF90, Roma).
- Sorties d'échappement centrales en haut du diffuseur (488, F8, SF90).
- Roma/Portofino : 2+2 élégant, ligne fluide.
- 296 GTB : feux en boomerang, prises d'air latérales.

McLAREN — indices infaillibles :
- Portes papillon (dièdre) caractéristiques.
- Flancs profondément sculptés (écopes latérales creusées vers les prises d'air moteur).
- Nez très pointu avec splitter intégré.
- Prises d'air derrière les vitres latérales.
- Feux arrière fins horizontaux.
- GT : ligne plus douce, coffre arrière, moins extrême que la 720S.

PORSCHE — indices infaillibles :
- Capot arrière bombé (moteur en porte-à-faux arrière), silhouette 911 fuyante inimitable.
- Bandeau de feux arrière horizontal continu (911 991/992) ; 4 phares ronds pour Cayenne/Macan/Taycan.
- Écusson Porsche (armoiries de Stuttgart) au centre du capot avant.

PORSCHE 911 GT3 — indices infaillibles :
- Aileron arrière fixe très large et haut (swan neck).
- Diffuseur arrière agressif avec sorties d'échappement basses.
- Roues centre-lock (écrou central unique).
- Jantes dorées ou noires spécifiques GT3.
- Badge GT3 sur le capot arrière moteur.

Si l'image est valide, renvoie strictement ce JSON :
{
  "brand": "Marque exacte",
  "model": "Modèle exact avec génération/millésime ET version/finition si visible",
  "year": 2022,
  "color": "couleur précise et nommée",
  "category": "supercar|hypercar|classic|youngtimer|JDM|other",
  "confidence": 85,
  "rarity": "standard|premium|performance|exclusif|supercar|hypercar",
  "specs": "Configuration moteur / Transmission",
  "valid": true
}

Règles :
- "model" : le plus PRÉCIS possible — inclus la génération/millésime ET la version/finition quand elle est identifiable. Ex: "Mercedes-AMG C 63 S", "BMW M340i", "Audi RS 6 Avant", "Porsche 911 Carrera S (992)", "Golf GTI Mk8". N'invente pas une finition que rien n'indique.
- "color" : nomme la teinte précise quand tu la reconnais ("gris nardo", "bleu Santorin", "vert British Racing", "rouge Rosso Corsa") plutôt qu'un simple "gris" ou "rouge".
- "confidence" : entier 0-100, ta certitude réelle sur l'ensemble marque + modèle + version.
- "specs" : moteur précis si identifiable visuellement (ex: "V12 NA / Propulsion", "Flat-6 Biturbo / 4RM"), sinon configuration générale.
- NE renvoie PAS de prix : le prix du marché est calculé séparément (appel texte dédié, modèle moins cher).
- RARETÉ = uniquement le volume de production mondial du modèle. JAMAIS le prix, jamais le lieu, jamais le standing perçu.
- En cas de doute sur la rareté, descends d'un cran (douteux supercar = "performance").
- Si tu n'identifies pas le modèle exact, donne ta meilleure estimation ; si vraiment incertain, renvoie "Modèle inconnu". Mais la MARQUE reste TOUJOURS obligatoire et ne doit JAMAIS être vide.
- Pas d'appel web : appuie-toi UNIQUEMENT sur la vision de cette photo et tes connaissances statiques pour une réponse instantanée.

INTERDICTIONS STRICTES (le champ JSON est "brand", pas "make") :
INTERDIT de retourner "Voiture" ou "Modèle indéterminé" comme valeurs.
Lamborghini : lignes angulaires extrêmes, feux en Y, badge taureau doré, capot ultra plat → brand: "Lamborghini"
Ferrari : feux arrière ronds, sorties échappement centrales, badge cheval cabré → brand: "Ferrari"
Porsche : capot bombé arrière, feux horizontaux fins → brand: "Porsche"
McLaren : portes papillon, flancs très sculptés → brand: "McLaren"
Même qualité photo médiocre : identifier la marque par la silhouette et les indices visuels.
Si vraiment impossible → brand: "Inconnue" mais JAMAIS "Voiture".

OBLIGATION DE MARQUE (NON NÉGOCIABLE — priorité maximale) :
Si une voiture est visible sur la photo, tu DOIS TOUJOURS identifier sa marque (Lamborghini, Ferrari, Porsche, BMW, Audi, Mercedes, etc.). C'est NON NÉGOCIABLE.
- Ne renvoie JAMAIS un champ "brand" vide, null, "Voiture", "Voiture inconnue" ou "Véhicule non identifié" dès qu'une voiture est clairement visible.
- Croise systématiquement les indices pour trouver la marque, même de dos ou de côté :
  • Lamborghini : lignes angulaires très prononcées, capot avant plat, feux arrière en Y, badge taureau.
  • Ferrari : feux ronds arrière, sorties d'échappement centrales, badge cheval cabré.
  • McLaren : portes papillon, flancs profondément sculptés.
  • Porsche : capot arrière bombé, bandeau de feux horizontal, écusson de Stuttgart (911 GT3 : grand aileron fixe swan-neck).
- Si tu reconnais la marque mais PAS le modèle exact, renvoie la marque + "Modèle inconnu" (jamais une marque vide).
- Donne toujours ta meilleure estimation de marque, même à confidence basse (25). Le champ "brand" ne peut rester générique QUE s'il n'y a réellement AUCUNE voiture sur la photo.`

const SYSTEM_SIMPLE = `Tu es un expert automobile. Identifie la voiture sur la photo. La MARQUE est OBLIGATOIRE (non négociable) dès qu'une voiture est visible : ne renvoie JAMAIS une marque vide, null ou "Voiture inconnue". Si le modèle exact est incertain, renvoie la marque + "Modèle inconnu" + confidence: 20.

Réponds UNIQUEMENT par ce JSON, rien d'autre, pas de markdown :
{"brand":"Marque","model":"Modèle","year":2022,"color":"couleur","category":"supercar|hypercar|classic|youngtimer|JDM|other","confidence":80,"price_estimate":100000,"details_used":["…"],"valid":true,"reason":""}`

const SYSTEM_MINIMAL = `Identifie la voiture. Réponds UNIQUEMENT en JSON avec au minimum brand et model. La MARQUE est obligatoire, jamais vide (si le modèle est incertain : marque + "Modèle inconnu"). Pas de markdown, pas de texte. Exemple : {"brand":"Ferrari","model":"488 GTB"}`

// Fired ONLY when a first pass came back with a generic/empty brand. A
// more forceful "look again" prompt that leans entirely on silhouette +
// brand cues, tuned to never return "Voiture"/"Inconnue" if a body is
// visible.
const SYSTEM_INSIST = `Regarde ENCORE cette voiture. Ta première réponse était trop vague. Il est INTERDIT de répondre "Voiture" ou "Inconnue" dès qu'une carrosserie est visible.
Concentre-toi sur la SILHOUETTE et les indices visuels, même sur une photo médiocre, floue, sombre ou partielle :
- lignes angulaires extrêmes + feux en Y + capot ultra plat → Lamborghini
- feux arrière ronds + sorties d'échappement centrales + cheval cabré → Ferrari
- capot bombé arrière + feux horizontaux fins → Porsche
- portes papillon + flancs très sculptés → McLaren
- calandre en haricots → BMW ; calandre mono-cadre → Audi ; étoile → Mercedes ; anneaux → Audi.
Donne ta MEILLEURE estimation de marque réelle (jamais générique). Le modèle peut être "Modèle inconnu", la marque JAMAIS.
Réponds UNIQUEMENT en JSON valide, rien d'autre :
{"brand":"Marque réelle","model":"Modèle ou Modèle inconnu","year":2022,"color":"couleur","category":"supercar|hypercar|classic|youngtimer|JDM|other","confidence":40,"rarity":"standard|premium|performance|exclusif|supercar|hypercar"}`

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
  // Field aliases — try the legacy name first, fall back to `car_*` or the
  // `make` key some prompts emit.
  const brandRaw = normalizeString(o.brand ?? o.car_brand ?? o.make)
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
    // Architecture line — clamped to 60 chars so a verbose Claude
    // response doesn't blow out the card-back row. Empty string is
    // the safe default when the prompt didn't produce one.
    specs: (() => {
      const v = o.specs
      if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 60)
      return ''
    })(),
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

// Text-only market-price lookup on Haiku (cheap). Returns an integer in
// [1000, 10_000_000] or null. Best-effort — never throws; on any failure
// the spot just keeps a null price.
async function lookupMarketPrice(client, brand, model, year) {
  const b = (brand ?? '').trim()
  const m = (model ?? '').trim()
  if (!b && !m) return null
  const yearPart = year ? ` ${year}` : ''
  try {
    const r = await client.messages.create({
      model: PRICE_MODEL,
      max_tokens: 20,
      system: PRICE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Prix du marché actuel en euros pour une ${b} ${m}${yearPart} en bon état ?`,
        },
      ],
    })
    const n = parseInt(String(lastText(r)).replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(n) && n >= 1000 && n <= 10_000_000) return n
  } catch (e) {
    console.error('[identify-car] price lookup failed:', e?.message ?? e)
  }
  return null
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

// True when a brand is empty or a generic placeholder ("Voiture",
// "Inconnue", "Voiture Modèle indéterminé", …) — i.e. recognition failed
// to name a real make and we should look again.
function isGenericBrand(b) {
  const s = (b ?? '').trim().toLowerCase()
  return (
    !s ||
    s === 'voiture' ||
    s === 'inconnu' ||
    s === 'inconnue' ||
    s.startsWith('voiture ') ||
    s === 'véhicule non identifié'
  )
}

// Second-chance vision call with the more forceful SYSTEM_INSIST prompt.
// Best-effort — returns a parsed object or null, never throws.
async function reanalyzeBrand(client, mimeType, imageBase64) {
  try {
    const r = await callClaude(client, mimeType, imageBase64, SYSTEM_INSIST, 400)
    if (r.stop_reason === 'refusal') return null
    return extractJSON(lastText(r))
  } catch (e) {
    console.error('[identify-car] reanalyze threw:', e?.message ?? e)
    return null
  }
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
  // Strict prompt first (the hot path — single fast static call). The
  // two legacy prompts stay as escalating fallbacks for the rare case
  // where the strict prompt fails to produce parseable JSON.
  const attempts = [
    { system: SYSTEM_STRICT,  max: 600 },
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

      // Anti-cheat short-circuit: the strict prompt asks the AI to
      // return {"error":"VIRTUAL_SCREEN_DETECTED"} for screens, toys,
      // photos-of-photos. Surface that as a hard rejection so the
      // frontend bounces the publish flow.
      if (parsed && typeof parsed.error === 'string' && parsed.error) {
        return sendJson(res, {
          ...FALLBACK,
          valid: false,
          reason:
            parsed.error === 'VIRTUAL_SCREEN_DETECTED'
              ? 'Image suspecte détectée (écran, jouet ou photo de photo). Prends ta photo en conditions réelles.'
              : `Image refusée (${parsed.error}).`,
        })
      }

      if (parsed && (parsed.brand || parsed.model || parsed.make)) {
        // Vision recognition done (Sonnet).
        let result = finalize(parsed)

        // Point 3 — if the brand came back generic/empty ("Voiture",
        // "Inconnue"…), don't accept it: fire ONE more insistent vision
        // call (SYSTEM_INSIST) that leans on silhouette + brand cues. Keep
        // it only if it actually names a real make.
        if (isGenericBrand(result.brand)) {
          const better = await reanalyzeBrand(client, mimeType, imageBase64)
          if (better && !isGenericBrand(finalize(better).brand)) {
            // Merge — the insistent pass overrides brand/model/etc, but any
            // field it omitted keeps the first pass's value.
            result = finalize({ ...parsed, ...better })
          }
        }

        // The market price is a separate cheap Haiku text call so the
        // expensive vision model never spends tokens guessing prices.
        result.estimated_price = await lookupMarketPrice(
          client,
          result.brand,
          result.model,
          result.year,
        )
        return sendJson(res, result)
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

  // Absolute last resort — the form still auto-fills with "Inconnue /
  // Modèle inconnu" and the user just edits.
  return sendJson(res, FALLBACK)
}
