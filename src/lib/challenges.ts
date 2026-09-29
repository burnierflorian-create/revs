import { supabase } from './supabase'

export type Challenge = {
  id: string
  title: string
  description: string
  type: 'spot_brand' | 'spot_count' | 'spot_category'
  target_value: number
  target_brand: string | null
  target_category: string | null
  xp_reward: number
  starts_at: string
  ends_at: string
  progress: number
  completed: boolean
  claimed: boolean
}

// Adaptive per-user weekly challenges (migrations 0042/0043). Same row
// shape as the legacy get_active_challenges, but target_value is the
// caller's personally-scaled goal and the set is assigned per-user. XP is
// still awarded automatically by the spots trigger (now per-user), so
// there's no manual claim call here. The legacy get_active_challenges RPC
// stays in the DB for rollback.
export async function fetchActiveChallenges(): Promise<Challenge[]> {
  const { data, error } = await supabase.rpc('get_my_weekly_challenges')
  if (error) {
    console.warn('[challenges] fetch failed:', error.message)
    return []
  }
  return (data ?? []) as Challenge[]
}

export function challengePct(c: Challenge): number {
  if (c.target_value <= 0) return 0
  return Math.min(100, Math.round((c.progress / c.target_value) * 100))
}

// ─────────────────── Visuel de défi (Home V2, 29/09/2026) ───────────────────
//
// La table `challenges` n'a PAS de colonne image, et cette mission ne doit pas
// en créer une. On se contente donc de brancher ce qui existe déjà :
// `car_renders`, la bibliothèque partagée d'images de voitures rangée par
// marque (51 images, 24 marques), alimentée par les scripts de maintenance.
//
// Seuls les défis de type `spot_brand` peuvent être illustrés ainsi — eux seuls
// désignent une marque. Les défis `spot_count` et `spot_category` n'ont aucun
// sujet photographiable : ils retombent sur l'icône SVG existante
// (`challengeIcon`), et c'est un repli assumé, pas un manque.
//
// UNE SEULE REQUÊTE, quel que soit le nombre de défis : on demande les rendus
// de toutes les marques visées d'un coup. Échec réseau → Map vide → repli
// partout. L'accueil ne doit jamais attendre après une image.
//
// La mission suivante inventoriera les défis et produira une image par défi ;
// le jour où `challenges.image_url` existera, il suffira de la préférer ici.

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

/** Renvoie, par id de défi, l'URL d'une image pertinente — quand il en existe une. */
export async function fetchChallengeImages(
  challenges: Challenge[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const brands = [
    ...new Set(
      challenges
        .map((c) => c.target_brand?.trim())
        .filter((b): b is string => !!b),
    ),
  ]
  if (brands.length === 0) return out

  const { data, error } = await supabase
    .from('car_renders')
    .select('make, render_url')
  if (error || !data) return out

  // `car_renders.make` est saisi en casse libre (« Mercedes Amg », « Bmw ») :
  // l'appariement se fait sur une forme normalisée, sinon « BMW » ne trouve
  // jamais « Bmw ».
  const byBrand = new Map<string, string>()
  for (const r of data as { make: string | null; render_url: string | null }[]) {
    if (!r.make || !r.render_url) continue
    const k = norm(r.make)
    if (!byBrand.has(k)) byBrand.set(k, r.render_url)
  }

  for (const c of challenges) {
    const b = c.target_brand?.trim()
    if (!b) continue
    const url = byBrand.get(norm(b))
    if (url) out.set(c.id, url)
  }
  return out
}
