// ═══════════════ FICHE MARQUE — LECTURE DU CACHE ═══════════════
//
// ── LA RÈGLE QUI GOUVERNE TOUT CE FICHIER ──
// Ouvrir une fiche ne doit JAMAIS coûter un appel IA, sauf la toute première
// fois où cette marque est ouverte dans cette langue. Le client ne décide
// donc rien : il demande, et c'est le serveur qui sait si le contenu existe.
//
// Le verrou vit en base (`claim_brand_content`, migration 0095) et non ici :
// deux navigateurs ne peuvent pas se coordonner entre eux, alors qu'une
// instruction `INSERT … ON CONFLICT` est atomique par construction.
//
// `generating: true` signifie « quelqu'un d'autre génère en ce moment ».
// L'écran affiche alors une attente discrète et relit — il ne relance rien.

import { supabase } from './supabase'

export type KeyMoment = { year?: string; title?: string; text?: string }
export type IconicModel = { name?: string; years?: string; text?: string }

export type BrandContent = {
  brand: string
  lang: string
  /** Description courte héritée des 19 fiches déjà générées. */
  description: string | null
  summary: string | null
  founded_year: number | null
  founder: string | null
  origin_country: string | null
  history: string | null
  key_moments: KeyMoment[]
  innovations: string[]
  iconic_models: IconicModel[]
  facts: string[]
  content_version: number
}

export type BrandContentResult = {
  content: BrandContent | null
  /** `true` quand une autre session génère déjà : il suffit de relire. */
  generating: boolean
}

const EMPTY: BrandContentResult = { content: null, generating: false }

/**
 * Lit la fiche. Au premier passage sur une marque, le serveur génère ; aux
 * suivants il sert le cache sans appeler quoi que ce soit de payant.
 *
 * La lecture directe de la table est tentée EN PREMIER : elle est gratuite,
 * publique, et couvre le cas de très loin le plus fréquent — une marque déjà
 * en cache. L'endpoint n'est sollicité que lorsqu'il n'y a rien à lire.
 */
export async function fetchBrandContent(
  slug: string,
  lang: string,
): Promise<BrandContentResult> {
  const l = lang.startsWith('en') ? 'en' : 'fr'

  const { data: row } = await supabase.rpc('brand_content', {
    p_brand: slug,
    p_lang: l,
  })
  const cached = (Array.isArray(row) ? row[0] : row) as BrandContent | undefined
  if (cached && (cached.summary || cached.history || cached.description)) {
    return { content: normalise(cached), generating: false }
  }

  // Rien en cache : on demande au serveur. C'est LUI qui pose le verrou.
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) return EMPTY

  try {
    const res = await fetch('/api/brand-description', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ brand: slug, lang: l, full: true }),
    })
    if (!res.ok) return EMPTY
    const data = (await res.json()) as {
      content?: BrandContent | null
      generating?: boolean
    }
    return {
      content: data.content ? normalise(data.content) : null,
      generating: data.generating === true,
    }
  } catch {
    return EMPTY
  }
}

/** Les colonnes jsonb peuvent revenir en null ; on normalise une fois ici
 *  plutôt que de garder des `?? []` dans tout le composant. */
function normalise(c: BrandContent): BrandContent {
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    ...c,
    key_moments: arr<KeyMoment>(c.key_moments),
    innovations: arr<string>(c.innovations),
    iconic_models: arr<IconicModel>(c.iconic_models),
    facts: arr<string>(c.facts),
  }
}

/** La fiche a-t-elle de quoi remplir un onglet ? Sert à n'afficher que les
 *  onglets réellement alimentés — jamais un onglet vide. */
export function hasHistory(c: BrandContent | null): boolean {
  return !!c && (!!c.history || c.key_moments.length > 0)
}
export function hasModels(c: BrandContent | null): boolean {
  return !!c && c.iconic_models.length > 0
}
