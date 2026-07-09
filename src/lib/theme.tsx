import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

/** App theme — stamped on <html> via class="dark" or class="light"
 *  so Tailwind's `darkMode: 'class'` setting picks it up AND the CSS
 *  variables in design-system.css under `html.light` activate. */
export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'revs-theme'

type ThemeCtxValue = {
  theme: Theme
  setTheme: (next: Theme) => void
  toggle: () => void
}

const ThemeCtx = createContext<ThemeCtxValue>({
  theme: 'dark',
  setTheme: () => {},
  toggle: () => {},
})

/** True when the user has explicitly picked a theme (persisted via the
 *  Settings toggle). While false, the app follows the OS preference and
 *  live-updates when the system flips light↔dark. */
function hasManualChoice(): boolean {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark'
  } catch {
    return false
  }
}

/** The OS-level preference. Defaults to dark — REVS' core identity is
 *  dark (motorsport / car culture) — so a device with no media-query
 *  support still lands on the brand default. */
function systemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'
}

/** Persisted explicit choice wins; otherwise follow the OS preference. */
function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  if (hasManualChoice()) {
    return window.localStorage.getItem(STORAGE_KEY) as Theme
  }
  return systemTheme()
}

function applyToDocument(theme: Theme): void {
  if (typeof document === 'undefined') return
  const html = document.documentElement
  html.classList.remove('dark', 'light')
  html.classList.add(theme)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme)

  // Stamp the class on <html> on mount + every change so CSS-var
  // overrides + Tailwind dark: prefixes resolve correctly.
  useEffect(() => {
    applyToDocument(theme)
  }, [theme])

  // Live-follow the OS preference — but only while the user hasn't made
  // an explicit choice. Once they flip the Settings toggle, that choice
  // is persisted and wins; this listener becomes a no-op for them.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (e: MediaQueryListEvent) => {
      if (hasManualChoice()) return
      setThemeState(e.matches ? 'light' : 'dark')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  function setTheme(next: Theme) {
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* swallow — quota / private mode */
    }
    setThemeState(next)
  }

  function toggle() {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <ThemeCtx.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeCtx.Provider>
  )
}

/** Hook for consumers. Returns the current theme + setter + toggle.
 *  Safe to call outside the provider (defaults to dark) so the
 *  initial render before mount doesn't throw. */
export function useTheme(): ThemeCtxValue {
  return useContext(ThemeCtx)
}
