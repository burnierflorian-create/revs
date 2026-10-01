import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAiAccess, AI_ENDPOINTS } from '../server/ai-gate.js'
import { checkRequestSize } from '../server/request-size.js'
import { detectPlates } from '../server/plate-detect.js'

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

  // ── PASSAGE 1 : DÉTECTEUR LOCAL SPÉCIALISÉ (01/10/2026) ──
  //
  // Le cas Toyota (spot 358583a3) a montré la limite du modèle de langage :
  // boîte plausible, décalée, plaque publiée lisible, et AUCUNE couche du
  // système en mesure de s'en apercevoir. Le détecteur YOLOv8 encadre la même
  // plaque exactement. Il tourne en local : pas d'appel réseau, pas de quota,
  // pas de coût par photo — l'identification d'un spot ne paie plus la
  // détection de plaque.
  //
  // Claude n'est PAS supprimé pour autant : il reste le second passage quand
  // le détecteur local ne trouve rien, car « rien trouvé » est précisément le
  // cas dangereux. Deux détecteurs indépendants doivent se taire pour qu'une
  // photo soit déclarée sans plaque.
  let localFound = false
  try {
    const local = await detectPlates(Buffer.from(imageBase64, 'base64'), sharp)
    if (local && local.plates.length > 0) {
      const plates = local.plates.map(({ x, y, width, height }) => ({
        x,
        y,
        width,
        height,
      }))
      console.log(`[detect-plate] local : ${plates.length} plaque(s)`)
      sendJson(res, { plates, source: 'local' })
      return
    }
    // `local === null` = modèle indisponible : on ne sait rien, et on enchaîne
    // sur Claude. `plates: []` = le détecteur a regardé sans rien trouver ;
    // on enchaîne quand même, mais on le note pour la décision finale.
    localFound = local !== null
  } catch (e) {
    console.error('[detect-plate] détecteur local en échec :', e)
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    // Le détecteur local a tourné et n'a rien vu : c'est un vrai résultat,
    // on peut répondre « aucune plaque » sans second avis.
    if (localFound) {
      sendJson(res, { plates: [], source: 'local' })
      return
    }
    // Sinon AUCUN détecteur n'a fonctionné — on ne déclare pas la photo sûre.
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
          // Either we found plates, or the model explicitly said
          // there were none — both are valid outcomes.
          sendJson(res, { plates: cleaned })
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
