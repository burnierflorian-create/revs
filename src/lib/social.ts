// ═══════════════ PSEUDOS SOCIAUX — FORME CANONIQUE ═══════════════
//
// ── LE PROBLÈME QU'ON RÈGLE ICI ──
// Un pseudo Instagram peut être saisi de quatre façons : `flr_brn`, `@flr_brn`,
// `instagram.com/flr_brn`, ou l'URL complète. Tant que chaque écran décidait
// seul quoi en faire, on obtenait `@@flr_brn` à l'affichage et des liens vers
// `instagram.com/@flr_brn` — une page qui n'existe pas.
//
// La règle tient en une phrase : on STOCKE sans « @ », on AFFICHE avec.
// La base l'impose aussi (déclencheur `normalize_social_handles`, migration
// 0094), parce qu'un garde côté navigateur ne couvre que les chemins qu'on a
// pensés. Ces fonctions servent à l'affichage et au nettoyage de saisie.

/** Forme stockée : minuscules, sans « @ », sans URL, sans espace. */
export function canonicalHandle(raw: string | null | undefined): string | null {
  const s = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/^(instagram|tiktok)\.com\//, '')
    .replace(/^@+/, '')
    .replace(/[/?#].*$/, '')
    .replace(/\s+/g, '')
  return s || null
}

/** Forme affichée : « @flr_brn ». Jamais « @@ », quelle que soit l'entrée. */
export function displayHandle(raw: string | null | undefined): string | null {
  const h = canonicalHandle(raw)
  return h ? `@${h}` : null
}

/** Lien réel. `null` plutôt qu'un lien mort quand le pseudo est vide. */
export function instagramUrl(raw: string | null | undefined): string | null {
  const h = canonicalHandle(raw)
  return h ? `https://instagram.com/${h}` : null
}

/**
 * Un pseudo Instagram valide : lettres, chiffres, point, tiret bas, 30 max.
 * Le champ reste FACULTATIF — une chaîne vide est valide, et ne doit jamais
 * empêcher quoi que ce soit.
 */
export function isValidHandle(raw: string | null | undefined): boolean {
  const s = (raw ?? '').trim()
  if (!s) return true
  const h = canonicalHandle(s)
  return !!h && /^[a-z0-9._]{1,30}$/.test(h)
}
