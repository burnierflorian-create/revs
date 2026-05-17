import { useLocation, useNavigate } from 'react-router-dom'
import { Camera } from 'lucide-react'

// Hidden inside the creation flow itself (a "go to camera" FAB there
// would be redundant and overlap the step UI).
const HIDDEN_ON = ['/new-spot', '/new-event']

export default function SpotFab() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  if (HIDDEN_ON.includes(pathname)) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom) + 5rem + 0.75rem)',
      }}
    >
      <button
        onClick={() => navigate('/new-spot')}
        aria-label="Spotter une voiture"
        className="pointer-events-auto flex h-14 w-14 animate-pulse-soft items-center justify-center rounded-full bg-accent text-fg shadow-lg shadow-black/40 active:opacity-90"
      >
        <Camera className="h-7 w-7" />
      </button>
    </div>
  )
}
