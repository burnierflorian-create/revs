// ═══════ PUBLIER UNE NOUVEAUTÉ REVS ═══════
//
// ── POURQUOI CET OUTIL, ET POURQUOI IL N'EST PAS AUTOMATIQUE ──
// La table `product_updates` et l'onglet « Nouveautés » existent depuis la
// migration 0090 ; il manquait seulement un moyen propre d'y écrire sans
// passer par du SQL à la main.
//
// Il n'est volontairement RELIÉ À RIEN : ni aux commits, ni aux déploiements,
// ni à un quelconque déclencheur. Un commit technique n'est pas une nouveauté
// utilisateur, et dix corrections internes ne valent pas dix annonces. C'est
// une décision éditoriale, prise par quelqu'un, au moment où il le décide.
//
// ── LA RÈGLE QUE CE FICHIER FAIT RESPECTER ──
// Une nouveauté ne doit annoncer que ce qui est RÉELLEMENT en production. Le
// script refuse donc de publier sans un `--confirme-en-production`, pour que
// personne ne l'oublie en écrivant vite.
//
// USAGE
//   node scripts/publish-update.mjs --fichier updates/ma-nouveaute.json
//   node scripts/publish-update.mjs --fichier … --confirme-en-production
//   node scripts/publish-update.mjs --liste
//   node scripts/publish-update.mjs --retirer <id>
//
// FORMAT DU FICHIER (JSON)
//   {
//     "id": "2026-10-protection-plaques",   // stable : republier le met à jour
//     "category": "privacy",                 // voir CATEGORIES ci-dessous
//     "title_fr": "…", "title_en": "…",
//     "body_fr":  "…", "body_en":  "…",
//     "points_fr": ["…"], "points_en": ["…"],
//     "rank": 0
//   }

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Celles que l'interface sait déjà styliser. En ajouter une ici sans la
// traiter côté affichage donnerait une pastille sans couleur.
const CATEGORIES = ['feature', 'improvement', 'privacy', 'fix', 'ai', 'performance']

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const val = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null)

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const pick = (k, re) => (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]
const db = createClient(
  pick('VITE_SUPABASE_URL', '[^\\s]+'),
  pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+'),
  { auth: { persistSession: false } },
)

if (flag('--liste')) {
  const { data } = await db
    .from('product_updates')
    .select('id, title_fr, category, published, published_at')
    .order('published_at', { ascending: false })
  console.log(`\n${(data ?? []).length} nouveauté(s) :\n`)
  for (const u of data ?? []) {
    console.log(`  ${u.published_at}  ${u.category.padEnd(12)} ${u.published ? '✓' : '·'}  ${u.title_fr}`)
    console.log(`     ${u.id}`)
  }
  process.exit(0)
}

if (flag('--retirer')) {
  const id = val('--retirer')
  if (!id) {
    console.error('usage : --retirer <id>')
    process.exit(2)
  }
  // On DÉPUBLIE au lieu de supprimer : les lignes de `product_update_reads`
  // qui la référencent restent cohérentes, et la décision est réversible.
  const { error } = await db.from('product_updates').update({ published: false }).eq('id', id)
  console.log(error ? `échec : ${error.message}` : `« ${id} » dépubliée (la ligne est conservée).`)
  process.exit(error ? 1 : 0)
}

const file = val('--fichier')
if (!file) {
  console.error('usage : node scripts/publish-update.mjs --fichier <json> [--confirme-en-production]')
  process.exit(2)
}

let u
try {
  u = JSON.parse(readFileSync(file, 'utf8'))
} catch (e) {
  console.error(`fichier illisible : ${e.message}`)
  process.exit(2)
}

// ── CONTRÔLES AVANT ÉCRITURE ──
const problems = []
for (const k of ['id', 'title_fr', 'title_en', 'body_fr', 'body_en']) {
  if (!String(u[k] ?? '').trim()) problems.push(`champ « ${k} » vide — FR et EN sont tous deux obligatoires`)
}
if (u.category && !CATEGORIES.includes(u.category)) {
  problems.push(`catégorie « ${u.category} » inconnue (attendu : ${CATEGORIES.join(', ')})`)
}
for (const k of ['points_fr', 'points_en']) {
  if (u[k] != null && !Array.isArray(u[k])) problems.push(`« ${k} » doit être une liste`)
}
if ((u.points_fr?.length ?? 0) !== (u.points_en?.length ?? 0)) {
  problems.push('points_fr et points_en n’ont pas le même nombre d’éléments')
}
if (problems.length) {
  console.error('\nPublication refusée :')
  for (const p of problems) console.error(`  · ${p}`)
  process.exit(1)
}

console.log(`\n═══ ${u.id} ═══`)
console.log(`catégorie : ${u.category ?? 'feature'}`)
console.log(`\nFR  ${u.title_fr}\n    ${u.body_fr}`)
for (const p of u.points_fr ?? []) console.log(`    • ${p}`)
console.log(`\nEN  ${u.title_en}\n    ${u.body_en}`)
for (const p of u.points_en ?? []) console.log(`    • ${p}`)

if (!flag('--confirme-en-production')) {
  console.log(`\n⚠️  Rien n'a été publié.`)
  console.log(`   Relire chaque point et vérifier qu'il décrit une amélioration RÉELLEMENT`)
  console.log(`   déployée. Puis relancer avec --confirme-en-production.`)
  process.exit(0)
}

const { error } = await db.from('product_updates').upsert(
  {
    id: u.id,
    title_fr: u.title_fr,
    title_en: u.title_en,
    body_fr: u.body_fr,
    body_en: u.body_en,
    points_fr: u.points_fr ?? [],
    points_en: u.points_en ?? [],
    category: u.category ?? 'feature',
    image_url: u.image_url ?? null,
    rank: u.rank ?? 0,
    published: true,
  },
  { onConflict: 'id' },
)
console.log(error ? `\néchec : ${error.message}` : `\npubliée ✓`)
process.exit(error ? 1 : 0)
