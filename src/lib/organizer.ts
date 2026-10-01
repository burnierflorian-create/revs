// ═══════════════ CANDIDATURE ORGANISATEUR — ACCÈS CLIENT ═══════════════
//
// Le client ne peut RIEN écrire directement : `authenticated` n'a aucun droit
// INSERT ni UPDATE sur `organizer_requests` (migration 0092). Tout passe par
// `/api/organizer-request`, qui dépose via une fonction SECURITY DEFINER —
// elle seule décide du `user_id`, du statut et de l'adresse e-mail.
//
// La lecture, elle, est directe : `my_organizer_request()` ne renvoie que
// l'état du dossier de l'appelant (statut et dates), jamais les notes
// internes ni l'identité de celui qui a instruit.

import { supabase } from './supabase'

export const EVENT_TYPES = [
  'cars_coffee', 'meetup', 'drive', 'track', 'show', 'private', 'other',
] as const
export const EXPERIENCE_LEVELS = [
  'beginner', 'under_1y', '1_3y', '3_5y', 'over_5y',
] as const
export const ATTENDANCE_RANGES = [
  'lt20', '20_50', '50_100', '100_250', 'gt250', 'unknown',
] as const

export type EventType = (typeof EVENT_TYPES)[number]
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number]
export type AttendanceRange = (typeof ATTENDANCE_RANGES)[number]
export type OrganizerStatus = 'pending' | 'approved' | 'rejected'

export type OrganizerRequestState = {
  id: string
  status: OrganizerStatus
  created_at: string
  reviewed_at: string | null
}

export type OrganizerForm = {
  first_name: string
  last_name: string
  display_name: string
  phone: string
  city_region: string
  instagram_url: string
  website_url: string
  organization_name: string
  event_types: EventType[]
  experience_level: ExperienceLevel | ''
  event_region: string
  expected_attendance: AttendanceRange | ''
  project_description: string
  consent_contact: boolean
}

export const EMPTY_FORM: OrganizerForm = {
  first_name: '', last_name: '', display_name: '', phone: '',
  city_region: '', instagram_url: '', website_url: '', organization_name: '',
  event_types: [], experience_level: '', event_region: '',
  expected_attendance: '', project_description: '', consent_contact: false,
}

export const DESCRIPTION_MAX = 1000

/** L'état du dossier courant, ou null si l'utilisateur n'a jamais candidaté. */
export async function fetchMyOrganizerRequest(): Promise<OrganizerRequestState | null> {
  const { data, error } = await supabase.rpc('my_organizer_request')
  if (error) {
    console.error('[organisateur] lecture du statut échouée:', error.message)
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  return (row as OrganizerRequestState | undefined) ?? null
}

export type SubmitResult =
  | { ok: true; requestId: string; emailed: boolean }
  | { ok: false; error: string }

/**
 * Dépose la candidature.
 *
 * `emailed: false` signifie que le dossier EST enregistré mais que l'alerte
 * à l'administrateur n'est pas partie. L'interface doit le dire — une
 * confirmation qui tairait cela serait un mensonge, et le brief l'interdit.
 */
export async function submitOrganizerRequest(form: OrganizerForm): Promise<SubmitResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) return { ok: false, error: 'not_authenticated' }

  try {
    const res = await fetch('/api/organizer-request', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(form),
    })
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      request_id?: string
      emailed?: boolean
      error?: string
    }
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error || `http_${res.status}` }
    }
    return {
      ok: true,
      requestId: String(body.request_id ?? ''),
      emailed: body.emailed === true,
    }
  } catch {
    return { ok: false, error: 'network' }
  }
}

// ─────────────── Validation, partagée par le formulaire ───────────────
// Les mêmes règles qu'au serveur, pour que l'utilisateur sache tout de suite
// ce qui manque. Le serveur reste l'autorité : celles-ci sont un confort.

export function isValidPhone(v: string): boolean {
  const s = v.trim()
  if (!/^\+?[\d\s().-]{8,24}$/.test(s)) return false
  return (s.match(/\d/g) || []).length >= 8
}

/** Accepte « @pseudo », « instagram.com/pseudo » ou une URL complète. */
export function isValidInstagram(v: string): boolean {
  const s = v.trim()
  if (!s) return true
  if (/^@?[A-Za-z0-9._]{1,30}$/.test(s)) return true
  return isValidUrl(s)
}

export function isValidUrl(v: string): boolean {
  const s = v.trim()
  if (!s) return true
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.')
  } catch {
    return false
  }
}

/** Les champs manquants de l'étape « Tes informations ». */
export function stepIdentityErrors(f: OrganizerForm): Record<string, string> {
  const e: Record<string, string> = {}
  if (!f.first_name.trim()) e.first_name = 'required'
  if (!f.last_name.trim()) e.last_name = 'required'
  if (!f.display_name.trim()) e.display_name = 'required'
  if (!f.phone.trim()) e.phone = 'required'
  else if (!isValidPhone(f.phone)) e.phone = 'phone'
  if (!f.city_region.trim()) e.city_region = 'required'
  if (!isValidInstagram(f.instagram_url)) e.instagram_url = 'url'
  if (!isValidUrl(f.website_url)) e.website_url = 'url'
  return e
}

/** Les champs manquants de l'étape « Ton expérience et tes événements ». */
export function stepProjectErrors(f: OrganizerForm): Record<string, string> {
  const e: Record<string, string> = {}
  if (f.event_types.length === 0) e.event_types = 'required'
  if (!f.experience_level) e.experience_level = 'required'
  if (!f.project_description.trim()) e.project_description = 'required'
  else if (f.project_description.length > DESCRIPTION_MAX) e.project_description = 'too_long'
  return e
}
