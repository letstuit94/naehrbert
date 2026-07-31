# naehrbert (NutriWise)

Calorie and nutrition optimizer based on grocery receipts. Upload a receipt (photo, PDF, or pasted text), and the app turns it into a pantry, tracks macros and micronutrients against personalized targets, and generates recipe/insight suggestions to close whatever gaps show up — all from what you actually buy, not manual food logging.

**Stack**
- **Backend**: FastAPI (Python 3.11), Supabase (Postgres + Auth), Groq (LLM-generated recipes and Insights suggestions), local OCR (Tesseract) for receipt text extraction, OpenFoodFacts + a German BLS food-composition table for nutrition data.
- **Frontend**: React 19 + TypeScript + Vite, React Router, Supabase Auth (Google + email/password).
- **Deployed at**: [naehrbert.vercel.app](https://naehrbert.vercel.app) (frontend on Vercel) + a FastAPI backend on Render.

---

## 1. Prerequisites

- **Node.js** 20+ and npm
- **Python** 3.11
- A free **[Supabase](https://supabase.com)** project
- A free **[Groq](https://console.groq.com)** API key (optional — everything except recipe/Insights generation works without one)
- For Google sign-in specifically: a Google Cloud OAuth client (optional — email/password sign-in works without it)

---

## 2. Set up Supabase

1. Create a new project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the entire contents of [`supabase/setup.sql`](supabase/setup.sql), and run it. This creates every table, view, and index the app needs in one shot.
   - The step-by-step history behind this schema (20 incremental migrations with the reasoning behind each change) is preserved in git history if you ever want to dig into it — `git log -- supabase/` — but isn't kept as a live directory in the repo.
3. Enable auth providers under **Authentication → Providers**:
   - **Email** is on by default.
   - **Google** (optional): create an OAuth client in [Google Cloud Console](https://console.cloud.google.com/apis/credentials) and set its **Authorized redirect URI** to `https://<your-project-ref>.supabase.co/auth/v1/callback`. Paste the resulting Client ID/Secret into Supabase's Google provider settings.
4. Under **Authentication → URL Configuration**, add every origin you'll run the frontend from to **Redirect URLs** (needed for both the Google OAuth bounce-back and email-confirmation links to land back on the app instead of erroring out):
   - `http://localhost:5173` for local dev
   - your Vercel URL for production (e.g. `https://naehrbert.vercel.app`)
5. Grab three values from **Settings → API**, you'll need them in the next two sections:
   - Project URL
   - `anon` / `public` key
   - `service_role` key (keep this one secret — it bypasses every RLS rule)

---

## 3. Backend (local)

```bash
cd naehrbert   # repo root — the backend imports as `backend.app.*`, so run it from here, not from inside backend/
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

cp .env.example .env
# then fill in .env:
#   SUPABASE_URL=<Project URL, from step 2.5>
#   SUPABASE_SERVICE_ROLE_KEY=<service_role key, from step 2.5>
#   ALLOWED_ORIGINS=http://localhost:5173
#   GROQ_API_KEY=<your Groq key>            # optional
#   GROQ_MODEL=openai/gpt-oss-120b          # optional, this is the default

uvicorn backend.app.main:app --reload
```

Backend now runs at `http://localhost:8000` (check `http://localhost:8000/health`).

No separate data-seeding step is needed — the German BLS food-composition table and OpenFoodFacts lookup cache are pre-built and committed (`backend/app/services/_bls_cache.json`, `_off_cache.json`, `_dge_cache.json`), so the app works against a fresh clone immediately.

---

## 4. Frontend (local)

```bash
cd frontend
npm install

cp .env.example .env
# then fill in .env:
#   VITE_API_BASE_URL=http://localhost:8000
#   VITE_SUPABASE_URL=<Project URL, from step 2.5>
#   VITE_SUPABASE_ANON_KEY=<anon/public key, from step 2.5>

npm run dev
```

Open `http://localhost:5173` — sign up, complete onboarding, and start uploading receipts.

---

## 5. Running tests

```bash
# backend
pip install -r backend/requirements-dev.txt
pytest backend/tests -q -k "not test_known_non_food_keys_degrades_gracefully_without_db"
# (that one test only passes with zero Supabase env vars set at all, e.g. in CI —
# it'll spuriously fail locally once you have a real .env, which is expected.)

# frontend
cd frontend
npm run build   # tsc -b && vite build
npm run lint
```

---

## 6. Deploying (Vercel + Render), the way this project is actually hosted

### Backend → Render

1. **New → Web Service** on [Render](https://render.com), connect this GitHub repo.
2. **Runtime: Docker**. Leave the root directory as the repo root; **Dockerfile Path**: `backend/Dockerfile` (its `COPY` paths are relative to the repo root, e.g. `BLS_data/`, so the build context has to stay at the top level, not `backend/`).
3. Add the same environment variables as the backend's local `.env` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`/`GROQ_MODEL`), plus:
   - `ALLOWED_ORIGINS=https://<your-vercel-domain>` (comma-separate if you also want to allow `http://localhost:5173` for testing against a prod backend). **Every deployed frontend origin must be listed here or the browser will block all API calls with a CORS error** — this is the single most common thing to forget.
4. Deploy. Render builds the Dockerfile and exposes port `8000` (from the Dockerfile's `EXPOSE`) automatically — no extra port configuration needed.
5. Render's free tier spins the service down after 15 minutes idle (~50s cold start on the next request). To avoid that during a demo, this repo has `.github/workflows/keepalive.yml`, which pings `/health` every 12 minutes — set a repo secret named `BACKEND_HEALTH_URL` to `https://<your-service>.onrender.com/health` (**Settings → Secrets and variables → Actions**) to enable it.

### Frontend → Vercel

1. **Add New → Project** on [Vercel](https://vercel.com), import this repo.
2. **Root Directory: `frontend`** — it already has its own [`vercel.json`](frontend/vercel.json) (framework: Vite, SPA rewrite rule for client-side routing).
3. Under **Settings → Environment Variables**, add for Production (and Preview, if you want preview deploys to work too):
   - `VITE_API_BASE_URL` = your Render backend's URL (no trailing slash)
   - `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` = the same values from Supabase step 2.5
4. Deploy. **Vite bakes `VITE_*` variables in at build time** — if you add or change one of these later, you must trigger a new deployment for it to take effect; re-saving the env var alone does nothing to an already-built bundle.
5. Go back to Supabase (step 2.4) and add this Vercel URL to **Authentication → URL Configuration → Redirect URLs** if you haven't already.

---

## Project structure

```
backend/app/
  api/        — FastAPI routers (one file per resource: profile, receipts, pantry, recipes, recommendations, analysis, auth, ...)
  services/   — business logic: receipt parsing/OCR, product matching (OFF/BLS/verified-matches), macro & micronutrient
                analysis, shelf-life estimation, recipe/recommendation generation via Groq
  models/     — Pydantic request/response + domain models
  db/         — Supabase client + repo.py (every DB query lives here)
  core/       — settings, auth (Supabase session verification)

frontend/src/
  pages/      — one component per route (Login, Onboarding, Upload, Pantry, Results/Insights, Recipes, Profile, ...)
  components/ — shared UI pieces (nav, chat engine, match-search panel, ...)
  lib/        — API client, Supabase client, auth context, i18n (EN/DE)

supabase/
  setup.sql       — the single-file schema setup (see section 2)

.github/workflows/keepalive.yml — optional Render free-tier keepalive ping (see section 6)
```
