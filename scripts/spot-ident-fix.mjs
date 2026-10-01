// ═══════ CORRECTION DES IDENTIFICATIONS CONFIRMÉES FAUSSES ═══════
//
// ── CE QUE CE SCRIPT CORRIGE, ET CE QU'IL REFUSE DE TOUCHER ──
// UNIQUEMENT les spots passés en `B_ERREUR` par `spot-ident-audit.mjs` ET
// listés explicitement ci-dessous après vérification humaine de la photo. Pas
// de correction en masse, pas de « tout ce que l'audit a signalé » : l'audit
// propose, un humain tranche, et la liste de ce qu'il a tranché est dans le
// code — lisible, relisable, discutable.
//
// Un cas écarté volontairement illustre la règle : l'audit a signalé le spot
// 1f4e2667 comme « BMW i4 » là où la fiche dit « Série 4 Gran Coupé ». Les
// deux analyses concordaient. Mais la photo est lointaine, sous la pluie, et
// l'indice avancé — l'absence de sorties d'échappement — n'est pas vérifiable
// à cette définition. De plus l'i4 est vendue SUR cette caisse, sous le nom
// « i4 Gran Coupé » : la fiche n'est pas fausse sur la carrosserie. Doute
// raisonnable → on ne touche pas.
//
// ── CE QUI EST FAIT POUR CHAQUE CORRECTION ──
//   1. la ligne `spots` est mise à jour (marque, modèle, année si connue) ;
//   2. `ident_locked` passe à true : aucune ré-identification automatique ne
//      doit plus l'écraser ;
//   3. `car_info` de la LIGNE est vidé — il décrit l'ancien modèle ;
//   4. l'entrée de `car_info_cache` de l'ANCIEN modèle est laissée en place
//      si elle sert à d'autres spots, et supprimée sinon (voir plus bas) ;
//   5. une ligne de journal est écrite dans `ident_corrections`.
//
// USAGE
//   node scripts/spot-ident-fix.mjs --dry-run     (défaut)
//   node scripts/spot-ident-fix.mjs --apply

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const pick = (k, re) => (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]
const db = createClient(
  pick('VITE_SUPABASE_URL', '[^\\s]+'),
  pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+'),
  { auth: { persistSession: false } },
)

// ── LA LISTE, VÉRIFIÉE PHOTO PAR PHOTO ──
// `year: null` quand la photo ne permet pas de trancher le millésime : on
// préfère un champ vide à une année inventée, puisque c'est précisément une
// année supposée qui a fait rendre la mauvaise génération au Garage Visual.
const FIXES = [
  {
    id: '0cb6565b',
    brand: 'Tesla',
    model: 'Model Y',
    year: null,
    reason: 'carrosserie de crossover, pavillon haut, protections d’arches noires — une Model 3 est une berline basse',
    evidence: 'Tall roofline, black plastic wheel arch cladding, Model Y front bumper and headlight design',
  },
  {
    id: '546d76ec',
    brand: 'Rolls-Royce',
    model: 'Silver Cloud',
    year: null,
    reason: 'calandre Parthénon et Spirit of Ecstasy — une Bentley R-Type porte une calandre arrondie et un B ailé',
    evidence: 'Pantheon grille with Spirit of Ecstasy mascot, RR monogram, pontoon-fender saloon body',
  },
  {
    id: 'a4074eae',
    brand: 'Mercedes-Benz',
    model: 'Classe E W214',
    year: null,
    reason: 'poignées de porte affleurantes et proportions longues — la Classe C W206 a des poignées classiques',
    evidence: 'Flush retractable door handles on both doors, long rear door and wheelbase, W214 lamp signature',
  },
]

const { data: spots, error } = await db
  .from('spots')
  .select('id, brand, model, year, car_info, ident_locked')
if (error) throw error

console.log(`\n═══ CORRECTION D'IDENTIFICATION ═══`)
console.log(APPLY ? 'MODE APPLICATION\n' : 'ESSAI À BLANC — aucune écriture\n')

for (const f of FIXES) {
  const s = spots.find((x) => x.id.startsWith(f.id))
  if (!s) {
    console.log(`  ✗ ${f.id} introuvable`)
    continue
  }
  if (s.ident_locked) {
    // Garde-fou : une identification déjà validée par un humain fait autorité.
    console.log(`  — ${f.id} déjà verrouillée (saisie humaine) — non touchée`)
    continue
  }
  console.log(`  ${f.id}  « ${s.brand} ${s.model} »`)
  console.log(`            → « ${f.brand} ${f.model} »`)
  console.log(`            ${f.reason}`)

  if (!APPLY) continue

  const { error: uErr } = await db
    .from('spots')
    .update({
      brand: f.brand,
      model: f.model,
      year: f.year,
      // La fiche d'enrichissement de la ligne décrit l'ANCIEN modèle : la
      // garder afficherait l'histoire et les specs d'une autre voiture.
      car_info: null,
      ident_locked: true,
    })
    .eq('id', s.id)
  if (uErr) {
    console.log(`            ✗ échec : ${uErr.message}`)
    continue
  }

  const { error: lErr } = await db.from('ident_corrections').insert({
    spot_id: s.id,
    old_brand: s.brand,
    old_model: s.model,
    old_year: s.year,
    new_brand: f.brand,
    new_model: f.model,
    new_year: f.year,
    certainty: 'confirmed',
    reason: f.reason,
    evidence: f.evidence,
  })
  console.log(lErr ? `            ⚠ journal non écrit : ${lErr.message}` : `            ✓ corrigé et journalisé`)
}

// ── CACHE D'ENRICHISSEMENT ──
// On ne vide RIEN en aveugle. Une entrée de `car_info_cache` n'est supprimée
// que si elle décrit un couple marque/modèle qu'AUCUN spot ne porte plus :
// elle ne peut alors qu'induire en erreur un futur spot mal identifié de la
// même façon. Une entrée encore utilisée par un autre spot est laissée — elle
// est juste pour celui-là.
const { data: after } = await db.from('spots').select('brand, model, year')
const live = new Set(
  (after ?? []).map((s) =>
    `${s.brand}|${s.model}|${s.year ?? ''}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9|]+/g, '-'),
  ),
)
const { data: cache } = await db.from('car_info_cache').select('slug, brand, model, year')
const orphans = (cache ?? []).filter((c) => {
  const key = `${c.brand}|${c.model}|${c.year ?? ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9|]+/g, '-')
  return !live.has(key)
})

console.log(`\n── CACHE D'ENRICHISSEMENT ──`)
console.log(`entrées totales            : ${(cache ?? []).length}`)
console.log(`orphelines (plus aucun spot): ${orphans.length}`)
for (const o of orphans) console.log(`   ${o.slug}`)
if (orphans.length && APPLY) {
  for (const o of orphans) await db.from('car_info_cache').delete().eq('slug', o.slug)
  console.log(`${orphans.length} entrée(s) orpheline(s) supprimée(s)`)
} else if (orphans.length) {
  console.log(`(essai à blanc — rien supprimé)`)
}

console.log(`\n${APPLY ? 'Terminé.' : 'Essai à blanc terminé — relancer avec --apply.'}`)
