import { useEffect, useState } from 'react'
import { Share, X } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'revs-install-dismissed'

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  )
}

export default function InstallBanner() {
  const [platform, setPlatform] = useState<'android' | 'ios' | null>(null)
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  )

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY) === '1') return

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    if (isIOS) {
      setPlatform('ios')
      return
    }

    function onPrompt(e: Event) {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setPlatform('android')
    }
    function onInstalled() {
      setPlatform(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setPlatform(null)
  }

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    setDeferred(null)
    setPlatform(null)
  }

  if (!platform) return null

  return (
    <div className="fixed inset-x-3 bottom-24 z-40 flex items-center gap-3 rounded-2xl border border-white/10 bg-[#1a1a1a] px-4 py-3 shadow-lg shadow-black/50">
      {platform === 'android' ? (
        <>
          <span className="flex-1 text-sm text-white">
            📱 Installe revs sur ton écran d'accueil
          </span>
          <button
            onClick={install}
            className="rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-white"
          >
            Installer
          </button>
        </>
      ) : (
        <span className="flex-1 text-sm text-white">
          📱 Pour installer : appuie sur{' '}
          <Share className="mx-1 inline h-4 w-4 align-text-bottom" /> puis « Sur
          l'écran d'accueil »
        </span>
      )}
      <button
        onClick={dismiss}
        aria-label="Fermer"
        className="flex-none text-fg/40 transition-colors hover:text-fg"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
