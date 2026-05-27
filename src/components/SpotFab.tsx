import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Camera } from 'lucide-react'
import { setPendingPhoto } from '../lib/pendingPhoto'

// Visible on Accueil + Carte. The Home hero block was replaced by the
// unified daily card, so the FAB is the only quick spot entry-point
// from those two tabs.
const SHOWN_ON = ['/', '/map']

export default function SpotFab() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // Opacity drops to 0.3 while the user scrolls *down* past 100 px in
  // the active tab pane; it returns to 1 the moment scrolling stops or
  // reverses. Never hides the button completely — discreet but always
  // tappable.
  const [opacity, setOpacity] = useState(1)

  useEffect(() => {
    if (!SHOWN_ON.includes(pathname)) return
    // Both tabs live inside their own .tab-pane scroller; we find the
    // active one from the FAB's wrapper position. Re-runs on pathname
    // change because the active pane DOM node differs per tab.
    const panes = Array.from(
      document.querySelectorAll<HTMLElement>('.tab-pane'),
    )
    if (panes.length === 0) return
    const cleanups: Array<() => void> = []
    let restoreTimer: number | null = null
    let lastTopByPane = new WeakMap<HTMLElement, number>()
    function onScroll(e: Event) {
      const pane = e.currentTarget as HTMLElement
      const top = pane.scrollTop
      const last = lastTopByPane.get(pane) ?? 0
      if (top > 100 && top > last) {
        setOpacity(0.3)
      } else if (top < last) {
        setOpacity(1)
      }
      lastTopByPane.set(pane, top)
      // Treat "scrolling stopped" as a return-to-1 trigger as well.
      if (restoreTimer) window.clearTimeout(restoreTimer)
      restoreTimer = window.setTimeout(() => setOpacity(1), 350)
    }
    for (const p of panes) {
      lastTopByPane.set(p, p.scrollTop)
      p.addEventListener('scroll', onScroll, { passive: true })
      cleanups.push(() => p.removeEventListener('scroll', onScroll))
    }
    return () => {
      if (restoreTimer) window.clearTimeout(restoreTimer)
      for (const fn of cleanups) fn()
    }
  }, [pathname])

  if (!SHOWN_ON.includes(pathname)) return null

  function onCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return // user cancelled the camera
    setPendingPhoto(file)
    navigate('/new-spot')
  }

  return (
    <div
      ref={wrapRef}
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom) + 5rem + 0.75rem)',
      }}
    >
      {/* Opening this input directly from the button's click gesture makes
          the native camera appear instantly — no intermediate screen. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onCapture}
        className="hidden"
      />
      <button
        onClick={() => inputRef.current?.click()}
        aria-label="Spotter une voiture"
        className="pointer-events-auto flex h-14 w-14 animate-pulse-soft items-center justify-center rounded-full bg-accent text-fg shadow-lg shadow-black/40 active:opacity-90"
        style={{ opacity, transition: 'opacity 200ms ease-out' }}
      >
        <Camera className="h-7 w-7" />
      </button>
    </div>
  )
}
