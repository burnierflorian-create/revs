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

/** Reads the persisted choice or falls back to dark. The system
 *  preference query is intentionally skipped — REVS' default identity
 *  is dark (motorsport / car culture), so we don't want a new user
 *  who has prefers-color-scheme:light to land on the half-finished
 *  light surfaces unless they explicitly opt in. */
function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    /* localStorage unavailable — fall through */
  }
  return 'dark'
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
