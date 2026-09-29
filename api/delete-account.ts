import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

/**
 * Vide le dossier `{uid}/` d'un bucket, page par page.
 *
 * `list()` plafonne à 100 entrées par appel : sans pagination, un compte de
 * plus de 100 spots aurait gardé ses photos les plus anciennes. On boucle donc
 * jusqu'à ce que la page revienne incomplète.
 *
 * Un dossier vide est un cas normal (compte sans spot, sans avatar) et ne
 * produit aucun appel de suppression.
 */
async function purgeUserFolder(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  uid: string,
): Promise<void> {
  const PAGE = 100
  for (let offset = 0; ; ) {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(uid, { limit: PAGE, offset })
    if (error) throw error
    const files = data ?? []
    if (files.length === 0) return

    // `list()` renvoie aussi les sous-dossiers, repérables à leur `id` nul.
    // Les deux buckets sont plats sous `{uid}/`, mais filtrer coûte moins cher
    // que de découvrir un jour une suppression silencieusement incomplète.
    const paths = files
      .filter((f) => f.id !== null)
      .map((f) => `${uid}/${f.name}`)

    if (paths.length > 0) {
      const { error: rmErr } = await admin.storage.from(bucket).remove(paths)
      if (rmErr) throw rmErr
      // Les entrées supprimées disparaissent de la liste : on ne décale pas
      // l'offset, la page suivante remonte d'elle-même.
    } else {
      offset += files.length
    }
    if (files.length < PAGE && paths.length === 0) return
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée.' })
    return
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    res.status(500).json({ error: 'Service indisponible — réessaie plus tard.' })
    return
  }

  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : ''
  if (!token) {
    res.status(401).json({ error: 'Session manquante. Reconnecte-toi.' })
    return
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  })

  try {
    // Verify the caller's token and resolve their user id.
    const { data, error } = await admin.auth.getUser(token)
    if (error || !data.user) {
      res.status(401).json({ error: 'Session invalide. Reconnecte-toi.' })
      return
    }
    const uid = data.user.id

    // ── 1 · Fichiers AVANT la base ──
    //
    // L'ordre n'est pas indifférent. En supprimant le compte d'abord, un échec
    // sur le stockage laisserait des fichiers que PLUS RIEN ne référence :
    // introuvables, donc impossibles à nettoyer ensuite. Dans l'autre sens, un
    // échec laisse le compte intact et l'opération peut être relancée telle
    // quelle. On échoue donc fermé : pas de fichier effacé à moitié, pas de
    // compte supprimé tant que ses images sont encore en ligne.
    //
    // Les chemins ne viennent JAMAIS du client : ils sont listés depuis le
    // dossier `{uid}/` de chaque bucket, préfixe imposé à l'écriture par
    // NewSpot.tsx et Settings.tsx.
    try {
      for (const bucket of ['spots', 'avatars']) {
        await purgeUserFolder(admin, bucket, uid)
      }
    } catch (storageErr) {
      console.error('[delete-account] storage purge failed:', storageErr)
      res.status(500).json({
        error:
          'Suppression des photos échouée — le compte est intact, réessaie plus tard.',
      })
      return
    }

    // ── 2 · Puis le compte ──
    // FKs are ON DELETE CASCADE, so spots/events/likes/xp/profile go too.
    const { error: delErr } = await admin.auth.admin.deleteUser(uid)
    if (delErr) {
      console.error('[delete-account] supabase failed:', delErr)
      res.status(500).json({ error: 'Suppression du compte échouée — réessaie plus tard.' })
      return
    }
    res.status(200).json({ deleted: true })
  } catch (err) {
    console.error('[delete-account] crashed:', err)
    res.status(500).json({ error: 'Suppression du compte échouée — réessaie plus tard.' })
  }
}
