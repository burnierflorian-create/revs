import { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import MainLayout from './layouts/MainLayout'
import Auth from './pages/Auth'
import Onboarding from './components/Onboarding'

// Every stack route is lazy: keeps the first paint chunk small. The
// fallback is a bare bg-bg slab — most routes render their own header
// + skeletons within ~50 ms, so a flash-free dark frame is enough.
const NewSpot = lazy(() => import('./pages/NewSpot'))
const NewEvent = lazy(() => import('./pages/NewEvent'))
const Premium = lazy(() => import('./pages/Premium'))
const PremiumCheckout = lazy(() => import('./pages/PremiumCheckout'))
const Settings = lazy(() => import('./pages/Settings'))
const LegalMentions = lazy(() => import('./pages/LegalMentions'))
const LegalPrivacy = lazy(() => import('./pages/LegalPrivacy'))
const LegalTerms = lazy(() => import('./pages/LegalTerms'))
const SpotDetail = lazy(() => import('./pages/SpotDetail'))
const GrandPrixDetail = lazy(() => import('./pages/GrandPrixDetail'))
const Leaderboard = lazy(() => import('./pages/Leaderboard'))
const Challenges = lazy(() => import('./pages/Challenges'))
const Badges = lazy(() => import('./pages/Badges'))
const BadgeDetail = lazy(() => import('./pages/BadgeDetail'))
const Referral = lazy(() => import('./pages/Referral'))
const Radar = lazy(() => import('./pages/Radar'))
const Games = lazy(() => import('./pages/Games'))
const Race = lazy(() => import('./pages/Race'))
const EventLive = lazy(() => import('./pages/EventLive'))
const MyBrands = lazy(() => import('./pages/MyBrands'))
const MyGallery = lazy(() => import('./pages/MyGallery'))
const Brands = lazy(() => import('./pages/Brands'))
const BrandDetail = lazy(() => import('./pages/BrandDetail'))
const F1Roster = lazy(() => import('./pages/F1Roster'))
const F1TeamDetail = lazy(() => import('./pages/F1TeamDetail'))
const F1DriverDetail = lazy(() => import('./pages/F1DriverDetail'))
const PublicProfile = lazy(() => import('./pages/PublicProfile'))

function StackFallback() {
  return <div className="min-h-screen bg-bg" />
}

function lazyRoute(node: React.ReactNode) {
  return <Suspense fallback={<StackFallback />}>{node}</Suspense>
}

export default function App() {
  const { session, loading } = useAuth()

  // After the first idle window, warm-start the Map chunk so its
  // 469 KB gzipped mapbox-gl payload is already in the browser cache
  // by the time the user taps /map. Wrapped in requestIdleCallback
  // (with a setTimeout fallback) so the warm-up never competes with
  // the initial paint. Only runs for authenticated sessions — the
  // /auth route doesn't have the tab bar so it'd be wasted work.
  useEffect(() => {
    if (!session) return
    const w = window as Window & {
      requestIdleCallback?: (
        cb: IdleRequestCallback,
        opts?: { timeout?: number },
      ) => number
    }
    const warm = () => {
      void import('./pages/Map')
    }
    let id: number | undefined
    if (typeof w.requestIdleCallback === 'function') {
      id = w.requestIdleCallback(warm, { timeout: 4000 })
    } else {
      id = window.setTimeout(warm, 2000) as unknown as number
    }
    return () => {
      if (typeof id === 'number') {
        if (typeof w.requestIdleCallback === 'function') {
          // No standardised cancel; the no-op callback if it fires
          // after unmount is harmless (browser caches the chunk).
        } else {
          window.clearTimeout(id)
        }
      }
    }
  }, [session])

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
          <Route path="/spot/:id" element={lazyRoute(<SpotDetail />)} />
          <Route path="/new-spot" element={lazyRoute(<NewSpot />)} />
          <Route path="/f1/:round" element={lazyRoute(<GrandPrixDetail />)} />
          <Route path="/new-event" element={lazyRoute(<NewEvent />)} />
          <Route path="/classement" element={lazyRoute(<Leaderboard />)} />
          <Route path="/challenges" element={lazyRoute(<Challenges />)} />
          <Route path="/badges" element={lazyRoute(<Badges />)} />
          <Route path="/badges/:slug" element={lazyRoute(<BadgeDetail />)} />
          <Route path="/referral" element={lazyRoute(<Referral />)} />
          <Route path="/radar" element={lazyRoute(<Radar />)} />
          <Route path="/games" element={lazyRoute(<Games />)} />
          <Route path="/race" element={lazyRoute(<Race />)} />
          <Route path="/event/:id/live" element={lazyRoute(<EventLive />)} />
          <Route path="/mes-marques" element={lazyRoute(<MyBrands />)} />
          <Route path="/brands" element={lazyRoute(<Brands />)} />
          <Route path="/brand/:slug" element={lazyRoute(<BrandDetail />)} />
          <Route path="/f1-roster" element={lazyRoute(<F1Roster />)} />
          <Route path="/f1-team/:slug" element={lazyRoute(<F1TeamDetail />)} />
          <Route
            path="/f1-driver/:slug"
            element={lazyRoute(<F1DriverDetail />)}
          />
          <Route path="/ma-galerie" element={lazyRoute(<MyGallery />)} />
          <Route path="/u/:id" element={lazyRoute(<PublicProfile />)} />
          <Route path="/settings" element={lazyRoute(<Settings />)} />
          <Route
            path="/legal/mentions"
            element={lazyRoute(<LegalMentions />)}
          />
          <Route path="/legal/privacy" element={lazyRoute(<LegalPrivacy />)} />
          <Route path="/legal/terms" element={lazyRoute(<LegalTerms />)} />
          <Route path="/premium" element={lazyRoute(<Premium />)} />
          <Route
            path="/premium/checkout/:tier"
            element={lazyRoute(<PremiumCheckout />)}
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {session && <Onboarding />}
    </>
  )
}
