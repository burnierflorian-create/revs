import Anthropic from '@anthropic-ai/sdk'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAiAccess, AI_ENDPOINTS } from '../server/ai-gate.js'
import { checkRequestSize } from '../server/request-size.js'

// ── POURQUOI LE DÉTECTEUR SPÉCIALISÉ N'EST PAS ICI (01/10/2026) ──
//
// Il a d'abord été branché dans cette fonction : c'était l'endroit évident,
// la fonction existe déjà et le plafond de 12 fonctions Node de Vercel
// interdit d'en créer une autre. Deux déploiements ont échoué
// (dpl_CWLSyDuy, dpl_JyqhAzug), et la cause est structurelle :
//
//   · `onnxruntime-node` exécute un `postinstall` qui TÉLÉCHARGE ses binaires
//     natifs. L'installation échoue donc avant même que la construction ne
//     commence, et aucun script de build ne peut rattraper cela ;
//   · le paquet publie les binaires des trois plateformes en un seul bloc —
//     133 Mo installés, 301 Mo pour la version courante — sans variante par
//     plateforme, face à un plafond de 250 Mo par fonction serverless.
//
// La détection est donc exécutée CÔTÉ APPAREIL, par `src/lib/plateDetect.ts`
// (onnxruntime-web, WebAssembly, modèle servi en statique). Elle y gagne
// d'ailleurs : la photo ne quitte plus l'appareil pour être analysée, là où
// cet endpoint, lui, l'envoie à Anthropic.
//
// Cet endpoint reste le SECOND AVIS : le client l'appelle quand son détecteur
// local ne trouve rien, car « rien trouvé » est le cas dangereux. Il reste
// aussi le seul recours si le modèle ne se charge pas sur un appareil ancien.

// Vision model — plate localisation is a coarse rectangle estimate, not
// full reasoning. Keeps latency low (we run this in the upload hot path,
// before the user taps Publish).
//
// 26/09/2026 — bascule Haiku en premier passage. Localiser un rectangle est
// une tâche géométrique, pas du raisonnement : sur Sonnet elle coûtait
// ~0,0041 $, soit 44 % du coût total d'une capture — autant que
// l'identification complète de la voiture, qui tourne déjà sur Haiku.
// Sonnet reste en second passage si Haiku ne rend pas de JSON exploitable,
// sur le même principe d'escalade que identify-car.
const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
const SONNET_MODEL = 'claude-sonnet-4-6'

type AllowedMime = 'image/jpeg' | 'image/png' | 'image/webp'
const ALLOWED_MIME = new Set<AllowedMime>([
  'image/jpeg',
  'image/png',
  'image/webp',
])
function isAllowedMime(m: unknown): m is AllowedMime {
  return typeof m === 'string' && ALLOWED_MIME.has(m as AllowedMime)
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // Authorization ajouté : l'endpoint exige désormais un jeton Bearer, et sans
  // cet en-tête le préflight d'un appel cross-origin échouerait.
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// Reframed as a privacy/anonymisation task — helps the model not refuse
// on "license plate detection" framing alone. Stays free-text JSON so
// the parser doesn't choke when the model wraps the response in
// markdown or adds a sentence of preamble (which output_config strict
// schema mode was breaking on for identify-car too).
const SYSTEM = `Tu protèges la vie privée sur une app de partage de photos. Pour chaque photo, repère TOUTES les plaques d'immatriculation visibles afin qu'elles soient anonymisées (floutées) avant publication.

Tu renvoies un rectangle englobant en coordonnées normalisées [0..1] pour chaque plaque :
- Repère : (0,0) = coin haut-gauche, (1,1) = coin bas-droit.
- "x" / "y" = coin haut-gauche du rectangle.
- "width" / "height" = dimensions positives.

Règles :
- Précision : la boîte couvre EXACTEMENT le rectangle de la plaque, sans déborder largement sur le pare-chocs.
- Mieux vaut couvrir un peu trop large que pas assez (la plaque ne doit pas dépasser de la zone floutée).
- N'inclus PAS les badges/logos de marque.
- AUCUNE plaque visible (capot fermé, voiture vue de profil sans plaque, déjà floutée) → tableau vide.
- TOUTES les plaques visibles, plaque avant ET arrière, latérale, plaque commerciale.

Réponds UNIQUEMENT par un JSON de cette forme, RIEN d'autre, AUCUN markdown, AUCUNE phrase :
{"plates":[{"x":0.31,"y":0.62,"width":0.18,"height":0.05}]}

Si aucune plaque : {"plates":[]}`

const SYSTEM_RETRY = `Identifie les plaques d'immatriculation visibles sur la photo. Réponds UNIQUEMENT par ce JSON, sans markdown : {"plates":[{"x":N,"y":N,"width":N,"height":N}]}. Valeurs entre 0 et 1. Tableau vide si aucune plaque.`

// Tolerant JSON parser. Handles markdown fences and leading/trailing
// prose by scanning for the largest balanced {...} block. Mirrors the
// identify-car recovery ladder.
function extractJSON(text: string): { plates?: unknown } | null {
  if (typeof text !== 'string') return null
  let t = text.trim()
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) t = fenced[1].trim()
  try {
    return JSON.parse(t)
  } catch {
    /* fall through */
  }
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

type Plate = { x: number; y: number; width: number; height: number }

function cleanPlates(raw: unknown): Plate[] {
  if (!Array.isArray(raw)) return []
  const out: Plate[] = []
  for (const p of raw) {
    const o = (p ?? {}) as Record<string, unknown>
    // Support both {x,y,width,height} and {x,y,w,h} shapes — Claude
    // sometimes shortens the keys despite the prompt's explicit list.
    const x = Number((o.x ?? o.left) as number)
    const y = Number((o.y ?? o.top) as number)
    const w = Number((o.width ?? o.w) as number)
    const h = Number((o.height ?? o.h) as number)
    if (
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(w) &&
      Number.isFinite(h) &&
      w > 0 &&
      h > 0 &&
      x >= 0 &&
      y >= 0 &&
      x + w <= 1.01 &&
      y + h <= 1.01
    ) {
      out.push({ x, y, width: w, height: h })
    }
  }
  return out
}

function sendJson(res: VercelResponse, body: unknown, status = 200) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
  res.status(status).json(body)
}

