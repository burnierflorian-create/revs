import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import fr from './locales/fr.json'
import en from './locales/en.json'

// App i18n — two languages, no extra detector dependency. The chosen
// language is the SINGLE source of truth in localStorage ('i18nextLng');
// it is also mirrored onto profiles.language in Supabase (best-effort,
// for cross-device continuity) but localStorage is what drives the UI so
// the first paint never waits on the network.

export const SUPPORTED_LANGS = ['fr', 'en'] as const
export type Lang = (typeof SUPPORTED_LANGS)[number]

// i18next's conventional localStorage key, so the value is portable.
const STORAGE_KEY = 'i18nextLng'
// Legacy key used by the first cut — read once for migration.
const LEGACY_KEY = 'revs_lang'

export function isLang(v: unknown): v is Lang {
  return v === 'fr' || v === 'en'
}

// localStorage first (current then legacy), then the browser's preferred
// language, else French.
function detectInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLang(stored)) return stored
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (isLang(legacy)) return legacy
  } catch {
    /* ignore — private mode / blocked storage */
  }
  try {
    const nav = (navigator.language || '').slice(0, 2).toLowerCase()
    if (nav === 'en') return 'en'
  } catch {
    /* ignore */
  }
  return 'fr'
}

const initial = detectInitialLang()

function applyHtmlLang(lng: string) {
  try {
    document.documentElement.lang = lng
  } catch {
    /* ignore — SSR / no DOM */
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en },
  },
  lng: initial,
  fallbackLng: 'fr',
  supportedLngs: SUPPORTED_LANGS as unknown as string[],
  interpolation: { escapeValue: false },
  returnNull: false,
  // No Suspense — resources are bundled inline, so there is nothing to
  // await; this avoids any React 19 suspense edge case on first render.
  react: { useSuspense: false },
})

applyHtmlLang(initial)

// Persist + mirror <html lang> on every change so a switch from anywhere
// (onboarding, settings) is durable and accessible.
i18n.on('languageChanged', (lng) => {
  applyHtmlLang(lng)
  try {
    localStorage.setItem(STORAGE_KEY, lng)
  } catch {
    /* ignore */
  }
})

// Imperative setter used by the onboarding language step and the Settings
// switcher. Writes localStorage immediately (changeLanguage also triggers
// the listener above, but we set it here too so the value is present even
// if the event loop is interrupted).
export function setLanguage(lng: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lng)
  } catch {
    /* ignore */
  }
  void i18n.changeLanguage(lng)
}

export function currentLang(): Lang {
  return isLang(i18n.language) ? i18n.language : 'fr'
}

export default i18n
