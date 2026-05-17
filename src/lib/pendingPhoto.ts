// One-shot hand-off for a photo captured directly from the FAB camera.
// The native camera input must be clicked inside the FAB's click gesture
// (iOS requirement) — so we can't navigate first. The captured File is
// stashed here, then NewSpot consumes it on mount.
let pending: File | null = null

export function setPendingPhoto(file: File) {
  pending = file
}

export function takePendingPhoto(): File | null {
  const f = pending
  pending = null
  return f
}
