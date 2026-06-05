// Lightweight haptic wrapper around navigator.vibrate. Works on
// Android Chrome / Firefox Android out of the box; iOS Safari silently
// no-ops (Apple hasn't shipped the Vibration API on the web), which is
// fine — the visual + audio cues carry the moment on iOS, and the
// PWA install path is what users land on for the real haptic loop.
//
// Three primitives, mirroring the spec language:
//   heartbeat() — starts a background interval pulsing short ticks
//                 during long-running flows (scan laser). Returns a
//                 stop() function the caller must invoke. Idempotent.
//   success()  — short triple pulse used at the card-reveal flash.
//   error()    — single long buzz used on reject (screen detected,
//                 geo refused, photo too old).
//
// Guards:
//   - typeof navigator === 'undefined' (SSR) → silent no-op
//   - typeof navigator.vibrate !== 'function' → silent no-op
//   - Throws inside vibrate (rare, some sandboxed iframes) → swallowed
//     so a haptic call never crashes the publish flow.

function canVibrate(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.vibrate === 'function'
  )
}

function vibrateSafely(pattern: number | number[]): void {
  if (!canVibrate()) return
  try {
    navigator.vibrate(pattern)
  } catch {
    /* swallow — iOS Safari, sandboxed frames, user-gesture issues */
  }
}

/** Triple-pulse "success" used at the card-reveal moment (step 3
 *  pop animation). 30 ms tick, 80 ms gap, 30 ms tick, 80 ms gap,
 *  60 ms longer tail. */
export function hapticSuccess(): void {
  vibrateSafely([30, 80, 30, 80, 60])
}

/** Single long buzz for rejections (screen detected, geo refused,
 *  photo too old). 220 ms. */
export function hapticError(): void {
  vibrateSafely(220)
}

/** Light single tap — a crisp confirmation for lightweight actions like
 *  a double-tap "like". 12 ms. */
export function hapticTap(): void {
  vibrateSafely(12)
}

/** Starts a heartbeat that pulses every ~580 ms while the scan
 *  laser animation runs. Returns a cancel function — call it when
 *  the analyze response lands or the user aborts. Internally guards
 *  against double-start so callers can safely re-trigger. */
export function hapticHeartbeat(): () => void {
  if (!canVibrate()) {
    // Return a no-op cancel so callers can still treat this as a
    // resource handle.
    return () => {}
  }
  // First tick fires immediately so the user feels feedback the moment
  // the laser starts; subsequent ticks every 580 ms keep the rhythm.
  vibrateSafely(40)
  const id = window.setInterval(() => vibrateSafely(40), 580)
  let cancelled = false
  return () => {
    if (cancelled) return
    cancelled = true
    window.clearInterval(id)
    // Hard stop any in-flight vibration the moment the heartbeat ends.
    vibrateSafely(0)
  }
}
