import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { requireAiAccess, AI_ENDPOINTS } from '../server/ai-gate.js'
import { checkRequestSize } from '../server/request-size.js'

// ─────────── Rarity = f(market value). Single source of truth; mirror of
// src/lib/rarity.ts. Rarity is DERIVED from the resale value, never guessed. ───────────
const RARITY_BANDS = [
  { rarity: 'standard', min: 0 },
  { rarity: 'premium', min: 20000 },
  { rarity: 'performance', min: 45000 },
  { rarity: 'exclusif', min: 90000 },
  { rarity: 'supercar', min: 130000 },
  { rarity: 'hypercar', min: 400000 },
]
function rarityFromPrice(price) {
  if (!price || price <= 0) return 'standard'
  let out = 'standard'
  for (const b of RARITY_BANDS) if (price >= b.min) out = b.rarity
  return out
}

// ─────────── Catalog freeze: compute a model's value + rarity ONCE. ───────────
const catalogNorm = (s) =>
  (s ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
const catalogSlug = (brand, model) => `${catalogNorm(brand)}|${catalogNorm(model)}`

let _sb
function getSb() {
  if (_sb !== undefined) return _sb
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  _sb = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null
  return _sb
}
// Returns { market_value, rarity } for a known model, or null. Never throws.
async function catalogLookup(brand, model) {
  const sb = getSb()
  if (!sb) return null
  try {
    const { data } = await sb
      .from('car_catalog')
      .select('market_value,rarity')
      .eq('slug', catalogSlug(brand, model))
      .maybeSingle()
    return data ?? null
  } catch {
    return null
  }
}
// ─────────── Cost control: auth + per-user quota + rate limit. ───────────
// Le contrôle vit désormais dans server/ai-gate.js, partagé avec detect-plate
// (point de vérité unique). Il est FAIL-CLOSED : plus de fenêtre de grâce
// « 3 jours illimités », plus de tolérance sur un jeton absent, plus de
// repli silencieux sur profiles.tier — le tier vient de user_tier(), dérivé
// de l'abonnement Stripe.

// Freeze a newly-priced model. Fire-and-forget; failure never blocks identify.
async function catalogInsert(brand, model, marketValue, rarity) {
  const sb = getSb()
  if (!sb || !brand || !model) return
  try {
    await sb
      .from('car_catalog')
      .upsert(
        { slug: catalogSlug(brand, model), brand, model, market_value: marketValue, rarity, updated_at: new Date().toISOString() },
        { onConflict: 'slug', ignoreDuplicates: true },
      )
  } catch {
    /* non-fatal */
  }
}

// Sonnet does the VISUAL recognition (image). The market price is a
// separate TEXT-ONLY call on Haiku (the cheapest model) — splitting the
// two cuts the price-side cost ~80% vs. asking Sonnet for everything.
const MODEL = 'claude-sonnet-4-6'
// Haiku handles vision on the first pass (5× cheaper than Sonnet). We only
// escalate to Sonnet when Haiku's confidence is below HAIKU_MIN_CONFIDENCE.
const HAIKU_VISION_MODEL = 'claude-haiku-4-5-20251001'
const HAIKU_MIN_CONFIDENCE = 80
const PRICE_MODEL = 'claude-haiku-4-5-20251001'

// Market-price rule + real reference quotes (current resale value, NOT
// catalogue-new) so Haiku anchors on realistic numbers for the year.
const PRICE_SYSTEM = `Tu donnes le prix du MARCHÉ ACTUEL en euros — la cote réelle de revente aujourd'hui pour l'année indiquée, en bon état. PAS le prix neuf, PAS une estimation gonflée. Jamais le prix neuf si la voiture a plus de 2 ans.
Références de cote marché réelles :
- Ferrari 488 GTB 2019 → 165000
- McLaren 570S 2018 → 125000
- Lamborghini Huracán 2020 → 195000
- Porsche 911 Carrera S 992 2021 → 115000
- Mercedes-AMG GT 63 S 2024 → 195000
- BMW M3 Competition 2022 → 75000
- Audi RS6 Avant 2022 → 85000
- Range Rover Sport SVR 2021 → 90000
- Rolls-Royce Ghost 2012 → 95000
- Bentley Continental GT 2020 → 155000
Réponds UNIQUEMENT par le nombre entier en euros, rien d'autre (pas de symbole, pas de texte).`

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // Authorization ajouté : l'endpoint exige désormais un jeton Bearer, et sans
  // cet en-tête le préflight d'un appel cross-origin échouerait.
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

// Last-resort labels. These are reached ONLY after the normal prompt
// ladder AND the insistent brand re-analysis in the handler ALL fail to
// name a real brand (should be extremely rare). We deliberately use
// "Inconnue" — NEVER "Voiture" — so the value is honest and the reprocess
// job can find these rows. The real "no empty brand" logic is the
// re-analysis pass (reanalyzeBrand) triggered whenever finalize() yields a
// generic brand, not this static string.
const NEVER_EMPTY_BRAND = 'Inconnue'
const NEVER_EMPTY_MODEL = 'Modèle inconnu'

const BASE = {
  brand: '',
  model: '',
  year: null,
  color: '',
  category: 'other',
  confidence: 0,
  alternatives: [],
  details_used: [],
  valid: true,
  reason: '',
  estimated_price: null,
  // Brouillon d'une phrase produit par le prompt vision, pré-rempli dans le
  // champ Description de l'étape 3. L'utilisateur reste libre de le réécrire.
  description: '',
  rarity: 'standard',
  // 'ai' | 'catalog' | 'price_estimate' | null — voir finalize() et
  // enrichAndSend(). null signifie qu'aucune source n'a pu se prononcer.
  rarity_source: null,
  production: null,
  // Architecture line per the 2026-06-02 strict prompt — surfaces
  // "V8 BiTurbo / Transm. Intégrale" style spec instantly without
  // waiting for the card-specs RPC. Empty string when the prompt
  // didn't produce one.
  specs: '',
}

const FALLBACK = {
  ...BASE,
  brand: NEVER_EMPTY_BRAND,
  model: NEVER_EMPTY_MODEL,
  confidence: 20,
}

// ─────────────────────── Prompts ───────────────────────

// 2026-06-07 single-call identify engine (API-cost cleanup):
// - ONE static vision call with SYSTEM_STRICT — pure JSON, 6-tier
//   rarity, specs line, screen-detection guard. ~3-5 s latency.
// - NO web_search refine anymore. Rarity ships straight from the
//   prompt's static knowledge; the previous hypercar web check was the
//   only "à la volée" AI cost left in a spot's lifecycle and is gone.
//   Every later step (rarity, specs, history) is local or DB-cached.
// - SYSTEM_SIMPLE / SYSTEM_MINIMAL remain as escalating fallbacks in
//   case strict JSON parsing fails on the first attempt.
const SYSTEM_STRICT = `Tu es le moteur de détection de l'application REVS. Tu analyses la photo d'un véhicule et tu réponds UNIQUEMENT par du JSON valide — sans markdown, sans texte avant ou après.

── VALIDATION, AVANT TOUTE IDENTIFICATION ──
Deux vérifications, dans cet ordre. Elles priment sur tout le reste.

① Aucune voiture comme sujet principal (personne, animal, nourriture, paysage, bâtiment, intérieur sans voiture, document, objet, moto ou vélo seuls) → renvoie STRICTEMENT et rien d'autre : {"error":"NO_CAR_DETECTED"}

② Voiture présente MAIS pas une vraie voiture photographiée sur le moment → renvoie STRICTEMENT et rien d'autre : {"error":"INVALID_PHOTO"}
Uniquement sur des indices FIABLES parmi ces cas :
- ÉCRAN (téléphone / ordinateur / télé / tablette) : moirage, grille de sous-pixels RGB, bord ou cadre d'écran, reflets d'écran, ET SURTOUT des éléments d'INTERFACE — barre d'état, heure/batterie/wifi, chrome de navigateur, logo ou contrôles YouTube, curseur de souris, boutons de lecture, vignettes.
- CAPTURE D'ÉCRAN : interface d'application ou de site, texte en superposition, barre de statut, proportions exactes d'un écran de téléphone.
- IMAGE IMPRIMÉE (affiche, magazine, brochure, poster, calendrier, livre) : trame d'impression en points, reflets de papier glacé, bords ou pliures de page, texture de papier.
- MINIATURE / JOUET / MAQUETTE : plastique brillant irréaliste, proportions de jouet, jantes moulées d'un bloc, joints de panneaux surdimensionnés, marques de moulage, vitres peintes sans vrai verre, contexte de bureau/table/main, macro à très faible profondeur de champ sur petit objet.
- DESSIN / RENDU 3D / IMAGE GÉNÉRÉE PAR IA / JEU VIDÉO : traits de croquis, cel-shading, éclairage de studio trop parfait sans aucune imperfection réelle, reflets ou ombres irréalistes, arrière-plan de studio artificiel, HUD de jeu, filigrane, aspect "render".

TOLÉRANCE — ne rejette JAMAIS une vraie voiture pour l'une de ces raisons, ce sont des conditions NORMALES qui doivent PASSER : floue, de loin, mal cadrée, partielle, de dos ou de côté, angle inhabituel, nuit, sombre, contre-jour, flash, pluie, éblouissement, reflets de vitrine ou de carrosserie ou de flaque, peinture noire/foncée/brillante, chrome, bruit de capteur, basse résolution, image compressée. Ces imperfections sont la SIGNATURE d'une vraie photo prise sur le vif.

RÈGLE DU DOUTE (essentielle) : le rejet doit rester RARE. Si tu hésites entre « vraie voiture de mauvaise qualité » et « triche », choisis TOUJOURS la vraie voiture et identifie-la. Ne déclenche INVALID_PHOTO ou NO_CAR_DETECTED que sur des indices FIABLES et clairement visibles — jamais sur un simple doute ni sur une mauvaise qualité de photo.

── RARETÉ : fondée EXCLUSIVEMENT sur le VOLUME DE PRODUCTION MONDIAL ──
Le prix n'a AUCUNE influence sur la rareté, ne le prends JAMAIS en compte.
- "standard"    : grande série de gros volume (Mercedes CLA, BMW Série 2, Audi A3, VW Golf).
- "premium"     : haut de gamme quotidien à fort volume, finition supérieure.
- "performance" : grande série issue d'un département sportif officiel (Mercedes-AMG, BMW M, Audi RS, Porsche 718). Sportivité = ADN, mais gros volume.
- "exclusif"    : série limitée mondiale stricte < 500 exemplaires, qui n'est pas une hypercar.
- "supercar"    : production mondiale TOTALE < 5 000 unités (Ferrari 488 GTB, McLaren 570S, Audi R8 V10, Lamborghini Huracán).
- "hypercar"    : série ultra-limitée < 500 exemplaires, sommet absolu (Bugatti Chiron, Pagani Huayra, Koenigsegg, McLaren P1).
En cas de doute, descends d'un cran (supercar douteux → "performance").

── INDICES VISUELS : croise-les AVANT de conclure ──
BADGE ou logo clairement visible = indice PRIORITAIRE pour la marque ET la version ("AMG", "M", "RS", "S-Line", "Carrera S", "Quadrifoglio") · signature lumineuse des phares · dessin de la calandre · jantes (branches, design de finition sportive) · échappements (nombre, forme, position) · proportions (coupé, berline, SUV, break, cabriolet) · spoilers, diffuseur, prises d'air actives · couleur des étriers de frein.
COULEUR : nomme la teinte constructeur exacte quand tu la reconnais.

Reconnais ces marques même de DOS ou de CÔTÉ, y compris sur une photo médiocre :
- LAMBORGHINI : lignes angulaires TRÈS prononcées, capot avant plat et extrêmement bas, feux arrière en Y ou hexagonaux, badge taureau doré, énormes prises d'air latérales. Huracán : feux en Y, diffuseur agressif, échappements centraux. Urus : SUV à toit fuyant, calandre hexagonale massive. Revuelto (ex-Aventador) : portes en ciseaux, nez pointu extrême, toit très bas. Teintes emblématiques : jaune Giallo Orion, vert Verde Mantis, orange Arancio Atlas, bleu Blu Cepheus.
- FERRARI : badge cheval cabré, feux ronds (308, F40) ou LED fins (488, SF90, Roma), échappements centraux en haut du diffuseur. Roma/Portofino : 2+2 élégant, ligne fluide. 296 GTB : feux en boomerang, prises d'air latérales.
- McLAREN : portes papillon (dièdre), flancs profondément sculptés vers les prises d'air moteur, nez très pointu à splitter intégré, prises d'air derrière les vitres latérales, feux arrière fins horizontaux. GT : ligne plus douce que la 720S.
- PORSCHE : capot arrière bombé, silhouette 911 fuyante inimitable, bandeau de feux arrière horizontal continu (991/992), 4 phares ronds sur Cayenne/Macan/Taycan, écusson de Stuttgart. 911 GT3 : aileron fixe très large et haut (swan neck), diffuseur agressif, roues centre-lock, jantes dorées ou noires spécifiques, badge GT3.
- BMW : calandre en haricots · AUDI : calandre mono-cadre, anneaux · MERCEDES : étoile.
- TESLA : aucune calandre, nez lisse et plein, poignées affleurantes, jantes aérodynamiques pleines ou à cache.

── CARROSSERIE PUIS MODÈLE : L'ERREUR LA PLUS COÛTEUSE ──
Mesuré sur les fiches réelles de REVS, les erreurs ne portent presque jamais
sur la marque : elles portent sur le MODÈLE VOISIN de la même marque. Trois
fiches sur trente-trois étaient fausses, toutes de ce type — une Model Y
fichée « Model 3 », une Classe E fichée « Classe C », une Rolls-Royce fichée
« Bentley ».

Avant de nommer un modèle, tranche d'abord la CARROSSERIE, en regardant :
hauteur de pavillon · garde au sol · longueur et nombre de portes · empattement ·
forme du vitrage latéral · angle du hayon · porte-à-faux arrière · rapport entre
le diamètre de roue et la hauteur de caisse · présence de protections d'arches
en plastique noir (signature d'un crossover).

Un crossover et une berline de la même marque ne sont JAMAIS le même modèle.
Exemples à ne pas confondre : Tesla Model 3 (berline basse) / Model Y
(crossover haut, arches protégées) · Mercedes Classe C / Classe E / Classe S
(longueur croissante ; la Classe E W214 a des poignées AFFLEURANTES, la Classe
C W206 des poignées classiques) · BMW Série 3 (berline) / Série 4 (coupé ou
Gran Coupé au pavillon fuyant) · Audi A4 / A5 · Porsche 911 selon la
génération (dessin des feux arrière et du bandeau central) · Volkswagen Golf /
Polo (longueur).

Si la photo ne permet pas de trancher entre deux modèles voisins, ne choisis
PAS le plus probable : laisse "model" vide et baisse "confidence". Une marque
seule et juste vaut mieux qu'un modèle complet et faux.

── RÉPONSE ATTENDUE ──
{
  "brand": "Marque exacte",
  "model": "Modèle exact avec génération/millésime ET version/finition si visible",
  "year": 2022,
  "color": "couleur précise et nommée",
  "category": "supercar|hypercar|classic|youngtimer|JDM|other",
  "confidence": 85,
  "rarity": "standard|premium|performance|exclusif|supercar|hypercar",
  "specs": "Configuration moteur / Transmission",
  "description": "une phrase courte et factuelle sur ce que la photo montre",
  "valid": true
}

Règles :
- "model" : le plus PRÉCIS possible — génération/millésime ET version/finition quand identifiable ("Mercedes-AMG C 63 S", "BMW M340i", "Audi RS 6 Avant", "Golf GTI Mk8"). N'invente pas une finition que rien n'indique. Modèle vraiment incertain → "Modèle inconnu".
- "color" : teinte nommée quand tu la reconnais ("gris nardo", "bleu Santorin", "vert British Racing", "rouge Rosso Corsa") plutôt qu'un simple "gris" ou "rouge".
- "confidence" : entier 0-100, ta certitude réelle sur l'ensemble marque + modèle + version.
- "specs" : moteur précis si identifiable visuellement ("V12 NA / Propulsion", "Flat-6 Biturbo / 4RM"), sinon configuration générale.
- "description" : UNE phrase courte (15 mots maximum), factuelle, en français, sur ce que la photo montre réellement — la teinte, une finition remarquable, le contexte. Ex : "Huracán jaune Giallo Orion garée en ville, jantes noires". Elle sert de brouillon que l'utilisateur pourra réécrire : reste sobre, n'invente rien, pas de superlatif ni de ponctuation d'enthousiasme.
- NE renvoie PAS de prix : il est calculé séparément par un appel dédié.
- Le champ s'appelle "brand", pas "make".
- Pas d'appel web : appuie-toi UNIQUEMENT sur cette photo et tes connaissances statiques.

MARQUE OBLIGATOIRE — NON NÉGOCIABLE, priorité maximale. Dès qu'une carrosserie est visible, tu DOIS nommer une marque réelle en croisant les indices ci-dessus. Il est INTERDIT de renvoyer "Voiture", "Voiture inconnue", "Véhicule non identifié", une chaîne vide ou null. "Inconnue" n'est admissible QUE s'il n'y a réellement AUCUNE voiture sur la photo.

LE MODÈLE, LUI, N'EST PAS OBLIGATOIRE. Cette obligation vaut pour la MARQUE seule.
Si tu reconnais la marque mais pas le modèle avec certitude : marque + "Modèle inconnu", et confidence basse. N'invente jamais un modèle pour remplir le champ — c'est exactement ce qui produit une Model 3 à la place d'une Model Y. Un champ honnêtement vide est corrigeable par l'utilisateur ; un modèle faux, lui, sera recopié tel quel dans sa collection et dans son Garage.`

const SYSTEM_SIMPLE = `Tu es un expert automobile. Identifie la voiture sur la photo. La MARQUE est OBLIGATOIRE (non négociable) dès qu'une voiture est visible : ne renvoie JAMAIS une marque vide, null ou "Voiture inconnue". Si le modèle exact est incertain, renvoie la marque + "Modèle inconnu" + confidence: 20.

VALIDATION D'ABORD : s'il n'y a AUCUNE voiture (personne, animal, objet, paysage…), réponds {"error":"NO_CAR_DETECTED"}. Si c'est une triche évidente — photo d'un écran, capture d'écran, photo d'une image imprimée (affiche/magazine), jouet/miniature/maquette, dessin/rendu 3D/image générée — réponds {"error":"INVALID_PHOTO"}. Mais une VRAIE voiture, même floue, sombre, de loin ou mal cadrée, doit PASSER (ne la rejette pas).

Réponds UNIQUEMENT par ce JSON, rien d'autre, pas de markdown :
{"brand":"Marque","model":"Modèle","year":2022,"color":"couleur","category":"supercar|hypercar|classic|youngtimer|JDM|other","confidence":80,"price_estimate":100000,"details_used":["…"],"valid":true,"reason":""}`

const SYSTEM_MINIMAL = `Identifie la voiture. Réponds UNIQUEMENT en JSON avec au minimum brand et model. La MARQUE est obligatoire, jamais vide (si le modèle est incertain : marque + "Modèle inconnu"). Pas de markdown, pas de texte. Exemple : {"brand":"Ferrari","model":"488 GTB"}`

// Fired ONLY when a first pass came back with a generic/empty brand. A
// more forceful "look again" prompt that leans entirely on silhouette +
// brand cues, tuned to never return "Voiture"/"Inconnue" if a body is
// visible.
const SYSTEM_INSIST = `Regarde ENCORE cette voiture. Ta première réponse était trop vague. Il est INTERDIT de répondre "Voiture" ou "Inconnue" dès qu'une carrosserie est visible.
Concentre-toi sur la SILHOUETTE et les indices visuels, même sur une photo médiocre, floue, sombre ou partielle :
- lignes angulaires extrêmes + feux en Y + capot ultra plat → Lamborghini
- feux arrière ronds + sorties d'échappement centrales + cheval cabré → Ferrari
- capot bombé arrière + feux horizontaux fins → Porsche
- portes papillon + flancs très sculptés → McLaren
- calandre en haricots → BMW ; calandre mono-cadre → Audi ; étoile → Mercedes ; anneaux → Audi.
Donne ta MEILLEURE estimation de marque réelle (jamais générique). Le modèle peut être "Modèle inconnu", la marque JAMAIS.
Réponds UNIQUEMENT en JSON valide, rien d'autre :
{"brand":"Marque réelle","model":"Modèle ou Modèle inconnu","year":2022,"color":"couleur","category":"supercar|hypercar|classic|youngtimer|JDM|other","confidence":40,"rarity":"standard|premium|performance|exclusif|supercar|hypercar"}`

// ─────────────────────── Helpers ───────────────────────

/** Tolerant JSON extraction — handles markdown code fences, leading
 *  text, trailing prose, and balanced-brace recovery. Returns null if
 *  no parseable object is found. */
function extractJSON(text) {
  if (typeof text !== 'string') return null
  let t = text.trim()
  // Strip ```json ... ``` or ``` ... ``` fences if Claude wraps the JSON.
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) t = fenced[1].trim()
  // Direct parse first.
  try {
    return JSON.parse(t)
  } catch {
    /* fall through */
  }
  // Pull the largest balanced {...} block we can find.
  const start = t.indexOf('{')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < t.length; i += 1) {
    const c = t[i]
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) {
        const slice = t.slice(start, i + 1)
        try {
          return JSON.parse(slice)
        } catch {
          /* keep scanning */
        }
      }
    }
  }
  return null
}

