import Anthropic from '@anthropic-ai/sdk'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const MODEL = 'claude-sonnet-4-6'
// Cheap text model + price rule for the on-demand market-price action.
const PRICE_MODEL = 'claude-haiku-4-5-20251001'
const PRICE_SYSTEM = `Tu donnes le prix du MARCHÉ actuel en euros — la cote réelle de revente aujourd'hui en France pour l'année indiquée, en bon état. PAS le prix neuf. Jamais le prix neuf si la voiture a plus de 2 ans. Références : Lamborghini Huracán 2020 = 195000, McLaren GT 2022 = 165000, Porsche 911 GT3 2021 = 175000, Ferrari 488 GTB 2019 = 165000. Réponds UNIQUEMENT par le nombre entier en euros, rien d'autre.`

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
// ─────────────────────── Garage image branch — RETIRÉE ───────────────────────
//
// Les images de garage ne viennent plus d'Internet : le Garage part de la
// photo du spot (voir server/garage-visual.js). L'action `garage-image` répond
// donc 410 Gone, et les trois fonctions qui la servaient — `carImagesSignedUrl`,
// `claudePressPhoto` et son gestionnaire — étaient devenues inatteignables.
//
// Elles avaient été à moitié supprimées : les DÉCLARATIONS étaient parties, les
// CORPS étaient restés. Le module ne se chargeait plus, et /api/car-info
// répondait 500 FUNCTION_INVOCATION_FAILED en 0,3 s sur toutes ses actions —
// y compris sans jeton et sur une action inconnue, preuve que le crash était au
// chargement et non à l'exécution.
//
// Personne ne l'avait vu parce que `api/` n'est type-vérifié par RIEN : le
// tsconfig racine ne couvre que `src/`, et `npm run build` ne regarde pas ce
// dossier. Conséquence côté utilisateur : le verso des cartes restait sans
// caractéristiques et la cote marché ne se calculait plus.
//
// Le code est supprimé plutôt que réparé — il ne servait plus. L'historique
// git le conserve, et la colonne `garage_image_url` reste en base.

// ─────────────────────── Spotting prediction ───────────────────────
// Generates the daily "Meilleur moment pour spotter" message. Cached
// per (user_id, city, date) so the Claude call only fires once per
// user per day per city. City change invalidates the day's cache.

type SpotScore = 'bon' | 'moyen' | 'mauvais'
type PredictionRow = {
  user_id: string
  city: string
  date: string
  message: string
  score_conditions: SpotScore
  created_at: string
}

const PREDICT_SYSTEM = `Tu es l'expert local d'une app de car-spotting. Tu reçois un CONTEXTE détaillé sur le spotter (pseudo, ville, jour, heure, son profil). Utilise web_search au moins une fois pour vérifier:
1. La météo réelle MAINTENANT dans cette ville (pluie, soleil, température).
2. La réputation supercar de la ville (Monaco/Genève = très dense toute l'année; Cannes peak festival mai; Courchevel peak hiver; Paris peak Champs dimanche matin; Annecy peak quai du lac week-end; ville standard = moyen).
3. Événements auto, salons, rassemblements ce week-end à proximité.

Tu utilises le PROFIL fourni pour personnaliser : tu peux mentionner le pseudo, ses marques favorites, son niveau, sa dernière voiture spottée pour rendre le conseil intime.

Réponds UNIQUEMENT par ce JSON, sans markdown ni texte additionnel:
{
  "message": "UNE SEULE phrase courte en français, hyper spécifique à cette ville + ce jour + cette heure + cette météo + ce profil. Commence TOUJOURS par un emoji météo ou contexte (🌞🌧️🏎️🗼🔥🌙). Donne un quartier précis et une heure recommandée. Maximum 18 mots.",
  "score_conditions": "bon" | "moyen" | "mauvais"
}

Règles:
- "bon" = conditions optimales (météo + ville propice + week-end / événement).
- "moyen" = conditions correctes mais sans peak.
- "mauvais" = pluie OU lundi-mardi ville standard OU pas de spots probables.
- Le message DOIT être actionnable (où, quand) — pas de banalité.`

