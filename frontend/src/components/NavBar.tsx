import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/authContext'
import { Logo } from './Logo'

// Persistent nav across all logged-in routes, incl. "Results" (Epic 7.3) so
// users can get back to their latest analysis at any time without
// re-entering data. "Onboarding" was dropped from here (multi-user
// feature): it's now the sign-up flow reached from the login screen's
// "Add new user" button, not a page an already-logged-in user revisits.
// "Profile" lives as its own icon on the far right, not in this list.
type NavIconName = 'upload' | 'results' | 'pantry' | 'recipes'

// Labels are language-dependent, so the list is built inside the component
// from the active t(). Structure (to/icon) is otherwise static.
function navLinks(t: (en: string, de: string) => string) {
  return [
    { to: '/upload', label: t('Upload', 'Upload'), icon: 'upload' as const },
    { to: '/results', label: t('Insights', 'Insights'), icon: 'results' as const },
    { to: '/pantry', label: t('Pantry', 'Vorrat'), icon: 'pantry' as const },
    { to: '/tips', label: t('Recipes', 'Rezepte'), icon: 'recipes' as const },
  ]
}

// Thin inline line-icons in the same family as the profile icon and the leaf
// logo (stroke=currentColor, no fill, round caps) -- so they inherit the link
// colour, including the light tone on the active green pill. Decorative: the
// label carries the accessible name.
function NavIcon({ name }: { name: NavIconName }) {
  const props = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  switch (name) {
    case 'upload': // plus = add (a new receipt / data)
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v8" />
          <path d="M8 12h8" />
        </svg>
      )
    case 'results': // ascending bar chart
      return (
        <svg {...props}>
          <path d="M5 20v-7" />
          <path d="M12 20V8" />
          <path d="M19 20V4" />
        </svg>
      )
    case 'pantry': // shopping basket
      return (
        <svg {...props}>
          <path d="m5 11 4-7" />
          <path d="m19 11-4-7" />
          <path d="M2 11h20" />
          <path d="m3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.6-7.4" />
          <path d="m9 11 1 9" />
          <path d="m15 11-1 9" />
        </svg>
      )
    case 'recipes': // open book
      return (
        <svg {...props}>
          <path d="M12 7v13" />
          <path d="M12 7C10.3 5.3 7.5 4.7 4 5v12c3.5-.3 6.3.3 8 2" />
          <path d="M12 7c1.7-1.7 4.5-2.3 8-2v12c-3.5-.3-6.3.3-8 2" />
        </svg>
      )
  }
}

export function NavBar() {
  const { t } = useI18n()

  // useLocation() ties this read to the router's own location context, so
  // it's re-evaluated on every navigation (login/logout always navigate
  // right after the auth context updates) rather than depending on NavBar
  // happening to re-render for some other incidental reason.
  useLocation()
  const { status } = useAuth()

  // No nav chrome on the login/claim/onboarding screens -- nothing there
  // to link to yet (RequireProfile would just bounce every link straight
  // back here).
  if (status !== 'ready') return null

  const NAV_LINKS = navLinks(t)

  return (
    // Full-width sticky header (CI §6): the bar itself spans the viewport so its
    // background/hairline cover the full width when content scrolls under it,
    // while the inner .nav-bar keeps content in the centred reading column.
    <header className="nav-header">
      <nav className="nav-bar">
        {/* Brand lockup (CI §1): leaf badge + "NutriWise" wordmark. The leaf is
          decorative; the wordmark provides the accessible brand name. */}
        <span className="nav-brand">
          <span className="nav-logo">
            <Logo size={18} />
          </span>
          <span className="nav-wordmark">{t('NutriWise', 'NutriWise')}</span>
        </span>

        {/* Two separate pills: Upload (the "add data" action) stands alone in
            its own ring, set apart from the analysis views that follow. */}
        <div className="nav-tabs">
          <ul className="nav-links nav-links--solo">
            {NAV_LINKS.filter((l) => l.to === '/upload').map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  className={({ isActive }) =>
                    isActive ? 'nav-link nav-link--active' : 'nav-link'
                  }
                >
                  <NavIcon name={link.icon} />
                  <span className="nav-link__label">{link.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>

          <ul className="nav-links">
            {NAV_LINKS.filter((l) => l.to !== '/upload').map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  className={({ isActive }) =>
                    isActive ? 'nav-link nav-link--active' : 'nav-link'
                  }
                >
                  <NavIcon name={link.icon} />
                  <span className="nav-link__label">{link.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>

        <NavLink
          to="/profile"
          aria-label={t('Profile', 'Profil')}
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
    </header>
  )
}
