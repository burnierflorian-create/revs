import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './i18n'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        <SplashScreen />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