const VALID_CATEGORIES = new Set([
  'supercar',
  'hypercar',
  'classic',
  'youngtimer',
  'JDM',
  'other',
])
const VALID_RARITY = new Set([
  'standard',
  'premium',
  'performance',
  'exclusif',
  'supercar',
  'hypercar',
])

function normalizeCategory(c) {
  if (typeof c !== 'string') return 'other'
  const v = c.trim()
  if (VALID_CATEGORIES.has(v)) return v
  const low = v.toLowerCase()
  if (low === 'jdm') return 'JDM'
  if (low === 'autre' || low === 'unknown' || low === 'inconnu') return 'other'
  // The 20-year-expert prompt emits capitalised, broader labels
  // ("Supercar", "Sportcar", "SUV", "Berline", "Coupé") — map them
  // back to the small enum the rest of the app speaks.
  if (low === 'supercar') return 'supercar'
  if (low === 'hypercar') return 'hypercar'
  if (
    low === 'sportcar' ||
    low === 'sportscar' ||
    low === 'sport' ||
    low === 'jdm sport'
  )
    return 'JDM'
  if (low === 'suv' || low === 'crossover' || low === 'berline' || low === 'sedan' || low === 'coupé' || low === 'coupe')
    return 'other'
  if (VALID_CATEGORIES.has(low)) return low
  return 'other'
}

