import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/authContext'

// Every route nested under this one needs a real login AND a linked
// profile. "loading" renders nothing rather than flashing a redirect
// while the very first session check is still in flight.
export function RequireProfile() {
  const { status } = useAuth()

  if (status === 'loading') return null
  if (status === 'signed-out') return <Navigate to="/" replace />
  if (status === 'no-profile') return <Navigate to="/onboarding" replace />
  return <Outlet />
}
