import { Navigate, Outlet } from 'react-router-dom'
import { getCurrentProfileId } from '../lib/session'

// Every route nested under this one needs a logged-in profile (multi-user
// feature) -- bounce back to the login/user-overview screen otherwise.
export function RequireProfile() {
  return getCurrentProfileId() !== null ? <Outlet /> : <Navigate to="/" replace />
}
