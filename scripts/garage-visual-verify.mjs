// ═══════ GARAGE VISUAL — VÉRIFICATION D'IDENTITÉ D'UN RENDU ═══════
//
// ── CE QUE CET OUTIL AJOUTE ──
// `garage-visual-score.mjs` mesure des pixels : résolution, fond, marge,
// teinte. Il a laissé passer les deux seuls ratés du 01/10 — une Classe C
// rendue en Classe S (auto 3/4) et du faux texte dans un feu arrière — parce
// qu'aucune de ces fautes ne se lit dans un histogramme.
//
// Celui-ci pose la seule question qui compte, à un modèle qui VOIT les deux
// images : « est-ce la même voiture ? ». C'est le critère éliminatoire de la
// grille, et c'est le seul moyen honnête de l'automatiser.
//
// ── POURQUOI ÇA RESTE BON MARCHÉ ──
// Un appel texte sur gemini-3-flash coûte ~0,001 $ contre 0,067 $ pour une
// génération. Vérifier coûte 1,5 % du prix de ce qu'on vérifie : on peut
// refuser et régénérer sans que le budget bouge.
//
// USAGE
//   node scripts/garage-visual-verify.mjs <source.jpg> <rendu.png> ["désignation fichée"]
//
// Sortie : VERDICT ACCEPTÉ / REFUSÉ + motif. Code de sortie 0 si accepté.
// N'ÉCRIT RIEN EN BASE.

import { readFileSync } from 'node:fs'

const [srcPath, renderPath, label] = process.argv.slice(2)
if (!srcPath || !renderPath) {
  console.error('usage : node scripts/garage-visual-verify.mjs <source> <rendu> ["désignation"]')
  process.exit(2)
}

// La clé est lue, jamais affichée ni journalisée.
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const KEY = (env.match(/^GEMINI_API_KEY=("?)([^"\n\r]+)\1/m) || [])[2]
if (!KEY) {
  console.error('GEMINI_API_KEY absente de .env.local — vérification impossible, aucun coût engagé.')
  process.exit(2)
}

// Relevé sur /v1beta/models le 01/10 : `gemini-3-flash` n'existe pas, le nom
// exploitable le plus récent est `gemini-3.8-flash`. Vérifié, pas supposé.
const MODEL = process.env.REVS_VERIFY_MODEL || 'gemini-3.8-flash'
const mime = (p) => (/\.png$/i.test(p) ? 'image/png' : 'image/jpeg')
const b64 = (p) => readFileSync(p).toString('base64')

// ── LA CONSIGNE ──
// Deux précautions délibérées :
//  1. La désignation fichée est donnée comme « ce que prétend la base », pas
//     comme une vérité — elle est parfois fausse (un spot fiché « Bentley
//     R-Type » montre une Rolls-Royce). On demande au vérificateur de juger
//     la PHOTO contre le RENDU, pas contre la fiche.
//  2. En cas de doute, REFUSER. Un faux négatif coûte 0,067 $ de
//     régénération ; un faux positif affiche la mauvaise voiture à un
//     utilisateur, ce qui est le reproche de fond fait au Garage.
const PROMPT = `You are auditing a generated studio photograph of a car.

IMAGE 1 is the original street photo of a real car.
IMAGE 2 is a studio image generated from it.
${label ? `A database record claims this car is a "${label}". That record is frequently WRONG — treat it as a rumour, not as truth. Judge IMAGE 2 against IMAGE 1, never against the record.` : ''}

Answer these questions about IMAGE 2 compared to IMAGE 1:

1. same_make — is it the same manufacturer?
2. same_model — is it the same model, not a bigger/smaller/more prestigious one from the same brand?
3. same_generation — is it the same generation and facelift? Check lamp signatures, grille, bumpers, roofline and proportions.
4. same_colour — is the paint colour and finish the same?
5. text_artefacts — does IMAGE 2 contain GARBLED or NONSENSICAL lettering: strings that do not spell a real word, smeared pseudo-glyphs, or micro-text inside the head or tail lamps? Look closely at the lamps.
   Correct, legible, real manufacturer badging that genuinely belongs on this car (model name, trim name, brand script) is NORMAL and is NOT an artefact — do not flag it.
   If and only if you answer true, you MUST quote the offending string in "artefact_text". If you cannot quote it, answer false.
6. people_or_street — does IMAGE 2 still contain any person, body part, mirror, building, road marking or outdoor element?
7. complete_car — is the whole car inside the frame with comfortable margins, nothing cropped at an edge?

Be strict. If you are not sure about a point, answer false for it.

Reply with ONLY this JSON, no prose, no markdown fence:
{"same_make":bool,"same_model":bool,"same_generation":bool,"same_colour":bool,"text_artefacts":bool,"artefact_text":"the garbled string you read, or empty","people_or_street":bool,"complete_car":bool,"what_it_looks_like":"the model you actually see in IMAGE 2","reason":"one short sentence"}`

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mime(srcPath), data: b64(srcPath) } },
            { inline_data: { mime_type: mime(renderPath), data: b64(renderPath) } },
            { text: PROMPT },
          ],
        },
      ],
      generationConfig: { temperature: 0 },
    }),
  },
)

