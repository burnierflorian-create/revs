// ═══════ ÉTAT SOCIAL D'UNE PAGE DE SPOTS ═══════
//
// Likes, commentaires, réactions, mon like, mon favori, ma réaction : six
// informations qui arrivaient autrefois en quatre requêtes PAR CARTE. Dix
// cartes faisaient quarante allers-retours au premier rendu du Fil, et
// quarante de plus à chaque défilement.
//
// `spot_social()` (migration 0116) répond pour une page entière d'un coup.
// Ce module ne fait que l'appeler et typer le résultat — la carte, elle, ne
// parle plus à la base que lorsqu'on la touche.

import { supabase } from './supabase'

/** Les quatre réactions. Le cœur n'en fait pas partie : il EST le Like,
 *  qui porte déjà son propre compteur public et déclenche l'XP. Deux cœurs
 *  côte à côte avec deux compteurs différents, c'est la confusion garantie. */
export const REACTIONS = ['🔥', '👌', '😍', '😂'] as const
export type Reaction = (typeof REACTIONS)[number]

export type SpotSocial = {
  like_count: number
  comment_count: number
  reaction_count: number
  liked: boolean
  bookmarked: boolean
  my_reaction: Reaction | null
  /** emoji → nombre, pour les seules réactions réellement posées. */
  reactions: Record<string, number>
}

export const EMPTY_SOCIAL: SpotSocial = {
  like_count: 0,
  comment_count: 0,
  reaction_count: 0,
  liked: false,
  bookmarked: false,
  my_reaction: null,
  reactions: {},
}

type Row = SpotSocial & { spot_id: string }

/**
 * Charge l'état social de plusieurs spots en un appel.
 *
 * Les favoris restent privés : la fonction est SECURITY INVOKER, donc la
 * policy « read own bookmarks » s'applique et `bookmarked` ne peut être vrai
 * que pour l'appelant.
 */
export async function loadSpotSocial(ids: string[]): Promise<Record<string, SpotSocial>> {
  if (ids.length === 0) return {}
  const { data, error } = await supabase.rpc('spot_social', { p_ids: ids })
  if (error) return {}
  const out: Record<string, SpotSocial> = {}
  for (const r of (data ?? []) as Row[]) {
    out[r.spot_id] = {
      like_count: r.like_count ?? 0,
      comment_count: r.comment_count ?? 0,
      reaction_count: r.reaction_count ?? 0,
      liked: !!r.liked,
      bookmarked: !!r.bookmarked,
      my_reaction: (r.my_reaction as Reaction) ?? null,
      reactions: r.reactions ?? {},
    }
  }
  return out
}

/**
 * Pose, change ou retire sa réaction. Renvoie la réaction effective.
 *
 * Reposer la même la retire : c'est le geste qu'on attend d'un sélecteur où
 * l'on voit son propre choix surligné. La clé primaire (spot_id, user_id)
 * fait le reste — il ne peut pas en exister deux.
 */
export async function setReaction(
  spotId: string,
  userId: string,
  emoji: Reaction,
  current: Reaction | null,
): Promise<Reaction | null> {
  if (current === emoji) {
    await supabase.from('spot_reactions').delete().eq('spot_id', spotId).eq('user_id', userId)
    return null
  }
  await supabase
    .from('spot_reactions')
    .upsert({ spot_id: spotId, user_id: userId, emoji }, { onConflict: 'spot_id,user_id' })
  return emoji
}
