import { Outlet, useLocation } from 'react-router-dom'
import { NavBar } from './components/NavBar.tsx'
import './App.css'

function App() {
  // Re-key the Outlet on the pathname so the page-enter fade (§11) retriggers on
  // every navigation, smoothing the hard cut between routes.
  const { pathname } = useLocation()
  return (
    <div className="app-shell">
      <NavBar />
      <main className="app-content">
        <div className="page-enter" key={pathname}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}

export default App
