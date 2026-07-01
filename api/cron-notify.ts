import webpush from 'web-push'
import Anthropic from '@anthropic-ai/sdk'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// Monthly market-price refresh (action=refresh-prices). Same Haiku model +
// rule as api/identify-car.js so quotes stay consistent across the app.
const PRICE_MODEL = 'claude-haiku-4-5-20251001'
const PRICE_SYSTEM = `Tu donnes le prix du MARCHÉ ACTUEL en euros — la cote réelle de revente aujourd'hui pour l'année indiquée, en bon état. PAS le prix neuf, PAS une estimation gonflée. Jamais le prix neuf si la voiture a plus de 2 ans.
Réponds UNIQUEMENT par le nombre entier en euros, rien d'autre (pas de symbole, pas de texte).`

async function marketPrice(
  client: Anthropic,
  brand: string,
  model: string,
  year: number | null,
): Promise<number | null> {
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
    const textBlocks = r.content.filter(
      (blk): blk is Anthropic.Messages.TextBlock => blk.type === 'text',
    )
    const raw = textBlocks[textBlocks.length - 1]?.text ?? ''
    const n = parseInt(raw.replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(n) && n >= 1000 && n <= 10_000_000) return n
  } catch (e) {
    console.error('[cron-notify:refresh-prices] price failed:', e)
  }
  return null
}

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
function cleanKey(s: string | undefined): string {
  return (s || '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '') // surrounding quotes
    .replace(/\s+/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
    .replace(/[^A-Za-z0-9_-]/g, '') // anything still non-url-safe
}
const VAPID_PUBLIC = cleanKey(process.env.VAPID_PUBLIC_KEY)
const VAPID_PRIVATE = cleanKey(process.env.VAPID_PRIVATE_KEY)

// Keep race dates in sync with src/lib/f1.ts.
const GP_2026: { name: string; date: string }[] = [
  { name: "GP d'Australie", date: '2026-03-08T05:00:00Z' },
  { name: 'GP de Chine', date: '2026-03-15T07:00:00Z' },
  { name: 'GP du Japon', date: '2026-03-29T05:00:00Z' },
  { name: 'GP de Bahreïn', date: '2026-04-12T15:00:00Z' },
  { name: "GP d'Arabie saoudite", date: '2026-04-19T17:00:00Z' },
  { name: 'GP de Miami', date: '2026-05-03T19:30:00Z' },
  { name: 'GP du Canada', date: '2026-05-24T18:00:00Z' },
  { name: 'GP de Monaco', date: '2026-06-07T13:00:00Z' },
  { name: "GP d'Espagne", date: '2026-06-14T13:00:00Z' },
  { name: "GP d'Autriche", date: '2026-06-28T13:00:00Z' },
  { name: 'GP de Grande-Bretagne', date: '2026-07-05T14:00:00Z' },
  { name: 'GP de Belgique', date: '2026-07-19T13:00:00Z' },
  { name: 'GP de Hongrie', date: '2026-07-26T13:00:00Z' },
  { name: 'GP des Pays-Bas', date: '2026-08-23T13:00:00Z' },
  { name: "GP d'Italie", date: '2026-09-06T13:00:00Z' },
  { name: 'GP de Madrid', date: '2026-09-13T13:00:00Z' },
  { name: "GP d'Azerbaïdjan", date: '2026-09-27T11:00:00Z' },
  { name: 'GP de Singapour', date: '2026-10-11T12:00:00Z' },
  { name: 'GP des États-Unis', date: '2026-10-25T19:00:00Z' },
  { name: 'GP de Mexico', date: '2026-11-01T20:00:00Z' },
  { name: 'GP de São Paulo', date: '2026-11-08T17:00:00Z' },
  { name: 'GP de Las Vegas', date: '2026-11-21T06:00:00Z' },
  { name: 'GP du Qatar', date: '2026-11-29T16:00:00Z' },
  { name: "GP d'Abu Dhabi", date: '2026-12-06T13:00:00Z' },
]

// Loose generics — the helper doesn't care about schema specifics, and
// the strict 5-param form from supabase-js v2.45+ breaks ReturnType
// inference (overload picks the narrowest defaults).
type Admin = SupabaseClient<any, any, any>

async function sendToUser(
  admin: Admin,
  userId: string,
  payload: string,
): Promise<number> {
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)
  let n = 0
  const dead: string[] = []
  for (const s of (subs ?? []) as {
    id: string
    endpoint: string
    p256dh: string
    auth: string
  }[]) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      )
      n += 1
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) dead.push(s.id)
    }
  }
  if (dead.length) await admin.from('push_subscriptions').delete().in('id', dead)
  return n
}

function dayStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET
  if (
    cronSecret &&
    req.headers.authorization !== `Bearer ${cronSecret}` &&
    req.headers['x-cron-key'] !== cronSecret
  ) {
    res.status(401).json({ error: 'Non autorisé.' })
    return
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    res.status(500).json({ error: 'Service indisponible.' })
    return
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  })

  // ─── action=challenges removed 2026-06-05: the global weekly rotation
  // (activate_weekly_challenges) is retired. Challenges are now assigned
  // per-user, adaptively, by get_my_weekly_challenges / the spots trigger
  // (migrations 0042/0043) — there is no scheduled rotation anymore.

  // ─── action=stats → refresh the global stats materialized view.
  // Cheap (a few seconds). Runs hourly.
  if (req.query.action === 'stats') {
    try {
      const { error } = await admin.rpc('refresh_global_stats')
      if (error) throw new Error(error.message)
      res.status(200).json({ refreshed: true })
    } catch (e) {
      console.error('[cron-notify:stats]', e)
      res.status(500).json({ error: 'stats refresh failed' })
    }
    return
  }

  // ─── action=refresh-prices → monthly market-price refresh for EVERY
  // spot (cron: 1st of each month). Re-runs the Haiku price lookup and
  // updates only estimated_price. No vision cost — text-only.
  if (req.query.action === 'refresh-prices') {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) {
      res.status(500).json({ error: 'ANTHROPIC_API_KEY manquante.' })
      return
    }
    const client = new Anthropic({ apiKey: key })
    const { data, error } = await admin
      .from('spots')
      .select('id, brand, model, year')
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    const list = (data ?? []) as {
      id: string
      brand: string
      model: string
      year: number | null
    }[]
    let refreshed = 0
    let failed = 0
    const BATCH = 5
    for (let i = 0; i < list.length; i += BATCH) {
      await Promise.all(
        list.slice(i, i + BATCH).map(async (s) => {
          const p = await marketPrice(client, s.brand, s.model, s.year)
          if (p == null) return
          const { error: uErr } = await admin
            .from('spots')
            .update({ estimated_price: p })
            .eq('id', s.id)
          if (uErr) failed += 1
          else refreshed += 1
        }),
      )
    }
    res.status(200).json({ action: 'refresh-prices', total: list.length, refreshed, failed })
    return
  }

  // ─── default → daily push notifications (streak + GP reminders).
  // Falls through to the existing logic below; requires VAPID.
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    res.status(500).json({ error: 'VAPID non configuré.' })
    return
  }
  try {
  webpush.setVapidDetails(
    'mailto:contact@revs.app',
    VAPID_PUBLIC,
    VAPID_PRIVATE,
  )

  const now = new Date()
  const today = dayStr(now)
  const yesterday = dayStr(new Date(now.getTime() - 86400000))

  // Distinct subscribed users.
  const { data: subRows } = await admin
    .from('push_subscriptions')
    .select('user_id')
    .limit(2000)
  const userIds = [
    ...new Set(((subRows ?? []) as { user_id: string }[]).map((s) => s.user_id)),
  ]

  let streakSent = 0
  if (userIds.length) {
    const { data: prefs } = await admin
      .from('notification_prefs')
      .select('user_id, streak')
      .in('user_id', userIds)
    const streakOff = new Set(
      ((prefs ?? []) as { user_id: string; streak: boolean }[])
        .filter((p) => p.streak === false)
        .map((p) => p.user_id),
    )
    for (const uid of userIds) {
      if (streakOff.has(uid)) continue
      const { data: rows } = await admin
        .from('spot_count_daily')
        .select('date, count')
        .eq('user_id', uid)
        .gt('count', 0)
        .order('date', { ascending: false })
        .limit(90)
      const days = new Set(
        ((rows ?? []) as { date: string }[]).map((r) => r.date),
      )
      if (days.has(today) || !days.has(yesterday)) continue // safe or no streak
      // Length of the streak ending yesterday.
      let len = 0
      const cur = new Date(now.getTime() - 86400000)
      while (days.has(dayStr(cur))) {
        len += 1
        cur.setUTCDate(cur.getUTCDate() - 1)
      }
      streakSent += await sendToUser(
        admin,
        uid,
        JSON.stringify({
          title: '🔥 Streak en danger',
          body: `Ton streak de ${len} jour${len > 1 ? 's' : ''} est en danger ! Spotte une voiture avant minuit.`,
          url: '/new-spot',
        }),
      )
    }
  }

  // GP within the next 24h → broadcast.
  let gpSent = 0
  const soon = GP_2026.find((g) => {
    const diff = new Date(g.date).getTime() - now.getTime()
    return diff > 0 && diff <= 24 * 3600 * 1000
  })
  if (soon) {
    const payload = JSON.stringify({
      title: '🏁 Bientôt le départ',
      body: `${soon.name} dans 24h !`,
      url: '/discover',
    })
    for (const uid of userIds) gpSent += await sendToUser(admin, uid, payload)
  }

  res.status(200).json({ streakSent, gpSent, users: userIds.length })
  } catch (e) {
    const err = e as { message?: string; stack?: string }
    console.error('[cron-notify] crashed:', err)
    res.status(500).json({ error: 'Tâche planifiée échouée.' })
  }
}
