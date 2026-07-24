/**
 * "Log in" is just picking a profile by name -- no passwords yet
 * (multi-user feature). The chosen profiles.id is remembered here and sent
 * as an X-Profile-Id header on every request (see api.ts's `request()`),
 * the one seam that later swaps this localStorage id for a real session.
 */

const STORAGE_KEY = 'naehrbert.profileId'

export function getCurrentProfileId(): number | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  const id = Number(raw)
  return Number.isFinite(id) ? id : null
}

export function setCurrentProfileId(id: number | null): void {
  if (id === null) {
    localStorage.removeItem(STORAGE_KEY)
  } else {
    localStorage.setItem(STORAGE_KEY, String(id))
  }
}
