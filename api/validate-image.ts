// ═══════ LE CONTRÔLE AUTOMOBILE DES IMAGES ═══════
//
// REVS est une application automobile. Une image publiée dans un contenu
// REVS doit montrer une voiture, une moto, ou un véhicule de compétition.
//
// ── CE QUI N'EST PAS CONCERNÉ ──
// L'avatar. Une photo de profil peut être n'importe quelle image : c'est le
// visage de quelqu'un, pas un contenu REVS. Ce point d'entrée n'est jamais
// appelé pour un avatar, et aucun déclencheur ne garde le bucket `avatars`.
//
// ── POURQUOI ICI ET PAS DANS LE NAVIGATEUR ──
// Un contrôle côté client ne vaut rien : les spots et les stories s'écrivent
// par PostgREST, que n'importe qui peut appeler. Ce point d'entrée est le
// seul à détenir la clé de service ; quand il accepte une image il dépose un
// jeton à usage unique, et les déclencheurs de `spots` et `stories`
// l'exigent (migration 0122). Publier sans passer par ici demanderait de
// fabriquer un jeton que seul le service peut créer.
//
// ── COÛT ──
// Haiku 4.5 avec vision. Le client réduit l'image à 512 px avant l'envoi —
// c'est largement assez pour dire « voiture ou pas », et c'est ce qui rend
// l'appel bon marché : environ 350 jetons d'image, 200 de consigne et 40 en
// sortie, soit ≈ 0,0008 $ par contrôle. Une seule passe : un second modèle
// « en cas de doute » doublerait le coût pour trancher des cas qu'un humain
// trancherait aussi mal.

export const config = { runtime: 'edge' }

const MODEL = 'claude-haiku-4-5-20251001'

/** Les trois classes acceptées, et les deux qui ne le sont pas. */
type Verdict = 'car' | 'motorcycle' | 'motorsport' | 'non_automotive' | 'uncertain'
const ACCEPTED: Verdict[] = ['car', 'motorcycle', 'motorsport']

const SYSTEM = `Tu es le contrôle d'entrée des images de REVS, une application
de spotting automobile. Tu dis UNIQUEMENT si l'image montre un sujet
automobile. Tu n'identifies pas le modèle, tu ne juges pas la qualité.

Réponds UNIQUEMENT par un objet JSON, sans markdown :
{"verdict":"car|motorcycle|motorsport|non_automotive|uncertain","note":"six mots maximum en français"}

car            = une automobile est le sujet principal (y compris utilitaire,
                 4x4, camionnette, voiture ancienne, épave, voiture en
                 atelier, intérieur ou détail d'une voiture).
motorcycle     = une moto ou un scooter est le sujet principal.
motorsport     = monoplace, F1, voiture de course, kart, rallye, ou une scène
                 de sport automobile.
non_automotive = aucun véhicule motorisé n'est le sujet : personne seule,
                 paysage, animal, nourriture, bâtiment, objet, document,
                 capture d'écran, image sans rapport.
uncertain      = tu ne parviens pas à trancher.

TOLÉRANCE — ces conditions sont NORMALES et doivent passer : photo floue, de
nuit, de loin, mal cadrée, partielle, de dos, sous la pluie, contre-jour,
reflets, basse résolution. Une vraie voiture mal photographiée reste une
voiture.

RÈGLE DU DOUTE : un refus doit rester rare. Si un véhicule est présent et
reconnaissable, même petit ou partiel, accepte. Ne réponds non_automotive
que si tu es sûr qu'aucun véhicule n'est le sujet. Si une voiture est
seulement un détail d'arrière-plan d'une scène qui parle d'autre chose,
c'est non_automotive.`

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** L'appelant, vérifié auprès de Supabase. On ne délivre un jeton qu'à
 *  quelqu'un de connecté, et nominativement — un jeton n'est utilisable que
 *  par le compte qui l'a obtenu. */
async function callerId(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization')
  const url = process.env.VITE_SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY
  if (!auth || !url || !anon) return null
  const r = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: auth },
  })
  if (!r.ok) return null
  const u = await r.json()
  return typeof u?.id === 'string' ? u.id : null
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  try {
    const uid = await callerId(req)
    if (!uid) return json({ error: 'auth' }, 401)

    const body = await req.json().catch(() => ({}))
    const dataUrl: string | undefined = body?.image
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      return json({ error: 'image' }, 400)
    }
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl)
    if (!m) return json({ error: 'format' }, 400)
    const [, mediaType, b64] = m
    // Garde-fou de taille : le client envoie une image réduite à 512 px, qui
    // pèse quelques dizaines de kilo-octets. Au-delà de 2 Mo, quelque chose
    // ne va pas — et on ne paie pas pour le découvrir.
    if (b64.length > 2_800_000) return json({ error: 'too_large' }, 413)

    const key = process.env.ANTHROPIC_API_KEY
    if (!key) {
      // Sans clé, on n'invente pas un verdict. Le refus est explicite et
      // temporaire — accepter par défaut ouvrirait la porte en grand.
      return json({ ok: false, verdict: 'uncertain', reason: 'unavailable' })
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 120,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: b64 },
              },
              { type: 'text', text: 'Cette image est-elle automobile ?' },
            ],
          },
        ],
      }),
    })
    if (!r.ok) {
      return json({ ok: false, verdict: 'uncertain', reason: 'unavailable' })
    }
    const data = await r.json()
    const raw: string = data?.content?.[0]?.text ?? ''
    const jm = raw.match(/\{[\s\S]*\}/)
    const parsed = jm ? (JSON.parse(jm[0]) as { verdict?: string; note?: string }) : null
    const verdict = (parsed?.verdict ?? 'uncertain') as Verdict
    const note = String(parsed?.note ?? '').slice(0, 120)

    if (!ACCEPTED.includes(verdict)) {
      return json({ ok: false, verdict, note })
    }

    // Accepté : on dépose le jeton à usage unique que les déclencheurs
    // exigeront à la publication.
    const url = process.env.VITE_SUPABASE_URL
    const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !svc) return json({ error: 'server' }, 500)
    const ins = await fetch(`${url}/rest/v1/image_validations`, {
      method: 'POST',
      headers: {
        apikey: svc,
        Authorization: `Bearer ${svc}`,
        'content-type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ user_id: uid, verdict, note }),
    })
    if (!ins.ok) return json({ error: 'token' }, 500)
    const rows = await ins.json()
    return json({ ok: true, verdict, note, validation_id: rows?.[0]?.id })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unknown' }, 500)
  }
}
