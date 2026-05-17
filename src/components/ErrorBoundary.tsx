import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean }

// A render error must not blank the whole app forever. This catches it,
// shows a recoverable screen, and best-effort clears a stale service
// worker / caches so a reload isn't stuck on the same broken bundle.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App crashed:', error, info)
    try {
      navigator.serviceWorker?.getRegistrations().then((regs) => {
        for (const r of regs) r.unregister()
      })
      if ('caches' in window) {
        caches.keys().then((keys) => {
          for (const k of keys) caches.delete(k)
        })
      }
    } catch {
      /* recovery is best-effort */
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-bg px-8 text-center text-fg">
        <h1 className="text-xl font-semibold">Une erreur est survenue</h1>
        <p className="max-w-xs text-sm text-fg/60">
          L’app a rencontré un problème. Recharge pour repartir d’une version
          propre.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-full bg-accent px-7 py-3 text-sm font-medium"
        >
          Recharger
        </button>
      </div>
    )
  }
}
