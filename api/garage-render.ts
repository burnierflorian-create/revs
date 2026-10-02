// ═══════════ GÉNÉRATION D'UN RENDU GARAGE VISUAL ═══════════
//
// ── POURQUOI UNE FONCTION EDGE ──
// Les douze fonctions Node de Vercel sont prises (plafond du plan). Ce travail
// s'y prête de toute façon : générer un rendu, c'est un `fetch` vers Gemini et
// deux appels REST vers Supabase. Aucune dépendance native, aucun binaire —
// contrairement au détecteur de plaques, dont le runtime ONNX avait fait
// échouer deux déploiements.
//
// ── CE QUE CETTE FONCTION NE FAIT JAMAIS ──
//   · elle ne bloque pas la publication : le client l'appelle APRÈS avoir
//     publié, sans attendre la réponse ;
//   · elle ne touche jamais `photo_url`. La photo de l'utilisateur est la
//     source, le rendu est une représentation À CÔTÉ ;
//   · elle ne décide jamais de l'identité du véhicule. Elle refuse de générer
//     sur une fiche non validée plutôt que de produire une belle image de la
//     mauvaise voiture ;
//   · elle ne génère pas si un rendu compatible existe : elle le réutilise.
//
// ── EN CAS D'ÉCHEC ──
// `garage_render_url` reste null et le Garage retombe sur `photo_url`. Un
// échec ici n'a aucune conséquence visible pour l'utilisateur, par conception.

import {
  GARAGE_VISUAL_VERSION,
  buildPrompt,
  cacheKey,
  canRender,
} from '../server/garage-visual.js'

export const config = { runtime: 'edge' }

const MODEL = 'gemini-3.1-flash-image'
const BUCKET = 'garage-renders'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })
}

/**
 * base64 → ArrayBuffer, sans Buffer (indisponible en edge).
 *
 * On rend un ArrayBuffer et non un Uint8Array : depuis TypeScript 5.7, un
 * `Uint8Array<ArrayBufferLike>` n'est plus assignable à `BodyInit` ni à
 * `BlobPart`, le type générique admettant aussi un SharedArrayBuffer. Un
 * ArrayBuffer nu est accepté partout sans détour.
 */
function bufferFromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const buf = new ArrayBuffer(bin.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i += 1) view[i] = bin.charCodeAt(i)
  return buf
}

