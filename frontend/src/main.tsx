import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { OnboardingPage } from './pages/OnboardingPage.tsx'
import { ProfilePage } from './pages/ProfilePage.tsx'
import { TargetsPage } from './pages/TargetsPage.tsx'
import { UploadPage } from './pages/UploadPage.tsx'
import { PurchasesPage } from './pages/PurchasesPage.tsx'
import { ResultsPage } from './pages/ResultsPage.tsx'
import { RecipeChatPage } from './pages/RecipeChatPage.tsx'
import { RecipesPage } from './pages/RecipesPage.tsx'

// v1 flow: Onboarding -> Targets -> Upload -> Results (Epic 0.1 / Epic 7.3),
// plus Profile (edit an existing profile directly) and Purchases (browse
// everything uploaded so far) as post-launch additions.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<OnboardingPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="targets" element={<TargetsPage />} />
          <Route path="upload" element={<UploadPage />} />
          <Route path="purchases" element={<PurchasesPage />} />
          <Route path="results" element={<ResultsPage />} />
          <Route path="recipes" element={<RecipesPage />} />
          <Route path="recipes/new" element={<RecipeChatPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
