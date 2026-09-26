// ─────────────────────── Portail d'accès aux endpoints IA ───────────────────────
//
// Point de vérité unique pour /api/identify-car et /api/detect-plate, suite au
// diagnostic du 25/09/2026 : les deux acceptaient des appels Claude sans aucun
// contrôle d'accès (CORS `*`, aucun jeton exigé, quota contournable en omettant
// simplement l'en-tête Authorization).
//
// Règle : FAIL-CLOSED. Au moindre doute — jeton absent, invalide, expiré, ou
// compteur de quota illisible — on refuse. L'ancien comportement « fail-open »
// est supprimé : il n'existe plus de mode invité, d'utilisateur assumé, ni de
// chemin qui atteint Claude sans user_id vérifié.
//
// Ce fichier vit HORS de api/ : tout fichier placé dans api/ devient une
// fonction serverless Vercel, et le projet en compte déjà 15.
//
// ⚠️ Nécessite la migration supabase/0067-ai-gate.sql (colonne ai_usage.endpoint,
//    fonctions ai_gate_consume() et log_api_abuse(), table api_abuse_attempts).

import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

/** Noms d'endpoint utilisés comme clé de compteur. */
export const AI_ENDPOINTS = {
  IDENTIFY: 'identify-car',
  DETECT_PLATE: 'detect-plate',
}

/** Écart minimum entre deux appels d'un même utilisateur sur un même endpoint. */
const COOLDOWN_MS = 3000

// Quotas journaliers par tier, remis à zéro à minuit heure de Paris.
// `user_tier()` (migration 0015) renvoie 'premium' | 'vip' | 'starter' | null ;
// tout le reste retombe sur le tier gratuit.
// 26/09/2026 — le gratuit passe de 6 à 5 pour coller à la limite de spots
// PUBLIABLES par jour. Les deux plafonds étaient désalignés : un utilisateur
// gratuit consommait 6 reconnaissances (~0,01 $ chacune) mais ne pouvait
// publier que 5 spots. Le 6e scan était payé pour rien, puis refusé à la
// publication.
const DAILY_LIMITS = {
  free: 5,
  starter: 5,
  premium: 100,
  vip: 300,
}

const MESSAGES = {
  missing_token: 'Authentication required',
  invalid_token: 'Authentication required',
  cooldown: 'Doucement ! Attends quelques secondes avant le prochain scan.',
  quota_exceeded: 'Tu as atteint ta limite du jour, réessaie demain',
  publish_quota_exceeded:
    'Tu as publié tous tes spots du jour, réessaie demain',
  gate_unavailable:
    'Service momentanément indisponible, réessaie dans un instant.',
}

let _client
function getServiceClient() {
  if (_client !== undefined) return _client
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  _client =
    url && key ? createClient(url, key, { auth: { persistSession: false } }) : null
  return _client
}

/** Date du jour au format YYYY-MM-DD en heure de Paris — la remise à zéro du
 *  quota suit le fuseau de l'utilisateur, pas UTC. */
export function parisDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Composantes date+heure d'un instant, lues en heure de Paris. */
function parisParts(d) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const o = {}
  for (const p of f.formatToParts(d)) if (p.type !== 'literal') o[p.type] = p.value
  return o
}

/**
 * Instant UTC correspondant à minuit, heure de Paris, du jour en cours.
 * Sert de borne basse pour compter les spots publiés « aujourd'hui » dans la
 * table `spots`, dont `created_at` est un timestamptz.
 *
 * Paris est à UTC+1 en hiver et UTC+2 en été : on teste les deux décalages et
 * on retient l'instant qui retombe exactement sur 00:00 le bon jour. Le
 * passage à l'heure d'été saute 02:00, jamais minuit, donc les deux nuits de
 * changement d'heure sont traitées correctement.
 *
 * @returns {Date}
 */
