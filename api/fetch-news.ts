import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { XMLParser } from 'fast-xml-parser'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// Requested model claude-sonnet-4-20250514 is deprecated (retires
// 2026-06-15); using its current drop-in replacement.
const MODEL = 'claude-sonnet-4-6'

const FEEDS: { url: string; source: string; category: string }[] = [
  {
    url: 'https://www.motorsport.com/rss/f1/news/',
    source: 'Motorsport',
    category: 'F1',
  },
  {
    url: 'https://www.autosport.com/rss/f1/news/',
    source: 'Autosport',
    category: 'F1',
  },
  {
    url: 'https://www.caradisiac.com/rss.xml',
    source: 'Caradisiac',
    category: 'Auto',
  },
]

const PER_FEED = 5
const MAX_TOTAL = 12

const SYSTEM =
  'Tu es un rédacteur automobile francophone. Résume l’article en français en 2 à 3 phrases courtes, factuelles, sans préambule ni formule d’introduction. Ne mentionne pas que c’est un résumé.'

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

async function summarize(
  client: Anthropic,
  title: string,
  description: string,
): Promise<string> {
  const fallback = description.slice(0, 300)
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 250,
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        {
          role: 'user',
          content: `Titre: ${title}\n\nDescription: ${description.slice(0, 1500)}`,
        },
      ],
    })
    const block = res.content.find((b) => b.type === 'text')
    const text = block && 'text' in block ? block.text.trim() : ''
    return text || fallback
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

  const { data: existing } = await admin
    .from('news')
    .select('url')
    .order('created_at', { ascending: false })
    .limit(500)
  const known = new Set((existing ?? []).map((r: { url: string }) => r.url))

  const rows: Record<string, unknown>[] = []
  const perFeed: Record<string, number> = {}

  for (const feed of FEEDS) {
    if (rows.length >= MAX_TOTAL) break
    perFeed[feed.source] = 0
    try {
      const resp = await fetch(feed.url, {
        headers: { 'User-Agent': 'revs-news-bot/1.0 (+https://revs.app)' },
      })
      if (!resp.ok) continue
      const xml = await resp.text()
      const parsed = parser.parse(xml)
      const channel = parsed?.rss?.channel ?? parsed?.feed
      const rawItems = channel?.item ?? channel?.entry ?? []
      const items: Record<string, unknown>[] = Array.isArray(rawItems)
        ? rawItems
        : [rawItems]

      for (const item of items.slice(0, PER_FEED)) {
        if (rows.length >= MAX_TOTAL) break
        const link =
          asText(item.link) ||
          (item.link as Record<string, string>)?.['@_href'] ||
          asText(item.guid)
        if (!link || known.has(link)) continue

        const title = stripHtml(asText(item.title))
        if (!title) continue
        const description = stripHtml(
          asText(item.description) || asText(item['content:encoded']),
        )
        const pub = asText(item.pubDate) || asText(item.published)
        const publishedAt = pub ? new Date(pub) : null

        const summary = await summarize(anthropic, title, description)

        rows.push({
          title,
          summary,
          source: feed.source,
          category: feed.category,
          url: link,
          image_url: pickImage(item),
          published_at:
            publishedAt && !isNaN(publishedAt.getTime())
              ? publishedAt.toISOString()
              : null,
        })
        known.add(link)
        perFeed[feed.source] += 1
      }
    } catch {
      // Skip a failing feed, keep the others.
      continue
    }
  }

  if (rows.length > 0) {
    await admin
      .from('news')
      .upsert(rows, { onConflict: 'url', ignoreDuplicates: true })
  }

  res.status(200).json({ processed: rows.length, perFeed })
}
