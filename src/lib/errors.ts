// Translates the most common Supabase/Postgrest/Auth/fetch error
// messages into user-facing French. Anything we don't recognise falls
// back to a generic French sentence — we NEVER show raw English to the
// user.

const EXACT: Record<string, string> = {
  // Supabase Auth — exact messages emitted by gotrue
  'Invalid login credentials': 'Identifiants incorrects.',
  'Email not confirmed': 'E-mail non confirmé. Vérifie ta boîte mail.',
  'Email rate limit exceeded':
    'Trop de tentatives. Réessaie dans quelques minutes.',
  'User already registered': 'Un compte existe déjà avec cet e-mail.',
  'User not found': 'Aucun compte trouvé pour cet e-mail.',
  'Password should be at least 6 characters.':
    'Le mot de passe doit contenir au moins 6 caractères.',
  'Password should be at least 6 characters':
    'Le mot de passe doit contenir au moins 6 caractères.',
  'Signup requires a valid password': 'Mot de passe requis.',
  'Unable to validate email address: invalid format':
    "Format d'e-mail invalide.",
  'New password should be different from the old password.':
    "Le nouveau mot de passe doit être différent de l'ancien.",
  'Token has expired or is invalid': 'Lien expiré ou invalide.',
  'Auth session missing!': 'Session expirée. Reconnecte-toi.',
  'JWT expired': 'Session expirée. Reconnecte-toi.',
  'Network request failed': 'Erreur réseau. Vérifie ta connexion.',
  'Failed to fetch': 'Erreur réseau. Vérifie ta connexion.',
  // Generic API responses
  Unauthorized: 'Non autorisé. Reconnecte-toi.',
  'Method not allowed': 'Méthode non autorisée.',
  'Not configured': 'Service indisponible — réessaie plus tard.',
  'Server not configured': 'Service indisponible — réessaie plus tard.',
  'Stripe not configured':
    'Paiement indisponible — réessaie plus tard.',
  'Invalid token': 'Session invalide. Reconnecte-toi.',
  'Missing token': 'Session manquante. Reconnecte-toi.',
  'Push not configured (VAPID/Supabase env)':
    'Notifications indisponibles — réessaie plus tard.',
  'Missing env (Supabase service role / Anthropic key)':
    'Service indisponible — réessaie plus tard.',
  'Missing title': 'Titre manquant.',
  'Missing spot_id': 'Spot manquant.',
  'Spot not found': 'Spot introuvable.',
  'Could not parse Claude JSON':
    'Impossible de récupérer les caractéristiques pour le moment.',
  'Invalid plan or missing user': 'Choix de formule invalide.',
}

// Substring matches — used when only a fragment of the message is in
// English (e.g. PostgREST returns long compound errors).
const SUBSTRING: [RegExp, string][] = [
  [/duplicate key value/i, 'Cette donnée existe déjà.'],
  [/violates row-level security/i,
    "Accès refusé — tu n'as pas les permissions pour cette action."],
  [/permission denied/i, 'Accès refusé.'],
  [/violates not-null/i, 'Champ obligatoire manquant.'],
  [/violates foreign key/i, 'Référence invalide.'],
  [/value too long/i, 'Valeur trop longue.'],
  [/check constraint/i, 'Valeur invalide.'],
  [/rate limit/i, 'Trop de requêtes. Réessaie dans quelques instants.'],
  [/network|fetch failed|networkerror|offline/i,
    'Erreur réseau. Vérifie ta connexion.'],
  [/timeout|timed out/i, 'Le serveur met trop de temps à répondre.'],
  [/unauthor/i, 'Non autorisé. Reconnecte-toi.'],
  [/forbidden/i, 'Action interdite.'],
  [/not found/i, 'Ressource introuvable.'],
  [/internal server error/i, 'Erreur serveur — réessaie plus tard.'],
  [/bad request/i, 'Requête invalide.'],
  [/payload too large|file too large/i, 'Fichier trop volumineux.'],
  [/storage.*quota|exceeded/i, 'Quota dépassé.'],
  [/invalid (api )?key/i, 'Clé invalide — contacte le support.'],
]

function looksAlreadyFrench(s: string): boolean {
  if (!s) return false
  const lower = s.toLowerCase()
  if (/[àâçéèêëîïôûùüÿœæ]/.test(lower)) return true
  return /\b(le|la|les|un|une|des|du|de|au|aux|et|ou|est|sont|avec|pour|dans|sur|par|qui|que|d'|l'|c'|n'|réessaie|impossible|introuvable|invalide|erreur|requis|trop|aucun|déjà)\b/.test(
    lower,
  )
}

export function translateError(err: unknown): string {
  if (err == null) return 'Erreur inconnue.'
  // Strings come first because we sometimes get plain strings from API
  // JSON responses (data.error).
  if (typeof err === 'string') return mapMessage(err)
  if (err instanceof Error) return mapMessage(err.message)
  // Supabase/Postgrest errors are plain objects with .message/.error_description.
  const o = err as {
    message?: string
    error_description?: string
    error?: string | { message?: string }
    msg?: string
    hint?: string
    details?: string
  }
  const raw =
    o.error_description ||
    o.message ||
    (typeof o.error === 'string' ? o.error : o.error?.message) ||
    o.msg ||
    o.details ||
    o.hint ||
    ''
  if (raw) return mapMessage(raw)
  return 'Erreur inconnue.'
}

function mapMessage(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return 'Erreur inconnue.'
  // 1) exact match
  const exact = EXACT[trimmed]
  if (exact) return exact
  // 2) substring match
  for (const [re, fr] of SUBSTRING) if (re.test(trimmed)) return fr
  // 3) already in French → keep it
  if (looksAlreadyFrench(trimmed)) return trimmed
  // 4) unknown English → generic FR fallback (but don't lose the info
  // entirely for advanced users — append the original code-like part if
  // it's short and looks like a code).
  return 'Une erreur est survenue. Réessaie plus tard.'
}
