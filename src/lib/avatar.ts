// ═══════ L'AVATAR : UNE SEULE DONNÉE, UNE SEULE ÉCRITURE ═══════
//
// ── LA SOURCE DE VÉRITÉ ──
// `profiles.avatar`. Une colonne, une seule, lue par toutes les surfaces :
// profil, profil public, Fil, commentaires, stories, lecteur de story,
// membres, classement. Il n'existe ni `avatarUrl`, ni `authorAvatar`, ni
// cache parallèle côté base — l'audit n'en a trouvé aucun autre.
//
// ── POURQUOI UN MODULE PLUTÔT QU'UN APPEL DIRECT ──
// Deux raisons, chacune née d'un vrai défaut :
//
//  1. Les Réglages enregistraient par UPSERT. PostgREST le traduit en
//     `INSERT ... ON CONFLICT DO UPDATE`, et Postgres exécute les
//     déclencheurs BEFORE INSERT sur la ligne PROPOSÉE — où `age_confirmed`
//     prend sa valeur par défaut `false`. `require_age_confirmed()` levait
//     donc « Âge minimum non confirmé » pour TOUS les comptes, y compris
//     ceux dont la ligne stockée porte `true`. Plus aucun profil ne pouvait
//     être enregistré. La ligne existe toujours — `handle_new_user()` la
//     crée à l'inscription — donc c'est un UPDATE qu'il fallait écrire.
//
//  2. Le Fil garde les profils déjà résolus en mémoire et ne les redemande
//     jamais. Changer sa photo puis revenir au Fil montrait l'ancienne.
//     L'annonce ci-dessous le règle sans une requête de plus.

import { supabase } from './supabase'

/** Chemin de stockage de l'avatar. Un seul fichier par compte, remplacé sur
 *  place : aucune accumulation, et la policy de `storage.objects` vérifie que
 *  le premier segment est bien l'identifiant du déposant. */
export function avatarPath(userId: string): string {
  return `${userId}/avatar.jpg`
}

type Listener = (userId: string, avatar: string | null) => void
const listeners = new Set<Listener>()

/** Annonce qu'un avatar vient de changer. */
export function publishAvatar(userId: string, avatar: string | null): void {
  for (const l of listeners) l(userId, avatar)
}

/** S'abonne aux changements d'avatar. Renvoie la fonction de désabonnement. */
export function onAvatarChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Dépose l'image et l'inscrit sur le profil. Renvoie l'URL versionnée.
 *
 * Le `?v=` n'est pas un contournement de cache à l'aveugle : l'URL publique
 * du fichier ne change jamais (même chemin, remplacé sur place), donc sans
 * lui le navigateur et le service worker continueraient de servir l'ancienne
 * image indéfiniment. Il ne bouge QUE lorsque la photo change — une URL
 * stable entre deux changements reste donc mise en cache normalement.
 */
export async function uploadAvatar(userId: string, blob: Blob): Promise<string> {
  const path = avatarPath(userId)
  const up = await supabase.storage
    .from('avatars')
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
  if (up.error) throw up.error
  const base = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
  const url = `${base}?v=${Date.now()}`
  // UPDATE, jamais UPSERT — voir la note 1 en tête de fichier.
  const { data, error } = await supabase
    .from('profiles')
    .update({ avatar: url })
    .eq('user_id', userId)
    .select('user_id')
  if (error) throw error
  if (!data || data.length === 0) {
    // Aucune ligne : le profil n'a jamais été créé (compte né hors du
    // parcours d'inscription). On le crée, en portant la déclaration d'âge
    // qu'exige le garde-fou — il n'est pas question de la contourner.
    const ins = await supabase
      .from('profiles')
      .insert({ user_id: userId, avatar: url, age_confirmed: true })
    if (ins.error) throw ins.error
  }
  publishAvatar(userId, url)
  return url
}
