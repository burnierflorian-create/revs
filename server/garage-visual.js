// ═══════════ GARAGE VISUAL — COUCHE FOURNISSEUR ═══════════
//
// ── POURQUOI CETTE COUCHE EXISTE ──
// Le cahier des charges demande que REVS puisse changer de moteur d'image
// sans réécrire le Garage. Ce n'est pas de l'abstraction gratuite : à ce
// jour AUCUN moteur n'a produit un rendu validé en production, et parier
// l'architecture sur l'un d'eux serait prématuré.
//
// État au 01/10/2026, vérifié et non supposé :
//
//   gemini   — intégré, 0,067 $/image, mais `limit: 0` sur TOUS les modèles
//              image. Revérifié ce jour : toujours bloqué. La clé est valide
//              (les modèles texte répondent 200) ; il manque la facturation.
//   canva    — a produit le SEUL rendu conforme aux dix critères (Tesla
//              Model 3, 3/4 arrière-gauche, rétroviseur et bras disparus).
//              Mais sa Connect API n'expose AUCUN endpoint de génération :
//              les 58 endpoints publics ont été lus, `/v1/image-transformations`
//              ne propose que `background_removal`. Non automatisable.
//   cutout   — le détourage local actuel. Mesuré sur les 32 rendus :
//              24 échecs. C'est un REPLI, pas un moteur.
//
// ── CE QUE CE FICHIER N'EST PAS ──
// Il ne lance aucune génération de masse et ne construit pas le pipeline de
// production. Il fixe le contrat pour que le jour où un moteur passe la
// validation, seul `providers.<nom>.generate` soit à écrire.

export const GARAGE_VISUAL_VERSION = 1

/**
 * Le prompt. Partagé par tous les fournisseurs : si deux moteurs reçoivent
 * des consignes différentes, on ne compare plus les moteurs mais les
 * prompts, et la décision devient ininterprétable.
 *
 * Écrit en anglais — les modèles image obéissent nettement mieux aux termes
 * photographiques anglais, et c'est de la consigne machine, jamais affichée.
 *
 * L'ordre est délibéré : l'IDENTITÉ d'abord, le studio ensuite. Un modèle à
 * qui on décrit d'abord un studio a déjà commencé à composer un studio, et
 * la vraie voiture devient un détail.
 */
export function buildPrompt(vehicle) {
  const { brand, model, year, color, confidence } = vehicle
  const name = [brand, model].filter(Boolean).join(' ').trim()
  const sure = Number(confidence ?? 0) >= 85 && !/inconnu|unknown/i.test(name)

  // Sous 85 de confiance, on NE donne PAS la désignation : écrire
  // « Ferrari modèle inconnu » invite le moteur à inventer une Ferrari.
  const identity = sure
    ? `The subject is a ${name}${year ? `, model year ${year}` : ''}, finished in "${color}". Render that exact model and generation — correct silhouette, roofline, greenhouse, overhangs, bumpers, lamp signatures, grille and wheel design.`
    : `The model is NOT reliably identified. Do not name or guess a model: reproduce faithfully the car VISIBLE in the reference photo — its exact silhouette, proportions, lamp shapes, glass area and wheels — in the colour "${color}".`

  return `Create a NEW premium automotive showroom photograph of one single car.

The attached photo is a REFERENCE FOR IDENTIFYING THE CAR ONLY. Do not edit it, do not reuse its framing, its angle, its lighting or any part of its surroundings. Build a new image from scratch.

SUBJECT
${identity}
Keep the real paint colour and finish. Keep any body kit, spoiler, wrap or wheel option genuinely on this car.

WHAT BELONGS TO THE SCENE, NOT TO THE CAR — exclude all of it
The reference photo was taken in the street, often from inside another vehicle. Everything below belongs to that situation and must not appear:
people, arms, hands, faces, reflections of people; the door mirror, window frame, A-pillar, dashboard or bodywork of the car the photo was taken FROM; other vehicles; buildings, shopfronts, signage, lettering; poles, traffic signs, road markings, kerbs, pavements, street furniture; trees, sky, any outdoor background; any object in front of or overlapping the car.
Only the identified car survives into the new image.

COMPOSITION
Three-quarter view, REAR toward the LEFT of the frame and FRONT toward the RIGHT. Camera at headlight height — low, car-level, never a drone or steep top-down angle. 50-85mm equivalent, no wide-angle distortion. Complete vehicle inside the frame, all four wheels visible, nothing cropped, comfortable margin on every side. The car fills most of the frame.
If this orientation cannot be produced without distorting the car, prefer a faithful car at a slightly different angle over a correct angle on a wrong car.

ENVIRONMENT — the REVS showroom
Dark seamless studio: black and graphite falling off to deep black at the edges. Polished floor with a soft, believable reflection beneath the car. Elegant vertical studio lights, depth, optional faint haze. No walls, props, furniture, decoration or text.

LIGHTING
Premium automotive studio lighting: long soft strip highlights along the shoulder line and roof, gentle rim light separating the car from the background, clean speculars on wheels and lamps, soft contact shadow so the car sits on the floor instead of floating.

STRICT PROHIBITIONS
- Do NOT output a different model, generation or trim.
- Do NOT restyle, modernise, lower, widen or "improve" the bodywork.
- Do NOT change the paint colour.
- Do NOT include any person, body part or reflection of a person.
- Do NOT render a readable licence plate: leave the plate area blank, dark or softly blurred.
- Do NOT add any manufacturer badge, logo or lettering not genuinely on this car.
- Do NOT add text, captions, graphics or watermarks anywhere.
- Do NOT reuse the background, framing or perspective of the reference photo.

Output: one photorealistic image, nothing else.`
}