export function parisDayStart(now = new Date()) {
  const today = parisDay(now)
  const base = Date.parse(`${today}T00:00:00Z`)
  for (const offsetHours of [1, 2]) {
    const candidate = new Date(base - offsetHours * 3600000)
    const p = parisParts(candidate)
    if (
      `${p.year}-${p.month}-${p.day}` === today &&
      p.hour === '00' &&
      p.minute === '00'
    ) {
      return candidate
    }
  }
  // Repli : minuit UTC. Au pire la fenêtre est décalée d'une ou deux heures,
  // ce qui vaut mieux que de ne pas compter du tout.
  console.warn('[ai-gate] offset Paris indéterminé, repli sur minuit UTC')
  return new Date(base)
}

/** Nombre de spots publiés par l'utilisateur depuis minuit heure de Paris.
 *  Renvoie null si le comptage échoue — l'appelant décide quoi en faire. */
async function countSpotsToday(sb, userId) {
  try {
    const { count, error } = await sb
      .from('spots')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', parisDayStart().toISOString())
    if (error) throw new Error(error.message)
    return typeof count === 'number' ? count : null
  } catch (e) {
    console.error('[ai-gate] comptage des spots du jour échoué:', e?.message ?? e)
    return null
  }
}

/** SHA-256 salé de l'IP appelante. On ne stocke jamais l'IP en clair : le
 *  journal sert à repérer un scan, pas à identifier une personne. */
function hashIp(req) {
  const fwd = req.headers['x-forwarded-for']
  const raw =
    (typeof fwd === 'string' ? fwd.split(',')[0] : Array.isArray(fwd) ? fwd[0] : '') ||
    (typeof req.headers['x-real-ip'] === 'string' ? req.headers['x-real-ip'] : '') ||
    ''
  const ip = raw.trim()
  if (!ip) return null
  const salt = process.env.ABUSE_IP_SALT || 'revs-abuse-salt-v1'
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex')
}

/** Journalise un refus. Best-effort strict : un échec d'écriture ne doit
 *  jamais transformer un 401 en 500. */
async function logAbuse(sb, req, endpoint, reason) {
  if (!sb) return
  try {
    const ua = req.headers['user-agent']
    await sb.rpc('log_api_abuse', {
      p_endpoint: endpoint,
      p_ip_hash: hashIp(req),
      p_user_agent: typeof ua === 'string' ? ua : null,
      p_reason: reason,
    })
  } catch (e) {
    console.error('[ai-gate] abuse log failed:', e?.message ?? e)
  }
}

function deny(status, reason) {
  return {
    ok: false,
    status,
    reason,
    body: { error: reason, message: MESSAGES[reason] ?? 'Requête refusée.' },
  }
}

/**
 * Vérifie l'accès à un endpoint IA : authentification obligatoire, puis
 * cooldown et quota journalier selon le tier.
 *
 * Le user_id provient EXCLUSIVEMENT du jeton vérifié — jamais du corps de la
 * requête, qui reste entièrement sous le contrôle de l'appelant.
 *
 * @param {import('@vercel/node').VercelRequest} req
 * @param {string} endpoint  clé de comptage (voir AI_ENDPOINTS)
 * @returns {Promise<{ok: true, userId: string, tier: string, used: number, limit: number}
 *                  | {ok: false, status: number, reason: string, body: {error: string, message: string}}>}
 */
