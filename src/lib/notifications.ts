// ═══════════════ NOTIFICATIONS — ACCÈS CLIENT ═══════════════
//
// Deux sources, un seul compteur :
//   · `notifications`   — ce qui arrive à UNE personne (like, badge, suivi…)
//   · `product_updates` — ce que REVS annonce à tout le monde (changelog)
//
// Les garder séparées évite de dupliquer chaque nouveauté produit sur chaque
// utilisateur ; les additionner dans la cloche évite à l'utilisateur d'avoir à
// comprendre cette distinction, qui ne le regarde pas.
//
// ⚠️ ÉCRITURE : le client ne peut RIEN créer. `notifications` n'a aucune
// policy INSERT, et seule la colonne `read_at` lui est accessible en mise à
// jour (migration 0090). Laisser un client insérer ses propres notifications
// reviendrait à le laisser s'auto-décerner des badges.

import { supabase } from './supabase'
import i18n from '../i18n'

export type NotificationType =
  | 'like'
  | 'comment'
  | 'follow'
  | 'mention'
  | 'badge_unlock'
  | 'challenge'
  | 'event'
  | 'system'
  | 'product_update'

export type Notification = {
  id: string
  type: NotificationType
  title: string
  body: string | null
  link: string | null
  image_url: string | null
  meta: Record<string, unknown>
  read_at: string | null
  created_at: string
}

export type ProductUpdate = {
  id: string
  title: string
  body: string
  points: string[]
  category: string
  image_url: string | null
  published_at: string
  /** Jamais consultée par cet utilisateur → pastille « NOUVEAU ». */
  unread: boolean
}

/** Les notifications personnelles, les plus récentes d'abord. */
export async function fetchNotifications(limit = 50): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, link, image_url, meta, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[notifications] lecture échouée:', error.message)
    return []
  }
  return (data ?? []) as Notification[]
}

/**
 * Le changelog, dans la langue courante.
 *
 * Les deux langues vivent dans la même ligne (`title_fr` / `title_en`) plutôt
 * que dans les fichiers de traduction : une nouveauté se publie sans
 * redéployer l'application, et les entrées passées ne polluent pas un bundle
 * que tout le monde télécharge.
 */
export async function fetchProductUpdates(): Promise<ProductUpdate[]> {
  const en = (i18n.resolvedLanguage ?? i18n.language ?? 'fr').startsWith('en')
  const [{ data: ups, error }, { data: reads }] = await Promise.all([
    supabase
      .from('product_updates')
      .select(
        'id, title_fr, title_en, body_fr, body_en, points_fr, points_en, category, image_url, published_at, rank',
      )
      .eq('published', true)
      .order('published_at', { ascending: false })
      .order('rank', { ascending: false }),
    supabase.from('product_update_reads').select('update_id'),
  ])
  if (error) {
    console.error('[nouveautés] lecture échouée:', error.message)
    return []
  }
  const seen = new Set((reads ?? []).map((r) => (r as { update_id: string }).update_id))
  return (ups ?? []).map((u) => {
    const r = u as unknown as {
      id: string
      title_fr: string
      title_en: string
      body_fr: string
      body_en: string
      points_fr: string[]
      points_en: string[]
      category: string
      image_url: string | null
      published_at: string
    }
    return {
      id: r.id,
      title: en ? r.title_en : r.title_fr,
      body: en ? r.body_en : r.body_fr,
      points: (en ? r.points_en : r.points_fr) ?? [],
      category: r.category,
      image_url: r.image_url,
      published_at: r.published_at,
      unread: !seen.has(r.id),
    }
  })
}

/** Le chiffre de la cloche : personnelles non lues + nouveautés non vues. */
export async function fetchUnreadCount(): Promise<number> {
  const { data, error } = await supabase.rpc('my_unread_count')
  if (error) {
    console.error('[notifications] compteur indisponible:', error.message)
    return 0
  }
  return Number(data ?? 0)
}

/** Marque UNE notification comme lue. Sans effet si elle l'était déjà. */
export async function markRead(id: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null)
}

/**
 * Tout marquer comme lu, en UNE instruction serveur.
 *
 * Boucler côté client sur cinquante lignes laisserait la cloche allumée si la
 * connexion lâchait au milieu — et le bouton promet le contraire.
 */
export async function markAllRead(): Promise<number> {
  const { data, error } = await supabase.rpc('mark_all_read')
  if (error) {
    console.error('[notifications] marquage global échoué:', error.message)
    return 0
  }
  return Number(data ?? 0)
}

/** Consigne qu'une nouveauté a été consultée (retire sa pastille). */
export async function markUpdateRead(updateId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  await supabase
    .from('product_update_reads')
    .upsert({ user_id: user.id, update_id: updateId }, { onConflict: 'user_id,update_id' })
}

// ── Diffusion locale du compteur ──
// La cloche vit sur l'accueil, l'écran de notifications ailleurs. Sans ce
// canal, marquer tout comme lu laissait la pastille allumée jusqu'au prochain
// montage de l'accueil.
const COUNT_CHANNEL = 'revs:unread-changed'

export function emitUnreadChanged() {
  window.dispatchEvent(new Event(COUNT_CHANNEL))
}

export function onUnreadChanged(fn: () => void): () => void {
  window.addEventListener(COUNT_CHANNEL, fn)
  return () => window.removeEventListener(COUNT_CHANNEL, fn)
}
