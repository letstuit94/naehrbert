import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { ApiError, getMe } from './api'
import { supabase } from './supabaseClient'

/**
 * Single source of truth for "who's logged in and do they have a profile
 * yet", replacing three places that used to each do their own ad-hoc
 * check (RequireProfile, the old RequireSession-shaped gates, NavBar).
 * Mounted once (main.tsx) around the whole router.
 *
 *   signed-out  -- no Supabase session at all -> routes to "/" (login)
 *   no-profile  -- valid session, but this account has no profiles row
 *                  yet -> routes to "/onboarding" to create one
 *   ready       -- valid session AND a linked profile -> the app proper
 */
export type AuthStatus = 'loading' | 'signed-out' | 'no-profile' | 'ready'

interface AuthContextValue {
  status: AuthStatus
  profileId: number | null
  /** Re-checks the session + linked-profile state. Call after claiming or
   * creating a profile so the app reflects it immediately, without a full
   * page reload. */
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [profileId, setProfileId] = useState<number | null>(null)

  async function refresh() {
    const { data } = await supabase.auth.getSession()
    if (!data.session) {
      setStatus('signed-out')
      setProfileId(null)
      return
    }
    try {
      const me = await getMe()
      setProfileId(me.profile_id)
      setStatus(me.profile_id !== null ? 'ready' : 'no-profile')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // The locally-stored session (getSession() above found *something*)
        // is one the backend actually rejects -- e.g. a refresh token that
        // expired while the tab sat open/backgrounded. Routing this to
        // "no-profile" used to send people straight into onboarding with a
        // session that can never actually save anything (every write hits
        // this same 401) and no way out, since onboarding has no sign-out
        // button. Clearing it and treating it as signed-out sends them back
        // to a normal, recoverable login instead.
        await supabase.auth.signOut()
        setProfileId(null)
        setStatus('signed-out')
        return
      }
      // Any other failure (e.g. a transient backend hiccup) shouldn't
      // silently claim "ready" without confirmation -- fall back to the
      // claim/create screen (the safer of the two non-ready states) rather
      // than pretending success.
      setProfileId(null)
      setStatus('no-profile')
    }
  }

  useEffect(() => {
    // onAuthStateChange fires once immediately with the current session on
    // subscribe (Supabase's own documented behavior), so this alone covers
    // both the initial load and every later sign-in/sign-out/token refresh
    // -- no separate first-load call needed.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void refresh()
    })
    return () => subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    setStatus('signed-out')
    setProfileId(null)
  }

  return (
    <AuthContext.Provider value={{ status, profileId, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
