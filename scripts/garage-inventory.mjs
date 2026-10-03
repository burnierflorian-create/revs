// ═══════ INVENTAIRE EXHAUSTIF DU GARAGE VISUAL ═══════
//
// La question à laquelle ce script répond : « combien de véhicules existent
// réellement dans REVS, et qu'est-il advenu de CHACUN ? »
//
// ── POURQUOI UN SCRIPT ET PAS UNE REQUÊTE ──
// Parce qu'il faut pouvoir prouver qu'aucun véhicule n'a disparu en route.
// Le total est vérifié par addition à la fin : si les catégories ne
// retombent pas sur le nombre de modèles distincts, le script le dit et sort
// en erreur. Une requête qui renvoie « 20 premiers » ne prouve rien.
//
// ── PAGINATION ──
// PostgREST plafonne les réponses (1000 lignes par défaut). On pagine
// explicitement jusqu'à épuisement : supposer que la première page contient
// tout est exactement la façon dont on oublie des véhicules.
//
//   node scripts/garage-inventory.mjs            # inventaire
//   node scripts/garage-inventory.mjs --json     # pour un autre outil
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { canRender, cacheKey, GARAGE_VISUAL_VERSION } from '../server/garage-visual.js'

const AS_JSON = process.argv.includes('--json')
const env = readFileSync('.env.local', 'utf8')
const pick = (k, re) => (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]
const db = createClient(
  pick('VITE_SUPABASE_URL', '[^\\s]+'),
  pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+'),
  { auth: { persistSession: false } },
)

/** Lit une table entière, page par page. */
async function readAll(table, select) {
  const PAGE = 1000
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select(select)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`${table} : ${error.message}`)
    out.push(...(data ?? []))
    if ((data ?? []).length < PAGE) break
  }
  return out
}

const spots = await readAll(
  'spots',
  'id, user_id, brand, model, color, garage_render_url, ai_verified, ident_locked, confidence, ai_confidence',
)
const renders = await readAll(
  'garage_renders',
  'cache_key, status, render_url, version, review_reason, attempts',
)
const byKey = new Map(renders.map((r) => [r.cache_key, r]))

// ── LA CLÉ CANONIQUE ──
// Celle du cache (`cacheKey`), qui inclut la couleur : deux exemplaires de
// couleurs différentes sont deux images, et c'est voulu — un rendu gris pour
// une voiture jaune serait faux. Le même modèle dans la même couleur chez
// dix utilisateurs ne produit qu'UNE image.
const canon = new Map()
for (const s of spots) {
  // `cacheKey()` renvoie la clé SANS le suffixe de version, que le point
  // d'entrée de génération ajoute avant d'écrire la ligne. Comparer sans lui
  // ne trouve jamais rien : c'est la version qui distingue un rendu v4 d'un
  // v5 pour la même voiture.
  const base = cacheKey(s)
  const key = base ? `${base}|v${GARAGE_VISUAL_VERSION}` : `??|${s.brand}|${s.model}`
  const e = canon.get(key) ?? {
    key,
    brand: s.brand,
    model: s.model,
    color: s.color,
    spots: 0,
    users: new Set(),
    rendered: 0,
    eligible: canRender(s),
  }
  e.spots++
  e.users.add(s.user_id)
  if (s.garage_render_url) e.rendered++
  canon.set(key, e)
}

const CATS = {
  VALIDE: [], //         image en cache, statut ready
  A_GENERER: [], //      identité fiable, aucune image
  A_CONTROLER: [], //    identité douteuse — on ne devine pas
  EN_ERREUR: [], //      une ligne de cache existe mais sans image
  // Un spot porte une image mais aucune ligne de cache ne la référence :
  // elle a été produite avant la table de cache, ou par un autre chemin.
  // Elle s'affiche, mais aucun autre utilisateur ne la réutilisera.
  ORPHELIN: [],
}