/** "2020-2023" → 2020, "2022" → 2022, 2022 → 2022, else null. */
function normalizeYear(v) {
  if (typeof v === 'number' && Number.isFinite(v) && v > 1900 && v < 2100) {
    return Math.floor(v)
  }
  if (typeof v === 'string') {
    const m = v.match(/\b(19|20)\d{2}\b/)
    if (m) return parseInt(m[0], 10)
  }
  return null
}

function normalizeInt(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v)
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/[^0-9-]/g, ''), 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

function normalizeString(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function normalizeStringArray(v) {
  if (!Array.isArray(v)) return []
  return v
    .filter((x) => typeof x === 'string' && x.trim())
    .map((s) => s.trim())
    .slice(0, 8)
}

/** Final normalization: takes any object Claude produced and forces it
 *  to match the response contract. NEVER returns empty brand/model.
 *  Accepts BOTH the legacy keys (`brand`, `model`, `year`, …) and the
 *  20-year-expert prompt's `car_*` keys — whichever Claude emits, the
 *  shape returned to the client is always the legacy one. */
function finalize(raw) {
  const o = raw ?? {}
  // Field aliases — try the legacy name first, fall back to `car_*` or the
  // `make` key some prompts emit.
  const brandRaw = normalizeString(o.brand ?? o.car_brand ?? o.make)
  const modelRaw = cleanModelName(normalizeString(o.model ?? o.car_model))
  // "Inconnu" / "Véhicule non identifiable" from the prompt's fallback
  // path collapse into the same NEVER_EMPTY pair we used before, so
  // downstream code (form pre-fill, rarity rules, etc.) never has to
  // worry about a new sentinel.
  const isUnknownBrand = /^inconnu(e)?$/i.test(brandRaw)
  const isUnknownModel = /^v[ée]hicule non identifiable$/i.test(modelRaw)
  const brand = !brandRaw || isUnknownBrand ? NEVER_EMPTY_BRAND : brandRaw
  const model =
    !modelRaw || isUnknownModel ? NEVER_EMPTY_MODEL : modelRaw
  const confidence = (() => {
    const n = normalizeInt(o.confidence)
    if (n === null) return brandRaw && modelRaw ? 60 : 20
    return Math.min(100, Math.max(0, n))
  })()
  // The new prompt no longer demands a `valid` boolean; default to true
  // (matches BASE) so the publish flow never blocks on missing fields.
  const valid = typeof o.valid === 'boolean' ? o.valid : true
  return {
    brand,
    model,
    year: normalizeYear(o.year ?? o.car_year),
    color: normalizeString(o.color ?? o.car_color),
    category: normalizeCategory(o.category ?? o.car_category),
    confidence,
    alternatives: Array.isArray(o.alternatives)
      ? o.alternatives
          .filter((a) => a && typeof a === 'object')
          .map((a) => ({
            brand: normalizeString(a.brand),
            model: normalizeString(a.model),
            year: normalizeYear(a.year),
          }))
          .filter((a) => a.brand || a.model)
          .slice(0, 2)
      : [],
    details_used: normalizeStringArray(o.details_used),
    valid,
    reason: normalizeString(o.reason ?? o.rarity_reason),
    // Tronquée à 140 caractères : le champ de l'étape 3 est une ligne, et une
    // réponse bavarde ne doit pas déborder ni décourager la réécriture.
    description: normalizeString(o.description).slice(0, 140),
    estimated_price:
      valid !== false
        ? normalizeInt(o.price_estimate ?? o.estimated_price)
        : null,
    rarity: VALID_RARITY.has(o.rarity) ? o.rarity : 'standard',
    // Seul endroit qui sache si la rareté vient VRAIMENT de l'IA : au-dessus,
    // une rareté absente ou invalide est repliée sur 'standard', donc le champ
    // `rarity` seul ne permet plus de distinguer « l'IA a dit standard » de
    // « l'IA n'a rien dit ». On trace l'origine ici, et enrichAndSend s'en
    // sert pour décider s'il doit compléter. null = l'IA n'a pas tranché.
    rarity_source: VALID_RARITY.has(o.rarity) ? 'ai' : null,
    // Architecture line — clamped to 60 chars so a verbose Claude
    // response doesn't blow out the card-back row. Empty string is
    // the safe default when the prompt didn't produce one.
    specs: (() => {
      const v = o.specs
      if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 60)
      return ''
    })(),
    production: (() => {
      const v = o.production
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v)
      if (typeof v === 'string') {
        const n = parseInt(v.replace(/[^0-9]/g, ''), 10)
        if (Number.isFinite(n) && n > 0) return n
      }
      return null
    })(),
  }
}

