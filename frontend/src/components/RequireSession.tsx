import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/authContext'

// Gate for /onboarding: needs a real login, but -- unlike RequireProfile
// -- must NOT already have a linked profile. An already-profiled account
// landing here (e.g. by typing the URL directly) is bounced to the app
// proper rather than risking onboarding's submit() silently overwriting
// their real profile in place (create_profile upserts onto whatever
// profile this account already has).
export function RequireSession() {
  const { status } = useAuth()

  if (status === 'loading') return null
  if (status === 'signed-out') return <Navigate to="/" replace />
  if (status === 'ready') return <Navigate to="/results" replace />
  return <Outlet />
}