async function callClaude(
  client: Anthropic,
  system: string,
  imageBase64: string,
  mimeType: AllowedMime,
  model: string,
): Promise<string> {
  const r = await client.messages.create({
    model,
    max_tokens: 600,
    // Pas de cache_control : ce prompt fait ~349 jetons, sous le minimum de
    // ~1024 requis pour qu'un préfixe soit réellement mis en cache. Le
    // marqueur était donc inerte.
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
          { type: 'text', text: "Détecte les plaques d'immatriculation à anonymiser." },
        ],
      },
    ],
  })
  if (r.stop_reason === 'refusal') return ''
  const block = r.content.find((b) => b.type === 'text')
  return block && 'text' in block ? block.text : ''
}

// ═══════ VÉRIFICATION DES BOÎTES ═══════
//
// Deux questions, posées séparément parce qu'elles n'ont pas la même réponse
// par défaut :
//
//   · des boîtes ont été rendues → chacune est DÉCOUPÉE et montrée seule au
//     modèle. Sur une vignette de 200 px, « est-ce une plaque ? » est une
//     question facile, bien plus facile qu'estimer des coordonnées — c'est
//     précisément pour ça qu'on la pose comme ça. La Toyota aurait rendu une
//     vignette de pare-chocs et de bitume.
//   · aucune boîte n'a été rendue → on demande simplement si une plaque est
//     visible. Sans cette seconde question, « je n'ai rien vu » serait traité
//     comme « il n'y a rien », ce que le cahier des charges interdit.
//
// Le coût : un appel Haiku sur une vignette, ~0,002 $. À comparer au prix
// d'une immatriculation publiée.
const VERIFY_BOX = `Tu vérifies un recadrage destiné à l'anonymisation. Cette vignette est-elle, en tout ou partie, une PLAQUE D'IMMATRICULATION de véhicule ?
Un pare-chocs nu, de la chaussée, une calandre, une enseigne, un phare ou une portion de carrosserie ne sont PAS des plaques.
Réponds UNIQUEMENT par {"plate":true} ou {"plate":false}.`

const VERIFY_ANY = `Tu prépares l'anonymisation d'une photo. Une plaque d'immatriculation de véhicule est-elle visible quelque part, même petite, inclinée, partielle ou dans l'ombre ?
Réponds UNIQUEMENT par {"plate":true} ou {"plate":false}.`

async function askYesNo(
  client: Anthropic,
  system: string,
  b64: string,
  mime: AllowedMime,
): Promise<boolean | null> {
  try {
    const text = await callClaude(client, system, b64, mime, HAIKU_MODEL)
    const j = extractJSON(text) as { plate?: unknown } | null
    if (!j || typeof j.plate !== 'boolean') return null
    return j.plate
  } catch (e) {
    console.error('[detect-plate] vérification en échec :', e)
    return null
  }
}

type Verdict =
  | { status: 'ok'; plates: Plate[] }
  | { status: 'wrong'; reason: string }

