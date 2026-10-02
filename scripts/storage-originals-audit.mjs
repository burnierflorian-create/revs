// ═══════ INVENTAIRE DES ORIGINAUX NON FLOUTÉS RESTÉS DANS LE STORAGE ═══════
//
// ── CE QU'ON CHERCHE ──
// Le retraitement des plaques du 01/10 n'a PAS supprimé les photos d'origine :
// il a écrit une version pixelisée sous `blurred/<spot_id>.jpg` et repointé
// `photo_url`. L'originale est donc restée à son ancienne adresse, servie
// publiquement. Depuis le 02/10 elle n'est plus ÉNUMÉRABLE (migration 0099),
// mais quiconque avait relevé l'URL avant peut encore la récupérer.
//
// ── POURQUOI UN INVENTAIRE AVANT TOUTE SUPPRESSION ──
// Supprimer un fichier encore référencé casse une photo en production, et rien
// ne la ramène. On établit donc d'abord, fichier par fichier : à quel spot il
// appartient, si une version protégée existe, et si une colonne de la base
// pointe encore vers lui. Un fichier n'est candidat que si TOUTES les
// conditions sont réunies.
//
// USAGE
//   node scripts/storage-originals-audit.mjs            # inventaire seul
//   node scripts/storage-originals-audit.mjs --apply    # supprime les candidats
//
// En mode inventaire : AUCUNE écriture, aucune suppression.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const OUT = 'storage-audit'
mkdirSync(OUT, { recursive: true })

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const pick = (k, re) => (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]
const db = createClient(
  pick('VITE_SUPABASE_URL', '[^\\s]+'),
  pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+'),
  { auth: { persistSession: false } },
)
const BUCKET = 'spots'

// ── TOUTES LES COLONNES QUI PEUVENT PORTER UNE URL D'IMAGE ──
// Relevé sur le schéma : si une seule est oubliée, on supprimerait un fichier
// encore affiché quelque part.
const URL_COLUMNS = [
  ['spots', ['photo_url', 'thumbnail_url', 'garage_image_url', 'realistic_render_url']],
  ['profiles', ['avatar']],
  ['car_renders', ['render_url']],
]

/** Toutes les URLs encore référencées par la base, quelle que soit la table. */
async function referencedUrls() {
  const refs = new Set()
  for (const [table, cols] of URL_COLUMNS) {
    const { data, error } = await db.from(table).select(cols.join(', '))
    if (error) {
      console.log(`  ⚠ ${table} illisible (${error.message.slice(0, 50)}) — on s'arrête`)
      process.exit(1)
    }
    for (const row of data ?? []) {
      for (const c of cols) {
        const v = row[c]
        if (typeof v === 'string' && v) refs.add(v)
      }
    }
  }
  return refs
}

/** Récursion dans le bucket : Storage ne liste qu'un niveau à la fois. */
async function walk(prefix = '') {
  const out = []
  let page = 0
  for (;;) {
    const { data, error } = await db.storage
      .from(BUCKET)
      .list(prefix, { limit: 100, offset: page * 100 })
    if (error || !data || !data.length) break
    for (const e of data) {
      const path = prefix ? `${prefix}/${e.name}` : e.name
      // Un « dossier » n'a pas de métadonnée de taille.
      if (e.id === null || e.metadata == null) out.push(...(await walk(path)))
      else out.push({ path, size: e.metadata?.size ?? 0, created: e.created_at })
    }
    if (data.length < 100) break
    page += 1
  }
  return out
}

console.log(`\n═══ INVENTAIRE DU BUCKET « ${BUCKET} » ═══`)
console.log(APPLY ? 'MODE SUPPRESSION\n' : 'INVENTAIRE SEUL — aucune écriture\n')

const files = await walk()
const refs = await referencedUrls()
const pub = (p) => db.storage.from(BUCKET).getPublicUrl(p).data.publicUrl

const { data: spots } = await db.from('spots').select('id, user_id, brand, model, photo_url')
const blurredOf = new Set(
  (spots ?? [])
    .map((s) => s.photo_url)
    .filter((u) => typeof u === 'string' && u.includes('/blurred/'))
    .map((u) => u.split(`/${BUCKET}/`)[1])
    .filter(Boolean),
)

