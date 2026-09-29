// ─────────────────────── REVS Master Tutorial — service du contenu ───────────────────────
//
// Le tutoriel décrit l'architecture interne de REVS : où vivent les secrets,
// quelles protections existent, lesquelles n'existent pas encore. Ce n'est pas
// un secret cryptographique, mais ce n'est pas non plus du contenu à publier.
// Il ne part donc PAS dans le bundle navigateur : il est servi ici, derrière
// une vérification de session, et le frontend ne le reçoit qu'après.
//
// ⚠️ ACCÈS TEMPORAIRE — V1 : réservé au créateur / compte administrateur.
// À remplacer ultérieurement par un vrai système de rôles/permissions.
// L'adresse autorisée vit dans server/tutorial-access.js (source unique).
//
// RUNTIME EDGE, ET CE N'EST PAS UN DÉTAIL
// Le plan Vercel Hobby plafonne à 12 fonctions serverless Node. Le projet en
// compte déjà exactement 12 ; api/og.ts et api/s.ts sont passés en edge pour
// cette raison (voir l'en-tête de api/s.ts). Une 13ᵉ fonction Node ferait
// échouer le déploiement. Cette fonction est donc edge elle aussi — ce qui
// tombe bien : elle ne fait qu'un fetch et une comparaison de chaîne.
//
// AUCUNE CLÉ DE SERVICE ICI
// La vérification passe par l'endpoint `/auth/v1/user` de Supabase, appelé
// avec le jeton de l'utilisateur lui-même et la clé publique (anon). Le jeton
// ne peut donc décrire que son propre porteur, et la clé service_role n'est
// jamais chargée par cette fonction.

import { TUTORIAL } from '../server/tutorial-content.js'
import { isTutorialAllowed } from '../server/tutorial-access.js'

export const config = { runtime: 'edge' }

// Vercel injecte les variables d'environnement dans process.env sur l'edge ;
// on le déclare pour que la fonction se type-checke sans @types/node.
declare const process: { env: Record<string, string | undefined> }

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  // Contenu propre à une session : ni le navigateur ni le CDN ne doivent
  // en garder une copie réutilisable par quelqu'un d'autre.
  'Cache-Control': 'private, no-store',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return json({ error: 'Méthode non autorisée.' }, 405)
  }

  const url = new URL(req.url)
  // `?probe=1` ne renvoie que le verdict d'accès, jamais le contenu. C'est ce
  // que Settings appelle pour décider d'afficher ou non le lien discret.
  const probeOnly = url.searchParams.get('probe') === '1'

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || ''
  if (!supabaseUrl || !anonKey) {
    // Fail-closed : sans moyen de vérifier, on refuse. Un service indisponible
    // qui laisse passer serait exactement le contraire de ce qu'on veut ici.
    return json({ error: 'Service indisponible.' }, 503)
  }

  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) {
    return json({ error: 'Session manquante.' }, 401)
  }

  // Le jeton est validé par Supabase, pas par nous : signature, expiration et
  // révocation sont vérifiées côté serveur d'authentification. Une session
  // expirée retombe donc naturellement en 401.
  let email: string | null
  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
    })
    if (!r.ok) {
      return json({ error: 'Session invalide ou expirée.' }, 401)
    }
    const user = (await r.json()) as { email?: string | null }
    email = user?.email ?? null
  } catch {
    return json({ error: 'Vérification impossible.' }, 503)
  }

  if (!isTutorialAllowed(email)) {
    // Volontairement 404 et non 403 : un compte non autorisé n'apprend même
    // pas que la ressource existe. Le message reste le même dans les deux cas.
    return json({ error: 'Introuvable.' }, 404)
  }

  if (probeOnly) return json({ allowed: true })
  return json({ allowed: true, doc: TUTORIAL })
}
