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

// Quotas D'ANALYSE IA par jour et par tier, remis à zéro à minuit heure de
// Paris. `user_tier()` (migration 0015) renvoie 'premium' | 'vip' | 'starter'
// | null ; tout le reste retombe sur le tier gratuit.
//
// ⚠️ CE QUE CES NOMBRES LIMITENT, ET CE QU'ILS NE LIMITENT PAS
// Ils plafonnent les APPELS À CLAUDE, c'est-à-dire la facture. Ils ne
// plafonnent PAS la publication de spots : prendre une photo, saisir une
// voiture à la main et la publier ne coûte rien et reste illimité.
//
// 30/09/2026 — le gratuit est à 5 (porté à 10 le matin, ramené à 5 l'après-midi
// sur demande explicite du brief P0-3), et surtout le raisonnement
// du 26/09 est ABANDONNÉ. Ce jour-là, le quota IA avait été aligné sur le
// nombre de spots publiables « pour que les deux plafonds coïncident ». C'était
// aligner deux choses qui n'ont rien à voir : l'une protège un budget, l'autre
// rationnait une fonctionnalité gratuite. Le résultat était qu'épuiser ses
// analyses interdisait de publier — voir le bloc supprimé plus bas.
//
// Ces valeurs sont la référence exécutoire. Tout endroit qui AFFICHE un
// plafond (src/lib/plans.ts, src/components/WelcomeCelebration.tsx) doit citer
// les mêmes chiffres, et `ai_daily_limit()` (migration 0086) les réplique en
// SQL pour que l'application puisse les afficher.
//   free / starter  5  ·  premium  30  ·  vip  300
const DAILY_LIMITS = {
  free: 5,
  starter: 5,
  premium: 30,
  vip: 300,
}

// ── LA CONFIDENTIALITÉ N'EST PAS UN QUOTA (30/09/2026) ──
//
// `detect-plate` passait par les mêmes plafonds que `identify-car`. Un
// utilisateur gratuit ayant épuisé ses analyses se voyait donc refuser la
// DÉTECTION DE PLAQUE — et publiait alors une photo non anonymisée, sur simple
// case à cocher. Autrement dit : la protection de la vie privée des personnes
// filmées dépendait du forfait du photographe.
//
// Identifier une voiture est un service, rationnable. Flouter une plaque est
// une obligation. Les deux ne peuvent pas partager un compteur.
//
// Ce plafond-ci n'est donc PAS un quota produit mais un garde anti-abus : il
// n'existe que pour arrêter une boucle défectueuse ou un script.
//
// ── 300 → 30 SUR LE PALIER GRATUIT (02/10/2026) ──
//
// Le commentaire ci-dessus datait d'une époque où l'appel coûtait ≈ 0,005 $.
// Il en coûte aujourd'hui ≈ 0,009 $ : Sonnet pour la détection, plus une
// vérification de la boîte sur une vignette. Un plafond de 300 laissait donc
// un SEUL compte gratuit dépenser 2,70 $ par jour, et cent comptes créés
// automatiquement 270 $ par jour. Ce n'est plus un garde, c'est une porte.
//
// Le nouveau plafond gratuit est de 30. Il reste très au-dessus de tout usage
// humain — le compte le plus actif de REVS totalise une trentaine de spots
// depuis sa création, soit autant de détections en plusieurs mois — tout en
// ramenant l'exposition d'un compte abusif à 0,27 $ par jour.
//
// Les paliers payants gardent un plafond élevé : leur abonnement couvre le
// coût, et un plafond bas y deviendrait une gêne au lieu d'une protection.
//
// ⚠️ CE QUI N'A PAS CHANGÉ, ET NE DOIT PAS : ce compteur reste SÉPARÉ de
// `DAILY_LIMITS`. Flouter une plaque reste une obligation, jamais un service
// rationné — c'est tout le sens du commentaire d'origine, et l'épuisement des
// analyses ne doit jamais faire publier une plaque lisible.
const PRIVACY_DAILY_LIMITS = {
  free: 30,
  starter: 30,
  premium: 300,
  vip: 300,
}

/** Le plafond applicable à un endpoint, pour un tier donné. */
function limitFor(endpoint, tier) {
  if (endpoint === AI_ENDPOINTS.DETECT_PLATE) {
    return PRIVACY_DAILY_LIMITS[tier] ?? PRIVACY_DAILY_LIMITS.free
  }
  return DAILY_LIMITS[tier] ?? DAILY_LIMITS.free
}

const MESSAGES = {
  missing_token: 'Authentication required',
  invalid_token: 'Authentication required',
  cooldown: 'Doucement ! Attends quelques secondes avant le prochain scan.',
  // Message vu par l'utilisateur quand ses analyses du jour sont épuisées. Il
  // dit explicitement que la publication reste possible : c'est la seule chose
  // qui compte pour lui à cet instant, et l'ancien texte laissait croire que
  // REVS entier était fermé jusqu'au lendemain.
  quota_exceeded:
    'Analyses IA épuisées pour aujourd’hui. Tu peux toujours saisir la voiture à la main et publier.',
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
 *
 * N'a plus d'appelant DANS ce fichier depuis que le plafond de publication en
 * est sorti (30/09/2026). Conservé parce qu'il reste la définition de référence
 * de « la journée » côté serveur, dupliquée à l'identique dans src/lib/spots.ts
 * et dans le trigger de la migration 0068.
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
  const limit = limitFor(endpoint, tier)

  // ─── SUPPRIMÉ le 30/09/2026 : le plafond de PUBLICATION vivait ici ───
  //
  // Ce portail comptait les spots déjà publiés dans la journée et refusait le
  // SCAN au-delà. Deux choses sans rapport se bloquaient mutuellement :
  //
  //   « Tu as publié 5 spots aujourd'hui, donc tu ne peux plus analyser. »
  //   « Tu as analysé 5 photos aujourd'hui, donc tu ne peux plus publier. »
  //
  // La seconde était la plus absurde : publier ne déclenche aucun appel IA et
  // ne coûte donc rien. Ce portail n'a qu'un seul travail — décider si REVS
  // paie un appel à Claude — et il s'en tient désormais à celui-là.
  //
  // La publication reste protégée, mais AILLEURS et pour une autre raison : le
  // trigger `enforce_spot_daily_quota` (migrations 0068 puis 0086) force
  // `created_at` et arrête un flot manifestement automatisé. C'est un garde
  // anti-abus, pas un quota commercial, et il ne dépend d'aucun tier.

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
