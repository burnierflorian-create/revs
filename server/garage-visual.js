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

// La préservation de la BICOLORE a été ajoutée après coup : la Rolls-Royce
// brun sur crème ressortait monochrome champagne, l'éclairage ambiant teinté
// ayant aplati la séparation des deux teintes. Le prompt parlait de couleur et
// de finition, jamais de carrosserie bicolore.
//
// v4 (02/10/2026) — LE GARAGE DE CHAQUE VOITURE, d'après une référence
// artistique fournie (carte Ferrari SF90 rouge). Elle dit l'inverse de la v3 :
//   · 3/4 AVANT, nez vers la droite, caméra basse — pas 3/4 arrière ;
//   · la voiture occupe ~85 % de la largeur — elle était bien trop petite ;
//   · un vrai décor architectural avec des bandeaux lumineux VERTICAUX —
//     que la v3 avait nommément interdits ;
//   · un environnement coloré par la voiture — la v3 les faisait toutes grises.
// La v3 avait unifié le showroom EN LE VIDANT. La référence unifie par le
// langage visuel, pas par l'uniformité : chaque voiture a son garage, et tous
// appartiennent à la même famille. L'ambiance dérive de la COULEUR de la
// carrosserie, jamais de la marque — sans quoi une Ferrari noire aurait un
// garage rouge et une Alpine rouge un garage bleu.
//
// v3 (02/10/2026) — décor unifié. Mesuré sur un banc de 7 véhicules, le
// prompt v2 produisait des rendus individuellement bons mais visuellement
// DISPARATES : dégradé nu pour l'un, tubes lumineux verticaux pour l'autre,
// plafond et embrasure architecturale pour un troisième. Chaque image était
// défendable ; mises côte à côte elles ne formaient pas un showroom.
// « Décor premium » laissait au moteur le soin d'inventer un lieu, et il en
// inventait un différent à chaque fois. La section ENVIRONMENT décrit
// désormais UN plateau, et interdit nommément ce qui était apparu.
//
// v2 (01/10/2026) — prompt hybride : la photo fait autorité sur la fiche.
//
// La version entre dans la clé de cache, donc la changer invalide les rendus
// faits avec l'ancien prompt. C'est voulu.
export const GARAGE_VISUAL_VERSION = 4

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
/**
 * ═══════ LE GARAGE NE DÉCIDE JAMAIS DE L'IDENTITÉ ═══════
 *
 * ── CE QUE CE VERROU EMPÊCHE ──
 * Le Garage Visual reçoit une fiche et dessine ce qu'elle dit. Il n'a aucun
 * moyen de savoir si elle est juste, et aucun droit d'en juger : son rôle est
 * de représenter, pas d'identifier. Or l'audit du parc, le 01/10/2026, a
 * trouvé 3 fiches fausses sur 33 — une Model Y fichée « Model 3 », une
 * Classe E fichée « Classe C », une Rolls-Royce fichée « Bentley ». Chacune
 * aurait produit, en toute logique, un rendu impeccable de la mauvaise
 * voiture, affiché dans le Garage de quelqu'un comme étant la sienne.
 *
 * Un beau rendu faux est pire qu'une absence de rendu : il est crédible.
 *
 * ── LA RÈGLE ──
 * On ne génère que sur une identité VALIDÉE, c'est-à-dire :
 *   · une marque réelle, pas un libellé générique ;
 *   · un modèle réel, pas « Modèle inconnu » ;
 *   · ET l'un des deux sceaux : soit un humain l'a saisie ou confirmée
 *     (`ident_locked`), soit la contre-vérification l'a soutenue
 *     (`verified`).
 *
 * La confiance seule ne suffit PAS à faire sceau : c'est un score que le
 * modèle s'attribue, et la Model Y était annoncée à 88.
 *
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function canRender(vehicle) {
  const brand = String(vehicle?.brand || '').trim()
  const model = String(vehicle?.model || '').trim()
  const generic = /^(inconnue?|unknown|voiture|véhicule|vehicle)$/i

  if (!brand || generic.test(brand)) {
    return { ok: false, reason: 'marque non identifiée' }
  }
  if (!model || /inconnu|unknown/i.test(model)) {
    return { ok: false, reason: 'modèle non identifié — le Garage ne devine pas' }
  }
  if (vehicle?.ident_locked === true) return { ok: true }
  // `ai_verified` est la colonne (migration 0102) ; `verified` est la forme
  // en mémoire que renvoie identify-car juste après l'analyse. On accepte les
  // deux : la première pour un spot relu depuis la base, la seconde pour un
  // résultat encore en vol.
  if (vehicle?.ai_verified === true || vehicle?.verified === true) return { ok: true }
  return {
    ok: false,
    reason:
      'identité ni confirmée par un humain ni soutenue par la contre-vérification',
  }
}

export function buildPrompt(vehicle) {
  // `year` est volontairement ABSENT : c'est lui qui a fait rendre une Model 3
  // d'avant 2023 pour une Highland. Une année dans le prompt se lit comme un
  // ordre de génération, et la génération doit venir de la photo.
  const { brand, model, color, confidence } = vehicle
  // La marque est souvent répétée dans le modèle (« Bentley Bentley R-Type »,
  // tel quel en base) : on la retire, un doublon brouille la désignation.
  const clean = String(model || '').replace(new RegExp(`^${String(brand || '').trim()}\\s+`, 'i'), '')
  const name = [brand, clean].filter(Boolean).join(' ').trim()
  const known = name.length > 0 && !/inconnu|unknown/i.test(name)
  // L'ambiance du décor dérive de la COULEUR de la voiture, jamais de sa
  // marque — voir SHOWROOM_PALETTES.
  const palette = showroomPalette(color)
  const trusted = Number(confidence ?? 0) >= 85

  // ── POURQUOI « INDICE » ET NON « CONSIGNE » ──
  // Les deux formulations précédentes se partageaient les véhicules selon le
  // seuil de confiance 85, et MESURÉ sur les 5 rendus du 01/10, chacune
  // échouait dès que SA source était fausse :
  //
  //   branche stricte (conf ≥ 85) « rends exactement un <nom> <année> »
  //     911 GT3 (94) ✓ · Cayenne GTS (92) ✓  — la fiche était juste.
  //     Model 3 (88) ✗ — la fiche dit « 2021 », la photo montre le restylage
  //     Highland. Le moteur a obéi à la fiche et rendu la voiture d'avant
  //     2023. L'ANNÉE de la fiche est le piège : elle commande une génération.
  //
  //   branche photo seule (conf < 85) « ne nomme rien, recopie la photo »
  //     Rolls-Royce fichée « Bentley R-Type » (82) ✓ — la photo a sauvé le
  //     rendu là où la fiche l'aurait détruit.
  //     Mercedes (78) ✗ — sans ancrage, le moteur dérive vers l'archétype du
  //     constructeur : la Classe C est devenue une Classe S.
  //
  // Aucune des deux sources n'est fiable seule, et le seuil ne fait que
  // choisir laquelle échouera.
  //
  // ── CE QUI A TRANCHÉ LE DOSAGE ──
  // Une vérification croisée des 5 photos contre leur fiche (voir
  // garage-visual-verify.mjs) a montré que la fiche est fausse sur TROIS des
  // cinq : une Classe E fichée « Classe C », une Rolls-Royce Silver Cloud
  // fichée « Bentley R-Type », une Model Y fichée « Model 3 ». La fiche n'est
  // donc pas une source d'appoint légèrement bruitée : sur cet échantillon
  // elle se trompe plus souvent qu'elle ne tombe juste, y compris sur la
  // MARQUE et sur la FAMILLE du modèle.
  //
  // La photo est donc posée comme source unique, lue en premier ; la fiche
  // n'intervient qu'en départage d'ambiguïté réelle. La confiance ne décide
  // plus quelle branche tire — elle ne fait que doser le crédit accordé à ce
  // départage.
  const identity = known
    ? `Identify the car FROM THE PHOTO ITSELF. The photo is the primary source: read its make, model, generation and facelift from what you can actually see — lamp signatures, grille, roofline, proportions, glass area, bonnet height, wheels and trim.
A database record calls this car a "${name}". That record was produced automatically and ${trusted ? 'is often wrong' : 'is unreliable'} — it may be wrong about the generation, about the model, and even about the make. Use it ONLY to break a genuine ambiguity when the photo alone does not settle the question, never against something you can see.
WHEREVER THE RECORD AND THE PHOTO DISAGREE, FOLLOW THE PHOTO.
Never replace the car with a larger, longer, newer, older or more prestigious model of the same brand, never turn a saloon into a crossover or the reverse, and never swap one generation or facelift for another.
Keep the paint colour and finish visible in the photo (catalogued as "${color}").`
    : `The model is NOT identified. Do not name or guess a model: reproduce faithfully the car VISIBLE in the reference photo — its exact silhouette, proportions, lamp shapes, glass area and wheels — in the colour "${color}".`

  return `Create a NEW premium automotive showroom photograph of one single car.

The attached photo is a REFERENCE FOR IDENTIFYING THE CAR ONLY. Do not edit it, do not reuse its framing, its angle, its lighting or any part of its surroundings. Build a new image from scratch.

SUBJECT
${identity}
Keep the real paint colour AND ITS FINISH exactly as photographed — satin, matt, brushed, metallic, pearlescent or gloss are different finishes and must not be swapped. A satin or matt car must not come out glossy.
If the car wears TWO-TONE or multi-colour paint — a different colour on the roof, the upper body, a bonnet stripe or a lower panel — reproduce BOTH colours and the line that separates them. Keep that division clearly visible even under coloured ambient light.
Keep any body kit, spoiler, wrap or wheel option genuinely on this car.

LIVERIES AND DECALS — SHAPES YES, LETTERING NEVER
If the car wears a wrap or racing livery, reproduce its SHAPES, its colours and its layout faithfully: stripes, chevrons, dot gradients, numbers blocks, panel divisions.
But do NOT attempt to reproduce the WORDING of sponsor decals or any lettering on the bodywork. Rendering engines cannot form real words at this scale and produce corrupted strings instead — measured on a real render: a sponsor decal came out as "Marteon U'6r". Where lettering exists on the source, leave a clean plain-colour block of the same shape and position, with no characters at all. An empty decal reads as a decal; a garbled one reads as a defect.

WHAT BELONGS TO THE SCENE, NOT TO THE CAR — exclude all of it
The reference photo was taken in the street, often from inside another vehicle. Everything below belongs to that situation and must not appear:
people, arms, hands, faces, reflections of people; the door mirror, window frame, A-pillar, dashboard or bodywork of the car the photo was taken FROM; other vehicles; buildings, shopfronts, signage, lettering; poles, traffic signs, road markings, kerbs, pavements, street furniture; trees, sky, any outdoor background; any object in front of or overlapping the car.
Only the identified car survives into the new image.

COMPOSITION — FRONT three-quarter, and the car is BIG
Camera at the car's FRONT-LEFT corner, low, roughly at headlight height. Never above the roofline, never a drone view.
The NOSE points toward the RIGHT of the frame and slightly toward the viewer; the body recedes toward the LEFT and into depth. The front end, both headlights, the complete left flank and the front wheel are all clearly visible.
This is a FRONT three-quarter. A rear three-quarter, a dead-side profile and a straight-on front view are all WRONG for this set.
THE CAR MUST FILL THE FRAME. This is the single most important compositional rule.
Frame TIGHT: the car spans from near the left edge to near the right edge, leaving only a thin margin — about one wheel's width — on each side. Its body occupies the majority of the image height too.
Think of a magazine cover shot, not a wide room photographed from across the hall. If you can see large empty floor on both sides of the car, the framing is WRONG and must be tightened.
A car sitting small in the middle of a vast room is a FAILED render, however beautiful the room.
Nothing is cropped all the same — all four wheels and the complete silhouette stay inside the frame, just close to its edges.
50-85mm equivalent, no wide-angle distortion. The car sits flat on the floor with a believable contact shadow; it never floats.
If this exact orientation cannot be produced without distorting the car, prefer a FAITHFUL car at a slightly different angle over a correct angle on a wrong car.

ENVIRONMENT — this car's OWN private showroom
A dark architectural room, not an empty seamless backdrop: a back wall with depth, a visible floor-to-wall relationship, and a sense of enclosure. The impression to produce is "this car is displayed in its own private showroom", never "a car was placed in front of a background".
Built from exactly these elements, nothing more:
- A back wall carrying several SLIM VERTICAL LIGHT STRIPS, evenly spaced, glowing in ${palette.accent}. They are the architecture of the room and they may be visible in frame — they are what gives the set its identity.
- A dark, highly polished floor acting almost as a mirror: the car and the light strips reflect into it clearly, fading out within about one car length.
- Deep shadow in the corners so the room reads as large and the car reads as lit.
Overall mood: ${palette.mood}.
The whole room is keyed to the car's own colour — ambient light, wall glow, reflections and speculars all carry ${palette.accent}. The car must still read as its true colour; the room is tinted, the paint is not repainted.
NO people, NO furniture, NO props, NO plants, NO signage, NO vehicles other than the subject, NO doorway or corridor leading elsewhere, NO visible lamps or fixtures other than the wall strips, NO science-fiction or video-game styling, NO garish saturated colour. It must stay credible as a high-end automotive showroom.

LIGHTING
Premium automotive studio lighting: long soft strip highlights along the shoulder line and roof, gentle rim light separating the car from the background, clean speculars on wheels and lamps, soft contact shadow so the car sits on the floor instead of floating.

STRICT PROHIBITIONS
- Do NOT output a different model, generation or trim.
- Do NOT restyle, modernise, lower, widen or "improve" the bodywork.
- Do NOT change the paint colour.
- Do NOT include any person, body part or reflection of a person.
- Do NOT render a readable licence plate: leave the plate area blank, dark or softly blurred.
- Do NOT add any manufacturer badge, logo or lettering not genuinely on this car.
- Do NOT draw text, letters, numbers or pseudo-text ANYWHERE in the image — not on the bodywork, not on the floor, not on the plate, and above all NOT INSIDE the head lamps or tail lamps. Lamp internals are clean optics, reflectors and plain LED light bars, with no characters, no micro-text and no engraved wording of any kind.
- Do NOT add captions, graphics or watermarks anywhere.
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
// L'ordre compte : la première expression qui matche gagne. Les teintes
// composées (« bleu nuit », « gris anthracite ») doivent donc être testées
// avant leur famille générique quand elles divergent.
const COLOUR_FAMILIES = [
  [/blanc|white|bianco|pearl|carrara|polaire/i, 'white'],
  [/noir|black|nero|obsidien|jet/i, 'black'],
  // `taupe` est rangé en bronze et NON en gris : c'est un gris brun, et les
  // voitures ainsi décrites — la Rolls-Royce Silver Cloud du parc — sont
  // visuellement brunes. Le classer en gris lui donnerait un garage froid là
  // où elle appelle un registre champagne.
  [/bronze|marron|brown|beige|champagne|sable|cuivre|copper|taupe|or\b|gold/i, 'bronze'],
  [/gris|grey|gray|grigio|argent|silver|graphite/i, 'grey'],
  [/rouge|red|rosso|guards|corsa/i, 'red'],
  [/bleu|blue|blu|miami|ara|azur/i, 'blue'],
  [/vert|green|verde|brooklyn|racing/i, 'green'],
  [/jaune|yellow|giallo/i, 'yellow'],
  [/orange|papaya|volcano|arancio/i, 'orange'],
  [/violet|purple|viola|mauve|lilas/i, 'purple'],
  [/rose|pink|magenta/i, 'pink'],
]

// ═══════ L'AMBIANCE DU SHOWROOM VIENT DE LA VOITURE ═══════
//
// ── POURQUOI PAS DE LA MARQUE ──
// Associer le rouge à Ferrari et le vert à Aston reviendrait à donner le même
// garage à toutes les Ferrari, y compris aux noires — et à refuser le rouge à
// une Alpine rouge. La teinte de la carrosserie est la seule information qui
// décrit RÉELLEMENT la voiture qu'on a sous les yeux.
//
// ── CE QUE DÉCRIT CHAQUE ENTRÉE ──
// `accent` : la couleur des bandeaux lumineux et des reflets du décor.
// `mood`   : le registre, qui oriente l'architecture et le contraste.
// Les deux restent sombres et crédibles : on éclaire un showroom, on ne fait
// pas une boîte de nuit.
const SHOWROOM_PALETTES = {
  red: { accent: 'deep crimson and warm red', mood: 'performance, exotic, exclusive' },
  blue: { accent: 'electric blue and deep indigo', mood: 'sporting, modern, precise' },
  green: { accent: 'deep racing green and emerald', mood: 'heritage sport, understated' },
  yellow: { accent: 'warm amber and golden yellow', mood: 'vivid, playful, high-energy' },
  orange: { accent: 'burnt orange and amber', mood: 'bold, modern competition' },
  purple: { accent: 'deep violet and plum', mood: 'rare, extravagant, collector' },
  pink: { accent: 'deep magenta with a cool violet edge', mood: 'bold, contemporary' },
  white: { accent: 'cool white and pale silver', mood: 'technological, minimal, clean' },
  black: { accent: 'cold white and graphite with faint steel blue', mood: 'luxury, elegant, restrained' },
  grey: { accent: 'graphite, brushed silver and cold white', mood: 'precise, industrial, premium' },
  bronze: { accent: 'champagne, bronze and warm amber', mood: 'heritage, collection, refined' },
  other: { accent: 'neutral cold white and soft silver', mood: 'premium, understated' },
}

export function showroomPalette(raw) {
  return SHOWROOM_PALETTES[colourFamily(raw)] ?? SHOWROOM_PALETTES.other
}

export function colourFamily(raw) {
  const s = String(raw ?? '').toLowerCase()
  for (const [re, name] of COLOUR_FAMILIES) if (re.test(s)) return name
  return 'other'
}

// ── NORMALISATION DES MARQUEURS DE GÉNÉRATION ──
// Mesuré sur le parc : `fabia-iii-berline` et `fabia-mk3-monte-carlo`
// désignent la MÊME génération, écrite de deux façons, et produisaient deux
// clés — donc deux générations payantes pour une seule voiture canonique.
// Même chose pour `juke` et `juke-mk1`.
//
// On replie les notations équivalentes sur une seule forme. Volontairement
// limité aux marqueurs de génération : on ne touche pas aux finitions
// (`monte-carlo`, `berline`), qui désignent parfois de vraies différences
// visuelles et dont le repliement demanderait un jugement au cas par cas.
const GEN_TOKENS = [
  [/^(mk)?([ivx]+)$/i, (m) => `g${romanToInt(m[2])}`],
  [/^(mk|mark|gen|generation)[-]?(\d+)$/i, (m) => `g${m[2]}`],
]

function romanToInt(r) {
  const V = { i: 1, v: 5, x: 10 }
  const s = r.toLowerCase()
  let n = 0
  for (let i = 0; i < s.length; i += 1) {
    const cur = V[s[i]] ?? 0
    const next = V[s[i + 1]] ?? 0
    n += cur < next ? -cur : cur
  }
  return n || r
}

export function cacheKey(vehicle) {
  const slug = (v) =>
    String(v ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  const model = slug(vehicle.model)
    .split('-')
    .map((tok) => {
      for (const [re, fn] of GEN_TOKENS) {
        const m = tok.match(re)
        if (m) return fn(m)
      }
      return tok
    })
    .join('-')
  return [slug(vehicle.brand), model, colourFamily(vehicle.color)]
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
