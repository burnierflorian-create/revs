import { useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Camera } from 'lucide-react'
import { setPendingPhoto } from '../lib/pendingPhoto'

// Only on Carte and Accueil — not Feed, Actu, Events, Profil, etc.
const SHOWN_ON = ['/', '/map']

export default function SpotFab() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const inputRef = useRef<HTMLInputElement>(null)

  if (!SHOWN_ON.includes(pathname)) return null

  function onCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return // user cancelled the camera
    setPendingPhoto(file)
    navigate('/new-spot')
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom) + 5rem + 0.75rem)',
      }}
    >
      {/* Opening this input directly from the button's click gesture makes
          the native camera appear instantly — no intermediate screen. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onCapture}
        className="hidden"
      />
      <button
        onClick={() => inputRef.current?.click()}
        aria-label="Spotter une voiture"
        className="pointer-events-auto flex h-14 w-14 animate-pulse-soft items-center justify-center rounded-full bg-accent text-fg shadow-lg shadow-black/40 active:opacity-90"
      >
        <Camera className="h-7 w-7" />
      </button>
    </div>
  )
}