for (const e of canon.values()) {
  const cached = byKey.get(e.key)
  if (cached?.status === 'ready' && cached.render_url) CATS.VALIDE.push(e)
  else if (e.rendered > 0 && !cached) CATS.ORPHELIN.push(e)
  else if (cached && cached.status !== 'ready')
    CATS.EN_ERREUR.push({
      ...e,
      status: cached.status,
      reason: cached.review_reason,
      attempts: cached.attempts,
    })
  else if (e.eligible.ok) CATS.A_GENERER.push(e)
  else CATS.A_CONTROLER.push(e)
}

const total = canon.size
const somme =
  CATS.VALIDE.length +
  CATS.A_GENERER.length +
  CATS.A_CONTROLER.length +
  CATS.EN_ERREUR.length +
  CATS.ORPHELIN.length

if (AS_JSON) {
  writeFileSync(
    'scripts/.garage-inventory.json',
    JSON.stringify(
      Object.fromEntries(
        Object.entries(CATS).map(([k, v]) => [
          k,
          v.map((e) => ({
            key: e.key,
            brand: e.brand,
            model: e.model,
            color: e.color,
            spots: e.spots,
            users: e.users.size,
            reason: e.eligible.reason ?? null,
          })),
        ]),
      ),
      null,
      1,
    ),
  )
  console.log('scripts/.garage-inventory.json écrit')
} else {
  console.log(`spots lus          : ${spots.length}`)
  console.log(`lignes de cache    : ${renders.length}`)
  console.log(`\nMODÈLES CANONIQUES : ${total}\n`)
  console.log(`  VALIDÉS          : ${CATS.VALIDE.length}`)
  console.log(`  À GÉNÉRER        : ${CATS.A_GENERER.length}`)
  console.log(`  À CONTRÔLER      : ${CATS.A_CONTROLER.length}`)
  console.log(`  EN ERREUR        : ${CATS.EN_ERREUR.length}`)
  console.log(`  HORS CACHE       : ${CATS.ORPHELIN.length}`)

  for (const [nom, liste] of [
    ['À GÉNÉRER', CATS.A_GENERER],
    ['À CONTRÔLER', CATS.A_CONTROLER],
    ['EN ERREUR', CATS.EN_ERREUR],
    ['HORS CACHE (image affichée mais non partageable)', CATS.ORPHELIN],
  ]) {
    if (!liste.length) continue
    console.log(`\n── ${nom} ──`)
    for (const e of liste) {
      console.log(
        `  ${`${e.brand} ${e.model}`.slice(0, 40).padEnd(42)} ${e.spots} spot(s) · ${e.users.size} util.` +
          (e.eligible.reason ? `\n      raison : ${e.eligible.reason}` : '') +
          (e.status
            ? `\n      statut de cache : ${e.status}` +
              (e.reason ? ` — ${e.reason}` : '') +
              (e.attempts ? ` (${e.attempts} tentative(s))` : '')
            : ''),
      )
    }
  }

  // ── LA PREUVE ──
  const coherent = somme === total
  console.log(
    `\nTOTAL = VALIDÉS + À GÉNÉRER + À CONTRÔLER + EN ERREUR + HORS CACHE : ` +
      `${total} = ${CATS.VALIDE.length} + ${CATS.A_GENERER.length} + ` +
      `${CATS.A_CONTROLER.length} + ${CATS.EN_ERREUR.length} + ${CATS.ORPHELIN.length} ` +
      `${coherent ? '✓' : '✗ UN MODÈLE A DISPARU'}`,
  )
  console.log(`version du moteur Garage : v${GARAGE_VISUAL_VERSION}`)
  // Les rendus signalés par le contrôle qualité, toutes clés confondues —
  // y compris ceux dont le modèle n'apparaît plus dans aucun spot.
  const signales = renders.filter((r) => r.status === 'needs_review' || r.status === 'failed')
  console.log(
    `rendus signalés par le contrôle : ${signales.length}` +
      (signales.length
        ? '\n' +
          signales
            .map(
              (r) =>
                `  ${r.cache_key.padEnd(44)} ${r.status} — ${r.review_reason ?? 'sans motif'} ` +
                `(${r.attempts} tentative(s))`,
            )
            .join('\n')
        : ''),
  )
  if (!coherent) process.exit(1)
}