async function handlePredictSpotting(
  req: VercelRequest,
  res: VercelResponse,
  admin: SupabaseClient<any, any, any>,
  userId: string,
) {
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  const cityRaw = String((body as { city?: string }).city ?? '').trim()
  if (!cityRaw) {
    res.status(400).json({ error: 'Ville manquante.' })
    return
  }
  const city = cityRaw.slice(0, 80)

  // Optional spotter context — passed verbatim into the prompt to give
  // Claude enough material for a personalised single sentence. All
  // fields are best-effort; missing values are simply omitted.
  type Ctx = {
    pseudo?: string
    spot_count?: number
    top_brands?: string[]
    level?: string
    last_car?: string
  }
  const ctx = (body as { context?: Ctx }).context ?? {}
  const today = new Date().toISOString().slice(0, 10)
  // Local time for the spotter — best-effort via the timezone the
  // client passes in. Defaults to Paris when none provided.
  const tz =
    typeof (body as { timezone?: string }).timezone === 'string'
      ? (body as { timezone: string }).timezone
      : 'Europe/Paris'
  const localNow = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  }).format(new Date())

  // Same user + city + date → return cached row, never re-call Claude.
  const { data: cached } = await admin
    .from('spotting_predictions')
    .select('message, score_conditions, created_at')
    .eq('user_id', userId)
    .eq('city', city)
    .eq('date', today)
    .maybeSingle()
  if (cached) {
    res.status(200).json({
      message: (cached as PredictionRow).message,
      score_conditions: (cached as PredictionRow).score_conditions,
      generated_at: (cached as PredictionRow).created_at,
      cached: true,
    })
    return
  }

  const profileLines: string[] = []
  if (ctx.pseudo) profileLines.push(`PSEUDO: ${ctx.pseudo}`)
  if (typeof ctx.spot_count === 'number')
    profileLines.push(`VOITURES SPOTTÉES: ${ctx.spot_count}`)
  if (ctx.top_brands && ctx.top_brands.length > 0)
    profileLines.push(`MARQUES FAVORITES: ${ctx.top_brands.join(', ')}`)
  if (ctx.level) profileLines.push(`NIVEAU: ${ctx.level}`)
  if (ctx.last_car) profileLines.push(`DERNIÈRE VOITURE: ${ctx.last_car}`)

  const userContent = [
    `VILLE: ${city}`,
    `DATE LOCALE: ${localNow}`,
    ...profileLines,
  ].join('\n')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  try {
    const r = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: [
        {
          type: 'text',
          text: PREDICT_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: userContent,
        },
      ],
      tools: [
        { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
      ] as unknown as Anthropic.Messages.ToolUnion[],
    })
    const textBlocks = r.content.filter(
      (b): b is Anthropic.Messages.TextBlock => b.type === 'text',
    )
    const last = textBlocks[textBlocks.length - 1]
    const parsed = last ? (extractJSON(last.text) as Record<string, unknown> | null) : null
    if (!parsed) {
      console.error('[predict-spotting] parse failed:', last?.text ?? '')
      res
        .status(502)
        .json({ error: 'Prédiction indisponible — réessaie plus tard.' })
      return
    }
    const message = typeof parsed.message === 'string' ? parsed.message.trim() : ''
    const rawScore =
      typeof parsed.score_conditions === 'string'
        ? parsed.score_conditions.trim().toLowerCase()
        : ''
    const score: SpotScore =
      rawScore === 'bon' || rawScore === 'moyen' || rawScore === 'mauvais'
        ? rawScore
        : 'moyen'
    if (!message) {
      res
        .status(502)
        .json({ error: 'Prédiction vide — réessaie plus tard.' })
      return
    }
    const created_at = new Date().toISOString()
    await admin
      .from('spotting_predictions')
      .upsert(
        {
          user_id: userId,
          city,
          date: today,
          message,
          score_conditions: score,
          created_at,
        },
        { onConflict: 'user_id,city,date' },
      )
    res.status(200).json({
      message,
      score_conditions: score,
      generated_at: created_at,
      cached: false,
    })
  } catch (e) {
    console.error('[predict-spotting] failed:', e)
    res
      .status(500)
      .json({ error: 'Prédiction indisponible — réessaie plus tard.' })
  }
}

// ─────────────────────── Daily challenge ───────────────────────
// Generates the daily "Défi du jour" objective. Cached per (user_id,
// date) so Claude is only called once a day per user. The XP reward
// is decided by Claude based on difficulty; the claim path is a
// separate RPC (claim_daily_challenge) that the client calls when the
// user taps "Relevé !".

