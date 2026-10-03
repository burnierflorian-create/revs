import { supabase } from './supabase'

export type ReferralStats = {
  invite_code: string | null
  /** Filleuls ayant réclamé le code — un compte créé suffit. */
  referred_count: number
  /** Filleuls ayant réellement publié au moins un spot (migration 0084).
   *  C'est la mesure qui a un coût, donc la seule à mettre en avant. */
  active_count: number
  xp_from_referrals: number
}

export async function fetchMyReferralStats(): Promise<ReferralStats | null> {
  const { data, error } = await supabase.rpc('my_referral_stats').maybeSingle()
  if (error) {
    console.warn('[referrals] stats failed:', error.message)
    return null
  }
  if (!data) return null
  // `active_count` est arrivé en 0084 : on retombe sur 0 si une réponse plus
  // ancienne traîne dans un cache client.
  const r = data as Partial<ReferralStats>
  return {
    invite_code: r.invite_code ?? null,
    referred_count: r.referred_count ?? 0,
    active_count: r.active_count ?? 0,
    xp_from_referrals: r.xp_from_referrals ?? 0,
  }
}

// ─────────────────── Partage de l'application ───────────────────
//
// Le profil partageait auparavant un LIEN DE PROFIL (/u/:id). C'était une
// impasse d'acquisition : le destinataire arrivait sur la fiche de quelqu'un
// d'autre, sans raison d'installer quoi que ce soit.
//
// Le partage porte désormais l'application ET le code de parrainage. Le lien
// embarque `?ref=CODE` : à l'inscription, `stashPendingReferral` le mémorise
// et MainLayout le réclame automatiquement. Le parrainage se fait donc sans
// que personne ait à recopier un code à la main.

/** L'origine de production. Exportée parce que le lien d'une publication se
 *  compose au même endroit que celui d'une invitation : deux constantes
 *  finiraient par désigner deux domaines. */
export const APP_ORIGIN = 'https://revs-ten.vercel.app'

/** Lien d'invitation, code inclus quand il est connu. */
export function inviteLink(code: string | null): string {
  return code ? `${APP_ORIGIN}/?ref=${encodeURIComponent(code)}` : APP_ORIGIN
}

/**
 * Ouvre le partage natif avec le texte d'invitation. Retombe sur une copie
 * dans le presse-papiers quand `navigator.share` n'existe pas (navigateurs de
 * bureau) — d'où le booléen : l'appelant affiche « Copié » dans ce cas.
 *
 * @returns true si le contenu a été copié plutôt que partagé.
 */
export async function shareRevsApp(
  code: string | null,
  text: string,
): Promise<boolean> {
  const url = inviteLink(code)
  try {
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ text, url })
      return false
    }
  } catch {
    // Partage annulé par l'utilisateur, ou refusé par le navigateur :
    // on retombe sur la copie plutôt que de ne rien faire.
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`)
    return true
  } catch {
    return false
  }
}

/** Claims a referral code as the freshly signed-up user. Returns true if
 *  the code was valid AND not already claimed by this account. */
export async function claimReferralCode(code: string): Promise<boolean> {
  const cleaned = code.trim().toUpperCase()
  if (cleaned.length !== 6) return false
  const { data, error } = await supabase.rpc('claim_referral', {
    p_code: cleaned,
  })
  if (error) {
    console.warn('[referrals] claim failed:', error.message)
    return false
  }
  return data === true
}

const PENDING_KEY = 'revs.pending-referral'

/** Held during the signup flow until the auth session is established,
 *  then redeemed once. Surviving across the email-confirmation hop
 *  is why this lives in localStorage rather than React state. */
export function stashPendingReferral(code: string) {
  const cleaned = code.trim().toUpperCase()
  if (cleaned.length !== 6) return
  try {
    localStorage.setItem(PENDING_KEY, cleaned)
  } catch {
    // ignore — private mode, etc.
  }
}

export function consumePendingReferral(): string | null {
  try {
    const c = localStorage.getItem(PENDING_KEY)
    if (c) localStorage.removeItem(PENDING_KEY)
    return c
  } catch {
    return null
  }
}
