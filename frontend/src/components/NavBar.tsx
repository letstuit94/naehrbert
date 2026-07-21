import { NavLink } from 'react-router-dom'

// Persistent nav across all routes, incl. "Results" (Epic 7.3) so users can
// get back to their latest analysis at any time without re-entering data.
const NAV_LINKS = [
  { to: '/', label: 'Onboarding' },
  { to: '/profile', label: 'Profile' },
  { to: '/upload', label: 'Upload' },
  { to: '/purchases', label: 'Purchases' },
  { to: '/results', label: 'Results' },
]

export function NavBar() {
  return (
    <nav className="nav-bar">
      <span className="nav-brand">naehrbert</span>
      <ul className="nav-links">
        {NAV_LINKS.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              end={link.to === '/'}
              className={({ isActive }) =>
                isActive ? 'nav-link nav-link--active' : 'nav-link'
              }
            >
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
