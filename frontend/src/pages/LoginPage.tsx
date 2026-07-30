import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/authContext'
import { supabase } from '../lib/supabaseClient'
import { useI18n } from '../lib/i18n'
import { Logo } from '../components/Logo'

type Mode = 'sign_in' | 'sign_up'

// Real Google + email auth (Supabase Auth), replacing the old "pick a
// user from a list, no password" screen.
//
// This route (the "/" index route) is deliberately NOT wrapped by
// RequireProfile/RequireSession -- it's the one place someone with no
// session at all needs to land. That means it's also the one place that
// has to actively redirect itself away once a session appears, rather
// than relying on a wrapping gate: Google sign-in is a full-page redirect
// away to Google and back (there's no synchronous "call finishes, now
// navigate" moment the way email/password has), so it lands back on this
// same "/" route with a fresh session that nothing else would ever notice.
// Reacting to the auth context here handles both paths uniformly.
export function LoginPage() {
  const { status } = useAuth()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [mode, setMode] = useState<Mode>('sign_in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkEmail, setCheckEmail] = useState(false)

  useEffect(() => {
    if (status === 'ready') navigate('/results', { replace: true })
    else if (status === 'no-profile') navigate('/onboarding', { replace: true })
  }, [status, navigate])

  function switchMode() {
    setMode((m) => (m === 'sign_in' ? 'sign_up' : 'sign_in'))
    setError(null)
    setCheckEmail(false)
  }

  async function continueWithGoogle() {
    setError(null)
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    // On success the browser is redirected away to Google -- there's
    // nothing else to do here; the useEffect above picks up the session
    // once Google/Supabase redirect back. An error (e.g. the provider not
    // being enabled) surfaces immediately, before any redirect happens.
    if (oauthError) setError(oauthError.message)
  }

  async function submitEmail(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setCheckEmail(false)
    try {
      if (mode === 'sign_up') {
        const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
        if (signUpError) throw signUpError
        if (!data.session) {
          // "Confirm email" is on for this project -- no session until the
          // confirmation link is clicked.
          setCheckEmail(true)
        }
        // If a session DID come back (confirm-email off), the useEffect
        // above picks it up -- no explicit navigate needed here either.
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (signInError) throw signInError
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Could not sign in. Please try again.', 'Anmeldung nicht möglich. Bitte versuche es erneut.'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="login-screen">
      <span className="login-logo">
        <span className="login-logo__badge">
          <Logo size={30} />
        </span>
        <span className="login-logo__word">NutriWise</span>
      </span>

      <div className="login-users">
        <button type="button" className="btn login-user-btn" onClick={continueWithGoogle}>
          {t('Continue with Google', 'Mit Google fortfahren')}
        </button>

        <p className="login-divider">{t('or', 'oder')}</p>

        <form onSubmit={submitEmail} className="login-email-form">
          <input
            type="email"
            placeholder={t('Email', 'E-Mail')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="login-input"
            aria-label={t('Email', 'E-Mail')}
          />
          <input
            type="password"
            placeholder={t('Password', 'Passwort')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === 'sign_up' ? 'new-password' : 'current-password'}
            className="login-input"
            aria-label={t('Password', 'Passwort')}
          />
          <button type="submit" className="btn btn-primary btn--block" disabled={busy}>
            {busy
              ? t('Please wait…', 'Bitte warten…')
              : mode === 'sign_up'
                ? t('Create account', 'Konto erstellen')
                : t('Sign in', 'Anmelden')}
          </button>
        </form>

        {checkEmail && (
          <p className="muted">
            {t(
              'Check your email to confirm your account, then sign in.',
              'Bestätige dein Konto über die E-Mail, die wir dir geschickt haben, und melde dich anschließend an.',
            )}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button type="button" className="btn-link" onClick={switchMode}>
          {mode === 'sign_in'
            ? t("Don't have an account? Sign up", 'Noch kein Konto? Registrieren')
            : t('Already have an account? Sign in', 'Schon ein Konto? Anmelden')}
        </button>
      </div>
    </section>
  )
}
