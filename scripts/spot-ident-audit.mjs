// ═══════ AUDIT D'IDENTIFICATION DES SPOTS EXISTANTS ═══════
//
// ── POURQUOI UN AUTRE FOURNISSEUR QUE CELUI QUI A PRODUIT LES FICHES ──
// Les fiches ont été écrites par Claude. Les réexaminer avec Claude mesurerait
// surtout la reproductibilité de Claude, pas la vérité : un modèle qui se
// trompe sur une photo a toutes les chances de se tromper pareil au second
// passage. On interroge donc Gemini — un moteur entraîné séparément, qui se
// trompe, quand il se trompe, pour d'autres raisons.
//
// ── CE QU'UN DÉSACCORD PROUVE, ET CE QU'IL NE PROUVE PAS ──
// Rien, seul. Une IA qui contredit une autre n'établit pas qui a raison. Une
// correction n'est donc proposée QUE si deux analyses indépendantes
// s'accordent ENTRE ELLES et contredisent toutes deux la fiche. Tout le reste
// est classé INCERTAIN et laissé strictement intact — remplacer une donnée
// juste par une fausse coûte plus cher que de laisser un doute.
//
// ── COÛT ──
// Passe 1 sur les 33 photos avec le modèle rapide. Passe 2, plus chère, UNIQUEMENT
// sur les désaccords. Le coût réel est affiché en fin d'exécution.
//
// USAGE
//   node scripts/spot-ident-audit.mjs            # audit, N'ÉCRIT RIEN
//
// LECTURE SEULE : aucune écriture en base. La correction est un script séparé,
// qui lit le rapport produit ici.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const OUT = 'ident-audit'
mkdirSync(OUT, { recursive: true })

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const pick = (k, re) => (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]
const GKEY = pick('GEMINI_API_KEY', '[^\\s]+')
if (!GKEY) {
  console.error('GEMINI_API_KEY absente — audit impossible, aucun coût engagé.')
  process.exit(2)
}
const db = createClient(
  pick('VITE_SUPABASE_URL', '[^\\s]+'),
  pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+'),
  { auth: { persistSession: false } },
)

// Relevé sur /v1beta/models le 01/10. Le « pro » n'est sollicité qu'en cas de
// désaccord, donc son prix ne porte que sur une poignée de photos.
const FAST = process.env.REVS_AUDIT_FAST || 'gemini-3.8-flash'
const DEEP = process.env.REVS_AUDIT_DEEP || 'gemini-3.1-pro-preview'
// Tarifs publics, pour une estimation honnête plutôt qu'un chiffre inventé.
const PRICE = { [FAST]: 0.0008, [DEEP]: 0.006 }

// ── LE PROMPT ──
// Il insiste sur ce que la chaîne actuelle ne demande nulle part : distinguer
// une carrosserie d'une autre et une génération d'une autre. C'est exactement
// ce qui a produit « Model 3 » sur une Model Y et « Classe C » sur une
// Classe E. On lui demande aussi de SE TAIRE sur ce qu'il ne voit pas, plutôt
// que de compléter.
const PROMPT = `You are auditing a car-spotting app's vehicle identification.

Identify the MAIN vehicle in this photo. Work from what you can actually see.

Compare carefully before concluding — these are the mistakes that matter most:
- body type: saloon vs estate vs coupé vs SUV vs crossover vs cabriolet. Judge roof height, ground clearance, glasshouse shape, rear overhang, tailgate angle.
- adjacent models of the same brand (Tesla Model 3 vs Model Y, Mercedes C-Class vs E-Class vs S-Class, BMW 3 vs 4 Series, Audi A4 vs A5, VW Golf vs Polo). Judge overall length, door count and length, wheelbase, and the proportions between wheel and body.
- generation and facelift of the same model: lamp signatures, grille, bumpers, door handles, mirror shape.

State ONLY what the photo supports:
- If you can read the brand but not the model, give the brand and leave model empty.
- If you cannot tell the generation, leave it empty. Never fill a field by inference from the others.
- "confident" means you would stake the app's credibility on it.

Reply with ONLY this JSON, no prose, no markdown fence:
{"brand":"","model":"","body":"saloon|estate|coupe|suv|crossover|cabriolet|hatchback|van|other","generation":"","year_range":"","colour":"","confident":true,"readable":true,"evidence":"the visual features you actually used, one sentence"}

"readable": false if the vehicle is too far, too occluded, too dark or too blurred to identify at all.`

let spend = 0

async function ask(model, imgB64, extra = '') {
  for (let i = 0; i < 3; i += 1) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': GKEY },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: 'image/jpeg', data: imgB64 } },
                { text: PROMPT + extra },
              ],
            },
          ],
          generationConfig: { temperature: 0 },
        }),
      },
    )
    if (r.ok) {
      const j = await r.json()
      const t = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')
      const m = t.match(/\{[\s\S]*\}/)
      if (m) {
        spend += PRICE[model] ?? 0.001
        try {
          return JSON.parse(m[0])
        } catch {
          /* réponse tronquée : on retente */
        }
      }
    }
    await new Promise((s) => setTimeout(s, 1500 * (i + 1)))
  }
  // null = l'analyse n'a PAS eu lieu. Jamais confondu avec « rien trouvé ».
  return null
}

/** Normalisation pour comparer des libellés écrits par des mains différentes. */
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/mercedes[- ]?(benz|amg)/g, 'mercedes')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Le libellé stocké contient-il le modèle vu, ou l'inverse ? */
function agrees(stored, seen) {
  const a = norm(stored)
  const b = norm(seen)
  if (!a || !b) return false
  if (a === b) return true
  // « Classe C W206 AMG Line » contient « classe c » ; « Model 3 » ne contient
  // pas « model y ». La comparaison par inclusion absorbe les finitions sans
  // absorber un changement de modèle.
  return a.includes(b) || b.includes(a)
}

