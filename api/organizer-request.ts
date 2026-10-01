// ═══════════ CANDIDATURE ORGANISATEUR — DÉPÔT ET NOTIFICATION ═══════════
//
// RUNTIME EDGE, ET CE N'EST PAS UN CHOIX ESTHÉTIQUE
// Le plan Vercel plafonne à 12 fonctions serverless Node. Le projet en compte
// déjà exactement 12 (api/og.ts, api/s.ts et api/tutorial.ts sont passés en
// edge pour cette raison). Une 13ᵉ fonction Node ferait échouer le
// déploiement entier. Celle-ci est donc edge — ce qui tombe bien : elle ne
// fait que des appels HTTP.
//
// AUCUNE CLÉ DE SERVICE ICI
// L'insertion passe par `submit_organizer_request()`, appelée avec le JETON
// DE L'UTILISATEUR. La fonction est SECURITY DEFINER : c'est elle qui décide
// du `user_id`, du statut et de l'adresse e-mail — pas le corps de la
// requête. Le client ne peut donc ni déposer sous l'identité d'un autre, ni
// naître approuvé. La clé service_role n'est jamais chargée par cette
// fonction, et `authenticated` n'a aucun droit INSERT sur la table.
//
// L'E-MAIL NE PEUT PAS FAIRE ÉCHOUER LA CANDIDATURE
// L'ordre est délibéré : on enregistre d'abord, on prévient ensuite. Si le
// fournisseur d'e-mail tombe, le dossier existe quand même et la réponse le
// dit (`emailed: false`) — plutôt que d'afficher une fausse confirmation ou,
// pire, de perdre la candidature. Le rattrapage est possible :
// `node scripts/organizer-notify-pending.mjs`.

import {
  ADMIN_SUBJECT,
  USER_SUBJECT,
  adminEmail,
  userEmail,
} from '../server/organizer-email.js'

export const config = { runtime: 'edge' }

// Vercel injecte les variables d'environnement dans process.env sur l'edge ;
// on le déclare pour que la fonction se type-checke sans @types/node.
declare const process: { env: Record<string, string | undefined> }

const ADMIN_EMAIL = process.env.REVS_ADMIN_EMAIL || 'burnierflorian74@gmail.com'
// `onboarding@resend.dev` est l'expéditeur de démarrage de Resend : il
// fonctionne sans domaine vérifié, mais UNIQUEMENT vers l'adresse du titulaire
// du compte. Dès qu'un domaine REVS sera vérifié, poser RESEND_FROM.
const FROM = process.env.RESEND_FROM || 'REVS <onboarding@resend.dev>'
const RESEND_KEY = process.env.RESEND_API_KEY || ''

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || ''

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })

type Payload = {
  first_name?: string
  last_name?: string
  display_name?: string
  phone?: string
  city_region?: string
  instagram_url?: string
  website_url?: string
  organization_name?: string
  event_types?: unknown
  experience_level?: string
  event_region?: string
  expected_attendance?: string
  project_description?: string
  consent_contact?: boolean
}

const EVENT_TYPES = [
  'cars_coffee', 'meetup', 'drive', 'track', 'show', 'private', 'other',
] as const
const EXPERIENCE = [
  'beginner', 'under_1y', '1_3y', '3_5y', 'over_5y',
] as const
const ATTENDANCE = [
  'lt20', '20_50', '50_100', '100_250', 'gt250', 'unknown',
] as const


/** Un lien n'est accepté que s'il est http(s) — pas de `javascript:`. */
function safeUrl(raw: string | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(withScheme)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

// ─────────────────────── Les courriels ───────────────────────
//
// Tableaux et styles en ligne, volontairement. Gmail retire les <style>, et
// Outlook ignore flexbox, grid et les variables CSS : une mise en page
// « moderne » arriverait en colonne unique chez la moitié des destinataires.

async function sendMail(to: string, subject: string, html: string): Promise<string | null> {
  if (!RESEND_KEY) return 'resend_not_configured'
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    })
    if (r.ok) return null
    const text = await r.text()
    return `resend_${r.status}: ${text.slice(0, 200)}`
  } catch (e) {
    return `resend_network: ${String(e).slice(0, 160)}`
  }
}

