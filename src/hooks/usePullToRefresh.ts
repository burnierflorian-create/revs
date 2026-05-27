import { useEffect, useRef, useState } from 'react'

const TRIGGER_PX = 60
const MAX_PX = 120

/** Pull-to-refresh wired to the closest `.tab-pane` ancestor of the
 *  returned ref. Uses native touch events with `passive: false` on
 *  touchmove so we can `preventDefault()` and stop the OS rubber-band
 *  from competing with our own indicator translation.
 *
 *  The hook reads the LATEST pull / refreshing / onRefresh through refs
 *  inside its effect so attaching the listeners exactly once on mount
 *  is safe — re-attaching on every state change would race with the
 *  user's gesture in progress. */
export function usePullToRefresh(onRefresh: () => Promise<void> | void) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const pullRef = useRef(0)
  pullRef.current = pull
  const refreshingRef = useRef(false)
  refreshingRef.current = refreshing
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const pane = root.closest('.tab-pane') as HTMLElement | null
    if (!pane) return

    let startY = 0
    let dragging = false

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current) return
      // Only enable PTR when the user starts at the very top of the
      // pane — otherwise scrolling normally must work.
      if (pane.scrollTop > 0) {
        dragging = false
        return
      }
      startY = e.touches[0].clientY
      dragging = true
    }

    const onMove = (e: TouchEvent) => {
      if (!dragging) return
      const dy = e.touches[0].clientY - startY
      if (dy <= 0) {
        if (pullRef.current !== 0) setPull(0)
        return
      }
      // Rubber-band: linear up to 80 px (× 0.55), then slow taper.
      const damped = dy < 80 ? dy * 0.55 : 44 + (dy - 80) * 0.25
      setPull(Math.min(damped, MAX_PX))
      // Block the OS overscroll while we're handling the gesture.
      if (pane.scrollTop === 0 && e.cancelable) e.preventDefault()
    }

    const onEnd = async () => {
      if (!dragging) return
      dragging = false
      if (pullRef.current >= TRIGGER_PX && !refreshingRef.current) {
        setRefreshing(true)
        setPull(70) // park spinner at a comfortable visible height
        try {
          await onRefreshRef.current()
        } finally {
          setRefreshing(false)
          setPull(0)
        }
      } else {
        setPull(0)
      }
    }

    pane.addEventListener('touchstart', onStart, { passive: true })
    pane.addEventListener('touchmove', onMove, { passive: false })
    pane.addEventListener('touchend', onEnd)
    pane.addEventListener('touchcancel', onEnd)

    return () => {
      pane.removeEventListener('touchstart', onStart)
      pane.removeEventListener('touchmove', onMove)
      pane.removeEventListener('touchend', onEnd)
      pane.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  return { containerRef, pull, refreshing }
}
