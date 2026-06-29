import { StrictMode, useEffect, useReducer } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import './index.css'
import i18n from './i18n'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import SplashScreen from './components/SplashScreen.tsx'
import { ThemeProvider } from './lib/theme'
import { stashPendingReferral } from './lib/referrals'

// Capture a ?ref=CODE deep-link (from shared collector-card images) before
// React mounts, so it survives the signup / email-confirmation hop and the
// existing claim flow credits +50 XP to both users. Only 6-char codes are
// kept (the referral system is code-based).
try {
  const ref = new URLSearchParams(window.location.search).get('ref')
  if (ref) stashPendingReferral(ref)
} catch {
  /* ignore */
}

// Root wrapper — provides the explicit i18n instance to the whole tree AND
// forces a re-render of everything on every language change. This is the
// guarantee that EVERY t() re-evaluates instantly (no reload), even if a
// given component didn't individually subscribe via useTranslation. It
// re-renders in place (no remount), so component state — including the
// onboarding's current step — is preserved across the switch.
// eslint-disable-next-line react-refresh/only-export-components
function Root() {
  const [, force] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    i18n.on('languageChanged', force)
    return () => {
      i18n.off('languageChanged', force)
    }
  }, [])
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        <SplashScreen />
      </ThemeProvider>
    </I18nextProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
)