type DailyChallengeRow = {
  user_id: string
  date: string
  objective: string
  xp_reward: number
  completed_at: string | null
  generated_at: string
}

const CHALLENGE_SYSTEM = `Tu es l'AI engagement de REVS, une app de car-spotting. Tu reçois le contexte d'un spotter et tu génères UN défi quotidien personnalisé.

Règles strictes :
- UNE seule phrase courte impérative en français, maximum 14 mots.
- Ne propose PAS le type de voiture qu'il vient déjà de spotter (sa "dernière voiture").
- Difficulté adaptée à la ville :
  • Monaco / Genève / Cannes / Courchevel = supercar/hypercar attendu (xp_reward 150-250)
  • Paris / Lyon / Annecy / Lille = supercar possible (xp_reward 100-180)
  • Ville standard = berline / SUV / classique (xp_reward 80-130)
- Variantes possibles : marque précise, catégorie ("2 voitures allemandes"), couleur, époque ("youngtimer"), nationalité.
- Mention de l'heure recommandée bonus : "avant 20h", "ce soir", "ce matin".

Réponds UNIQUEMENT par ce JSON, sans markdown ni texte additionnel :
{"objective": "Trouve une Ferrari avant 20h", "xp_reward": 150}`

async function handleDailyChallenge(
  req: VercelRequest,
  res: VercelResponse,
  admin: SupabaseClient<any, any, any>,
  userId: string,
) {
  const today = new Date().toISOString().slice(0, 10)

  // Same user + date → return cached row, never re-call Claude.
  const { data: cached } = await admin
    .from('daily_challenges')
    .select('objective, xp_reward, completed_at, generated_at')
    .eq('user_id', userId)
    .eq('date', today)
    .maybeSingle()
  if (cached) {
    const c = cached as Pick<
      DailyChallengeRow,
      'objective' | 'xp_reward' | 'completed_at' | 'generated_at'
    >
    res.status(200).json({
      objective: c.objective,
      xp_reward: c.xp_reward,
      completed_at: c.completed_at,
      generated_at: c.generated_at,
      cached: true,
    })
    return
  }

  // Build context from the body (sent by the client — same shape as
  // predict-spotting). All fields optional, missing values just shorten
  // the prompt.
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  type Ctx = {
    pseudo?: string
    city?: string
    top_brands?: string[]
    last_car?: string
    level?: string
  }
  const ctx = (body as { context?: Ctx }).context ?? {}
  const lines: string[] = []
  if (ctx.pseudo) lines.push(`PSEUDO: ${ctx.pseudo}`)
  if (ctx.city) lines.push(`VILLE: ${ctx.city}`)
  if (ctx.level) lines.push(`NIVEAU: ${ctx.level}`)
  if (ctx.top_brands && ctx.top_brands.length > 0)
    lines.push(`MARQUES FAVORITES: ${ctx.top_brands.join(', ')}`)
  if (ctx.last_car) lines.push(`DERNIÈRE VOITURE SPOTTÉE: ${ctx.last_car}`)
  if (lines.length === 0) {
    lines.push('PSEUDO: Spotter', 'VILLE: France')
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  try {
    const r = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: [
        {
          type: 'text',
          text: CHALLENGE_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: lines.join('\n') }],
    })
    const textBlocks = r.content.filter(
      (b): b is Anthropic.Messages.TextBlock => b.type === 'text',
    )
    const last = textBlocks[textBlocks.length - 1]
    const parsed = last
      ? (extractJSON(last.text) as Record<string, unknown> | null)
      : null
    if (!parsed) {
      console.error('[daily-challenge] parse failed:', last?.text ?? '')
      res
        .status(502)
        .json({ error: 'Défi indisponible — réessaie plus tard.' })
      return
    }
    const objective =
      typeof parsed.objective === 'string' ? parsed.objective.trim() : ''
    const rawXp = Number((parsed as { xp_reward?: unknown }).xp_reward)
    const xpReward = Number.isFinite(rawXp)
      ? Math.max(50, Math.min(500, Math.round(rawXp)))
      : 100
    if (!objective) {
      res.status(502).json({ error: 'Défi vide — réessaie plus tard.' })
      return
    }
    const generated_at = new Date().toISOString()
    await admin.from('daily_challenges').upsert(
      {
        user_id: userId,
        date: today,
        objective,
        xp_reward: xpReward,
        generated_at,
      },
      { onConflict: 'user_id,date' },
    )
    res.status(200).json({
      objective,
      xp_reward: xpReward,
      completed_at: null,
      generated_at,
      cached: false,
    })
  } catch (e) {
    console.error('[daily-challenge] failed:', e)
    res.status(500).json({ error: 'Défi indisponible — réessaie plus tard.' })
  }
}

