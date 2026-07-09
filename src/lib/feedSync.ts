// Cross-screen channel for the "instant feed re-render" flow.
//
// NewSpot publishes a spot on its own route, then navigates away. The
// Feed tab is kept alive but lives in a different component tree, so it
// can't be handed the new row directly. This tiny pub/sub bridges them:
// NewSpot calls emitNewSpot() the instant the server confirms the insert,
// and the (already-mounted) Feed listener unshifts it to the top.
//
// Buffering: if the user spots BEFORE ever opening the Feed tab, there's
// no listener yet — we hold the spot(s) and flush them the moment Feed
// first subscribes. So the new post is always waiting at the top when the
// user lands on the Fil, with zero manual refresh.

import type { Spot } from './spots'

type Listener = (spot: Spot) => void

const listeners = new Set<Listener>()
let buffered: Spot[] = []

/** Announce a freshly-published spot. Fires every live listener, or
 *  buffers it until the Feed mounts and subscribes. */
export function emitNewSpot(spot: Spot): void {
  if (listeners.size === 0) {
    buffered.push(spot)
    return
  }
  for (const l of listeners) l(spot)
}

/** Subscribe to new-spot announcements. On subscribe, any spots buffered
 *  while no listener existed are flushed immediately (newest first).
 *  Returns an unsubscribe function. */
export function onNewSpot(listener: Listener): () => void {
  listeners.add(listener)
  if (buffered.length) {
    const pending = buffered
    buffered = []
    for (const s of pending) listener(s)
  }
  return () => {
    listeners.delete(listener)
  }
}
