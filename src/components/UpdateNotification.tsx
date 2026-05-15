import { useRegisterSW } from 'virtual:pwa-register/react'
import { X } from 'lucide-react'

export default function UpdateNotification() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-accent bg-[#1a1a1a] px-4 py-3 text-sm shadow-lg shadow-black/50">
      <span className="text-white">🔄 Nouvelle version disponible</span>
      <button
        onClick={() => updateServiceWorker(true)}
        className="rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-white"
      >
        Mettre à jour
      </button>
      <button
        onClick={() => setNeedRefresh(false)}
        aria-label="Fermer"
        className="text-fg/40 transition-colors hover:text-fg"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
