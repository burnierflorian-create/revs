import { Suspense, lazy, useEffect, useState } from 'react'
import Home from '../pages/Home'
import Feed from '../pages/Feed'
import Profile from '../pages/Profile'
import Discover from '../pages/Discover'
import { SkeletonMap } from '../components/Skeleton'

// Keep mapbox-gl out of the initial bundle: only loaded when the user
// first taps the Carte tab. After that the Map component stays mounted
// for the lifetime of the session — switching tabs never re-runs its
// init, geolocation, fetches or realtime subscriptions.
const MapPage = lazy(() => import('../pages/Map'))

export type TabKey = 'home' | 'feed' | 'map' | 'discover' | 'profile'

// Each pane is absolutely positioned so the 5 tabs overlay each other,
// only the active one is visible (opacity-driven crossfade, 150 ms).
// We use opacity + pointer-events rather than display:none so the DOM
// tree (and Mapbox's canvas size) is preserved across switches — that's
// what makes coming back to a tab instant.
function TabPane({
  active,
  children,
}: {
  active: boolean
  children: React.ReactNode
}) {
  return (
    <div
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

  return (
    <>
      <TabPane active={activeTab === 'home'}>
        {visited.has('home') && <Home />}
      </TabPane>
      <TabPane active={activeTab === 'feed'}>
        {visited.has('feed') && <Feed />}
      </TabPane>
      <TabPane active={activeTab === 'map'}>
        {visited.has('map') && (
          <Suspense fallback={<SkeletonMap />}>
            <MapPage />
          </Suspense>
        )}
      </TabPane>
      <TabPane active={activeTab === 'discover'}>
        {visited.has('discover') && <Discover initial={discoverInitial} />}
      </TabPane>
      <TabPane active={activeTab === 'profile'}>
        {visited.has('profile') && <Profile />}
      </TabPane>
    </>
  )
}
