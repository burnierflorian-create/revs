import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import MainLayout from './layouts/MainLayout'
import Auth from './pages/Auth'
import MapPage from './pages/Map'
import Feed from './pages/Feed'
import NewSpot from './pages/NewSpot'
import Events from './pages/Events'
import NewEvent from './pages/NewEvent'
import Profile from './pages/Profile'
import UpdatePrompt from './components/UpdatePrompt'

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
      <UpdatePrompt />
      <Routes>
        <Route
          path="/auth"
          element={session ? <Navigate to="/" replace /> : <Auth />}
        />
        <Route
          element={session ? <MainLayout /> : <Navigate to="/auth" replace />}
        >
          <Route path="/" element={<MapPage />} />
          <Route path="/feed" element={<Feed />} />
          <Route path="/new-spot" element={<NewSpot />} />
          <Route path="/events" element={<Events />} />
          <Route path="/new-event" element={<NewEvent />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
