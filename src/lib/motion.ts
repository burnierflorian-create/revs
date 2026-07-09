/** Shared motion utilities for the app-wide animation layer.
 *
 *  prefersReducedMotion() lets every JS-driven effect (full-screen
 *  celebrations, particle bursts, marker drops) bail out to a static /
 *  instant fallback when the user has enabled "Reduce Motion" in their OS.
 *  CSS keyframes are additionally guarded by a @media block in
 *  design-system.css; this is the JS counterpart for effects we build
 *  imperatively. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** navigator.vibrate wrapper — SSR/feature-guarded, never throws. iOS
 *  Safari has no Vibration API so this is a silent no-op there. */
export function vibrate(pattern: number | number[]): void {
  if (typeof navigator === 'undefined') return
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* ignore — vibration is best-effort */
  }
}
