// ─────────────────────── Garde-fou de taille de requête ───────────────────────
//
// Les deux endpoints vision reçoivent une image en base64 dans le corps JSON.
// Rien ne bornait cette taille : un corps de plusieurs dizaines de Mo était
// accepté, désérialisé, puis transmis à Claude — coût de jetons et mémoire
// proportionnels à ce que l'appelant décide d'envoyer.
//
// Ce module vit hors de api/ : tout fichier placé dans api/ deviendrait une
// fonction serverless Vercel de plus.

/** Plafond du corps de requête, en octets. */
export const MAX_REQUEST_BYTES = 10 * 1024 * 1024 // 10 Mo

/**
 * Vérifie l'en-tête Content-Length. Renvoie null si la requête passe, ou un
 * objet de refus prêt à sérialiser (413) si elle dépasse le plafond.
 *
 * Volontairement fondé sur l'en-tête seul : à ce stade le corps n'est pas
 * encore lu, donc c'est le seul indicateur disponible sans payer le coût
 * mémoire qu'on cherche justement à éviter. Un Content-Length absent ou
 * illisible laisse passer — la plateforme applique de toute façon sa propre
 * limite en amont (voir la note ci-dessous).
 *
 * @param {import('@vercel/node').VercelRequest} req
 * @returns {{status: 413, body: {error: string}} | null}
 */
export function checkRequestSize(req) {
  const raw = req.headers['content-length']
  const header = Array.isArray(raw) ? raw[0] : raw
  if (!header) return null
  const bytes = Number.parseInt(header, 10)
  if (!Number.isFinite(bytes)) return null
  if (bytes <= MAX_REQUEST_BYTES) return null
  console.warn(
    `[request-size] corps refusé : ${bytes} octets > ${MAX_REQUEST_BYTES}`,
  )
  return {
    status: 413,
    body: { error: 'Image trop volumineuse (max 10 MB)' },
  }
}

// NOTE — Vercel plafonne déjà le corps des fonctions serverless bien en
// dessous de 10 Mo (~4,5 Mo) et renvoie son propre 413 avant que ce code ne
// s'exécute. Ce garde-fou reste utile à trois titres : il rend la limite
// explicite et versionnée, il renvoie un message JSON exploitable par le
// client au lieu d'une page d'erreur de plateforme, et il continue de
// s'appliquer si la limite de plateforme change ou si le code tourne
// ailleurs. Il ne faut donc pas s'attendre à le voir déclencher en
// production dans la configuration actuelle.