// ─────────────────────── Card-back specs branch ───────────────────────
// Per-model cached specs surfaced on the back of a collector card.
// Five fields only — narrower than the legacy per-spot CarInfo and
// keyed by (brand, model, year) so one Claude call serves every user
// who ever spotted the same model.

const CARD_SPECS_FIELDS = [
  'horsepower',
  'zero_to_100',
  'top_speed',
  'torque',
  'architecture',
  'fun_fact',
] as const
type CardSpec = (typeof CARD_SPECS_FIELDS)[number]
type CardSpecs = Record<CardSpec, string>

const CARD_SPECS_SYSTEM = `Tu es un expert automobile. Pour la voiture demandée, recherche les specs officielles via l'outil web_search. Règles :

- Tu DOIS utiliser web_search au moins une fois ; n'invente jamais.
- Si une donnée est introuvable ou incertaine, mets exactement "N/A".
- Réponds en français, unités lisibles ("ch", "Nm", "s", "km/h").
- "architecture" : UNE ligne très courte (max 50 caractères) au format "<configuration moteur> / <transmission>". Exemples : "V8 BiTurbo / Transm. Intégrale", "Moteur Central Arrière / Propulsion", "L6 BiTurbo / Propulsion", "V12 Atmo / Propulsion". Pas de chevaux ici, juste l'architecture mécanique.
- "fun_fact" : UNE seule phrase courte (max 100 caractères) — un détail croustillant que les passionnés trouvent intéressant. Ex : "Seulement 750 exemplaires produits.", "Le V8 biturbo développe 562 ch grâce au système 48V."

Réponds UNIQUEMENT par un JSON valide, sans markdown, conforme à :
{
  "horsepower": "562 ch" | "N/A",
  "zero_to_100": "3,2 s" | "N/A",
  "top_speed": "320 km/h" | "N/A",
  "torque": "750 Nm" | "N/A",
  "architecture": "V8 BiTurbo / Transm. Intégrale" | "N/A",
  "fun_fact": "phrase courte." | "N/A"
}`

function normalizeCardSpecs(raw: unknown): CardSpecs {
  const o = (raw ?? {}) as Record<string, unknown>
  const out = {} as CardSpecs
  for (const k of CARD_SPECS_FIELDS) {
    const v = o[k]
    out[k] = typeof v === 'string' && v.trim() ? v.trim() : 'N/A'
  }
  return out
}

function cardSpecsSlug(brand: string, model: string, year: number | null): string {
  const n = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  return `${n(brand)}|${n(model)}|${year ?? 'na'}`
}

async function handleCardSpecs(
  req: VercelRequest,
  res: VercelResponse,
  admin: SupabaseClient,
) {
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  const brand = String((body as { brand?: string }).brand ?? '').trim()
  const model = String((body as { model?: string }).model ?? '').trim()
  const yearRaw = (body as { year?: number | null }).year
  const year =
    typeof yearRaw === 'number' && Number.isFinite(yearRaw) ? yearRaw : null

  if (!brand || !model) {
    res.status(400).json({ error: 'Marque/modèle manquants.' })
    return
  }

  const slug = cardSpecsSlug(brand, model, year)

  const { data: cached } = await admin
    .from('car_specs')
    .select('data')
    .eq('slug', slug)
    .maybeSingle()
  // Cache-hit only when the stored row already includes the
  // architecture field (added 2026-06-01). Older rows are silently
  // refetched once so the back-face line populates without needing
  // a table truncate.
  if (
    cached?.data &&
    typeof (cached.data as { architecture?: string }).architecture === 'string'
  ) {
    res.status(200).json({ specs: cached.data, cached: true })
    return
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const yearPart = year ? ` (${year})` : ''
  const userMsg = `Voiture : ${brand} ${model}${yearPart}.`

  try {
    const r = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: [
        {
          type: 'text',
          text: CARD_SPECS_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMsg }],
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 3,
        },
      ] as unknown as Anthropic.Messages.ToolUnion[],
    })

    const textBlocks = r.content.filter(
      (b): b is Anthropic.Messages.TextBlock => b.type === 'text',
    )
    const last = textBlocks[textBlocks.length - 1]
    const parsed = last ? extractJSON(last.text) : null
    if (!parsed) {
      console.error('[card-specs] JSON parse failed, raw:', last?.text ?? '')
      res.status(502).json({ error: 'Specs indisponibles — réessaie.' })
      return
    }
    const specs = normalizeCardSpecs(parsed)

    await admin
      .from('car_specs')
      .upsert({ slug, brand, model, year, data: specs }, { onConflict: 'slug' })
    res.status(200).json({ specs, cached: false })
  } catch (e) {
    console.error('[card-specs] failed:', e)
    res.status(500).json({ error: 'Specs indisponibles — réessaie.' })
  }
}

