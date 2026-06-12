import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { XMLParser } from 'fast-xml-parser'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// Requested model claude-sonnet-4-20250514 is deprecated (retires
// 2026-06-15); using its current drop-in replacement.
const MODEL = 'claude-sonnet-4-6'

// `category` is only a fallback hint. The real category is decided later
// by categorize(): Claude separates motorsport from road cars, then a
// keyword pass picks the finest bucket (Hypercar / Supercar / Électrique
// / JDM / Classique / SUV). 20+ specialist auto/motorsport feeds — broad
// coverage so the Explorer never runs dry between hourly refreshes.
const FEEDS: { url: string; source: string; category: string }[] = [
  // — Generalist & supercar magazines —
  { url: 'https://www.autocar.co.uk/rss', source: 'Autocar', category: 'Supercar' },
  { url: 'https://www.evo.co.uk/rss', source: 'Evo', category: 'Supercar' },
  { url: 'https://www.topgear.com/rss', source: 'Top Gear', category: 'Supercar' },
  { url: 'https://www.caranddriver.com/rss/all.xml', source: 'Car and Driver', category: 'Supercar' },
  { url: 'https://www.motortrend.com/feeds/', source: 'MotorTrend', category: 'Supercar' },
  { url: 'https://www.roadandtrack.com/rss/all.xml', source: 'Road & Track', category: 'Supercar' },
  { url: 'https://jalopnik.com/rss', source: 'Jalopnik', category: 'Supercar' },
  { url: 'https://www.autoblog.com/rss.xml', source: 'Autoblog', category: 'Supercar' },
  { url: 'https://www.carscoops.com/feed', source: 'Carscoops', category: 'Supercar' },
  { url: 'https://www.motor1.com/rss/news/all/', source: 'Motor1', category: 'Supercar' },
  { url: 'https://www.autoevolution.com/rss/news.xml', source: 'autoevolution', category: 'Supercar' },
  { url: 'https://www.gtspirit.com/feed', source: 'GTspirit', category: 'Hypercar' },
  { url: 'https://www.supercars.net/blog/feed', source: 'Supercars.net', category: 'Hypercar' },
  { url: 'https://www.speedhunters.com/feed', source: 'Speedhunters', category: 'JDM' },
  { url: 'https://www.pistonheads.com/rss/news', source: 'PistonHeads', category: 'Supercar' },
  // — Motorsport / F1 —
  { url: 'https://www.autosport.com/rss/feed/all', source: 'Autosport', category: 'F1' },
  { url: 'https://www.motorsport.com/rss/all/', source: 'Motorsport', category: 'F1' },
  { url: 'https://the-race.com/feed', source: 'The Race', category: 'F1' },
  { url: 'https://racer.com/feed', source: 'Racer', category: 'F1' },
  { url: 'https://www.crash.net/rss/f1', source: 'Crash.net', category: 'F1' },
  // — Sources françaises —
  { url: 'https://www.largus.fr/rss', source: "L'Argus", category: 'Supercar' },
  { url: 'https://www.caradisiac.com/rss/rss.xml', source: 'Caradisiac', category: 'Supercar' },
  { url: 'https://www.automobile-magazine.fr/rss/rss.xml', source: 'Automobile Magazine', category: 'Supercar' },
  { url: 'https://www.turbo.fr/rss', source: 'Turbo', category: 'Supercar' },
]

