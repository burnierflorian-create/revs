// ═══════ RATTRAPAGE DES CANDIDATURES NON SIGNALÉES ═══════
//
// POURQUOI CE SCRIPT EXISTE
// `/api/organizer-request` enregistre la candidature AVANT d'envoyer l'alerte.
// C'est délibéré : une panne du fournisseur d'e-mail ne doit jamais faire
// disparaître un dossier. Mais la conséquence est qu'un dossier peut exister
// sans que personne ne l'ait vu passer. `admin_notified_at` marque ceux qui
// ont bien été signalés ; ce script s'occupe des autres.
//
// Il réutilise EXACTEMENT les gabarits de l'endpoint
// (server/organizer-email.js) : deux copies du même courriel finiraient par
// diverger, et c'est celle qu'on relit le moins qui se serait dégradée.
//
// USAGE
//   node scripts/organizer-notify-pending.mjs            # essai à blanc
//   node scripts/organizer-notify-pending.mjs --send     # envoie pour de vrai
//   node scripts/organizer-notify-pending.mjs --send --all
//        ↑ ignore `admin_notified_at` et renvoie TOUTES les candidatures en
//          attente. Utile si un envoi a été marqué à tort.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { ADMIN_SUBJECT, adminEmail } from '../server/organizer-email.js'

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const pick = (k, re) =>
  (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]

const db = createClient(
  pick('VITE_SUPABASE_URL', '[^\\s]+'),
  pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+'),
  { auth: { persistSession: false } },
)

const SEND = process.argv.includes('--send')
const ALL = process.argv.includes('--all')
const RESEND_KEY = pick('RESEND_API_KEY', '[^\\s]+') || process.env.RESEND_API_KEY || ''
const ADMIN_EMAIL =
  pick('REVS_ADMIN_EMAIL', '[^\\s]+') || 'burnierflorian74@gmail.com'
const FROM = pick('RESEND_FROM', '[^\\n]+') || 'REVS <onboarding@resend.dev>'

let q = db
  .from('organizer_requests')
  .select('*')
  .eq('status', 'pending')
  .order('created_at', { ascending: true })
if (!ALL) q = q.is('admin_notified_at', null)

const { data: rows, error } = await q
if (error) throw error

console.log(`candidatures en attente non signalées : ${rows.length}`)
if (!rows.length) process.exit(0)

for (const r of rows) {
  const when = new Date(r.created_at).toLocaleString('fr-FR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  })
  console.log(
    `\n· ${r.first_name ?? ''} ${r.last_name ?? ''} (${r.display_name ?? '—'})` +
      `\n  ${r.email ?? '—'} · ${r.phone ?? '—'} · ${r.city_region ?? '—'}` +
      `\n  ${(r.event_types ?? []).join(', ')} · ${r.experience_level ?? '—'}` +
      `\n  déposée le ${when}`,
  )

  if (!SEND) continue
  if (!RESEND_KEY) {
    console.log('  ✗ RESEND_API_KEY absente — rien envoyé.')
    continue
  }

  const html = adminEmail({
    firstName: r.first_name ?? '',
    lastName: r.last_name ?? '',
    displayName: r.display_name ?? '',
    email: r.email ?? '',
    phone: r.phone ?? '',
    cityRegion: r.city_region ?? '',
    instagram: r.instagram_url ?? null,
    website: r.website_url ?? null,
    organization: r.organization_name ?? '',
    eventTypes: r.event_types ?? [],
    experience: r.experience_level ?? '',
    eventRegion: r.event_region ?? '',
    attendance: r.expected_attendance ?? '',
    description: r.project_description ?? '',
    userId: r.user_id,
    createdAt: when,
  })

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: [ADMIN_EMAIL],
      subject: ADMIN_SUBJECT,
      html,
    }),
  })
  if (res.ok) {
    await db
      .from('organizer_requests')
      .update({ admin_notified_at: new Date().toISOString() })
      .eq('id', r.id)
    console.log(`  ✓ envoyée à ${ADMIN_EMAIL}`)
  } else {
    console.log(`  ✗ Resend ${res.status} : ${(await res.text()).slice(0, 200)}`)
  }
}

if (!SEND) console.log('\n(essai à blanc — relance avec --send)')