/** Appel REST Supabase avec la clé de service. Jamais exposée au client. */
async function sb(
  url: string,
  key: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
  const GEMINI = process.env.GEMINI_API_KEY
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'service_unavailable' }, 500)
  // Pas de clé Gemini = pas de rendu. Ce n'est PAS une erreur produit : le
  // Garage fonctionne sans, sur la photo du spot.
  if (!GEMINI) return json({ skipped: 'no_image_provider' })

  // ── IDENTITÉ DE L'APPELANT ──
  // Jamais le corps de la requête : sans cela n'importe qui pourrait faire
  // générer des rendus au nom d'autrui, et donc dépenser à sa place.
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return json({ error: 'missing_token' }, 401)

  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE, authorization: `Bearer ${token}` },
  })
  if (!who.ok) return json({ error: 'invalid_token' }, 401)
  const user = (await who.json()) as { id?: string }
  if (!user?.id) return json({ error: 'invalid_token' }, 401)

  let spotId = ''
  try {
    const body = (await req.json()) as { spotId?: string }
    spotId = String(body?.spotId ?? '')
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  if (!spotId) return json({ error: 'bad_request' }, 400)

  // ── LE SPOT DOIT APPARTENIR À L'APPELANT ──
  const r = await sb(
    SUPABASE_URL,
    SERVICE_ROLE,
    `spots?id=eq.${encodeURIComponent(spotId)}&select=id,user_id,brand,model,color,photo_url,garage_render_url,ident_locked`,
  )
  const rows = (await r.json()) as Array<Record<string, unknown>>
  const spot = rows?.[0]
  if (!spot) return json({ error: 'not_found' }, 404)
  if (spot.user_id !== user.id) return json({ error: 'forbidden' }, 403)
  if (spot.garage_render_url) return json({ skipped: 'already_rendered' })

  // ── LE VERROU D'IDENTITÉ ──
  // Un rendu impeccable de la mauvaise voiture est pire que pas de rendu :
  // il est crédible. Trois fiches sur trente-trois étaient fausses lors de
  // l'audit du 01/10.
  const gate = canRender(spot)
  if (!gate.ok) return json({ skipped: 'identity_not_validated', reason: gate.reason })

  const key = `${cacheKey(spot)}|v${GARAGE_VISUAL_VERSION}`

  // ── CACHE ET CONCURRENCE, EN UN SEUL APPEL ATOMIQUE ──
  const claimRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_garage_render`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE,
      authorization: `Bearer ${SERVICE_ROLE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      p_key: key,
      p_brand: spot.brand ?? null,
      p_model: spot.model ?? null,
      p_colour: spot.color ?? null,
      p_version: GARAGE_VISUAL_VERSION,
    }),
  })
  if (!claimRes.ok) return json({ error: 'claim_failed' }, 502)
  const verdict = (await claimRes.json()) as string

  const attach = async (url: string) =>
    sb(SUPABASE_URL, SERVICE_ROLE, `spots?id=eq.${encodeURIComponent(spotId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ garage_render_url: url }),
    })

  if (verdict === 'ready') {
    // Un rendu compatible existe déjà : on le rattache, sans dépenser.
    const got = await sb(
      SUPABASE_URL,
      SERVICE_ROLE,
      `garage_renders?cache_key=eq.${encodeURIComponent(key)}&select=render_url`,
    )
    const [row] = (await got.json()) as Array<{ render_url?: string }>
    if (row?.render_url) {
      await attach(row.render_url)
      return json({ cache: 'hit', url: row.render_url })
    }
    return json({ cache: 'hit_but_empty' })
  }
  if (verdict !== 'claimed') {
    // Quelqu'un d'autre génère cette même voiture en ce moment. On s'abstient :
    // le spot restera sans rendu jusqu'au prochain passage, ce qui est sans
    // conséquence visible.
    return json({ cache: 'pending' })
  }

  // ── GÉNÉRATION ──
  const release = async () =>
    sb(SUPABASE_URL, SERVICE_ROLE, `garage_renders?cache_key=eq.${encodeURIComponent(key)}`, {
      method: 'DELETE',
    })

  try {
    const photoUrl = String(spot.photo_url ?? '')
    if (!photoUrl) {
      await release()
      return json({ error: 'no_source_photo' }, 422)
    }
    // La photo du spot est DÉJÀ protégée côté plaques : c'est elle qu'on
    // envoie, jamais un original. Les deux systèmes restent indépendants.
    const photoRes = await fetch(photoUrl)
    if (!photoRes.ok) {
      await release()
      return json({ error: 'source_unreachable' }, 502)
    }
    const photoBytes = new Uint8Array(await photoRes.arrayBuffer())
    let bin = ''
    for (let i = 0; i < photoBytes.length; i += 1) bin += String.fromCharCode(photoBytes[i])
    const photoB64 = btoa(bin)

    const gen = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: photoRes.headers.get('content-type') ?? 'image/jpeg',
                    data: photoB64,
                  },
                },
                { text: buildPrompt(spot) },
              ],
            },
          ],
          generationConfig: { responseModalities: ['IMAGE'] },
        }),
      },
    )
    const out = (await gen.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>
      error?: { message?: string }
    }
    const data = out.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data
    if (!gen.ok || !data) {
      console.error('[garage-render] génération échouée:', out.error?.message ?? 'aucune image')
      await release()
      return json({ error: 'generation_failed' }, 502)
    }

    const bytes = bufferFromBase64(data)
    const path = `${key.replace(/[|]/g, '_')}.png`
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE,
        authorization: `Bearer ${SERVICE_ROLE}`,
        'content-type': 'image/png',
        'x-upsert': 'true',
      },
      body: bytes,
    })
    if (!up.ok) {
      console.error('[garage-render] upload échoué:', up.status, await up.text())
      await release()
      return json({ error: 'upload_failed' }, 502)
    }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`

    await sb(SUPABASE_URL, SERVICE_ROLE, `garage_renders?cache_key=eq.${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'ready', render_url: publicUrl }),
    })
    await attach(publicUrl)
    console.log(`[garage-render] généré ${key} pour ${spotId}`)
    return json({ cache: 'miss', url: publicUrl })
  } catch (e) {
    // La réservation est libérée pour que la clé reste réessayable : la
    // condamner enfermerait ce véhicule sans rendu pour toujours.
    console.error('[garage-render] exception:', e)
    await release()
    return json({ error: 'generation_failed' }, 502)
  }
}