// Several publishers block non-browser User-Agents (403/Access Denied).
// A realistic browser UA gets through (verified for supercars.net).
const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/rss+xml, application/xml, text/xml, */*',
}

// Per-feed hard timeout — a single hanging/slow feed must never stall
// the whole run into a function timeout.
const FEED_TIMEOUT_MS = 8000
async function fetchWithTimeout(url: string): Promise<Response | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FEED_TIMEOUT_MS)
  try {
    return await fetch(url, { headers: FETCH_HEADERS, signal: ctrl.signal })
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

const PER_FEED = 5
const MAX_TOTAL = 50
// Articles older than 48h are dropped before they ever reach Claude.
const MAX_AGE_MS = 48 * 60 * 60 * 1000
// Article time-to-live in DB (matches the 48h DB default — keeps the
// feed populated between the 4 daily cron runs).
const TTL_MS = 48 * 60 * 60 * 1000
// Public (non-cron) callers can only trigger a real run if the freshest
// article is older than this — bounds Claude/API cost under load.
const MIN_REFRESH_MS = 20 * 60 * 1000
// Quality filter: drop summaries shorter than this once Claude returns.
const MIN_SUMMARY_LEN = 100

const SYSTEM = `Tu es l'éditeur automobile de l'app REVS. Tu es strict.

PERTINENCE — mets "relevant" à true UNIQUEMENT si l'article est DIRECTEMENT et principalement consacré à l'un de ces sujets :
- Formule 1 / motorsport automobile (Grands Prix, écuries, pilotes, circuits, résultats)
- supercars et hypercars (essais, présentations officielles, performances)
- voitures de sport, de performance ou de collection
- événements automobiles (salons, meetings, track days, rassemblements, enchères de voitures)

Mets "relevant" à false pour TOUT LE RESTE, même si une voiture est citée en passant : avions, bateaux/yachts, motos, vélos, trains, immobilier, crypto/bourse/finance, jeux vidéo, hardware/tech grand public, politique, people/célébrités, sport non automobile, SUV/utilitaires familiaux sans dimension sportive. Dans le moindre doute → false.

CATÉGORIE — règle STRICTE, choisis exactement UNE valeur pour "category" :
- "F1" → l'article parle de Formule 1 ou de motorsport (Grand Prix, écurie, pilote, qualif, circuit, championnat, résultats). AUCUNE voiture de route ici.
- "Supercar" → voiture de route sportive / grande marque (Porsche, BMW M, AMG, essais, nouveautés, reviews).
- "Hypercar" → voiture de route d'exception, ultra limitée ou hyper-performante (Ferrari/Lamborghini/Bugatti/Koenigsegg/McLaren halo, hypercars).
Ne JAMAIS mélanger F1 et voiture de route. Si c'est F1/Motorsport → "F1" obligatoirement, jamais Supercar/Hypercar. Si c'est une voiture de route → "Supercar" ou "Hypercar", jamais "F1".

TITRE — "title" : traduis le titre en français si nécessaire (s'il est déjà en français, garde-le tel quel). Garde les noms propres inchangés (pilotes, écuries, marques, modèles, circuits). Concis, sans guillemets ajoutés, sans point final.

RÉSUMÉ — si pertinent, rédige "summary" : 2 à 3 lignes maximum en français, concis et enthousiaste, précis sur les chiffres de performance s'ils sont donnés. TEXTE BRUT UNIQUEMENT : aucun markdown, pas d'astérisques, pas de gras, pas de titres, pas de listes. Si non pertinent, "summary" = chaîne vide (mais renvoie quand même "title" traduit).`

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export const config = { maxDuration: 60 }

function asText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o['#text'] === 'string') return o['#text']
  }
  return ''
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

// Collect every image candidate with its known width (0 = unknown),
// from enclosure / media:content / media:thumbnail / media:group /
// inline <img width> / og:image.
function imageCandidates(
  item: Record<string, unknown>,
): { url: string; w: number }[] {
  const out: { url: string; w: number }[] = []
  const push = (u: unknown, w: unknown) => {
    if (typeof u === 'string' && /^https?:\/\//i.test(u))
      out.push({ url: u, w: Number(w) || 0 })
  }
  const arr = (x: unknown): unknown[] =>
    x == null ? [] : Array.isArray(x) ? x : [x]

  for (const e of arr(item.enclosure)) {
    const o = e as Record<string, string>
    if (
      (o['@_type'] ?? '').startsWith('image') ||
      /\.(jpe?g|png|webp)/i.test(o['@_url'] ?? '')
    )
      push(o['@_url'], o['@_width'])
  }
  for (const m of arr(item['media:content'])) {
    const o = m as Record<string, string>
    if (
      o['@_medium'] === 'image' ||
      /image/i.test(o['@_type'] ?? '') ||
      /\.(jpe?g|png|webp)/i.test(o['@_url'] ?? '')
    )
      push(o['@_url'], o['@_width'])
  }
  for (const t of arr(item['media:thumbnail'])) {
    const o = t as Record<string, string>
    push(o['@_url'], o['@_width'])
  }
  const mg = item['media:group'] as Record<string, unknown> | undefined
  if (mg)
    for (const m of arr(mg['media:content'])) {
      const o = m as Record<string, string>
      push(o['@_url'], o['@_width'])
    }
  const html =
    asText(item['content:encoded']) || asText(item.description) || ''
  const imgTag = html.match(/<img[^>]+>/i)?.[0]
  if (imgTag) {
    push(
      imgTag.match(/src=["']([^"']+)["']/i)?.[1],
      imgTag.match(/width=["']?(\d+)/i)?.[1],
    )
  }
  push(html.match(/og:image["'][^>]*content=["']([^"']+)["']/i)?.[1], 0)
  return out
}

// Best real image, or null if none acceptable (caller then uses a
// high-quality category fallback). Prefer the largest >=400px image;
// else an unknown-size one; never a known < 400px image.
function pickBestImage(item: Record<string, unknown>): string | null {
  const cands = imageCandidates(item)
  if (cands.length === 0) return null
  const big = cands
    .filter((c) => c.w >= 400)
    .sort((a, b) => b.w - a.w)[0]
  if (big) return big.url
  const unknown = cands.find((c) => c.w === 0)
  return unknown ? unknown.url : null
}

// Near-duplicate detection: normalize then Dice coefficient on
// character bigrams. >= 0.8 means "same story, different wording".
function normTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function titleSimilarity(a: string, b: string): number {
  const x = normTitle(a)
  const y = normTitle(b)
  if (!x || !y) return 0
  if (x === y) return 1
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0
  const bigrams = (s: string) => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      m.set(g, (m.get(g) ?? 0) + 1)
    }
    return m
  }
  const ma = bigrams(x)
  const mb = bigrams(y)
  let overlap = 0
  for (const [g, c] of ma) overlap += Math.min(c, mb.get(g) ?? 0)
  return (2 * overlap) / (x.length - 1 + (y.length - 1))
}

const DUP_THRESHOLD = 0.8

// Defensive: strip common markdown so summaries never render literal
// **bold**, headings, list bullets, etc.
function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const CATEGORIES = [
  'F1',
  'Supercar',
  'Hypercar',
  'Électrique',
  'JDM',
  'Classique',
  'SUV',
] as const
type NewsCategory = (typeof CATEGORIES)[number]

function normCategory(v: unknown, fallback: string): NewsCategory {
  const s = String(v ?? '')
  if ((CATEGORIES as readonly string[]).includes(s)) return s as NewsCategory
  if ((CATEGORIES as readonly string[]).includes(fallback))
    return fallback as NewsCategory
  return 'Supercar'
}

// Keyword categoriser. Claude already makes the critical motorsport↔road
// split (its strict F1 vs road-car call), so F1 wins when Claude says F1
// or the text carries explicit race signals; otherwise the finest road-car
// bucket is chosen by keyword. Order = priority (first match wins).
const KW_RULES: { cat: NewsCategory; words: string[] }[] = [
  { cat: 'Hypercar', words: ['bugatti', 'koenigsegg', 'pagani', 'rimac', 'chiron', 'veyron', 'tourbillon', 'nevera', 'hypercar'] },
  { cat: 'Électrique', words: ['électrique', 'electrique', 'electric', ' ev ', 'tesla', 'rivian', 'batterie', 'battery', 'autonomie', 'kwh', 'bev', 'lucid'] },
  { cat: 'JDM', words: ['toyota', 'nissan', 'honda', 'mazda', 'subaru', 'mitsubishi', 'lexus', 'jdm', 'japonais', 'japanese', 'supra', 'skyline', 'gt-r', ' gtr', 'civic'] },
  { cat: 'Classique', words: ['vintage', 'classique', 'classic', 'youngtimer', 'oldtimer', 'restauration', 'restoration', 'collection', 'concours', 'barn find', 'heritage'] },
  { cat: 'SUV', words: ['suv', ' crossover', 'cayenne', 'urus', 'cullinan', ' dbx', 'bentayga', 'purosangue', 'macan'] },
  { cat: 'Supercar', words: ['ferrari', 'lamborghini', 'mclaren', 'porsche', 'aston martin', 'maserati', 'supercar', 'sportcar', 'sports car', '911', 'huracan', 'gt3'] },
]
const F1_WORDS = ['formula 1', 'formula one', 'formule 1', 'grand prix', ' f1 ', 'fia ', ' drs ', ' pit stop', 'qualifying', 'pole position', 'verstappen', 'leclerc', 'piastri', ' norris', ' hamilton', 'championnat du monde']

function categorize(
  aiCat: NewsCategory,
  title: string,
  description: string,
): NewsCategory {
  const hay = ` ${(title + ' ' + description).toLowerCase()} `
  const hit = (w: string) => hay.includes(w)
  if (aiCat === 'F1' || F1_WORDS.some(hit)) return 'F1'
  for (const { cat, words } of KW_RULES) if (words.some(hit)) return cat
  return 'Supercar'
}

// Commercial / classifieds filter — drop pricing & sales pieces (applied
// to road-car articles only; "Grand Prix" legitimately contains "prix").
const COMMERCIAL_RE = /\b(prix|occasion|vente|acheter|achat|cote|argus)\b/i

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    relevant: { type: 'boolean' },
    category: { type: 'string', enum: ['F1', 'Supercar', 'Hypercar'] },
    title: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['relevant', 'category', 'title', 'summary'],
  additionalProperties: false,
}

// Positive English detection: look for English-only stopwords / verb
// forms that don't exist in French. Aggressive on purpose — a false
// positive just costs one extra Claude call, a false negative leaks
// English into the user feed. This is the authoritative gate.
function looksEnglish(s: string): boolean {
  if (!s) return false
  const lower = s.toLowerCase()
  const en =
    /\b(the|of|to|is|are|was|were|will|with|for|from|by|on|at|in|as|that|this|these|those|has|have|had|been|being|would|could|should|its|it's|new|all|but|not|than|then|when|where|what|how|why|who|which|about|over|under|after|before|into|onto|out|up|down|reveals?|revealed|revealing|launch(?:ed|es|ing)?|unveils?|unveiled|unveiling|tested|test(?:s|ing)?|reviews?|reviewed|driving|drove|driven|sold|sells|selling|buys?|bought|wins?|won|claims?|claimed|gets?|got|gotten|makes?|making|made|takes?|taking|took|taken|sees?|saw|seen|here's|we've|don't|doesn't|isn't|aren't|won't|can't|you|your|our|their|his|her|he|she|they|we)\b/
  return en.test(lower)
}

// Cheap French check — used only to short-circuit the second-pass
// translation when the content is unambiguously French (no English
// markers at all and at least one French marker present).
function looksFrench(s: string): boolean {
  if (!s) return true
  const lower = s.toLowerCase()
  if (/[àâçéèêëîïôûùüÿœæ]/.test(lower)) return true
  return /\b(le|la|les|un|une|des|du|de|au|aux|et|ou|est|sont|avec|pour|dans|sur|par|son|sa|ses|ce|cette|ces|qui|que|quoi|où|d'|l'|c'|n')\b/.test(
    lower,
  )
}

// "Needs translation" combines both: positive English match always
// triggers; otherwise fall back to "no French marker" (defensive).
function needsTranslation(s: string): boolean {
  if (!s) return false
  if (looksEnglish(s)) return true
  return !looksFrench(s)
}

const TRANSLATE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['title', 'summary'],
  additionalProperties: false,
}

const TRANSLATE_SYSTEM = `Tu traduis des articles automobiles en FRANÇAIS NATUREL.

Règles strictes :
- Titre : concis, en français, sans guillemets ni point final, sans markdown. Garde les noms propres (marques, modèles, pilotes, circuits, villes) inchangés.
- Résumé : 2 à 3 phrases en français naturel, ton journalistique, texte brut. Pas de markdown, pas de listes, pas de gras.
- NE LAISSE AUCUN mot anglais dans le titre ni le résumé, sauf noms propres / sigles (F1, GP, MPG, V8, etc.).

Réponds UNIQUEMENT par un JSON {"title": string, "summary": string}.`

// One Claude translation call. Bulletproof: json_schema enforces well-
// formed output and 600 tokens leaves room for 3 FR sentences + JSON
// overhead. Returns `ok: false` on any failure path — callers can
// retry or DROP the article rather than silently storing English.
async function translateOnce(
  client: Anthropic,
  title: string,
  description: string,
): Promise<{ title: string; summary: string; ok: boolean }> {
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: [
        {
          type: 'text',
          text: TRANSLATE_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Titre: ${title}\n\nDescription: ${description.slice(0, 1500)}`,
        },
      ],
      output_config: {
        format: { type: 'json_schema', schema: TRANSLATE_SCHEMA },
      },
    })
    const block = res.content.find((b) => b.type === 'text')
    const text = block && 'text' in block ? block.text : ''
    if (!text) return { title, summary: description, ok: false }
    const parsed = JSON.parse(text) as { title?: string; summary?: string }
    const outTitle = stripMarkdown(parsed.title ?? '').trim()
    const outSummary = stripMarkdown(parsed.summary ?? '').trim()
    if (!outTitle || !outSummary)
      return { title, summary: description, ok: false }
    // Last guard: Claude occasionally echoes English back. Treat that
    // as a failure too — caller will retry or drop.
    if (looksEnglish(outTitle) || looksEnglish(outSummary))
      return { title: outTitle, summary: outSummary, ok: false }
    return { title: outTitle, summary: outSummary, ok: true }
  } catch (e) {
    console.error('[translate] failed:', e)
    return { title, summary: description, ok: false }
  }
}

// Wrapper with one retry. Two attempts give the model a chance to
// recover from transient errors / token truncation without ballooning
// cost (each failed attempt is one extra Claude call per article).
async function translateToFrench(
  client: Anthropic,
  title: string,
  description: string,
): Promise<{ title: string; summary: string; ok: boolean }> {
  const first = await translateOnce(client, title, description)
  if (first.ok) return first
  const second = await translateOnce(client, title, description)
  if (second.ok) return second
  // Both attempts failed — return the best we got (often Claude returned
  // a partial FR translation that just had a couple of English words).
  return second
}

async function summarize(
  client: Anthropic,
  title: string,
  description: string,
  feedCategory: string,
): Promise<{
  relevant: boolean
  category: NewsCategory
  title: string
  summary: string
}> {
  // Fail open on infra/parse errors: keep the (curated, on-topic) feed
  // content but force a French translation so the feed never shows raw
  // English from sources like Autocar, Top Gear, Motorsport.
  const makeFallback = async () => {
    if (!needsTranslation(title) && !needsTranslation(description)) {
      return {
        relevant: true,
        category: normCategory(feedCategory, 'Supercar'),
        title,
        summary: stripMarkdown(description).slice(0, 300),
      }
    }
    const t = await translateToFrench(client, title, description)
    return {
      relevant: true,
      category: normCategory(feedCategory, 'Supercar'),
      title: t.title,
      summary: t.summary,
    }
  }
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 350,
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        {
          role: 'user',
          content: `Titre: ${title}\n\nDescription: ${description.slice(0, 1500)}`,
        },
      ],
      output_config: {
        format: { type: 'json_schema', schema: SUMMARY_SCHEMA },
      },
    })
    const block = res.content.find((b) => b.type === 'text')
    const text = block && 'text' in block ? block.text : ''
    if (!text) return await makeFallback()
    const parsed = JSON.parse(text) as {
      relevant?: boolean
      category?: string
      title?: string
      summary?: string
    }
    const category = normCategory(parsed.category, feedCategory)
    const rawTitle = stripMarkdown(parsed.title ?? '').trim() || title
    const rawSummary = stripMarkdown(parsed.summary ?? '')
    // Defensive: structured-output sometimes echoes the original English
    // back when the input is long. Force a translation pass if EITHER
    // field still looks English. The feed MUST be 100% FR.
    let frTitle = rawTitle
    let summary = rawSummary
    if (needsTranslation(frTitle) || needsTranslation(summary)) {
      const t = await translateToFrench(client, frTitle, summary || description)
      frTitle = t.title
      summary = t.summary
    }
    if (parsed.relevant === false)
      return { relevant: false, category, title: frTitle, summary: '' }
    const fb = await makeFallback()
    return {
      relevant: true,
      category,
      title: frTitle,
      summary: summary || fb.summary,
    }
  } catch {
    return await makeFallback()
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // The Vercel cron is identified by CRON_SECRET (auto-sent as a bearer)
  // and always runs. Without that header it's a public/client trigger:
  // allowed, but rate-limited below so it can't run up Claude costs.
  const cronSecret = process.env.CRON_SECRET
  const isCron =
    !cronSecret || req.headers.authorization === `Bearer ${cronSecret}`
  const force = req.query.force === '1'

  if (!SUPABASE_URL || !SERVICE_ROLE || !process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Service indisponible — configuration manquante.' })
    return
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  })
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  })

  // Housekeeping: drop articles past their 24h TTL on every call
  // (cron + client), so the table never accumulates stale news.
  const nowIso = new Date().toISOString()
  let expired: number | null = null
  {
    const { error, count } = await admin
      .from('news')
      .delete({ count: 'exact' })
      .lt('expires_at', nowIso)
    expired = error ? -1 : (count ?? 0)
    if (error) console.error('news ttl cleanup failed:', error)
  }

  // Public client trigger: skip cheaply if the feed is already fresh.
  if (
    !isCron &&
    !force &&
    req.query.purge !== '1' &&
    req.query.purge_en !== '1'
  ) {
    const { data: latest } = await admin
      .from('news')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
    const newest = latest?.[0]?.created_at as string | undefined
    if (newest) {
      const ageMs = Date.now() - new Date(newest).getTime()
      if (ageMs < MIN_REFRESH_MS) {
        res.status(200).json({
          skipped: true,
          reason: 'fresh',
          ageMinutes: Math.round(ageMs / 60000),
        })
        return
      }
    }
  }

  // Manual maintenance levers (cron path stays non-destructive):
  //   ?purge=1     → wipes the entire news table before repopulating
  //   ?purge_en=1  → wipes ONLY rows whose title/summary still looks
  //                  English (recovery after a translation regression
  //                  without losing French rows that are fine).
  let purged: number | null = null
  let purgedEn: number | null = null
  if (req.query.purge === '1') {
    const { error, count } = await admin
      .from('news')
      .delete({ count: 'exact' })
      .not('id', 'is', null)
    purged = error ? -1 : (count ?? 0)
    if (error) console.error('news purge failed:', error)
  }
  if (req.query.purge_en === '1') {
    const { data: rowsAll } = await admin
      .from('news')
      .select('id, title, summary')
      .limit(2000)
    const englishIds = ((rowsAll ?? []) as {
      id: string
      title: string
      summary: string | null
    }[])
      .filter((r) => looksEnglish(r.title) || looksEnglish(r.summary ?? ''))
      .map((r) => r.id)
    if (englishIds.length) {
      const { error, count } = await admin
        .from('news')
        .delete({ count: 'exact' })
        .in('id', englishIds)
      purgedEn = error ? -1 : (count ?? 0)
      if (error) console.error('news purge_en failed:', error)
    } else {
      purgedEn = 0
    }
  }

  const { data: existing } = await admin
    .from('news')
    .select('id, url, title, summary')
    .order('created_at', { ascending: false })
    .limit(800)
  const existingRows = (existing ?? []) as {
    id: string
    url: string
    title: string
    summary: string | null
  }[]
  const known = new Set(existingRows.map((r) => r.url))

  const perFeed: Record<string, number> = {}
  type Candidate = {
    title: string
    description: string
    source: string
    category: string
    url: string
    image_url: string | null
    published_at: string | null
  }

  // Fetch + parse every feed in parallel (I/O bound, fast). No Claude
  // calls here — those are the expensive part and run in one parallel
  // batch below. Sequential summaries blew past the 60s Hobby ceiling.
  const candidateLists = await Promise.all(
    FEEDS.map(async (feed): Promise<Candidate[]> => {
      perFeed[feed.source] = 0
      try {
        const resp = await fetchWithTimeout(feed.url)
        if (!resp || !resp.ok) return []
        const xml = await resp.text()
        const parsed = parser.parse(xml)
        const channel = parsed?.rss?.channel ?? parsed?.feed
        const rawItems = channel?.item ?? channel?.entry ?? []
        const items: Record<string, unknown>[] = Array.isArray(rawItems)
          ? rawItems
          : [rawItems]
        const out: Candidate[] = []
        for (const item of items) {
          if (out.length >= PER_FEED) break
          const link =
            asText(item.link) ||
            (item.link as Record<string, string>)?.['@_href'] ||
            asText(item.guid)
          if (!link || known.has(link)) continue
          const title = stripHtml(asText(item.title))
          if (!title) continue
          known.add(link)
          const description = stripHtml(
            asText(item.description) ||
              asText(item['content:encoded']) ||
              asText(item.summary) ||
              asText(item.content),
          )
          const pub = asText(item.pubDate) || asText(item.published)
          const publishedAt = pub ? new Date(pub) : null
          out.push({
            title,
            description,
            source: feed.source,
            category: feed.category,
            url: link,
            image_url: pickBestImage(item),
            published_at:
              publishedAt && !isNaN(publishedAt.getTime())
                ? publishedAt.toISOString()
                : null,
          })
        }
        return out
      } catch {
        return []
      }
    }),
  )

  // Hard 48h cap: drop anything we can date that's older than 48h
  // before spending Claude calls on it.
  const cutoff = Date.now() - MAX_AGE_MS
  const candidates = candidateLists
    .flat()
    .filter(
      (c) =>
        !c.published_at || new Date(c.published_at).getTime() >= cutoff,
    )
    .slice(0, MAX_TOTAL)

  const summarized = await Promise.all(
    candidates.map(async (c) => ({
      c,
      ...(await summarize(anthropic, c.title, c.description, c.category)),
    })),
  )

  // Quality + dedup pass.
  //
  // 1. Drop non-automotive articles (Claude said `relevant: false`).
  // 2. Drop articles with no RSS image — fallback category illustrations
  //    look generic and hurt the feed's perceived quality.
  // 3. Drop articles whose Claude summary is shorter than 100 chars —
  //    those are usually pure-headline RSS items with no real body.
  // 4. Smart dedup — when the same story shows up across sources, keep
  //    only the version with the longest summary (= most complete).
  //    Applies BOTH within this batch and against rows already in DB:
  //    if the incoming version is more complete, the existing one is
  //    deleted and the new one inserted in its place.
  let dedupSkipped = 0
  let qualitySkipped = 0
  let englishDropped = 0
  type ReadyRow = {
    title: string
    summary: string
    source: string
    category: string
    url: string
    image_url: string | null
    published_at: string | null
    expires_at: string
  }
  const accepted: ReadyRow[] = []
  // Existing DB rows to delete because an incoming candidate is more
  // complete than them — replaced rather than skipped.
  const replacedIds = new Set<string>()

  // Final language gate BEFORE the dedup loop. Run all the remaining
  // English→French translation calls in parallel — sequential awaits
  // inside the dedup loop would blow past the 60s function ceiling
  // when many articles need a second pass. Only items that still look
  // English after summarize() pay the extra Claude call.
  let lateTranslated = 0
  const relocalized = await Promise.all(
    summarized.map(async (s) => {
      if (!s.relevant) return s
      if (!needsTranslation(s.title) && !needsTranslation(s.summary)) return s
      const t = await translateToFrench(anthropic, s.title, s.summary)
      lateTranslated += 1
      return {
        ...s,
        title: t.title || s.title,
        summary: t.summary || s.summary,
      }
    }),
  )

  // Process longest-summary-first so the first survivor of a duplicate
  // cluster is the most complete one (others get dropped).
  const ordered = [...relocalized].sort(
    (a, b) => (b.summary?.length ?? 0) - (a.summary?.length ?? 0),
  )

  for (const { c, relevant, category, title, summary } of ordered) {
    if (!relevant) continue

    // (2) Image: skip if there's no real RSS image at all. We want every
    // displayed card to have a story-specific image, not a fallback.
    if (!c.image_url) {
      qualitySkipped += 1
      continue
    }

    // (3) Summary length floor — headline-only items are not useful.
    if (summary.length < MIN_SUMMARY_LEN) {
      qualitySkipped += 1
      continue
    }

    // (3b) Hard language gate. After summarize() + the late-translate
    // pre-pass, anything still flagged as English is a translation
    // failure — DO NOT insert it. Better to skip than to leak English
    // into the feed. Logged so we can monitor leakage rate.
    if (looksEnglish(title) || looksEnglish(summary)) {
      console.warn(
        '[fetch-news] dropping English row:',
        c.source,
        '|',
        title.slice(0, 80),
      )
      englishDropped += 1
      continue
    }

    // Final category (keyword pass over title + description) and the
    // commercial/classifieds filter — sales pieces never reach the feed.
    const finalCat = categorize(category, `${title} ${c.title}`, c.description)
    if (finalCat !== 'F1' && COMMERCIAL_RE.test(`${title} ${c.title}`)) {
      qualitySkipped += 1
      continue
    }

    const frTitle = title
    const frSummary = summary

    // (4a) Dedup against already-accepted items in this batch.
    const dupInBatch = accepted.find(
      (k) => titleSimilarity(k.title, frTitle) >= DUP_THRESHOLD,
    )
    if (dupInBatch) {
      // Ordered desc by length — the kept one is at least as long.
      dedupSkipped += 1
      continue
    }

    // (4b) Dedup against the live DB. If incoming is longer, replace
    // the existing row; if shorter, drop incoming.
    const dupInDb = existingRows.find(
      (e) => titleSimilarity(e.title, frTitle) >= DUP_THRESHOLD,
    )
    if (dupInDb) {
      const existingLen = (dupInDb.summary ?? '').length
      if (frSummary.length > existingLen) {
        replacedIds.add(dupInDb.id)
      } else {
        dedupSkipped += 1
        continue
      }
    }

    perFeed[c.source] += 1
    const base = c.published_at ? new Date(c.published_at) : new Date()
    accepted.push({
      title: frTitle,
      summary: frSummary,
      source: c.source,
      // Keyword category (F1 stays F1 via Claude's motorsport call).
      category: finalCat,
      url: c.url,
      image_url: c.image_url,
      published_at: c.published_at,
      expires_at: new Date(base.getTime() + TTL_MS).toISOString(),
    })
  }

  const rows = accepted

  // Delete the inferior duplicates before inserting their replacements
  // so the unique (url) constraint never trips on the dedup transition.
  let replaced = 0
  if (replacedIds.size > 0) {
    const { error, count } = await admin
      .from('news')
      .delete({ count: 'exact' })
      .in('id', [...replacedIds])
    if (error) console.error('news dedup replace failed:', error)
    else replaced = count ?? 0
  }

  let upsertError: string | null = null
  if (rows.length > 0) {
    const { error } = await admin
      .from('news')
      .upsert(rows, { onConflict: 'url', ignoreDuplicates: true })
    if (error) {
      upsertError = `${error.code ?? ''} ${error.message} ${error.details ?? ''} ${error.hint ?? ''}`.trim()
      console.error('news upsert failed:', error)
    }
  }

  // Cap the table at the 60 freshest articles (newest by published_at,
  // then created_at). Everything past index 60 is overflow and deleted,
  // so the Explorer always reads from a tight, recent set.
  let trimmed = 0
  {
    const { data: overflow } = await admin
      .from('news')
      .select('id')
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(60, 999)
    const overflowIds = ((overflow ?? []) as { id: string }[]).map((r) => r.id)
    if (overflowIds.length) {
      const { count } = await admin
        .from('news')
        .delete({ count: 'exact' })
        .in('id', overflowIds)
      trimmed = count ?? 0
    }
  }

  const { count: tableTotal, error: countError } = await admin
    .from('news')
    .select('*', { count: 'exact', head: true })

  res.status(200).json({
    purged,
    purgedEn,
    expired,
    dedupSkipped,
    qualitySkipped,
    englishDropped,
    replaced,
    trimmed,
    lateTranslated,
    processed: rows.length,
    perFeed,
    upsertError,
    tableTotal: tableTotal ?? null,
    countError: countError ? countError.message : null,
  })
}