/**
 * La clé de cache.
 *
 * ── POURQUOI LA COULEUR EN FAIT PARTIE ──
 * Une Tesla Model 3 blanche et une noire ne se ressemblent pas : la couleur
 * change les reflets, donc toute la lecture de la carrosserie en studio. Un
 * rendu commun donnerait à la moitié des gens une voiture qui n'est pas la
 * leur — exactement le reproche fait à l'ancienne bibliothèque `car_renders`.
 *
 * La couleur est NORMALISÉE avant d'entrer dans la clé : l'IA écrit « noir
 * obsidien », « Nero Noctis », « noir nacré » pour des rendus qui seront
 * visuellement identiques. Sans ce repliement, on paierait trois générations
 * pour une seule image utile.
 *
 * Grain retenu : marque + modèle + famille de couleur. Pas l'année —
 * deux millésimes d'une même génération donnent le même visuel.
 */
const COLOUR_FAMILIES = [
  [/blanc|white|bianco|pearl|carrara|polaire/i, 'white'],
  [/noir|black|nero|obsidien|jet/i, 'black'],
  [/gris|grey|gray|grigio|argent|silver|taupe|graphite/i, 'grey'],
  [/rouge|red|rosso|guards/i, 'red'],
  [/bleu|blue|blu|miami|ara/i, 'blue'],
  [/vert|green|verde|brooklyn/i, 'green'],
  [/jaune|yellow|giallo/i, 'yellow'],
  [/orange|papaya|volcano/i, 'orange'],
]

export function colourFamily(raw) {
  const s = String(raw ?? '').toLowerCase()
  for (const [re, name] of COLOUR_FAMILIES) if (re.test(s)) return name
  return 'other'
}