const { data: spots, error } = await db
  .from('spots')
  .select('id, brand, model, year, color, photo_url, car_info, created_at')
  .order('created_at', { ascending: true })
if (error) throw error

console.log(`\n═══ AUDIT D'IDENTIFICATION · ${spots.length} spots ═══`)
console.log(`passe 1 : ${FAST}   ·   passe 2 (désaccords seuls) : ${DEEP}\n`)

const rows = []
for (const s of spots) {
  const stored = `${s.brand ?? ''} ${s.model ?? ''}`.trim()
  let img
  try {
    const r = await fetch(s.photo_url)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    img = Buffer.from(await r.arrayBuffer()).toString('base64')
  } catch (e) {
    console.log(`  ✗ ${stored.slice(0, 34).padEnd(36)} photo illisible : ${e.message}`)
    rows.push({ id: s.id, stored, verdict: 'PHOTO_KO' })
    continue
  }

  const p1 = await ask(FAST, img)
  if (!p1) {
    console.log(`  ? ${stored.slice(0, 34).padEnd(36)} analyse indisponible — laissé intact`)
    rows.push({ id: s.id, stored, verdict: 'INDISPONIBLE' })
    continue
  }

  const seen1 = `${p1.brand ?? ''} ${p1.model ?? ''}`.trim()
  const brandOk = agrees(s.brand, p1.brand)
  const modelOk = agrees(stored, seen1)

  // ── QUAND DÉCLENCHER LA PASSE 2 ──
  // Uniquement si la passe 1 contredit la fiche ET s'estime sûre. Un
  // désaccord d'une analyse peu sûre ne vaut pas qu'on paie un modèle cher :
  // il sera classé INCERTAIN de toute façon.
  let p2 = null
  if (!modelOk && p1.confident && p1.readable !== false) {
    p2 = await ask(DEEP, img)
  }

  let verdict
  let why
  if (p1.readable === false) {
    verdict = 'C_INCERTAIN'
    why = 'véhicule non identifiable sur la photo'
  } else if (modelOk) {
    verdict = 'A_CORRECT'
    why = ''
  } else if (!p1.confident) {
    verdict = 'C_INCERTAIN'
    why = 'la seconde lecture diverge mais ne s’estime pas sûre'
  } else if (!p2) {
    verdict = 'C_INCERTAIN'
    why = 'contre-analyse indisponible'
  } else {
    const seen2 = `${p2.brand ?? ''} ${p2.model ?? ''}`.trim()
    const twoAgree = agrees(seen1, seen2)
    const p2ContradictsStored = !agrees(stored, seen2)
    if (twoAgree && p2ContradictsStored && p2.confident) {
      verdict = 'B_ERREUR'
      why = `deux analyses indépendantes concordent sur « ${seen1} »`
    } else {
      verdict = 'C_INCERTAIN'
      why = twoAgree ? 'les deux analyses ne contredisent pas clairement la fiche' : `les deux analyses divergent (${seen1} / ${seen2})`
    }
  }

  const mark = verdict === 'A_CORRECT' ? '✓' : verdict === 'B_ERREUR' ? '✗' : '?'
  console.log(
    `  ${mark} ${stored.slice(0, 34).padEnd(36)}` +
      (verdict === 'A_CORRECT'
        ? `conforme`
        : `vu : ${seen1.slice(0, 28).padEnd(30)}${verdict === 'B_ERREUR' ? 'ERREUR CONFIRMÉE' : 'incertain'}`),
  )
  rows.push({
    id: s.id,
    stored,
    storedBrand: s.brand,
    storedModel: s.model,
    storedYear: s.year,
    photo_url: s.photo_url,
    pass1: p1,
    pass2: p2,
    brandOk,
    verdict,
    why,
  })
}

const by = (v) => rows.filter((r) => r.verdict === v)
console.log(`\n═══ SYNTHÈSE ═══`)
console.log(`A · confirmés corrects     : ${by('A_CORRECT').length}`)
console.log(`B · erreurs confirmées     : ${by('B_ERREUR').length}`)
console.log(`C · incertains (intacts)   : ${by('C_INCERTAIN').length}`)
console.log(`    analyses indisponibles : ${by('INDISPONIBLE').length}`)
console.log(`    photos illisibles      : ${by('PHOTO_KO').length}`)
console.log(`\ncoût de l'audit            : ${spend.toFixed(3)} $  (${(spend / Math.max(1, spots.length)).toFixed(4)} $/spot)`)

if (by('B_ERREUR').length) {
  console.log(`\n── ERREURS CONFIRMÉES ──`)
  for (const r of by('B_ERREUR')) {
    console.log(`  ${r.id.slice(0, 8)}  « ${r.stored} »`)
    console.log(`            → « ${r.pass1.brand} ${r.pass1.model} »   ${r.why}`)
    console.log(`            indice : ${r.pass1.evidence ?? ''}`)
  }
}
if (by('C_INCERTAIN').length) {
  console.log(`\n── INCERTAINS, LAISSÉS INTACTS ──`)
  for (const r of by('C_INCERTAIN')) {
    console.log(`  ${r.id.slice(0, 8)}  « ${r.stored} »  — ${r.why}`)
  }
}

writeFileSync(`${OUT}/ident-audit.json`, JSON.stringify({ at: new Date().toISOString(), spend, rows }, null, 2))
console.log(`\nrapport : ${OUT}/ident-audit.json`)