/** Last-ditch effort: regex-extract a brand and model from raw prose.
 *  Used only when all 3 retries returned non-JSON text. */
function rescueFromProse(text) {
  if (typeof text !== 'string') return null
  // Look for "Brand : X" / "Brand: X" / "Marque : X" patterns.
  const brandRe = /(?:brand|marque)\s*[:=]\s*["“]?([A-Z][A-Za-zÀ-ÿ' -]{1,30})/i
  const modelRe = /(?:model|modèle|modele)\s*[:=]\s*["“]?([A-Za-z0-9À-ÿ' -]{1,40})/i
  const yearRe = /\b(19|20)\d{2}\b/
  const b = brandRe.exec(text)
  const m = modelRe.exec(text)
  const y = yearRe.exec(text)
  if (!b && !m) return null
  return {
    brand: b ? b[1].trim() : '',
    model: m ? m[1].trim() : '',
    year: y ? parseInt(y[0], 10) : null,
    confidence: 25,
  }
}

// Strips any "(stuff)" trailer or in-string parenthetical from a model
// name. Safety net in case Claude ignores the no-parens rule in the
// prompt — we don't want chassis codes leaking to the UI.
function cleanModelName(s) {
  if (typeof s !== 'string') return s
  return s.replace(/\s*\([^)]*\)/g, '').trim()
}


// ─────────── Note sur le cache de prompt (26/09/2026) ───────────
// `cache_control: ephemeral` a été retiré ici. Il était actif — SYSTEM_STRICT
// dépasse le minimum d'environ 1024 jetons requis pour qu'un préfixe soit
// réellement mis en cache — mais à perte : une écriture de cache est facturée
// 1,25x et sa durée de vie est de 5 minutes. Avec le trafic actuel (3 appels
// enregistrés dans ai_usage en deux mois), aucune écriture n'était jamais
// relue avant d'expirer. Chaque scan payait donc 25 % de surcoût sur son
// prompt système, soit ~865 jetons pour rien.
//
// À REMETTRE dès que le trafic dépasse durablement ~1 scan toutes les 5
// minutes : au-delà, les lectures à 0,1x rentabilisent largement l'écriture.
// Vérifier alors `usage.cache_read_input_tokens` dans la réponse — s'il reste
// à zéro, c'est qu'un élément du préfixe varie d'un appel à l'autre.
// `userText` permet de réutiliser cet appel pour autre chose qu'identifier —
// la contre-vérification lui soumet une affirmation à réfuter. Sans ce
// paramètre il aurait fallu dupliquer la fonction pour changer une phrase.
async function callClaude(
  client,
  mimeType,
  imageBase64,
  system,
  maxTokens,
  model = MODEL,
  userText = "Identifie cette voiture. Renvoie uniquement le JSON, rien d'autre.",
) {
  return client.messages.create({
    model,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system }],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType,
              data: imageBase64,
            },
          },
          { type: 'text', text: userText },
        ],
      },
    ],
  })
}

