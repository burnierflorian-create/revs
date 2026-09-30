// ─────────────────── Quota d'ANALYSE IA — lecture côté client ───────────────────
//
// Ce que ce module fournit : de quoi AFFICHER « il te reste X analyses ».
// Ce qu'il ne fournit pas : une autorisation. L'autorité est et reste
// server/ai-gate.js, qui décide seul si REVS paie un appel à Claude. Un client
// modifié qui ferait mentir ce compteur n'obtiendrait rien de plus : le serveur
// recompte à chaque appel, dans la même transaction que l'incrément.
//
// La table `ai_usage` n'est pas lisible depuis le navigateur — RLS active,
// zéro policy, et c'est très bien ainsi : elle porte l'historique de tous les
// utilisateurs. Le RPC `my_ai_quota()` (migration 0086) n'expose que la ligne
// du jour de l'appelant, dérivée de `auth.uid()`.
//
// ⚠️ À NE PAS CONFONDRE avec la publication de spots, qui n'a plus de quota.
// Épuiser ses analyses n'empêche pas de publier — c'était précisément le bug
// corrigé le 30/09/2026.

import { supabase } from './supabase'

export type AiQuota = {
  /** Analyses déjà consommées aujourd'hui (jour parisien). */
  used: number
  /** Plafond du palier. */
  limit: number
  /** Ce qu'il reste. Jamais négatif. */
  remaining: number
  tier: string
}

/**
 * Quota d'analyses IA du jour pour l'utilisateur connecté.
 *
 * Renvoie `null` si l'information n'est pas disponible (hors ligne, session
 * absente, RPC en erreur). L'appelant doit alors MASQUER le compteur plutôt
 * que d'inventer un chiffre : afficher « 10/10 » par défaut ferait croire à un
 * crédit qui n'existe peut-être pas.
 */
export async function fetchAiQuota(): Promise<AiQuota | null> {
  const { data, error } = await supabase.rpc('my_ai_quota')
  if (error) {
    console.error('[aiQuota] lecture échouée:', error.message)
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null
  const used = Number(row.used ?? 0)
  const limit = Number(row.limit ?? 0)
  return {
    used,
    limit,
    remaining: Math.max(0, Number(row.remaining ?? limit - used)),
    tier: String(row.tier ?? 'free'),
  }
}