export function cacheKey(vehicle) {
  const slug = (v) =>
    String(v ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  return [slug(vehicle.brand), slug(vehicle.model), colourFamily(vehicle.color)]
    .filter(Boolean)
    .join('|')
}

/**
 * Contrôle qualité automatique — le garde du §28.
 *
 * Un rendu peut revenir « réussi » côté API et être inutilisable à l'écran.
 * Ces trois mesures sur le canal alpha repèrent les ratés francs, et c'est
 * exactement ce qui a permis d'écarter 24 des 32 rendus de détourage :
 *   · plusieurs taches opaques  → un objet parasite accompagne la voiture ;
 *   · sujet touchant 3+ bords   → voiture coupée, aucune composition ;
 *   · couverture hors bornes    → décor conservé, ou véhicule minuscule.
 *
 * Volontairement conservateur : il écarte les échecs évidents, il ne juge
 * pas la fidélité du modèle. Cela, seul un œil humain le fait.
 */
export const QUALITY_BOUNDS = {
  minCoverage: 0.12,
  maxCoverage: 0.85,
  maxEdges: 2,
  maxBlobs: 1,
}

export function verdictFrom(metrics) {
  const why = []
  if (metrics.blobs > QUALITY_BOUNDS.maxBlobs) why.push('objet parasite détecté')
  if (metrics.coverage > QUALITY_BOUNDS.maxCoverage) why.push('décor conservé')
  if (metrics.coverage < QUALITY_BOUNDS.minCoverage) why.push('véhicule trop petit')
  if (metrics.edges > QUALITY_BOUNDS.maxEdges) why.push('véhicule coupé')
  return { ok: why.length === 0, why }
}

/**
 * Les fournisseurs. Chacun expose `available()` et `generate()`.
 *
 * `available()` dit la VÉRITÉ du moment, pas une intention : c'est ce qui
 * permet au pipeline de choisir sans que l'appelant connaisse les détails,
 * et au rapport de ne jamais prétendre qu'un moteur fonctionne.
 */
export const providers = {
  gemini: {
    id: 'gemini',
    model: 'gemini-3.1-flash-image',
    usdPerImage: 0.067,
    /** Un appel réel, pas une supposition sur la configuration. */
    async available(apiKey) {
      if (!apiKey) return { ok: false, reason: 'GEMINI_API_KEY absente' }
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }] }),
          },
        )
        if (r.ok) return { ok: true }
        const j = await r.json().catch(() => ({}))
        const msg = j?.error?.message ?? `HTTP ${r.status}`
        return {
          ok: false,
          reason: /limit: 0/.test(msg)
            ? 'quota image à 0 — facturation Google Cloud non activée'
            : msg.slice(0, 140),
        }
      } catch (e) {
        return { ok: false, reason: String(e).slice(0, 140) }
      }
    },
    async generate({ apiKey, photoBase64, mimeType, vehicle }) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { inlineData: { mimeType, data: photoBase64 } },
                  { text: buildPrompt(vehicle) },
                ],
              },
            ],
            generationConfig: { responseModalities: ['IMAGE'] },
          }),
        },
      )
      const json = await res.json()
      if (!res.ok || json.error) {
        return { ok: false, error: json?.error?.message ?? `HTTP ${res.status}` }
      }
      const part = (json.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData)
      if (!part) {
        return {
          ok: false,
          error: `aucune image renvoyée (${json.candidates?.[0]?.finishReason ?? 'raison inconnue'})`,
        }
      }
      return {
        ok: true,
        bytes: Buffer.from(part.inlineData.data, 'base64'),
        mimeType: part.inlineData.mimeType ?? 'image/png',
      }
    },
  },

  /**
   * Le détourage local — REPLI, pas moteur.
   *
   * Il ne reconstruit rien : il découpe la voiture de la photo et la pose sur
   * le sol du studio. Quand la photo est propre, le résultat est honnête.
   * Quand elle contient le rétroviseur du photographe, il le découpe avec.
   * C'est pourquoi `verdictFrom()` existe, et pourquoi 24 rendus sur 32 ont
   * été retirés le 01/10.
   */
  cutout: {
    id: 'cutout',
    model: '@imgly/background-removal-node',
    usdPerImage: 0,
    async available() {
      return { ok: true, reason: 'local, hors ligne, gratuit' }
    },
    async generate() {
      return {
        ok: false,
        error:
          'Le détourage tourne hors ligne via scripts/detour-spot-photos.mjs. ' +
          'Il n’est pas exposé ici : c’est un repli, pas un moteur de rendu.',
      }
    },
  },
}

/** Le premier fournisseur réellement disponible, dans l'ordre de préférence. */
export async function pickProvider(env) {
  const order = ['gemini', 'cutout']
  const report = []
  for (const id of order) {
    const p = providers[id]
    const a = await p.available(env?.GEMINI_API_KEY)
    report.push({ id, ...a })
    if (a.ok && id !== 'cutout') return { provider: p, report }
  }
  return { provider: null, report }
}
