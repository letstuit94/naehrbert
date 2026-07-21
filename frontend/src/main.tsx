import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { OnboardingPage } from './pages/OnboardingPage.tsx'
import { TargetsPage } from './pages/TargetsPage.tsx'
import { UploadPage } from './pages/UploadPage.tsx'
import { ResultsPage } from './pages/ResultsPage.tsx'

// Exactly 4 routes for the v1 flow: Onboarding -> Targets -> Upload -> Results
// (see instructions/clean_rebuild_epics.md, Epic 0.1 / Epic 7.3).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<OnboardingPage />} />
          <Route path="targets" element={<TargetsPage />} />
          <Route path="upload" element={<UploadPage />} />
          <Route path="results" element={<ResultsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
