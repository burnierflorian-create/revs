import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import Home from '../pages/Home'
import { SkeletonMap } from '../components/Skeleton'
import { prefersReducedMotion } from '../lib/motion'

// Home is eager (default landing route). All other tabs split off into
// their own chunks: each lands when the user first taps the tab, then
// stays mounted (kept-alive) for the rest of the session. Mapbox itself
// is also kept lazy through this — its heavy module graph only loads
// when /map is visited for the first time.
const MapPage = lazy(() => import('../pages/Map'))
const Feed = lazy(() => import('../pages/Feed'))
const Profile = lazy(() => import('../pages/Profile'))
const Discover = lazy(() => import('../pages/Discover'))

function TabFallback() {
  return <div className="min-h-screen bg-bg" />
}

export type TabKey = 'home' | 'feed' | 'map' | 'discover' | 'profile'

// Visual left→right order of the tabs in the bottom nav. Used to pick the
// horizontal slide direction (move right in the bar → new content enters
// from the right, and vice-versa). NOT the same as the TabKey enum order.
const NAV_ORDER: TabKey[] = ['map', 'feed', 'home', 'discover', 'profile']

type PaneAnim = 'left' | 'right' | 'zoom' | null

const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'

// Each pane is absolutely positioned so the 5 tabs overlay each other,
// only the active one is visible (opacity-driven crossfade). We use
// opacity + pointer-events rather than display:none so the DOM tree (and
// Mapbox's canvas size) is preserved across switches — that's what makes
// coming back to a tab instant. When a pane BECOMES active it plays a
// one-shot transform via the Web Animations API (so children are never
// remounted): a horizontal spring slide for most tabs, a subtle zoom for
// the Carte. Honours prefers-reduced-motion.
function TabPane({
  active,
  anim,
  children,
}: {
  active: boolean
  anim: PaneAnim
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const wasActive = useRef(active)

  useEffect(() => {
    const becameActive = active && !wasActive.current
    wasActive.current = active
    if (!becameActive || !ref.current || !anim) return
    if (prefersReducedMotion()) return
    const el = ref.current
    if (anim === 'zoom') {
      el.animate(
        [{ transform: 'scale(0.95)' }, { transform: 'scale(1)' }],
        { duration: 400, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      )
    } else {
      const from = anim === 'right' ? '30px' : '-30px'
      el.animate(
        [{ transform: `translateX(${from})` }, { transform: 'translateX(0)' }],
        { duration: 320, easing: SPRING },
      )
    }
  }, [active, anim])

  return (
    <div
      ref={ref}
      className="tab-pane"
      aria-hidden={!active}
      style={{
        opacity: active ? 1 : 0,
        pointerEvents: active ? 'auto' : 'none',
      }}
    >
      {children}
    </div>
  )
}

type Props = {
  activeTab: TabKey | null
  discoverInitial: 'events' | undefined
}

// Lazy-mount-once-then-keep-alive: a tab's component is created the
// first time it becomes active and never unmounted afterwards. Avoids
// fetching/initialising the four other tabs on launch (initial bundle
// + network stays minimal) while still giving instant tab switches.
export default function TabsContainer({ activeTab, discoverInitial }: Props) {
  const [visited, setVisited] = useState<Set<TabKey>>(
    () => new Set(activeTab ? [activeTab] : []),
  )

  useEffect(() => {
    if (!activeTab) return
    setVisited((v) => {
      if (v.has(activeTab)) return v
      const n = new Set(v)
      n.add(activeTab)
      return n
    })
  }, [activeTab])

  // Slide direction is derived from the move's direction in the visual nav
  // bar. prevTabRef still holds the PREVIOUS tab during the render where
  // activeTab just changed (the effect below updates it afterwards).
  const prevTabRef = useRef<TabKey | null>(activeTab)
  const prev = prevTabRef.current
  const dir =
    activeTab && prev && activeTab !== prev
      ? Math.sign(NAV_ORDER.indexOf(activeTab) - NAV_ORDER.indexOf(prev))
      : 0
  useEffect(() => {
    prevTabRef.current = activeTab
  }, [activeTab])

  // Carte zooms; every other arriving tab springs in horizontally.
  const animFor = (key: TabKey): PaneAnim => {
    if (key !== activeTab) return null
    if (key === 'map') return 'zoom'
    if (dir > 0) return 'right'
    if (dir < 0) return 'left'
    return null
  }

  return (
    <>
      <TabPane active={activeTab === 'home'} anim={animFor('home')}>
        {visited.has('home') && <Home />}
      </TabPane>
      <TabPane active={activeTab === 'feed'} anim={animFor('feed')}>
        {visited.has('feed') && (
          <Suspense fallback={<TabFallback />}>
            <Feed />
          </Suspense>
        )}
      </TabPane>
      <TabPane active={activeTab === 'map'} anim={animFor('map')}>
        {visited.has('map') && (
          <Suspense fallback={<SkeletonMap />}>
            <MapPage />
          </Suspense>
        )}
      </TabPane>
      <TabPane active={activeTab === 'discover'} anim={animFor('discover')}>
        {visited.has('discover') && (
          <Suspense fallback={<TabFallback />}>
            <Discover initial={discoverInitial} />
          </Suspense>
        )}
      </TabPane>
      <TabPane active={activeTab === 'profile'} anim={animFor('profile')}>
        {visited.has('profile') && (
          <Suspense fallback={<TabFallback />}>
            <Profile />
          </Suspense>
        )}
      </TabPane>
    </>
  )
}
