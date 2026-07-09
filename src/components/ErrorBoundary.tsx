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

  // Named handler bound to `this` once at construction time so the
  // minifier renaming the inline arrow can't strand the click target.
  private handleReload = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div
        className="flex min-h-screen select-none flex-col items-center justify-center bg-bg p-6 text-center"
        style={{
          paddingTop: 'max(2rem, env(safe-area-inset-top))',
          paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
        }}
      >
        <div
          className="mb-5 flex h-16 w-16 items-center justify-center rounded-full"
          style={{
            background: 'rgba(232, 32, 58, 0.10)',
            border: '1px solid rgba(232, 32, 58, 0.30)',
            fontSize: '26px',
          }}
        >
          ⚠️
        </div>
        <h1
          className="font-display font-extrabold tracking-tight text-fg"
          style={{ fontSize: '22px', letterSpacing: '-0.02em' }}
        >
          Une petite mise au point est nécessaire
        </h1>
        <p
          className="mx-auto mt-2.5 max-w-[18rem] leading-relaxed text-fg/55"
          style={{ fontSize: '13px' }}
        >
          L'application a rencontré une anomalie technique mineure. Pas
          d'inquiétude, tes données sont en sécurité.
        </p>
        <button
          onClick={this.handleReload}
          className="mt-7 rounded-xl font-bold text-fg transition-transform active:scale-95"
          style={{
            padding: '12px 24px',
            fontSize: '13px',
            background: 'rgb(var(--color-card))',
            border: '1px solid rgb(var(--color-fg) / 0.10)',
            backdropFilter: 'saturate(160%) blur(12px)',
          }}
        >
          Actualiser REVS
        </button>
      </div>
    )
  }
}
