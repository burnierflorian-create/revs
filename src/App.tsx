import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import MainLayout from './layouts/MainLayout'
import Auth from './pages/Auth'
import Home from './pages/Home'
// Lazy: keeps mapbox-gl (~1MB) out of the initial app bundle — only
// downloaded when the user navigates to /map.
const MapPage = lazy(() => import('./pages/Map'))
import { SkeletonMap } from './components/Skeleton'
import Feed from './pages/Feed'
import NewSpot from './pages/NewSpot'
import NewEvent from './pages/NewEvent'
import Profile from './pages/Profile'
import Premium from './pages/Premium'
import Settings from './pages/Settings'
import LegalMentions from './pages/LegalMentions'
import LegalPrivacy from './pages/LegalPrivacy'
import LegalTerms from './pages/LegalTerms'
// Lazy too: SpotDetail pulls mapbox-gl for its mini-map, so keep it
// out of the initial bundle.
const SpotDetail = lazy(() => import('./pages/SpotDetail'))
import Discover from './pages/Discover'
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
          <Route path="/" element={<Home />} />
          <Route
            path="/map"
            element={
              <Suspense fallback={<SkeletonMap />}>
                <MapPage />
              </Suspense>
            }
          />
          <Route path="/feed" element={<Feed />} />
          <Route
            path="/spot/:id"
            element={
              <Suspense fallback={<div className="min-h-screen bg-bg" />}>
                <SpotDetail />
              </Suspense>
            }
          />
          <Route path="/new-spot" element={<NewSpot />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/actu" element={<Discover />} />
          <Route path="/events" element={<Discover initial="events" />} />
          <Route path="/f1/:round" element={<GrandPrixDetail />} />
          <Route path="/new-event" element={<NewEvent />} />
          <Route path="/profile" element={<Profile />} />
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