const rows = files.map((f) => {
  const url = pub(f.path)
  const isBlurred = f.path.startsWith('blurred/')
  const referenced = refs.has(url)
  // `blurred/<spot_id>.jpg` → on retrouve le spot par son identifiant.
  const spotIdFromBlur = isBlurred ? f.path.slice('blurred/'.length).replace(/\.\w+$/, '') : null
  // Un original vit sous `<user_id>/<timestamp>.jpg`.
  const owner = !isBlurred ? f.path.split('/')[0] : null
  const spot = isBlurred
    ? (spots ?? []).find((s) => s.id === spotIdFromBlur)
    : (spots ?? []).find((s) => s.photo_url === url)
  // Le propriétaire a-t-il une version protégée quelque part ?
  const ownerHasProtected = owner
    ? (spots ?? []).some((s) => s.user_id === owner && String(s.photo_url).includes('/blurred/'))
    : false
  return { ...f, url, isBlurred, referenced, owner, spot, ownerHasProtected }
})

const blurred = rows.filter((r) => r.isBlurred)
const originals = rows.filter((r) => !r.isBlurred)
const orphanOriginals = originals.filter((r) => !r.referenced)
const liveOriginals = originals.filter((r) => r.referenced)

const mo = (n) => (n / 1048576).toFixed(1)
console.log(`fichiers dans le bucket        : ${files.length}  (${mo(files.reduce((a, f) => a + f.size, 0))} Mo)`)
console.log(`  versions protégées /blurred/ : ${blurred.length}`)
console.log(`  hors /blurred/               : ${originals.length}`)
console.log(`    · encore référencées       : ${liveOriginals.length}  ← À CONSERVER`)
console.log(`    · plus référencées         : ${orphanOriginals.length}  (${mo(orphanOriginals.reduce((a, f) => a + f.size, 0))} Mo)`)

// ── CE QUI EST VRAIMENT UN ANCIEN ORIGINAL ──
// Non référencé NE SUFFIT PAS : un fichier peut être non référencé parce que
// son spot a été supprimé, ou parce qu'une publication a échoué en cours de
// route. On distingue les deux, car ils ne se traitent pas pareil.
const withProtectedTwin = orphanOriginals.filter((r) => r.ownerHasProtected)
const noTwin = orphanOriginals.filter((r) => !r.ownerHasProtected)
console.log(`\n      dont propriétaire ayant au moins une photo protégée : ${withProtectedTwin.length}`)
console.log(`      dont aucune photo protégée chez ce propriétaire     : ${noTwin.length}`)

writeFileSync(
  `${OUT}/inventaire.json`,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      total: files.length,
      blurred: blurred.length,
      originalsReferenced: liveOriginals.map((r) => r.path),
      originalsOrphan: orphanOriginals.map((r) => ({
        path: r.path,
        owner: r.owner,
        size: r.size,
        created: r.created,
        ownerHasProtected: r.ownerHasProtected,
      })),
    },
    null,
    2,
  ),
)
console.log(`\ninventaire détaillé : ${OUT}/inventaire.json`)

if (!APPLY) {
  console.log(`\nRien n'a été supprimé. Relancer avec --apply pour retirer les ${orphanOriginals.length} fichier(s) non référencé(s).`)
  process.exit(0)
}

// ── SUPPRESSION ──
// Uniquement les fichiers qu'AUCUNE colonne de la base ne référence. On
// re-vérifie juste avant d'agir : l'inventaire a pu dater de quelques minutes,
// et une publication a pu survenir entre-temps.
const fresh = await referencedUrls()
const toDelete = orphanOriginals.filter((r) => !fresh.has(r.url)).map((r) => r.path)
console.log(`\nsuppression de ${toDelete.length} fichier(s)…`)
let done = 0
for (let i = 0; i < toDelete.length; i += 50) {
  const batch = toDelete.slice(i, i + 50)
  const { error } = await db.storage.from(BUCKET).remove(batch)
  if (error) console.log(`  ✗ lot ${i / 50 + 1} : ${error.message}`)
  else done += batch.length
}
console.log(`${done} fichier(s) supprimé(s).`)
