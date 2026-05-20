import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import MainLayout from './layouts/MainLayout'
import Auth from './pages/Auth'
import NewSpot from './pages/NewSpot'
import NewEvent from './pages/NewEvent'
import Premium from './pages/Premium'
import Settings from './pages/Settings'
import LegalMentions from './pages/LegalMentions'
import LegalPrivacy from './pages/LegalPrivacy'
import LegalTerms from './pages/LegalTerms'
// Lazy: SpotDetail pulls mapbox-gl for its mini-map; keep it out of
// the initial bundle.
const SpotDetail = lazy(() => import('./pages/SpotDetail'))
import GrandPrixDetail from './pages/GrandPrixDetail'
import Leaderboard from './pages/Leaderboard'
import MyBrands from './pages/MyBrands'
import MyGallery from './pages/MyGallery'
import PublicProfile from './pages/PublicProfile'
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
          {/* Tab routes — the actual UI is rendered by <TabsContainer />
              inside MainLayout (kept-alive). These routes only exist so
              the router accepts the URLs and so MainLayout can read the
              active path. */}
          <Route path="/" element={null} />
          <Route path="/map" element={null} />
          <Route path="/feed" element={null} />
          <Route path="/discover" element={null} />
          <Route path="/actu" element={null} />
          <Route path="/events" element={null} />
          <Route path="/profile" element={null} />

          {/* Stack routes — render via <Outlet /> on top of the tabs. */}
          <Route
            path="/spot/:id"
            element={
              <Suspense fallback={<div className="min-h-screen bg-bg" />}>
                <SpotDetail />
              </Suspense>
            }
          />
          <Route path="/new-spot" element={<NewSpot />} />
          <Route path="/f1/:round" element={<GrandPrixDetail />} />
          <Route path="/new-event" element={<NewEvent />} />
          <Route path="/classement" element={<Leaderboard />} />
          <Route path="/mes-marques" element={<MyBrands />} />
          <Route path="/ma-galerie" element={<MyGallery />} />
          <Route path="/u/:id" element={<PublicProfile />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/legal/mentions" element={<LegalMentions />} />
          <Route path="/legal/privacy" element={<LegalPrivacy />} />
          <Route path="/legal/terms" element={<LegalTerms />} />
          <Route path="/premium" element={<Premium />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {session && <Onboarding />}
    </>
  )
}
