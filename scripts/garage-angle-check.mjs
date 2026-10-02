// ═══════ CONTRÔLE D'ANGLE DES RENDUS GARAGE VISUAL ═══════
//
// L'identité d'un rendu et son ANGLE sont deux critères distincts : un rendu
// peut montrer la bonne voiture et la montrer de dos. Ce module pose la
// question à un modèle de vision et n'accepte qu'une réponse structurée.
//
// Il ne juge PAS le style ni la qualité — seulement ce qui est mesurable :
// quelle extrémité de la voiture fait face à la caméra, et quelle part de la
// largeur du cadre elle occupe.
const MODEL = 'gemini-3.8-flash'

const QUESTION = `You are inspecting a studio photograph of a single car. Answer ONLY with JSON.

{"view":"front-three-quarter"|"rear-three-quarter"|"side-profile"|"front-straight"|"rear-straight"|"other",
 "nose_points":"left"|"right"|"toward-camera"|"away",
 "body_colour":"<one word>",
 "front_visible":true|false,
 "both_headlights_visible":true|false,
 "width_pct":<integer 0-100>,
 "cropped":true|false,
 "camera_height":"low"|"eye"|"high",
 "text_or_watermark":true|false}

Definitions you must apply strictly:
- "front-three-quarter": you see the FRONT of the car AND one of its flanks. Headlights and grille face the camera at an angle.
- "rear-three-quarter": you see the REAR of the car AND one of its flanks. Tail lamps face the camera; the headlights are hidden or barely visible at the far end.
- "width_pct": how much of the image WIDTH the car's bodywork spans, from its leftmost to its rightmost point.
- "cropped": true if any wheel, mirror, roof or body panel is cut by the image edge.
- "body_colour": the dominant colour of the car's PAINT, as one single lowercase English word from this list exactly: white, black, grey, silver, red, blue, green, yellow, orange, purple, pink, brown, bronze, beige. Judge the paint only — not the lighting, not the floor, not the reflections.
Answer with the JSON object alone, no prose, no code fence.`

export async function checkAngle({ apiKey, bytes, mimeType = 'image/png' }) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [
          { inlineData: { mimeType, data: Buffer.from(bytes).toString('base64') } },
          { text: QUESTION },
        ] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    },
  )
  const j = await r.json()
  if (!r.ok || j.error) return { ok: false, error: j?.error?.message ?? `HTTP ${r.status}` }
  const txt = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text).join('')
  try {
    return { ok: true, verdict: JSON.parse(txt) }
  } catch {
    return { ok: false, error: `réponse illisible : ${String(txt).slice(0, 80)}` }
  }
}

/**
 * Le rendu est-il conforme à la référence ?
 *
 * Trois critères séparés, pour que le rapport puisse dire LEQUEL a échoué —
 * « non conforme » sans raison n'apprend rien et ne se corrige pas.
 */
/**
 * Les teintes que l'on accepte de confondre.
 *
 * `colourFamily()` range les libellés catalogue dans douze familles ; le
 * contrôleur, lui, décrit ce qu'il VOIT. Les deux ne se recouvrent pas
 * exactement : un « gris argent métallisé » se voit « silver », un bronze
 * taupe se voit « brown ». On ne signale donc que les écarts qui sautent aux
 * yeux — un noir rendu brun, un blanc rendu rouge.
 */
const COLOUR_NEIGHBOURS = {
  white: ['white', 'silver', 'beige'],
  black: ['black'],
  grey: ['grey', 'silver', 'white'],
  bronze: ['bronze', 'brown', 'beige', 'gold', 'silver', 'grey'],
  red: ['red'],
  blue: ['blue'],
  green: ['green'],
  yellow: ['yellow'],
  orange: ['orange'],
  purple: ['purple'],
  pink: ['pink'],
  other: null,
}

/** L'écart de couleur, quand on sait quelle famille était attendue. */
export function colourMismatch(v, expectedFamily) {
  const allowed = COLOUR_NEIGHBOURS[expectedFamily]
  if (!allowed || !v?.body_colour) return null
  return allowed.includes(String(v.body_colour).toLowerCase())
    ? null
    : `couleur ${v.body_colour} au lieu de ${expectedFamily}`
}

export function conformity(v) {
  const problems = []
  if (v.view !== 'front-three-quarter') problems.push(`vue ${v.view}`)
  if (v.front_visible === false) problems.push('avant non visible')
  if (typeof v.width_pct === 'number' && v.width_pct < 70) problems.push(`cadrage large (${v.width_pct} %)`)
  if (v.cropped === true) problems.push('véhicule coupé')
  if (v.text_or_watermark === true) problems.push('texte ou filigrane')
  return { ok: problems.length === 0, problems }
}
