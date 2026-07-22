import { NavLink, useLocation } from 'react-router-dom'
import { getCurrentProfileId } from '../lib/session'

// Persistent nav across all logged-in routes, incl. "Results" (Epic 7.3) so
// users can get back to their latest analysis at any time without
// re-entering data. "Onboarding" was dropped from here (multi-user
// feature): it's now the sign-up flow reached from the login screen's
// "Add new user" button, not a page an already-logged-in user revisits.
// "Profile" lives as its own icon on the far right, not in this list.
const NAV_LINKS = [
  { to: '/upload', label: 'Upload' },
  { to: '/purchases', label: 'Purchases' },
  { to: '/results', label: 'Results' },
]

export function NavBar() {
  // useLocation() ties this read to the router's own location context, so
  // it's re-evaluated on every navigation (login/logout always navigate
  // right after changing the stored profile id) rather than depending on
  // NavBar happening to re-render for some other incidental reason.
  useLocation()

  // No nav chrome on the login/sign-up screens -- nothing there to link to
  // yet (RequireProfile would just bounce every link straight back here).
  if (getCurrentProfileId() === null) return null

  return (
    <nav className="nav-bar">
      <span className="nav-logo" role="img" aria-label="naehrbert">
        N
      </span>

      <ul className="nav-links">
        {NAV_LINKS.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              className={({ isActive }) =>
                isActive ? 'nav-link nav-link--active' : 'nav-link'
              }
            >
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>

      <NavLink
        to="/profile"
        aria-label="Profile"
        className={({ isActive }) =>
          isActive ? 'nav-profile-icon nav-profile-icon--active' : 'nav-profile-icon'
        }
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
          <path
            d="M4 20c0-3.31 3.58-6 8-6s8 2.69 8 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </NavLink>
    </nav>
  )
}
