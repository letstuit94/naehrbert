import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, listProfiles, type ProfileSummary } from '../lib/api'
import { setCurrentProfileId } from '../lib/session'
import { useI18n } from '../lib/i18n'
import { Logo } from '../components/Logo'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; profiles: ProfileSummary[] }

export function LoginPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const navigate = useNavigate()
  const { t } = useI18n()

  useEffect(() => {
    listProfiles()
      .then((profiles) => setState({ status: 'ready', profiles }))
      .catch((err) =>
        setState({
          status: 'error',
          message:
            err instanceof ApiError
              ? err.message
              : t('Could not load users.', 'Nutzer konnten nicht geladen werden.'),
        }),
      )
  }, [t])

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

      {state.status === 'loading' && <p className="muted">{t('Loading…', 'Wird geladen…')}</p>}

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
              {profile.name || t(`User #${profile.id}`, `Nutzer #${profile.id}`)}
            </button>
          ))}

          <button
            type="button"
            className="btn login-user-btn login-add-user-btn"
            onClick={() => navigate('/onboarding')}
          >
            {t('+ Add new user', '+ Neuen Nutzer hinzufügen')}
          </button>
        </div>
      )}
    </section>
  )
}
