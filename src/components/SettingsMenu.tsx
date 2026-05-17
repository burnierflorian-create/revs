import { X } from 'lucide-react'

export default function SettingsMenu({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  if (!open) return null

  function resetOnboarding() {
    try {
      localStorage.removeItem('revs_onboarded')
      localStorage.removeItem('revs_profile_done')
    } catch {
      /* storage may be unavailable — reload anyway */
    }
    window.location.reload()
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-card p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fg">Paramètres</h2>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="text-fg/40 transition-colors hover:text-fg"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <button
          onClick={resetOnboarding}
          className="mt-5 w-full rounded-full bg-accent py-3 text-sm font-medium text-fg"
        >
          Effacer le cache et relancer l'onboarding
        </button>
        <p className="mt-2 text-center text-xs text-fg/40">
          Réinitialise l'onboarding (pseudo / ville) et recharge l'app.
        </p>
      </div>
    </div>
  )
}
