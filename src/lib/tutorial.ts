// ─────────────────── REVS Master Tutorial — accès côté client ───────────────────
//
// ⚠️ TEMPORAIRE — V1 : le tutoriel est réservé au créateur / compte
// administrateur. À remplacer ultérieurement par un vrai système de
// rôles/permissions si d'autres comptes doivent y accéder.
//
// CE MODULE NE CONNAÎT PAS L'ADRESSE AUTORISÉE, ET C'EST VOULU.
// La comparaison vit dans server/tutorial-access.js, qui ne part jamais dans
// le bundle navigateur. Ici, on se contente de demander au serveur « ai-je le
// droit ? » et d'afficher ou non le lien selon la réponse.
//
// Le masquage du lien n'est PAS la sécurité. Un utilisateur non autorisé qui
// tape /tutorial directement obtient une page « Introuvable » parce que
// /api/tutorial refuse de lui envoyer le contenu — pas parce que le lien
// était caché.

import { supabase } from './supabase'

export type TutorialChapter = {
  id: string
  num: string
  title: string
  blurb: string
  markdown: string
}

export type TutorialDoc = {
  title: string
  version: string
  referenceCommit: string
  referenceDate: string
  lastVerified: string
  chapters: TutorialChapter[]
}

/** Erreur d'accès distincte d'une panne réseau : la page l'affiche différemment. */
export class TutorialDenied extends Error {
  constructor() {
    super('Introuvable.')
    this.name = 'TutorialDenied'
  }
}

async function authHeader(): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : null
}

/**
 * Récupère le document complet. Lève `TutorialDenied` si le compte n'est pas
 * autorisé (ou si la session a expiré) — ce sont deux refus indiscernables du
 * point de vue du client, et c'est l'intention : l'endpoint répond 404 pour ne
 * pas confirmer l'existence de la ressource.
 */
export async function fetchTutorial(): Promise<TutorialDoc> {
  const headers = await authHeader()
  if (!headers) throw new TutorialDenied()

  const r = await fetch('/api/tutorial', { headers })
  if (r.status === 401 || r.status === 404) throw new TutorialDenied()
  if (!r.ok) throw new Error('Chargement du tutoriel impossible.')

  const body = (await r.json()) as { doc?: TutorialDoc }
  if (!body?.doc) throw new Error('Réponse inattendue du serveur.')
  return body.doc
}

// Sonde d'accès — mémorisée pour la durée du chargement de page, afin que
// plusieurs écrans qui affichent le lien ne déclenchent pas plusieurs appels.
let probe: Promise<boolean> | null = null

/**
 * Indique si le compte courant a accès au tutoriel, sans télécharger son
 * contenu. Sert uniquement à décider d'afficher un lien : ne jamais s'en
 * servir pour protéger quoi que ce soit.
 */
export function hasTutorialAccess(): Promise<boolean> {
  if (probe) return probe
  probe = (async () => {
    try {
      const headers = await authHeader()
      if (!headers) return false
      const r = await fetch('/api/tutorial?probe=1', { headers })
      return r.ok
    } catch {
      return false
    }
  })()
  return probe
}

/** À appeler à la déconnexion : le verdict suivant doit être redemandé. */
export function resetTutorialAccessCache(): void {
  probe = null
}
