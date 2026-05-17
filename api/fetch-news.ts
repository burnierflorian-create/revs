import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { XMLParser } from 'fast-xml-parser'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// Requested model claude-sonnet-4-20250514 is deprecated (retires
// 2026-06-15); using its current drop-in replacement.
const MODEL = 'claude-sonnet-4-6'

const FEEDS: { url: string; source: string; category: string }[] = [
  {
    url: 'https://www.formula1.com/content/fom-website/en/latest/all.xml',
    source: 'Formula 1',
    category: 'F1',
  },
  {
    url: 'https://www.motorsport.com/rss/f1/news/',
    source: 'Motorsport',
    category: 'F1',
  },
  {
    url: 'https://www.autocar.co.uk/rss/cars/supercar',
    source: 'Autocar',
    category: 'Supercar',
  },
  {
    url: 'https://www.supercars.net/blog/feed/',
    source: 'Supercars.net',
    category: 'Hypercar',
  },
  {
    url: 'https://www.gtplanet.net/feed/',
    source: 'GTPlanet',
    category: 'Events',
  },
]

// Several publishers block non-browser User-Agents (403/Access Denied).
// A realistic browser UA gets through (verified for supercars.net).
const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/rss+xml, application/xml, text/xml, */*',
}

const PER_FEED = 3
const MAX_TOTAL = 15

const SYSTEM = `Tu es un expert passion auto.

D'abord, juge la pertinence: "relevant" est true UNIQUEMENT si l'article concerne l'automobile au sens large — voitures, F1, motorsport, supercars, hypercars, ou événements automobiles. Si l'article parle d'un avion, d'un bateau, de jeux vidéo, de matériel informatique, ou de tout autre sujet non automobile, "relevant" est false.

Ensuite, si pertinent, rédige "summary": un résumé en français de 2 à 3 lignes, enthousiaste, précis sur les chiffres de performance si mentionnés. TEXTE BRUT UNIQUEMENT: aucun markdown, pas d'astérisques, pas de gras, pas de titres, pas de listes. Si non pertinent, "summary" peut être une chaîne vide.`

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

function pickImage(item: Record<string, unknown>): string | null {
  const enc = item.enclosure as Record<string, string> | undefined
  if (enc?.['@_url'] && (enc['@_type'] ?? '').startsWith('image'))
    return enc['@_url']
  const norm = (x: unknown): string | null => {
    const node = Array.isArray(x) ? x[0] : x
    const u = (node as Record<string, string> | undefined)?.['@_url']
    return u || null
  }
  return (
    norm(item['media:content']) ||
    norm(item['media:thumbnail']) ||
    (asText(item.description).match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ??
      null)
  )
}

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

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    relevant: { type: 'boolean' },
    summary: { type: 'string' },
  },
  required: ['relevant', 'summary'],
  additionalProperties: false,
}

async function summarize(
  client: Anthropic,
  title: string,
  description: string,
): Promise<{ relevant: boolean; summary: string }> {
  // Fail open on infra/parse errors: keep the (curated, on-topic) feed
  // content rather than dropping it.
  const fallback = {
    relevant: true,
    summary: stripMarkdown(description).slice(0, 300),
  }
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
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
    if (!text) return fallback
    const parsed = JSON.parse(text) as {
      relevant?: boolean
      summary?: string
    }
    const summary = stripMarkdown(parsed.summary ?? '')
    if (parsed.relevant === false) return { relevant: false, summary: '' }
    return { relevant: true, summary: summary || fallback.summary }
  } catch {
    return fallback
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (process.env.CRON_SECRET) {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
  }
  if (!SUPABASE_URL || !SERVICE_ROLE || !process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Missing env (Supabase service role / Anthropic key)' })
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

  // Manual maintenance lever: GET /api/fetch-news?purge=1 wipes the table
  // before repopulating. The scheduled cron calls the path without the
  // param, so normal runs stay non-destructive.
  let purged: number | null = null
  if (req.query.purge === '1') {
    const { error, count } = await admin
      .from('news')
      .delete({ count: 'exact' })
      .not('id', 'is', null)
    purged = error ? -1 : (count ?? 0)
    if (error) console.error('news purge failed:', error)
  }

  const { data: existing } = await admin
    .from('news')
    .select('url')
    .order('created_at', { ascending: false })
    .limit(500)
  const known = new Set((existing ?? []).map((r: { url: string }) => r.url))

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
        const resp = await fetch(feed.url, { headers: FETCH_HEADERS })
        if (!resp.ok) return []
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
            image_url: pickImage(item),
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

  const candidates = candidateLists.flat().slice(0, MAX_TOTAL)

  const summarized = await Promise.all(
    candidates.map(async (c) => ({
      c,
      ...(await summarize(anthropic, c.title, c.description)),
    })),
  )

  // Drop non-automotive articles (planes, boats, gaming, etc.).
  const rows = summarized
    .filter((x) => x.relevant)
    .map(({ c, summary }) => {
      perFeed[c.source] += 1
      return {
        title: c.title,
        summary,
        source: c.source,
        category: c.category,
        url: c.url,
        image_url: c.image_url,
        published_at: c.published_at,
      }
    })

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

  const { count: tableTotal, error: countError } = await admin
    .from('news')
    .select('*', { count: 'exact', head: true })

  res.status(200).json({
    purged,
    processed: rows.length,
    perFeed,
    upsertError,
    tableTotal: tableTotal ?? null,
    countError: countError ? countError.message : null,
  })
}
