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
import { BasketPage } from './pages/BasketPage.tsx'
import { ResultsPage } from './pages/ResultsPage.tsx'
import { RecipeChatPage } from './pages/RecipeChatPage.tsx'

// v1 flow: Login (pick a user or sign up) -> Onboarding -> Upload ->
// Basket / Results (Epic 0.1 / Epic 7.3 / multi-user feature), plus Profile
// (edit an existing profile directly). The Purchases page (browse everything
// uploaded) is currently hidden -- its route + nav link were removed; the
// page component is kept for easy restore. Targets and the standalone Recipes
// page were folded into Results (targets/macro comparison, recipe generation,
// and the recipe list all live there now). Everything except Login/
// Onboarding requires a logged-in profile (RequireProfile).
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
            <Route path="basket" element={<BasketPage />} />
            <Route path="results" element={<ResultsPage />} />
            <Route path="recipes/new" element={<RecipeChatPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
