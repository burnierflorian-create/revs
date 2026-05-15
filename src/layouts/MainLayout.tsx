import { NavLink, Outlet } from 'react-router-dom'
import { Map as MapIcon, Newspaper, Home, Calendar, User } from 'lucide-react'

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `flex flex-col items-center justify-center gap-1 h-full text-[10px] tracking-wide transition-colors ${
    isActive ? 'text-fg' : 'text-fg/40'
  }`

export default function MainLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-bg text-fg">
      <main className="flex-1 pb-28">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-bg/95 backdrop-blur border-t border-white/5">
        <div className="grid grid-cols-5 items-end h-20 max-w-md mx-auto px-2">
          <NavLink to="/map" className={tabClass}>
            <MapIcon className="w-5 h-5" />
            <span>Carte</span>
          </NavLink>

          <NavLink to="/feed" className={tabClass}>
            <Newspaper className="w-5 h-5" />
            <span>Feed</span>
          </NavLink>

          <NavLink to="/" end className={tabClass}>
            <Home className="w-5 h-5" />
            <span>Accueil</span>
          </NavLink>

          <NavLink to="/events" className={tabClass}>
            <Calendar className="w-5 h-5" />
            <span>Événements</span>
          </NavLink>

          <NavLink to="/profile" className={tabClass}>
            <User className="w-5 h-5" />
            <span>Profil</span>
          </NavLink>
        </div>
        <div style={{ height: 'env(safe-area-inset-bottom)' }} />
      </nav>
    </div>
  )
}