// Finish an accepted identification: rescue a generic brand (Sonnet), read
// the frozen price/rarity from the catalog (zero AI when cached) or compute
// it once via Haiku, freeze it, and send. Shared by the confident path and
// the low-confidence Haiku fallback.
// ═══════ CONTRE-VÉRIFICATION DES MODÈLES VOISINS ═══════
//
// ── POURQUOI UNIQUEMENT CERTAINES FAMILLES ──
// Vérifier chaque spot doublerait le coût de la chaîne pour corriger un
// problème qui, mesuré, ne se produit que dans un cas bien particulier : deux
// modèles de la MÊME marque dont les silhouettes se ressemblent. Les trois
// erreurs trouvées dans le parc sont toutes de ce type. Une Huracán n'est
// jamais prise pour une 488 ; une Model Y est prise pour une Model 3.
//
// On paie donc un appel supplémentaire seulement quand la marque identifiée
// appartient à une famille connue pour ça — soit, sur le parc actuel, moins
// d'un spot sur quatre.
//
// ── POURQUOI LA QUESTION EST POSÉE À L'ENVERS ──
// On ne redemande pas « quelle voiture est-ce ? » : le modèle refournirait sa
// première réponse, pour les mêmes raisons qu'au premier passage. On lui
// soumet SA PROPRE conclusion comme une affirmation à réfuter, et on lui
// demande ce qu'il voit réellement. Réfuter une affirmation précise est une
// tâche différente, et beaucoup plus facile, que produire une identification.
const CONFUSABLE = [
  /tesla/i,
  /mercedes/i,
  /\bbmw\b/i,
  /\baudi\b/i,
  /porsche/i,
  /volkswagen|\bvw\b/i,
  /bentley|rolls/i,
]

