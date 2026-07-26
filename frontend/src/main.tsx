import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { RequireProfile } from './components/RequireProfile.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { OnboardingPage } from './pages/OnboardingPage.tsx'
import { ProfilePage } from './pages/ProfilePage.tsx'
import { UploadPage } from './pages/UploadPage.tsx'
import { PantryPage } from './pages/PantryPage.tsx'
import { PurchasesPage } from './pages/PurchasesPage.tsx'
import { ResultsPage } from './pages/ResultsPage.tsx'
import { TipsPage } from './pages/TipsPage.tsx'
import { RecipeChatPage } from './pages/RecipeChatPage.tsx'

// v1 flow: Login (pick a user or sign up) -> Onboarding -> Upload ->
// Pantry / Results (Epic 0.1 / Epic 7.3 / multi-user feature), plus Profile
// (edit an existing profile directly). The Purchases page (browse everything
// uploaded) is currently hidden -- its route + nav link were removed; the
// page component is kept for easy restore. Results holds the analysis view
// (targets/macro comparison); recipe generation, the recipe list, and the
// "unlock recipes" gate live on the separate Tips page (nav label "Recipes",
// route /tips). Everything except Login/Onboarding requires a logged-in
// profile (RequireProfile).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<LoginPage />} />
          <Route path="onboarding" element={<OnboardingPage />} />
          <Route element={<RequireProfile />}>
            <Route path="profile" element={<ProfilePage />} />
            <Route path="upload" element={<UploadPage />} />
            <Route path="pantry" element={<PantryPage />} />
            <Route path="purchases" element={<PurchasesPage />} />
            <Route path="results" element={<ResultsPage />} />
            <Route path="tips" element={<TipsPage />} />
            <Route path="recipes/new" element={<RecipeChatPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