if (!res.ok) {
  console.error(`vérification impossible : HTTP ${res.status}`)
  process.exit(2)
}

const body = await res.json()
const raw = (body.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')
const json = raw.match(/\{[\s\S]*\}/)
if (!json) {
  console.error('réponse non exploitable — on REFUSE par défaut plutôt que de supposer.')
  process.exit(1)
}
const v = JSON.parse(json[0])

// Les sept points ne pèsent pas pareil. L'identité (marque, modèle,
// génération) est ÉLIMINATOIRE : s'y tromper, c'est montrer à quelqu'un une
// voiture qui n'est pas la sienne. Le reste est bloquant mais réparable.
const fatal = [
  ['même marque', v.same_make],
  ['même modèle', v.same_model],
  ['même génération', v.same_generation],
]
// La règle « cite ou tais-toi », appliquée par le code et pas seulement
// demandée dans la consigne : le vérificateur a d'abord refusé le Cayenne pour
// « fictional rear badging » alors que le badge « Cayenne GTS » est réel et
// correctement orthographié. Exiger la citation rend l'accusation vérifiable —
// et un faux positif ici coûte 0,067 $ de régénération inutile.
const quoted = String(v.artefact_text || '').trim()
const hasArtefact = Boolean(v.text_artefacts) && quoted.length > 0

const blocking = [
  ['couleur conservée', v.same_colour],
  ['aucun faux texte', !hasArtefact],
  ['aucun parasite de rue', !v.people_or_street],
  ['voiture entière', v.complete_car],
]

console.log(`\n═══ ${renderPath.split('/').pop()} ═══`)
for (const [n, ok] of fatal) console.log(`  ${ok ? '✓' : '✗'} ${n.padEnd(24)} ${ok ? '' : '← ÉLIMINATOIRE'}`)
for (const [n, ok] of blocking) console.log(`  ${ok ? '✓' : '✗'} ${n.padEnd(24)} ${ok ? '' : '← bloquant'}`)
if (hasArtefact) console.log(`  texte lu   : « ${quoted} »`)
console.log(`  vu comme   : ${v.what_it_looks_like}`)
console.log(`  motif      : ${v.reason}`)

const failedFatal = fatal.filter(([, ok]) => !ok).map(([n]) => n)
const failedBlock = blocking.filter(([, ok]) => !ok).map(([n]) => n)
const accepted = !failedFatal.length && !failedBlock.length
console.log(
  `\n  VERDICT : ${accepted ? 'ACCEPTÉ' : `REFUSÉ — ${[...failedFatal, ...failedBlock].join(', ')}`}`,
)
process.exit(accepted ? 0 : 1)