async function verifyPlates(
  client: Anthropic,
  imageBase64: string,
  mimeType: AllowedMime,
  plates: Plate[],
): Promise<Verdict> {
  const sharp = (await import('sharp')).default

  if (plates.length === 0) {
    const any = await askYesNo(client, VERIFY_ANY, imageBase64, mimeType)
    // `null` = la vérification elle-même n'a pas abouti. On ne peut pas
    // conclure, donc on ne déclare pas la photo sûre.
    if (any === false) return { status: 'ok', plates: [] }
    return {
      status: 'wrong',
      reason: any === null ? 'contre-vérification indisponible' : 'une plaque est visible mais aucune boîte rendue',
    }
  }

  const src = Buffer.from(imageBase64, 'base64')
  const meta = await sharp(src).metadata()
  const W = meta.width ?? 0
  const H = meta.height ?? 0
  if (!W || !H) return { status: 'wrong', reason: 'image illisible côté serveur' }

  const kept: Plate[] = []
  for (const p of plates) {
    // Marge de 15 % : on vérifie bien la zone qui sera floutée, pas un
    // recadrage plus serré qui pourrait manquer le bord de la plaque.
    const left = Math.max(0, Math.round((p.x - p.width * 0.15) * W))
    const top = Math.max(0, Math.round((p.y - p.height * 0.15) * H))
    const width = Math.min(W - left, Math.round(p.width * W * 1.3))
    const height = Math.min(H - top, Math.round(p.height * H * 1.3))
    if (width < 8 || height < 8) continue
    const crop = await sharp(src)
      .extract({ left, top, width, height })
      // Agrandissement : une vignette de 30 px de haut est illisible pour le
      // modèle comme pour un humain.
      .resize({ width: Math.max(200, width), withoutEnlargement: false })
      .jpeg({ quality: 90 })
      .toBuffer()
    const isPlate = await askYesNo(client, VERIFY_BOX, crop.toString('base64'), 'image/jpeg')
    if (isPlate === true) kept.push(p)
    else if (isPlate === null) {
      // Vérification indisponible : on GARDE la boîte. Flouter une zone dont
      // on n'a pas pu confirmer la nature ne coûte qu'un peu de pixels ; la
      // jeter exposerait une plaque.
      kept.push(p)
    }
  }

  if (kept.length > 0) return { status: 'ok', plates: kept }
  return { status: 'wrong', reason: `aucune des ${plates.length} boîte(s) ne contient de plaque` }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, { plates: [] }, 405)
    return
  }

  // Portail d'accès AVANT tout le reste — y compris avant la lecture du corps,
  // pour qu'une image de 10 Mo envoyée sans jeton soit rejetée au plus tôt.
  // Cet endpoint n'avait AUCUN contrôle jusqu'au 25/09/2026 : ni jeton, ni
  // quota, ni rate-limit, pour un appel Claude vision à chaque requête.
  //
  // Note : il compte sur sa propre ligne de quota (clé `detect-plate`), pas sur
  // celle d'identify-car. NewSpot déclenche les deux EN PARALLÈLE pour une seule
  // capture — un compteur partagé diviserait le quota gratuit par deux et le
  // cooldown de 3 s ferait échouer systématiquement le second des deux appels.
  // Taille du corps avant même l'authentification : inutile de consulter la
  // base pour une requête qu'on va refuser de toute façon.
  const tooLarge = checkRequestSize(req)
  if (tooLarge) {
    sendJson(res, tooLarge.body, tooLarge.status)
    return
  }

  const access = await requireAiAccess(req, AI_ENDPOINTS.DETECT_PLATE)
  if (!access.ok) {
    sendJson(res, access.body, access.status)
    return
  }

  // Ici se trouvait un FAIL-OPEN : clé Anthropic absente → `{plates: []}`,
  // c'est-à-dire « aucune plaque », indiscernable côté client d'une photo
  // réellement sans plaque. Une variable d'environnement manquante publiait
  // donc des originaux. Le contrôle a été déplacé APRÈS le détecteur local :
  // sans clé, si le détecteur local a tourné son verdict suffit ; s'il n'a pas
  // tourné non plus, on échoue explicitement.

  let imageBase64: string | undefined
  let mimeType: string | undefined
  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    imageBase64 = (body as { imageBase64?: string }).imageBase64
    mimeType = (body as { mimeType?: string }).mimeType
  } catch {
    sendJson(res, { plates: [] }, 400)
    return
  }

  if (
    typeof imageBase64 !== 'string' ||
    !imageBase64 ||
    !isAllowedMime(mimeType)
  ) {
    sendJson(res, { plates: [] }, 400)
    return
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    // Clé absente = AUCUNE détection n'a tourné ici. On ne déclare pas la
    // photo sûre pour autant : c'était un fail-OPEN (`{plates: []}`), que le
    // client ne peut pas distinguer d'une photo réellement sans plaque, et
    // une simple variable d'environnement manquante suffisait donc à publier
    // des originaux.
    res.status(502).json({
      error: 'detection_failed',
      message:
        "Impossible de vérifier les plaques sur cette photo. Réessaie ou reprends la photo.",
    })
    return
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  // Échelle en deux temps : Haiku avec le prompt complet, puis — seulement si
  // la réponse est inexploitable — Sonnet avec un prompt minimal. Le second
  // passage est rare, donc le coût moyen suit celui de Haiku. Tout ce qui
  // reste illisible retombe sur []. Journalisé pour auditer les cas vides
  // via les logs Vercel.
  // ── SONNET EN PREMIER (30/09/2026) ──
  //
  // Haiku ouvrait la marche. Il renvoyait un JSON parfaitement valide, donc
  // l'escalade vers Sonnet — déclenchée uniquement par une réponse ILLISIBLE —
  // ne se produisait jamais. Or ses coordonnées étaient fausses : vérifié sur
  // une photo réelle, il a encadré une enseigne « Buffalo Grill » à
  // l'arrière-plan et une portion vide de carrosserie, en laissant la vraie
  // plaque parfaitement lisible. Le floutage s'appliquait fidèlement au mauvais
  // endroit, et chaque couche du système rapportait un succès.
  //
  // Une boîte plausible mais fausse est le pire des cas : elle ne déclenche
  // aucune alarme. On paie donc le modèle qui vise juste. L'écart de coût
  // (~0,01 $ contre ~0,003 $) est sans commune mesure avec la publication
  // d'une plaque lisible, et la détection ne compte plus dans le quota produit.
  const attempts: { prompt: string; model: string }[] = [
    { prompt: SYSTEM, model: SONNET_MODEL },
    { prompt: SYSTEM_RETRY, model: SONNET_MODEL },
    { prompt: SYSTEM_RETRY, model: HAIKU_MODEL },
  ]
  for (const { prompt, model } of attempts) {
    try {
      const text = await callClaude(client, prompt, imageBase64, mimeType, model)
      const parsed = extractJSON(text)
      if (parsed && 'plates' in parsed) {
        const cleaned = cleanPlates(parsed.plates)
        if (cleaned.length > 0 || /\bplates\b/.test(text)) {
          // ── ON NE FAIT PLUS CONFIANCE À LA BOÎTE (01/10/2026) ──
          //
          // C'est le cœur du cas Toyota : le détecteur a rendu UNE boîte, bien
          // formée, dans l'image, parfaitement plausible — et à 150 px de la
          // plaque. Le client l'a floutée fidèlement, le serveur a répondu 200,
          // et « DM-107-SE » est parti en ligne. Rien, nulle part, n'avait de
          // quoi s'en apercevoir : toutes les couches avaient réussi.
          //
          // La seule parade est de VÉRIFIER ce que la boîte contient
          // réellement, et de traiter un détecteur qui vise à côté comme un
          // détecteur en panne.
          const verdict = await verifyPlates(client, imageBase64, mimeType, cleaned)
          if (verdict.status === 'ok') {
            sendJson(res, { plates: verdict.plates, verified: true })
            return
          }
          // `wrong` = les boîtes ne contiennent pas de plaque, ou une plaque
          // est visible alors qu'aucune boîte n'a été rendue. Dans les deux
          // cas la photo N'EST PAS sûre et ne doit pas être publiée en
          // silence : on échoue, le client retient la publication.
          console.error(`[detect-plate] vérification négative : ${verdict.reason}`)
          res.status(502).json({
            error: 'detection_failed',
            message:
              "La zone de plaque détectée n'a pas pu être confirmée. Reprends la photo ou recadre-la.",
          })
          return
        }
      }
      console.warn(
        '[detect-plate] unparseable response, will retry. raw:',
        text.slice(0, 200),
      )
    } catch (e) {
      console.error('[detect-plate] call failed:', e)
    }
  }
  // ── FAIL-CLOSED (30/09/2026) ──
  //
  // Ici se trouvait `sendJson(res, { plates: [] })` — un fail-OPEN. Quand la
  // détection échouait de bout en bout, le serveur répondait « aucune plaque »,
  // ce que le client ne peut pas distinguer d'une photo réellement sans plaque.
  // Il publiait donc l'original.
  //
  // On renvoie désormais un échec EXPLICITE. Le client bascule sur son garde
  // (`plateGuard('failed')`) et retient la publication jusqu'à confirmation.
  // Un tableau vide ne doit signifier qu'une chose : on a regardé, il n'y avait
  // rien.
  console.error('[detect-plate] toutes les tentatives ont échoué — fail-closed')
  res.status(502).json({
    error: 'detection_failed',
    message:
      "Impossible de vérifier les plaques sur cette photo. Réessaie ou reprends la photo.",
  })
}
