import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
// Self-hosted Instrument Sans (CI §4): Fontsource bundles the woff2 + @font-face
// locally, so the font ships in our own build -- no runtime Google Fonts request
// (GDPR / performance / offline). Variable font, weight range 400..700.
import '@fontsource-variable/instrument-sans'
import './index.css'
import { initTheme } from './lib/theme.ts'
import { initLang, I18nProvider } from './lib/i18n.tsx'
import App from './App.tsx'
import { AuthProvider } from './lib/authContext.tsx'
import { RequireProfile } from './components/RequireProfile.tsx'
import { RequireSession } from './components/RequireSession.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { OnboardingPage } from './pages/OnboardingPage.tsx'
import { ProfilePage } from './pages/ProfilePage.tsx'
import { UploadPage } from './pages/UploadPage.tsx'
import { PantryPage } from './pages/PantryPage.tsx'
import { PurchasesPage } from './pages/PurchasesPage.tsx'
import { ResultsPage } from './pages/ResultsPage.tsx'
import { TipsPage } from './pages/TipsPage.tsx'
import { RecipeChatPage } from './pages/RecipeChatPage.tsx'

// v1 flow: Login (Google/email, Supabase Auth) -> Onboarding -> Upload ->
// Pantry / Results, plus Profile (edit an existing profile directly). The
// Purchases page (browse everything uploaded) is currently hidden -- its
// route + nav link were removed; the page component is kept for easy
// restore. Results holds the analysis view (targets/macro comparison);
// recipe generation, the recipe list, and the "unlock recipes" gate live
// on the separate Tips page (nav label "Recipes", route /tips).
//
// Two auth tiers (lib/authContext.tsx): RequireProfile needs a session AND
// a linked profile; RequireSession (onboarding only) needs a session but
// must NOT already have one -- an already-profiled account is bounced
// past it, not into it. The login route itself needs neither.
//
// Apply the saved theme + language before the first render so an explicit
// light/dark choice doesn't flash the OS default first, and <html lang> is
// correct from the very first paint.
initTheme()
initLang()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<App />}>
              <Route index element={<LoginPage />} />
              <Route element={<RequireSession />}>
                <Route path="onboarding" element={<OnboardingPage />} />
              </Route>
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
        </AuthProvider>
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
)
