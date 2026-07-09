/** Hardened geolocation acquisition shared by every screen that
 *  needs a fresh fix (NewSpot publish, Map locate-me, Onboarding
 *  city auto-fill, Settings location prefs, etc.).
 *
 *  Why a shared lib: the prod "b is not a function" crash on the
 *  NewSpot RÉESSAYER button traced back to passing the Promise
 *  constructor's resolve/reject straight into
 *  navigator.geolocation.getCurrentPosition. Under Vite's terser
 *  pipeline those parameters become single-letter names that a few
 *  webkit dispatcher builds mis-bind. Centralising the hardened
 *  pattern means every caller benefits from the same fix and
 *  future call sites don't reintroduce the footgun.
 *
 *  Defensive ingredients, applied unconditionally:
 *    - Named onSuccess / onError handlers wrap resolve/reject so
 *      the wrapped functions go through a typeof === 'function'
 *      guard before being invoked.
 *    - try/catch around the dispatch — a couple of iOS Safari
 *      builds throw synchronously on PERMISSION_DENIED.
 *    - `typeof window !== 'undefined' && navigator.geolocation`
 *      gates the call so SSR / non-browser bundlers never see a
 *      ReferenceError.
 *    - Per-code error messages in French so callers can surface
 *      them directly without further translation.
 */

export type GeoOptions = {
  /** Request high accuracy (slower, more battery). Default true. */
  highAccuracy?: boolean
  /** Geolocation timeout in ms. Default 10_000. */
  timeoutMs?: number
  /** Max cached-position age in ms. Default 0 (fresh fix only). */
  maxAgeMs?: number
}

/** Whether geolocation is ALREADY granted — checked WITHOUT ever prompting.
 *  Automatic screens (Map open, location watch, signup city prefill) must gate
 *  on this so they never re-trigger the OS permission dialog: the single ask
 *  happens once during onboarding. Uses the Permissions API when available;
 *  falls back to the remembered onboarding/settings choice (`revs_geo`) on
 *  older iOS Safari builds that lack `permissions.query` for geolocation.
 *  User-initiated actions (a "locate me" tap) may still prompt — that's fine. */
export async function hasGeoPermission(): Promise<boolean> {
  try {
    const perms =
      typeof navigator !== 'undefined' ? navigator.permissions : undefined
    if (perms?.query) {
      const st = await perms.query({ name: 'geolocation' as PermissionName })
      return st.state === 'granted'
    }
  } catch {
    /* Permissions API unsupported / threw — fall through to the flag. */
  }
  try {
    return localStorage.getItem('revs_geo') === '1'
  } catch {
    return false
  }
}

/** Returns a Promise resolving to a GeolocationPosition. Rejects
 *  with a French-language Error.message that callers can surface
 *  in their UI as-is. */
export function getCurrentPositionSafe(
  options?: GeoOptions,
): Promise<GeolocationPosition> {
  const opts: PositionOptions = {
    enableHighAccuracy: options?.highAccuracy ?? true,
    timeout: options?.timeoutMs ?? 10_000,
    maximumAge: options?.maxAgeMs ?? 0,
  }

  return new Promise<GeolocationPosition>((resolve, reject) => {
    function settleError(msg: string): void {
      if (typeof reject === 'function') {
        reject(new Error(msg))
      } else {
        console.error('[geo] reject callback missing:', msg)
      }
    }

    if (
      typeof window === 'undefined' ||
      typeof navigator === 'undefined' ||
      !navigator.geolocation
    ) {
      settleError('Géolocalisation non disponible sur cet appareil.')
      return
    }

    function onSuccess(pos: GeolocationPosition): void {
      if (typeof resolve === 'function') {
        resolve(pos)
      } else {
        console.error('[geo] resolve callback missing despite valid position')
      }
    }

    function onError(err: GeolocationPositionError): void {
      let msg = 'Impossible de récupérer ta position GPS.'
      if (err) {
        if (err.code === err.PERMISSION_DENIED) {
          msg = "Autorise l'accès GPS dans les réglages pour continuer."
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          msg = 'Position GPS introuvable. Réessaie en extérieur.'
        } else if (err.code === err.TIMEOUT) {
          msg = 'Le GPS met trop de temps à répondre. Réessaie.'
        }
      }
      settleError(msg)
    }

    try {
      navigator.geolocation.getCurrentPosition(onSuccess, onError, opts)
    } catch (e) {
      // Some Safari builds throw synchronously when the permission
      // prompt has been dismissed previously — funnel to the same
      // rejection path so awaiters see a clean Error.
      console.error('[geo] getCurrentPosition threw:', e)
      settleError(
        e instanceof Error && e.message
          ? e.message
          : 'Erreur GPS inattendue. Réessaie dans un instant.',
      )
    }
  })
}
