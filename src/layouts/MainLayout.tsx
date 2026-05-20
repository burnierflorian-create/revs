import { useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Map as MapIcon, Newspaper, Home, Compass, User } from 'lucide-react'
import UpdateNotification from '../components/UpdateNotification'
import InstallBanner from '../components/InstallBanner'
import SpotFab from '../components/SpotFab'
import TabsContainer, { type TabKey } from './TabsContainer'

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `flex flex-col items-center justify-center gap-1 h-full text-[10px] tracking-wide transition-colors ${
    isActive ? 'text-fg' : 'text-fg/40'
  }`

// Map a pathname to one of the 5 always-mounted tabs. Returns null for
// stack routes (spot detail, new-spot, public profile, etc.) — those
// render via <Outlet /> on top of the kept-alive tabs.
function pathToTab(pathname: string): {
  tab: TabKey | null
  discoverInitial: 'events' | undefined
} {
  if (pathname === '/') return { tab: 'home', discoverInitial: undefined }
  if (pathname === '/feed') return { tab: 'feed', discoverInitial: undefined }
  if (pathname === '/map') return { tab: 'map', discoverInitial: undefined }
  if (pathname === '/profile')
    return { tab: 'profile', discoverInitial: undefined }
  if (pathname === '/discover' || pathname === '/actu')
    return { tab: 'discover', discoverInitial: undefined }
  if (pathname === '/events')
    return { tab: 'discover', discoverInitial: 'events' }
  return { tab: null, discoverInitial: undefined }
}

export default function MainLayout() {
  const { pathname } = useLocation()
  const { tab, discoverInitial } = pathToTab(pathname)
  // Remember the last visited tab so we keep the right pane visible
  // underneath stack routes (e.g. /spot/:id over /feed).
  const lastTabRef = useRef<TabKey | null>(null)
  if (tab) lastTabRef.current = tab
  const onStack = tab === null

  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <main className="app-main relative flex-1">
        <TabsContainer
          activeTab={tab ?? lastTabRef.current}
          discoverInitial={discoverInitial}
        />

        {onStack && (
          <div className="stack-overlay">
            <Outlet />
          </div>
        )}
      </main>

      <SpotFab />
      <UpdateNotification />
      <InstallBanner />

      <nav className="app-nav fixed bottom-0 left-0 right-0 z-40 bg-bg/95 backdrop-blur border-t border-white/5">
        <div className="grid grid-cols-5 items-end h-20 max-w-md mx-auto px-1">
          <NavLink to="/map" className={tabClass}>
            <MapIcon className="w-5 h-5" />
            <span>Carte</span>
          </NavLink>

          <NavLink to="/feed" className={tabClass}>
            <Newspaper className="w-5 h-5" />
            <span>Fil</span>
          </NavLink>

          <NavLink to="/" end className={tabClass}>
            <Home className="w-5 h-5" />
            <span>Accueil</span>
          </NavLink>

          <NavLink to="/discover" className={tabClass}>
            <Compass className="w-5 h-5" />
            <span>Explorer</span>
          </NavLink>

          <NavLink to="/profile" className={tabClass}>
            <User className="w-5 h-5" />
            <span>Profil</span>
          </NavLink>
        </div>
      </nav>
    </div>
  )
}
