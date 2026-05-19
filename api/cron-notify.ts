import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

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

type Admin = ReturnType<typeof createClient>

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
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  if (!SUPABASE_URL || !SERVICE_ROLE || !VAPID_PUBLIC || !VAPID_PRIVATE) {
    res.status(500).json({ error: 'Not configured' })
    return
  }
  try {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  })
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
    res.status(500).json({ error: err?.message || String(e) })
  }
}