export async function requireAiAccess(req, endpoint) {
  const sb = getServiceClient()

  // Sans client service-role on ne sait ni vérifier le jeton ni compter les
  // appels : refuser est la seule option sûre (un fail-open ici rouvrirait
  // exactement la faille qu'on ferme).
  if (!sb) {
    console.error('[ai-gate] service client unavailable — refusing')
    return deny(503, 'gate_unavailable')
  }

  const rawAuth = req.headers.authorization || req.headers.Authorization || ''
  const auth = typeof rawAuth === 'string' ? rawAuth : ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) {
    await logAbuse(sb, req, endpoint, 'missing_token')
    return deny(401, 'missing_token')
  }

  // getUser() rejette aussi bien un jeton falsifié qu'un jeton expiré ; une
  // exception réseau est traitée comme un refus, jamais comme un laissez-passer.
  let user = null
  try {
    const { data, error } = await sb.auth.getUser(token)
    if (error) {
      console.warn('[ai-gate] token rejected:', error.message)
    }
    user = data?.user ?? null
  } catch (e) {
    console.error('[ai-gate] getUser threw:', e?.message ?? e)
  }
  if (!user?.id) {
    await logAbuse(sb, req, endpoint, 'invalid_token')
    return deny(401, 'invalid_token')
  }

  // Tier dérivé de l'abonnement Stripe via user_tier() (migration 0015), et
  // non de profiles.tier — cette colonne n'est jamais écrite (diagnostic §08).
  let tier = 'free'
  try {
    const { data } = await sb.rpc('user_tier', { p_user: user.id })
    if (typeof data === 'string' && data) tier = data.toLowerCase()
  } catch (e) {
    // Tier illisible → on retombe sur le quota gratuit. C'est restrictif, donc
    // sans danger pour le coût ; l'utilisateur payant verra une limite basse
    // plutôt qu'un accès illimité accordé par erreur.
    console.error('[ai-gate] user_tier failed, falling back to free:', e?.message ?? e)
  }
  const limit = DAILY_LIMITS[tier] ?? DAILY_LIMITS.free

  // ─── Plafond de PUBLICATION, vérifié côté serveur ───
  // Jusqu'au 26/09/2026, la limite de spots publiables par jour n'existait que
  // dans le navigateur (NewSpot.tsx) : un INSERT PostgREST direct l'ignorait
  // complètement. Elle est désormais contrôlée ici, sur la table `spots`, avec
  // la même borne de journée que le quota de scans — minuit heure de Paris.
  //
  // Ce test passe AVANT ai_gate_consume() : un utilisateur qui a déjà publié
  // son quota est refusé sans perdre un crédit de scan au passage.
  const published = await countSpotsToday(sb, user.id)
  if (published !== null && published >= limit) {
    console.log(
      `[quota] user ${user.id} (tier ${tier}) — ${published}/${limit} spots publiés aujourd'hui, scan refusé`,
    )
    await logAbuse(sb, req, endpoint, 'publish_quota_exceeded')
    return deny(429, 'publish_quota_exceeded')
  }

  // Cooldown + quota + incrément, atomiques côté Postgres : deux requêtes
  // concurrentes ne peuvent pas consommer deux fois le même crédit.
  let verdict
  try {
    const { data, error } = await sb.rpc('ai_gate_consume', {
      p_user: user.id,
      p_endpoint: endpoint,
      p_day: parisDay(),
      p_limit: limit,
      p_cooldown_ms: COOLDOWN_MS,
    })
    if (error) throw new Error(error.message)
    verdict = Array.isArray(data) ? data[0] : data
  } catch (e) {
    // Compteur illisible → refus. Laisser passer un appel non compté est
    // précisément le trou que cette migration ferme.
    console.error('[ai-gate] consume failed:', e?.message ?? e)
    await logAbuse(sb, req, endpoint, 'gate_unavailable')
    return deny(503, 'gate_unavailable')
  }

  if (!verdict?.allowed) {
    const reason = verdict?.reason === 'cooldown' ? 'cooldown' : 'quota_exceeded'
    console.log(
      `[ai-gate] ${endpoint} refusé pour ${user.id} (tier ${tier}) — ${reason}, ${verdict?.used ?? '?'}/${limit}`,
    )
    await logAbuse(sb, req, endpoint, reason)
    return deny(429, reason)
  }

  console.log(
    `[ai-gate] ${endpoint} ok pour ${user.id} (tier ${tier}) — ${verdict.used}/${limit}`,
  )
  return { ok: true, userId: user.id, tier, used: verdict.used, limit }
}
