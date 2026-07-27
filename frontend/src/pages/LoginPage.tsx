import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, listProfiles, type ProfileSummary } from '../lib/api'
import { setCurrentProfileId } from '../lib/session'
import { Logo } from '../components/Logo'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; profiles: ProfileSummary[] }

export function LoginPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const navigate = useNavigate()

  useEffect(() => {
    listProfiles()
      .then((profiles) => setState({ status: 'ready', profiles }))
      .catch((err) =>
        setState({
          status: 'error',
          message: err instanceof ApiError ? err.message : 'Could not load users.',
        }),
      )
  }, [])

  function logIn(profile: ProfileSummary) {
    setCurrentProfileId(profile.id)
    navigate('/results')
  }

  return (
    <section className="login-screen">
      <span className="login-logo">
        <span className="login-logo__badge">
          <Logo size={30} />
        </span>
        <span className="login-logo__word">NutriWise</span>
      </span>

      {state.status === 'loading' && <p className="muted">Loading…</p>}

      {state.status === 'error' && (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      )}

      {state.status === 'ready' && (
        <div className="login-users">
          {state.profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              className="btn login-user-btn"
              onClick={() => logIn(profile)}
            >
              {profile.name || `User #${profile.id}`}
            </button>
          ))}

          <button
            type="button"
            className="btn login-user-btn login-add-user-btn"
            onClick={() => navigate('/onboarding')}
          >
            + Add new user
          </button>
        </div>
      )}
    </section>
  )
}
