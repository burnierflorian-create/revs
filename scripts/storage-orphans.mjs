// ═══════ FICHIERS DE STOCKAGE QUE PLUS RIEN NE RÉFÉRENCE ═══════
//
// Un fichier orphelin ne casse rien : il n'est simplement plus servi à
// personne, et il compte dans le quota. Au 3 octobre 2026 : 36,7 Mo sur les
// 75 Mo stockés, soit presque la moitié.
//
// ── D'OÙ ILS VIENNENT ──
//   stories        : la story expire, sa ligne est purgée, le JPEG reste
//                    (`purge_expired_stories` ne touche pas au bucket).
//   garage-renders  : rendus d'une version antérieure du style, remplacés par
//   car-renders       un nouveau fichier sans que l'ancien soit retiré.
//   spots          : aucun — la photo d'un spot est supprimée avec lui.
//
// ── POURQUOI UN ESSAI À BLANC PAR DÉFAUT ──
// « Plus rien ne le référence » se déduit d'une comparaison de chaînes entre
// l'URL stockée et le nom du fichier. Si une colonne venait à changer de
// forme, la comparaison déclarerait orphelin un fichier bien vivant. On
// regarde la liste avant de supprimer.
//
//   node scripts/storage-orphans.mjs            # liste
//   node scripts/storage-orphans.mjs --supprime # supprime réellement
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--supprime')
const env = readFileSync('.env.local', 'utf8')
const pick = (k, re) => (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]
const db = createClient(
  pick('VITE_SUPABASE_URL', '[^\\s]+'),
  pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+'),
  { auth: { persistSession: false } },
)

/** TOUTES les colonnes qui peuvent référencer un fichier de ce bucket.
 *
 *  ── POURQUOI UNE LISTE ET PAS UNE PAIRE ──
 *  La première version de ce script ne regardait qu'une table par bucket.
 *  Elle déclarait donc orphelins 32 fichiers de `garage-renders`, alors que
 *  27 d'entre eux sont référencés par `spots.garage_render_url` — une colonne
 *  qu'elle ne consultait pas. Les supprimer aurait vidé le Garage de la
 *  moitié de ses voitures.
 *
 *  Toute nouvelle colonne pointant vers un bucket DOIT être ajoutée ici. La
 *  requête qui les trouve toutes :
 *    select table_name, column_name from information_schema.columns
 *     where table_schema='public' and data_type='text'
 *       and column_name ~* 'url|photo|image|avatar|render'
 */
const BUCKETS = [
  { bucket: 'stories', refs: [['stories', 'media_url']] },
  {
    bucket: 'garage-renders',
    refs: [
      ['garage_renders', 'render_url'],
      ['spots', 'garage_render_url'],
      ['spots', 'garage_image_url'],
      ['spots', 'realistic_render_url'],
    ],
  },
  {
    bucket: 'car-renders',
    refs: [
      ['car_renders', 'render_url'],
      ['spots', 'realistic_render_url'],
      ['spots', 'garage_render_url'],
    ],
  },
  {
    bucket: 'spots',
    refs: [
      ['spots', 'photo_url'],
      ['spots', 'thumbnail_url'],
      ['card_progress', 'best_photo_url'],
      ['card_progress', 'main_photo_url'],
    ],
  },
  { bucket: 'avatars', refs: [['profiles', 'avatar']] },
]

/** Liste complète d'un bucket, page par page. */
async function listAll(bucket, prefix = '', out = []) {
  const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error) throw new Error(`${bucket} : ${error.message}`)
  for (const e of data ?? []) {
    const path = prefix ? `${prefix}/${e.name}` : e.name
    // Un dossier n'a pas de métadonnées : on descend dedans.
    if (!e.metadata) await listAll(bucket, path, out)
    else out.push({ path, size: e.metadata.size ?? 0 })
  }
  return out
}

let totalFichiers = 0
let totalOctets = 0

for (const { bucket, refs: sources } of BUCKETS) {
  const fichiers = await listAll(bucket)
  // On compare sur le chemin du fichier, pas sur l'URL entière : celle-ci
  // porte parfois un `?v=` de version (avatars) qui fausserait l'égalité.
  const refs = new Set()
  for (const [table, column] of sources) {
    const { data: rows, error } = await db.from(table).select(column)
    if (error) {
      console.log(`  ⚠ ${table}.${column} illisible (${error.message}) — bucket ignoré par prudence`)
      refs.add('__illisible__')
      continue
    }
    for (const r of rows ?? []) {
      const u = String(r[column] ?? '').split('?')[0]
      if (!u) continue
      const p = decodeURIComponent(u.split(`/${bucket}/`)[1] ?? '')
      if (p) refs.add(p)
    }
  }
  // Une source illisible rend le verdict incertain : on ne supprime rien.
  if (refs.has('__illisible__')) continue
  const orphelins = fichiers.filter((f) => !refs.has(f.path))
  const octets = orphelins.reduce((a, f) => a + Number(f.size || 0), 0)
  totalFichiers += orphelins.length
  totalOctets += octets
  console.log(
    `${bucket.padEnd(16)} ${String(fichiers.length).padStart(4)} fichier(s), ` +
      `${String(refs.size).padStart(4)} référencé(s) → ` +
      `${String(orphelins.length).padStart(4)} orphelin(s) · ${(octets / 1048576).toFixed(1)} Mo`,
  )
  if (APPLY && orphelins.length) {
    // Par paquets de 100 : l'API de stockage plafonne les suppressions en lot.
    for (let i = 0; i < orphelins.length; i += 100) {
      const lot = orphelins.slice(i, i + 100).map((f) => f.path)
      const { error: delErr } = await db.storage.from(bucket).remove(lot)
      if (delErr) console.log(`  ✗ ${delErr.message}`)
    }
    console.log(`  ${orphelins.length} supprimé(s)`)
  }
}

console.log(
  `\ntotal : ${totalFichiers} fichier(s), ${(totalOctets / 1048576).toFixed(1)} Mo` +
    (APPLY ? ' — supprimés' : "\nessai à blanc — relancer avec --supprime"),
)