const VERIFY_SYSTEM = `Tu vérifies une identification automobile, pas tu n'en produis une.

On te soumet une PHOTO et une AFFIRMATION. Ton travail est de dire si la photo soutient réellement cette affirmation.

Regarde dans cet ordre : hauteur de pavillon, garde au sol, longueur et nombre de portes, empattement, porte-à-faux arrière, forme du vitrage latéral, protections d'arches, dessin des poignées de porte, signature des feux.

Une erreur d'un cran à l'intérieur d'une même marque est le cas le plus fréquent (berline prise pour crossover, Classe C pour Classe E, génération antérieure pour la suivante). C'est précisément ce que tu dois attraper.

DISCRIMINANTS CONCRETS, à vérifier quand ils s'appliquent — ce sont ceux sur lesquels des erreurs réelles ont été constatées :
- Mercedes Classe C W206 vs Classe E W214 : la W214 a des POIGNÉES DE PORTE AFFLEURANTES, escamotées dans la tôle ; la W206 a des poignées classiques en étrier, qui se détachent nettement du flanc. La W214 est aussi plus longue, avec une porte arrière et un porte-à-faux arrière sensiblement plus grands. Cette seule poignée tranche le cas.
- Tesla Model 3 vs Model Y : la Model Y est un crossover à pavillon haut avec des protections d'arches en plastique noir ; la Model 3 est une berline basse sans protections.
- Bentley vs Rolls-Royce d'époque : la Rolls porte une calandre PARTHÉNON, rectangulaire à sommet plat, surmontée de la Spirit of Ecstasy ; la Bentley a une calandre arrondie en haricot et un B ailé.
- BMW Série 3 vs Série 4 : la Série 4 a un pavillon fuyant de coupé ou de Gran Coupé ; la Série 3 est une berline à pavillon horizontal.
- Porsche 911 : la génération se lit au bandeau arrière (continu sur 991 et 992) et au dessin des feux.

Réponds UNIQUEMENT par ce JSON, sans markdown :
{"supported":true,"actual_brand":"","actual_model":"","why":"une phrase, les éléments visuels utilisés"}

"supported": true si la photo soutient l'affirmation. false sinon — et dans ce cas remplis actual_brand/actual_model avec ce que tu vois RÉELLEMENT. Si tu ne peux pas trancher le modèle, laisse actual_model vide plutôt que d'en proposer un.`

