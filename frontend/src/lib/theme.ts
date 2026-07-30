/**
 * Theme preference: the user's explicit choice for the app's color scheme.
 *
 * - 'system' — follow the OS (`prefers-color-scheme`); no `data-theme`
 *   attribute is set, so the media-query branch in index.css drives the tokens.
 * - 'light' / 'dark' — force that scheme regardless of the OS, via a
 *   `data-theme` attribute on <html> that index.css keys off.
 *
 * Persisted in localStorage so the choice survives reloads and is shared
 * across tabs.
 */
export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'nutriwise-theme'

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

/** The stored preference, defaulting to 'system' when nothing valid is saved. */
export function getStoredTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isThemePreference(stored) ? stored : 'system'
  } catch {
    // localStorage can throw in private mode / when disabled.
    return 'system'
  }
}

/**
 * Reflect a preference onto <html> so index.css picks it up. 'system' removes
 * the attribute entirely so the OS media query takes over again.
 */
export function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement
  if (pref === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', pref)
  }
}

/** Persist and apply a preference. */
export function setTheme(pref: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // Persistence is best-effort; still apply for this session.
  }
  applyTheme(pref)
}

/** Apply the stored preference. Call once at startup, before React renders. */
export function initTheme(): void {
  applyTheme(getStoredTheme())
}
