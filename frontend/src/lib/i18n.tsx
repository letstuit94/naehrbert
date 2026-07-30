/**
 * App language: the user's choice of UI language (Epic: multilingual).
 *
 * The app ships English and German. Unlike the (build-time, single-language)
 * v1, strings are now co-located with their call site via the `t(en, de)`
 * translate function returned by {@link useI18n} -- no central key dictionary,
 * so a string and both its renderings live together and can't drift apart.
 *
 * The choice is persisted in localStorage (mirroring lib/theme.ts) so it
 * survives reloads and is shared across tabs, and it's reflected onto the
 * <html lang> attribute for correct hyphenation / screen-reader pronunciation.
 * It's edited from the Profile page's "Language" card, the same way the theme
 * is.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'

export type Lang = 'en' | 'de'

const STORAGE_KEY = 'nutriwise-lang'

function isLang(value: string | null): value is Lang {
  return value === 'en' || value === 'de'
}

/** The stored language, or -- on first visit -- the browser's preferred one
 * (German if the browser asks for any `de-*`, English otherwise). */
export function getStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLang(stored)) return stored
    const preferred = navigator.language?.toLowerCase() ?? ''
    return preferred.startsWith('de') ? 'de' : 'en'
  } catch {
    // localStorage can throw in private mode / when disabled.
    return 'en'
  }
}

/** Reflect the language onto <html lang> for a11y / hyphenation. */
export function applyLang(lang: Lang): void {
  document.documentElement.setAttribute('lang', lang)
}

function storeLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Persistence is best-effort; still apply for this session.
  }
  applyLang(lang)
}

/** Apply the stored language. Call once at startup, before React renders. */
export function initLang(): void {
  applyLang(getStoredLang())
}

/**
 * Pick the string for the active language.
 *
 *   const { t } = useI18n()
 *   <button>{t('Save', 'Speichern')}</button>
 *
 * `de` is required so a translation is never accidentally forgotten -- passing
 * the same string twice is the explicit "identical in both languages" signal.
 */
export type TranslateFn = (en: string, de: string) => string

interface I18nContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: TranslateFn
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getStoredLang)

  const setLang = useCallback((next: Lang) => {
    storeLang(next)
    setLangState(next)
  }, [])

  // Keep tabs in sync: another tab changing the language updates this one too.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY && isLang(e.newValue)) {
        applyLang(e.newValue)
        setLangState(e.newValue)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const t = useCallback<TranslateFn>((en, de) => (lang === 'de' ? de : en), [lang])

  const value = useMemo<I18nContextValue>(
    () => ({ lang, setLang, t }),
    [lang, setLang, t],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/** Access the active language, a setter, and the `t(en, de)` translate fn.
 * Throws if used outside {@link I18nProvider}. */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider')
  return ctx
}