async function verifyModel(client, mimeType, imageBase64, result) {
  const brand = String(result.brand || '')
  const model = String(result.model || '')
  // Rien à vérifier : pas de modèle affirmé, ou marque hors des familles
  // sujettes à confusion.
  if (!model || /inconnu|unknown/i.test(model)) return result
  if (!CONFUSABLE.some((re) => re.test(brand))) return result

  try {
    // ── POURQUOI SONNET ET NON HAIKU POUR VÉRIFIER (01/10/2026) ──
    // La vérification a d'abord tourné sur Haiku, pour rester bon marché.
    // Mesuré contre la production sur dix véhicules : elle a bien contesté la
    // Model Y et la Classe E, mais elle a CONFIRMÉ « Bentley R-Type » sur une
    // Rolls-Royce Silver Cloud — grille Parthénon et Spirit of Ecstasy en
    // évidence. Un sceau « vérifié » apposé sur une erreur est pire que pas de
    // sceau du tout : c'est lui qui déverrouille le Garage Visual.
    //
    // On paie donc le modèle capable de répondre. L'appel ne tourne que sur
    // les marques confusables, soit environ un spot sur quatre.
    const r = await callClaude(
      client,
      mimeType,
      imageBase64,
      VERIFY_SYSTEM,
      300,
      MODEL,
      `AFFIRMATION À VÉRIFIER : cette photo montre une « ${brand} ${model} ».`,
    )
    if (r.stop_reason === 'refusal') return result
    const v = extractJSON(lastText(r))
    if (!v || typeof v.supported !== 'boolean') return result

    if (v.supported) return { ...result, verified: true }

    const altBrand = String(v.actual_brand || '').trim()
    const altModel = String(v.actual_model || '').trim()
    console.warn(
      `[identify-car] vérification négative : « ${brand} ${model} » contesté → « ${altBrand} ${altModel} » (${v.why ?? ''})`,
    )

    // ── TROISIÈME AVIS AVANT DE RENONCER ──
    // Deux lectures se contredisent ; rien ne dit encore laquelle a raison.
    // Plutôt que de trancher à pile ou face ou d'effacer aussitôt, on demande
    // une identification NEUVE au modèle le plus précis dont on dispose, avec
    // le prompt complet. Si elle rejoint la contestation, les deux tiers
    // concordent et on adopte sa réponse. Sinon, le doute est réel et on
    // s'abstient.
    let third = null
    try {
      const t = await callClaude(client, mimeType, imageBase64, SYSTEM_STRICT, 600, MODEL)
      if (t.stop_reason !== 'refusal') {
        const parsed = extractJSON(lastText(t))
        if (parsed && (parsed.brand || parsed.model)) third = finalize(parsed)
      }
    } catch {
      /* le troisième avis est un bonus, jamais un prérequis */
    }

    const same = (a, b) => {
      const n = (s) =>
        String(s || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]+/g, ' ')
          .trim()
      const x = n(a)
      const y = n(b)
      return Boolean(x && y && (x === y || x.includes(y) || y.includes(x)))
    }

    if (
      third &&
      !isGenericBrand(third.brand) &&
      same(third.brand, altBrand) &&
      (!altModel || same(third.model, altModel))
    ) {
      // Deux avis sur trois s'accordent contre la première lecture.
      return {
        ...result,
        brand: third.brand,
        model: third.model,
        year: third.year ?? result.year,
        confidence: Math.min(Number(third.confidence) || 60, 75),
        verified: true,
        verify_note: `Première lecture corrigée : « ${brand} ${model} » → « ${third.brand} ${third.model} ».`,
      }
    }

    // ── AUCUNE MAJORITÉ : ON S'ABSTIENT ──
    // On retire le modèle contesté et on ne garde que ce sur quoi les lectures
    // s'accordent — la marque. « Tesla » seul et juste vaut mieux que « Tesla
    // Model 3 » faux : le premier se corrige d'un geste, le second part dans
    // la collection, la carte et le Garage.
    const sameBrand =
      altBrand && brand.toLowerCase().includes(altBrand.toLowerCase().split(' ')[0])
    return {
      ...result,
      brand: sameBrand || !altBrand ? result.brand : altBrand,
      model: NEVER_EMPTY_MODEL,
      // Le doute doit se voir dans le score interne, qui pilote l'affichage
      // du badge « reconnaissance basse » et le feu vert du Garage Visual.
      confidence: Math.min(Number(result.confidence) || 0, 40),
      verified: false,
      verify_note: `Modèle incertain : une seconde lecture y voit « ${[altBrand, altModel].filter(Boolean).join(' ')} ».`,
    }
  } catch (e) {
    // Une vérification en échec ne doit pas dégrader une identification qui,
    // elle, a abouti. On laisse le résultat tel quel, non marqué « vérifié ».
    console.error('[identify-car] vérification impossible :', e?.message ?? e)
    return result
  }
}

async function enrichAndSend(res, client, mimeType, imageBase64, parsed, initial) {
  let result = initial

  // If the brand came back generic/empty ("Voiture", "Inconnue"…), fire ONE
  // insistent vision call (Sonnet) that leans on silhouette + brand cues.
  if (isGenericBrand(result.brand)) {
    const better = await reanalyzeBrand(client, mimeType, imageBase64)
    if (better && !isGenericBrand(finalize(better).brand)) {
      result = finalize({ ...parsed, ...better })
    }
  }

  // Contre-vérification ciblée des familles où une erreur d'un cran est
  // courante et invisible. Ne tourne QUE sur ces familles — voir
  // CONFUSABLE et verifyModel().
  result = await verifyModel(client, mimeType, imageBase64, result)

  // ─── Rareté : l'IA d'abord, le prix seulement en dernier recours ───
  // Avant le 26/09/2026, rarityFromPrice() écrasait systématiquement la
  // rareté que le prompt vision avait déterminée. C'était un bug de
  // hiérarchie : SYSTEM_STRICT demande une rareté fondée sur le VOLUME DE
  // PRODUCTION mondial, puis le code la remplaçait par une dérivation du
  // prix de revente — deux règles contradictoires, la moins informée gagnant.
  //
  // Ordre de priorité désormais :
  //   1. 'ai'             → le prompt a renvoyé une rareté valide, on la garde
  //   2. 'catalog'        → rareté déjà gelée pour ce modèle
  //   3. 'price_estimate' → dernier recours, dérivée du prix
  const aiDecided = result.rarity_source === 'ai'

  // Le PRIX, lui, reste gelé par modèle : c'est ce qui garantit qu'une même
  // voiture est valorisée pareil pour tout le monde.
  const known = await catalogLookup(result.brand, result.model)
  if (known) {
    result.estimated_price = known.market_value
    if (!aiDecided) {
      result.rarity = known.rarity
      result.rarity_source = 'catalog'
    }
  } else {
    const price = await lookupMarketPrice(
      client,
      result.brand,
      result.model,
      result.year,
    )
    result.estimated_price = price
    if (!aiDecided) {
      result.rarity = rarityFromPrice(price)
      result.rarity_source = 'price_estimate'
    }
    if (!isGenericBrand(result.brand) && result.model && result.model !== NEVER_EMPTY_MODEL) {
      // On gèle la rareté RETENUE (donc celle de l'IA quand elle s'est
      // prononcée), pas la dérivation du prix : le catalogue conserve ainsi
      // la meilleure information disponible pour les spots suivants.
      await catalogInsert(result.brand, result.model, price, result.rarity)
    }
  }
  console.log(
    `[rarity] ${result.brand} ${result.model} → ${result.rarity} (source: ${result.rarity_source ?? 'aucune'})`,
  )
  return sendJson(res, result)
}

