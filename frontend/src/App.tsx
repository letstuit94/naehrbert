import { Outlet } from 'react-router-dom'
import { NavBar } from './components/NavBar.tsx'
import './App.css'

function App() {
  return (
    <div className="app-shell">
      <NavBar />
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  )
}

export default App