// On-demand market price for a spot whose estimated_price is missing/zero.
// Cheap Haiku text call, run server-side (key stays off the client), and
// the result is persisted via the service-role admin client (bypasses RLS,
// so it works for any spot — not just the viewer's own).
async function handleMarketPrice(
  req: VercelRequest,
  res: VercelResponse,
  admin: SupabaseClient,
) {
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  const spotId =
    typeof (body as { spotId?: string }).spotId === 'string'
      ? (body as { spotId: string }).spotId
      : undefined
  const brand = String((body as { brand?: unknown }).brand ?? '').trim()
  const model = String((body as { model?: unknown }).model ?? '').trim()
  const yearRaw = (body as { year?: unknown }).year
  const year =
    typeof yearRaw === 'number' && Number.isFinite(yearRaw) ? yearRaw : null
  if (!brand && !model) {
    res.status(400).json({ error: 'missing_car' })
    return
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  let price: number | null = null
  try {
    const yearPart = year ? ` ${year}` : ''
    const r = await anthropic.messages.create({
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
    if (Number.isFinite(n) && n >= 1000 && n <= 10_000_000) price = n
  } catch (e) {
    console.error('[market-price] lookup failed:', (e as Error)?.message ?? e)
    res.status(502).json({ error: 'lookup_failed' })
    return
  }

  if (price != null && spotId) {
    try {
      await admin
        .from('spots')
        .update({ estimated_price: price })
        .eq('id', spotId)
    } catch (e) {
      console.error('[market-price] persist failed:', (e as Error)?.message ?? e)
    }
  }
  res.status(200).json({ price })
}

// ─────────── Cache des fiches expert, par MODÈLE ───────────
// `spots.car_info` est un cache par LIGNE : dix personnes photographiant la
// même Ferrari 488 GTB déclenchaient dix fois le même appel Sonnet + jusqu'à
// cinq recherches web, ~0,10 $ à chaque fois pour un résultat identique.
// `car_info_cache` (migration 0070) déplace le cache au niveau du modèle.
// `spots.car_info` reste alimenté pour ne rien changer en lecture.
function carInfoSlug(brand: string, model: string, year: number | null): string {
  const n = (v: string) =>
    v
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  return `${n(brand)}|${n(model)}|${year ?? 'na'}`
}

/** Fiche déjà connue pour ce modèle, ou null. Ne lève jamais : une panne de
 *  cache doit dégrader vers un appel IA, pas casser la requête. */
async function carInfoFromCache(
  admin: SupabaseClient,
  slug: string,
): Promise<CarInfo | null> {
  try {
    const { data } = await admin
      .from('car_info_cache')
      .select('data')
      .eq('slug', slug)
      .maybeSingle()
    return (data as { data?: CarInfo } | null)?.data ?? null
  } catch {
    return null
  }
}

/** Gèle une fiche fraîchement calculée. Best-effort : un échec d'écriture ne
 *  doit pas priver l'utilisateur de sa réponse. */
async function carInfoToCache(
  admin: SupabaseClient,
  slug: string,
  brand: string,
  model: string,
  year: number | null,
  data: CarInfo,
): Promise<void> {
  try {
    await admin.from('car_info_cache').upsert(
      { slug, brand, model, year, data, updated_at: new Date().toISOString() },
      { onConflict: 'slug' },
    )
  } catch (e) {
    console.error('[car-info] mise en cache échouée:', e)
  }
}

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

  // Require a valid Supabase user — the call hits the paid Claude API
  // and shouldn't be triggerable anonymously.
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const { data: u } = token
    ? await admin.auth.getUser(token)
    : { data: { user: null } }
  if (!u?.user) {
    res.status(401).json({ error: 'Non autorisé. Reconnecte-toi.' })
    return
  }

  // ── RETIRÉ DU SERVICE le 30/09/2026 ──
  // Cette action allait chercher une photo du modèle sur Internet (CarImages,
  // puis Claude web_search sur des photos presse/constructeur) et l'écrivait
  // dans `spots.garage_image_url`, que le Garage affichait À LA PLACE de la
  // voiture réellement photographiée. Plus aucun appelant ne l'invoque
  // (NewSpot ne la déclenche plus) ; elle répond désormais 410 pour qu'un
  // client resté en cache ne puisse pas la réactiver.
  //
  // Le code en aval est conservé volontairement : il documente ce qui existait,
  // et `garage_image_url` reste en base — rien n'est détruit.
  // ── RETIRÉ DU SERVICE le 30/09/2026 ──
  // Cette action allait chercher une photo du modèle sur Internet (CarImages,
  // puis Claude web_search sur des photos presse/constructeur) et l'écrivait
  // dans `spots.garage_image_url`, que le Garage affichait À LA PLACE de la
  // voiture réellement photographiée — 30 lignes sur 32 pointaient vers
  // wikimedia.org.
  //
  // Le worker et ses deux collecteurs ont été SUPPRIMÉS, pas seulement
  // débranchés : du code mort qui télécharge des images tierces est un passif,
  // il suffit d'un branchement pour le réveiller. L'historique git le conserve.
  // La colonne `garage_image_url` reste en base : rien n'est détruit.
  if (req.query.action === 'garage-image') {
    res.status(410).json({
      error: 'gone',
      message:
        "Les images de garage ne proviennent plus d'Internet : le Garage part de la photo du spot.",
    })
    return
  }
  if (req.query.action === 'predict-spotting') {
    return handlePredictSpotting(req, res, admin, u.user.id)
  }
  if (req.query.action === 'daily-challenge') {
    return handleDailyChallenge(req, res, admin, u.user.id)
  }
  if (req.query.action === 'card-specs') {
    return handleCardSpecs(req, res, admin)
  }
  if (req.query.action === 'market-price') {
    return handleMarketPrice(req, res, admin)
  }

  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  const spotId = (body as { spot_id?: string }).spot_id
  if (!spotId) {
    res.status(400).json({ error: 'Spot manquant.' })
    return
  }

  const { data: spot } = await admin
    .from('spots')
    .select('id, brand, model, year, car_info')
    .eq('id', spotId)
    .maybeSingle()
  if (!spot) {
    res.status(404).json({ error: 'Spot introuvable.' })
    return
  }
  // Cached: return as-is so the panel opens instantly on subsequent
  // expands across users.
  if (spot.car_info) {
    res.status(200).json({ car_info: spot.car_info, cached: true })
    return
  }

  // Cache par modèle : si une autre personne a déjà fait analyser cette
  // voiture, on recopie sa fiche sur ce spot. Zéro appel IA, zéro recherche
  // web — c'est l'économie principale de ce endpoint.
  const slug = carInfoSlug(spot.brand, spot.model, spot.year ?? null)
  const cachedForModel = await carInfoFromCache(admin, slug)
  if (cachedForModel) {
    await admin.from('spots').update({ car_info: cachedForModel }).eq('id', spotId)
    console.log(`[car-info] cache modèle utilisé pour ${slug} — aucun appel IA`)
    res.status(200).json({ car_info: cachedForModel, cached: 'model' })
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
      console.error('[car-info] JSON parse failed, raw:', last?.text ?? '')
      res
        .status(502)
        .json({ error: 'Impossible de récupérer les caractéristiques pour le moment.' })
      return
    }
    const info = normalize(parsed)

    // Persist so subsequent opens skip Claude entirely.
    await admin.from('spots').update({ car_info: info }).eq('id', spotId)
    // Gel au niveau du modèle : le prochain spot de la même voiture, quel que
    // soit son auteur, sera servi sans aucun appel IA.
    await carInfoToCache(admin, slug, spot.brand, spot.model, spot.year ?? null, info)
    res.status(200).json({ car_info: info, cached: false })
  } catch (e) {
    const err = e as { message?: string }
    console.error('[car-info] failed:', err)
    res.status(500).json({ error: 'Recherche indisponible — réessaie plus tard.' })
  }
}
