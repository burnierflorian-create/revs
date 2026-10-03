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
    // N'importe quel sous-domaine, pas seulement `www.` : Instagram sert
    // aussi `m.instagram.com` et des liens de redirection `l.instagram.com`.
    // Sans cela, coller une URL mobile donnait `m.instagram.com` comme
    // pseudo — le lien menait alors nulle part.
    .replace(/^[a-z0-9-]+\.(?=(instagram|tiktok)\.com\/)/, '')
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

/**
 * Lien réel vers le profil. `null` plutôt qu'un lien mort quand le pseudo est
 * vide — un `href="#"` remonte la page et passe pour un bouton cassé.
 *
 * ── POURQUOI `www.` ET LE SLASH FINAL ──
 * C'est la forme canonique d'Instagram. `instagram.com/x` fonctionne, mais
 * par une REDIRECTION — et c'est ce détour qui casse l'ouverture de
 * l'application sur iOS : les Universal Links sont déclarés pour
 * `www.instagram.com`, pas pour le domaine nu. Un lien redirigé atterrit donc
 * dans Safari au lieu du profil dans l'application. D'un pseudo à l'autre le
 * comportement paraissait aléatoire ; il ne l'était pas.
 */
export function instagramUrl(raw: string | null | undefined): string | null {
  const h = canonicalHandle(raw)
  return h ? `https://www.instagram.com/${h}/` : null
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
