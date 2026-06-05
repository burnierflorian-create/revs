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

// iOS non-Safari detection — all iOS browsers run on WebKit but each
// embedded webview / 3rd-party browser tags its own UA marker. If we
// see one of these, the user is on iPhone but NOT in real Safari, so
// the "Add to Home Screen" action doesn't apply — they need to open
// the link in Safari first.
function isIOSNonSafari(): boolean {
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua)
  if (!isIOS) return false
  return /CriOS|FxiOS|EdgiOS|OPiOS|WhatsApp|FBAN|FBAV|Instagram|Snapchat|Line|MicroMessenger/.test(
    ua,
  )
}

export default function InstallBanner() {
  const [platform, setPlatform] = useState<
    'android' | 'ios-safari' | 'ios-non-safari' | null
  >(null)
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  )

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY) === '1') return

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    if (isIOS) {
      setPlatform(isIOSNonSafari() ? 'ios-non-safari' : 'ios-safari')
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
    <div className="fixed inset-x-3 bottom-24 z-40 flex items-center gap-3 rounded-2xl border border-fg/10 bg-card px-4 py-3 shadow-lg shadow-black/50">
      {platform === 'android' ? (
        <>
          <span className="flex-1 text-sm text-fg">
            📱 Installe revs sur ton écran d'accueil
          </span>
          <button
            onClick={install}
            className="rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-fg"
          >
            Installer
          </button>
        </>
      ) : platform === 'ios-non-safari' ? (
        <span className="flex-1 text-sm text-fg">
          🧭 Ouvre ce lien dans Safari pour installer REVS sur ton
          écran d'accueil.
        </span>
      ) : (
        <span className="flex-1 text-sm text-fg">
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
