import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import MainLayout from './layouts/MainLayout'
import Auth from './pages/Auth'
import Home from './pages/Home'
import MapPage from './pages/Map'
import Feed from './pages/Feed'
import NewSpot from './pages/NewSpot'
import NewEvent from './pages/NewEvent'
import Profile from './pages/Profile'
import Premium from './pages/Premium'
import Settings from './pages/Settings'
import Privacy from './pages/Privacy'
import Legal from './pages/Legal'
import Cgu from './pages/Cgu'
import SpotDetail from './pages/SpotDetail'
import Discover from './pages/Discover'
import GrandPrixDetail from './pages/GrandPrixDetail'
import Onboarding from './components/Onboarding'

export default function App() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg text-fg">
        <div className="text-sm opacity-40">Chargement…</div>
      </div>
    )
  }

  return (
    <>
      <Routes>
        <Route
          path="/auth"
          element={session ? <Navigate to="/" replace /> : <Auth />}
        />
        <Route
          element={session ? <MainLayout /> : <Navigate to="/auth" replace />}
        >
          <Route path="/" element={<Home />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/feed" element={<Feed />} />
          <Route path="/spot/:id" element={<SpotDetail />} />
          <Route path="/new-spot" element={<NewSpot />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/actu" element={<Discover />} />
          <Route path="/events" element={<Discover initial="events" />} />
          <Route path="/f1/:round" element={<GrandPrixDetail />} />
          <Route path="/new-event" element={<NewEvent />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/confidentialite" element={<Privacy />} />
          <Route path="/mentions-legales" element={<Legal />} />
          <Route path="/cgu" element={<Cgu />} />
          <Route path="/premium" element={<Premium />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {session && <Onboarding />}
    </>
  )
}
