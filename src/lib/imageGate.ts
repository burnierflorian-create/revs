// ═══════ LE CONTRÔLE AUTOMOBILE, CÔTÉ CLIENT ═══════
//
// Un seul passage pour tous les flux qui publient une image dans un contenu
// REVS — spot, story, et tout ce qui viendra. Dupliquer ce code par écran
// garantirait qu'un écran finisse par l'oublier.
//
// ── CE QUI N'EST PAS CONCERNÉ ──
// L'avatar. Une photo de profil peut être n'importe quelle image. Ce module
// n'est jamais appelé depuis les Réglages, et aucun déclencheur ne garde le
// bucket `avatars`.
//
// ── POURQUOI 512 PX ──
// La question posée est « est-ce automobile ? », pas « quel modèle ? ».
// 512 px suffisent largement, et c'est ce qui rend le contrôle bon marché :
// le coût d'une image chez un modèle de vision est proportionnel à sa
// surface. Envoyer l'original coûterait vingt fois plus pour la même réponse.

import { supabase } from './supabase'

/** Ce que le contrôle a vu. `non_automotive` et `uncertain` sont refusés. */
export type ImageVerdict =
  | 'car'
  | 'motorcycle'
  | 'motorsport'
  | 'non_automotive'
  | 'uncertain'

export type GateResult =
  | { ok: true; verdict: ImageVerdict; validationId: string }
  | { ok: false; verdict: ImageVerdict; reason?: 'unavailable' | 'network' }

const PROBE_PX = 512

/** Réduit l'image à une vignette JPEG pour l'analyse. L'original n'est pas
 *  touché : c'est lui qui sera publié. */
async function probe(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob)
  const k = Math.min(1, PROBE_PX / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * k))
  const h = Math.max(1, Math.round(bitmap.height * k))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  return canvas.toDataURL('image/jpeg', 0.72)
}

/**
 * Demande au serveur si cette image peut être publiée dans REVS.
 *
 * En cas de refus, l'appelant affiche un message — jamais un pourcentage, ni
 * la classe technique renvoyée. L'utilisateur a besoin de savoir quoi faire,
 * pas de ce que la machine a pensé.
 */
export async function checkAutomotive(blob: Blob): Promise<GateResult> {
  try {
    const image = await probe(blob)
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return { ok: false, verdict: 'uncertain', reason: 'network' }
    const r = await fetch('/api/validate-image', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ image }),
    })
    if (!r.ok) return { ok: false, verdict: 'uncertain', reason: 'unavailable' }
    const j = (await r.json()) as {
      ok?: boolean
      verdict?: ImageVerdict
      validation_id?: string
      reason?: 'unavailable'
    }
    if (j.ok && j.validation_id) {
      return { ok: true, verdict: j.verdict ?? 'car', validationId: j.validation_id }
    }
    return { ok: false, verdict: j.verdict ?? 'uncertain', reason: j.reason }
  } catch {
    return { ok: false, verdict: 'uncertain', reason: 'network' }
  }
}

/** La clé de message à afficher selon le verdict. Le texte reste le même
 *  pour `non_automotive` et `uncertain` : dire « je ne suis pas sûr » ne
 *  donne à personne un moyen d'agir, alors que « prenez une photo où le
 *  véhicule se voit mieux » en donne un. */
export function gateMessageKey(r: GateResult): string {
  if (r.ok) return ''
  if (r.reason === 'unavailable' || r.reason === 'network') return 'gate.unavailable'
  return 'gate.notAVehicle'
}