// Text-only market-price lookup on Haiku (cheap). Returns an integer in
// [1000, 10_000_000] or null. Best-effort — never throws; on any failure
// the spot just keeps a null price.
async function lookupMarketPrice(client, brand, model, year) {
  const b = (brand ?? '').trim()
  const m = (model ?? '').trim()
  if (!b && !m) return null
  const yearPart = year ? ` ${year}` : ''
  try {
    const r = await client.messages.create({
      model: PRICE_MODEL,
      max_tokens: 20,
      system: PRICE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Prix du marché actuel en euros pour une ${b} ${m}${yearPart} en bon état ?`,
        },
      ],
    })
    const n = parseInt(String(lastText(r)).replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(n) && n >= 1000 && n <= 10_000_000) return n
  } catch (e) {
    console.error('[identify-car] price lookup failed:', e?.message ?? e)
  }
  return null
}

function lastText(response) {
  if (!response?.content) return ''
  const blocks = response.content.filter((b) => b.type === 'text')
  return blocks.length ? blocks[blocks.length - 1].text : ''
}

function sendJson(res, body, status = 200) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
  res.status(status).json(body)
}

// True when a brand is empty or a generic placeholder ("Voiture",
// "Inconnue", "Voiture Modèle indéterminé", …) — i.e. recognition failed
// to name a real make and we should look again.
function isGenericBrand(b) {
  const s = (b ?? '').trim().toLowerCase()
  return (
    !s ||
    s === 'voiture' ||
    s === 'inconnu' ||
    s === 'inconnue' ||
    s.startsWith('voiture ') ||
    s === 'véhicule non identifié'
  )
}

// Second-chance vision call with the more forceful SYSTEM_INSIST prompt.
// Best-effort — returns a parsed object or null, never throws.
async function reanalyzeBrand(client, mimeType, imageBase64) {
  try {
    const r = await callClaude(client, mimeType, imageBase64, SYSTEM_INSIST, 400)
    if (r.stop_reason === 'refusal') return null
    return extractJSON(lastText(r))
  } catch (e) {
    console.error('[identify-car] reanalyze threw:', e?.message ?? e)
    return null
  }
}

// ─────────────────────── Handler ───────────────────────

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    return sendJson(res, FALLBACK, 405)
  }

  // Taille du corps avant même l'authentification : inutile de consulter la
  // base pour une requête qu'on va refuser de toute façon.
  const tooLarge = checkRequestSize(req)
  if (tooLarge) {
    return sendJson(res, tooLarge.body, tooLarge.status)
  }

  // Portail d'accès AVANT tout le reste, y compris la lecture du corps : un
  // POST sans jeton reçoit 401 avant tout traitement. Ensuite cooldown et
  // quota, avant toute dépense de jetons. Fail-closed — un refus ne laisse
  // passer aucun appel Claude. Voir server/ai-gate.js.
  const access = await requireAiAccess(req, AI_ENDPOINTS.IDENTIFY)
  if (!access.ok) {
    return sendJson(res, access.body, access.status)
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return sendJson(res, FALLBACK, 500)
  }

  let imageBase64
  let mimeType
  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    imageBase64 = body.imageBase64
    mimeType = body.mimeType
  } catch {
    return sendJson(res, FALLBACK, 400)
  }

  if (
    typeof imageBase64 !== 'string' ||
    !imageBase64 ||
    !ALLOWED_MIME.has(mimeType)
  ) {
    return sendJson(res, FALLBACK, 400)
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // Three escalating attempts: full prompt → simple prompt → minimal
  // prompt. Each attempt keeps the same image. We stop at the first one
  // whose response yields a parseable JSON with at least a brand or
  // model — anything else, including refusals, falls through to the
  // next try.
  // Strict prompt first (the hot path — single fast static call). The
  // two legacy prompts stay as escalating fallbacks for the rare case
  // where the strict prompt fails to produce parseable JSON.
  const attempts = [
    { model: HAIKU_VISION_MODEL, system: SYSTEM_STRICT,  max: 600, minConfidence: HAIKU_MIN_CONFIDENCE },
    { model: MODEL,              system: SYSTEM_STRICT,  max: 600 },
    { model: MODEL,              system: SYSTEM_SIMPLE,  max: 600 },
    { model: MODEL,              system: SYSTEM_MINIMAL, max: 250 },
  ]
  let lastRawText = ''
  // A parseable-but-low-confidence Haiku result, kept as a floor in case the
  // Sonnet escalation also fails to beat it.
  let fallback = null
  for (let i = 0; i < attempts.length; i += 1) {
    try {
      const r = await callClaude(
        client,
        mimeType,
        imageBase64,
        attempts[i].system,
        attempts[i].max,
        attempts[i].model,
      )
      if (r.stop_reason === 'refusal') {
        // Stop trying — model explicitly refused.
        break
      }
      const text = lastText(r)
      lastRawText = text || lastRawText
      const parsed = extractJSON(text)

      // Anti-cheat short-circuit: the strict prompt asks the AI to
      // return {"error":"VIRTUAL_SCREEN_DETECTED"} for screens, toys,
      // photos-of-photos. Surface that as a hard rejection so the
      // frontend bounces the publish flow.
      if (parsed && typeof parsed.error === 'string' && parsed.error) {
        const code = parsed.error
        const reason =
          code === 'NO_CAR_DETECTED'
            ? 'Aucune voiture détectée, réessaie avec une vraie voiture.'
            : code === 'INVALID_PHOTO' || code === 'VIRTUAL_SCREEN_DETECTED'
              ? 'Photo non valide, prends une vraie voiture en photo.'
              : `Image refusée (${code}).`
        return sendJson(res, {
          ...FALLBACK,
          valid: false,
          reason,
          error_code: code,
        })
      }

      if (parsed && (parsed.brand || parsed.model || parsed.make)) {
        const result = finalize(parsed)
        // Stop-on-confidence: accept the cheap Haiku pass only when it's
        // confident enough; otherwise stash it and escalate to Sonnet.
        const min = attempts[i].minConfidence
        if (min && result.confidence < min) {
          if (!fallback) fallback = { parsed, result }
          continue
        }
        return enrichAndSend(res, client, mimeType, imageBase64, parsed, result)
      }
    } catch (e) {
      console.error(`[identify-car] attempt ${i + 1} threw:`, e?.message ?? e)
      // Continue to next attempt unless we're out.
    }
  }

  // Sonnet never beat the Haiku floor — use the stashed low-confidence result.
  if (fallback) {
    return enrichAndSend(res, client, mimeType, imageBase64, fallback.parsed, fallback.result)
  }

  // All attempts failed to produce a usable JSON. Try to salvage brand
  // and model from the raw prose of the last response.
  const rescued = rescueFromProse(lastRawText)
  if (rescued && (rescued.brand || rescued.model)) {
    return sendJson(res, finalize(rescued))
  }

  // Absolute last resort — the form still auto-fills with "Inconnue /
  // Modèle inconnu" and the user just edits.
  return sendJson(res, FALLBACK)
}