// ─────────────────────── Le gestionnaire ───────────────────────
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !ANON_KEY) return json({ error: 'server_misconfigured' }, 500)

  // 1 — Qui parle ? Le jeton est la seule source d'identité acceptée.
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return json({ error: 'not_authenticated' }, 401)

  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
  })
  if (!who.ok) return json({ error: 'not_authenticated' }, 401)
  const user = (await who.json()) as { id?: string; email?: string }
  if (!user.id) return json({ error: 'not_authenticated' }, 401)

  // 2 — Le corps, lu avec méfiance.
  let p: Payload
  try {
    p = (await req.json()) as Payload
  } catch {
    return json({ error: 'bad_request' }, 400)
  }

  const types = Array.isArray(p.event_types)
    ? (p.event_types as unknown[])
        .map(String)
        .filter((x) => (EVENT_TYPES as readonly string[]).includes(x))
    : []
  const experience = (EXPERIENCE as readonly string[]).includes(String(p.experience_level))
    ? String(p.experience_level)
    : ''
  const attendance = (ATTENDANCE as readonly string[]).includes(String(p.expected_attendance))
    ? String(p.expected_attendance)
    : ''

  const firstName = String(p.first_name ?? '').trim()
  const lastName = String(p.last_name ?? '').trim()
  const phone = String(p.phone ?? '').trim()
  const cityRegion = String(p.city_region ?? '').trim()
  const description = String(p.project_description ?? '').trim()

  // Validation serveur. `submit_organizer_request()` revalide en base — deux
  // filets, parce que l'endpoint est joignable sans passer par le formulaire.
  if (
    !firstName || !lastName || !phone || !cityRegion || !description ||
    types.length === 0 || !experience || p.consent_contact !== true
  ) {
    return json({ error: 'missing_required_fields' }, 400)
  }
  if (description.length > 1000) return json({ error: 'description_too_long' }, 400)
  // Format international raisonnable : 8 à 15 chiffres, « + » et séparateurs
  // tolérés. Volontairement permissif — refuser un numéro valide coûte plus
  // cher qu'accepter un numéro mal formé qu'un humain lira de toute façon.
  if (!/^\+?[\d\s().-]{8,24}$/.test(phone) || (phone.match(/\d/g) || []).length < 8) {
    return json({ error: 'invalid_phone' }, 400)
  }

  const instagram = safeUrl(
    p.instagram_url && !/^https?:\/\//i.test(String(p.instagram_url).trim())
      ? `https://instagram.com/${String(p.instagram_url).trim().replace(/^@+/, '')}`
      : p.instagram_url,
  )
  const website = safeUrl(p.website_url)

  // 3 — Enregistrement. SECURITY DEFINER côté base : c'est elle qui fixe
  // user_id, statut et e-mail.
  const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_organizer_request`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_first_name: firstName,
      p_last_name: lastName,
      p_display_name: String(p.display_name ?? '').trim(),
      p_email: user.email ?? '',
      p_phone: phone,
      p_city_region: cityRegion,
      p_instagram_url: instagram,
      p_website_url: website,
      p_organization_name: String(p.organization_name ?? '').trim(),
      p_event_types: types,
      p_experience_level: experience,
      p_event_region: String(p.event_region ?? '').trim() || cityRegion,
      p_expected_attendance: attendance,
      p_project_description: description,
      p_consent_contact: true,
    }),
  })

  if (!rpc.ok) {
    const text = await rpc.text()
    // Les deux cas que l'interface doit savoir distinguer d'une panne.
    if (text.includes('request_already_open')) return json({ error: 'request_already_open' }, 409)
    if (text.includes('already_organizer')) return json({ error: 'already_organizer' }, 409)
    console.error('[organizer-request] insertion refusée:', text.slice(0, 300))
    return json({ error: 'save_failed' }, 500)
  }
  const requestId = String((await rpc.json()) ?? '').replace(/"/g, '')

  // 4 — Notification. À partir d'ici, la candidature EXISTE : plus aucune
  // erreur ne doit la faire disparaître.
  const createdAt = new Date().toLocaleString('fr-FR', {
    dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris',
  })
  const adminErr = await sendMail(
    ADMIN_EMAIL,
    ADMIN_SUBJECT,
    adminEmail({
      firstName, lastName,
      displayName: String(p.display_name ?? '').trim(),
      email: user.email ?? '',
      phone, cityRegion, instagram, website,
      organization: String(p.organization_name ?? '').trim(),
      eventTypes: types, experience,
      eventRegion: String(p.event_region ?? '').trim() || cityRegion,
      attendance, description,
      userId: user.id, createdAt,
    }),
  )
  if (adminErr) console.error('[organizer-request] e-mail admin:', adminErr)

  if (!adminErr) {
    // Trace d'envoi, pour que le script de rattrapage sache quoi ignorer.
    void fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_organizer_notified`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_id: requestId }),
    }).catch(() => {})
  }

  // L'accusé de réception au candidat est un confort, pas une obligation :
  // son échec n'est même pas remonté à l'interface.
  if (user.email) {
    const userErr = await sendMail(
      user.email,
      USER_SUBJECT,
      userEmail(firstName),
    )
    if (userErr) console.error('[organizer-request] e-mail candidat:', userErr)
  }

  return json({ ok: true, request_id: requestId, emailed: !adminErr })
}
