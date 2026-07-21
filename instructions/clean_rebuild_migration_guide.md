# Clean Rebuild — Migration Guide

Companion to [`clean_rebuild_epics.md`](./clean_rebuild_epics.md). This answers, file by file: **carry over**, **create fresh**, or **set up on Supabase**.

Confirmed decisions this guide assumes:
- New Supabase project (clean slate; old project stays untouched as a fallback).
- Receipt images are OCR'd in-memory and discarded — no Supabase Storage bucket.
- No auth, no multi-user, no i18n (per `clean_rebuild_epics.md`).

Method: an import-trace was run from the 10 modules that hold the logic worth keeping (target calc, OCR, parsing, BLS/OFF matching, macro composition), following every internal import transitively. That trace is the basis for the lists below.

---

## 1. Carry over (port from old repo)

### Business logic — port as-is

| File | Notes |
|---|---|
| `backend/app/services/ideal_profile.py` | Epic 2. Strip micronutrient + pregnancy branches per the epics doc. |
| `backend/app/services/receipt_parser.py` | Epic 3 orchestration entrypoint. |
| `backend/app/services/local_extractor.py` | Epic 3. Tesseract OCR + PyMuPDF, fully offline. |
| `backend/app/services/receipt_text_parser.py` | Epic 3. Text → structured items. |
| `backend/app/services/resolver.py` | Epic 4. Tiered BLS/OFF resolution cascade. |
| `backend/app/services/matcher.py`, `off_api.py` | Epic 4. OFF matching + caching client. |
| `backend/app/services/bls_matcher.py` | Epic 4. BLS whole-food matching. |
| `backend/app/services/nutrition_mapping.py` | Epic 4. Orchestrates the cascade. |
| `backend/app/services/units.py`, `fallback_categories.py`, `base_terms.py`, `text_similarity.py` | Internal dependencies of the matching cascade — no changes needed. |
| `backend/app/services/nutrition_profile.py` | Supporting nutrition-value helpers used by the above. |
| `backend/app/analytics/match_quality.py` | Used by `nutrition_mapping.py`. |

### Business logic — port, but fix while porting

| File | What to change |
|---|---|
| `backend/app/services/non_food_terms.py` | Currently imports `db/supabase.py` **at module level**, which means the whole matching cascade fails to import without `SUPABASE_URL`/`SUPABASE_KEY` set (`create_client()` runs at import time). Make the DB calls function-local, the way `verified_matches.py` already correctly does — otherwise you've re-imported the old repo's tight coupling on day one. |
| `backend/app/services/basket_composition.py` | Only the Tier-1 logic is in scope (`compute_basket_composition` + `_pct_split`) — the same file's Tier 2/3 functions pull in `intake_estimator.py`, `day_coverage.py`, and pantry tables that are out of scope. Split Tier 1 into its own module. It also has a **function-local direct import of `db/supabase.py`** (`get_receipt_items_by_user`) — don't carry that coupling forward either. Have the new version accept `receipt_items: list` as a parameter; let the API layer fetch from the DB and pass it in. This is the one deliberate architecture fix worth making during the port — everything else can move unchanged. |
| `backend/app/services/verified_matches.py` | Optional (Epic 4.2 — "remembered corrections" so the same product never needs re-correcting). Already DB-agnostic (function-local imports, `try/except`, local-JSON fallback) — safe to port whole. Skip it entirely if you want the absolute minimum for a v1 cut. |

### Data files — must ship alongside the ported code

| File | Notes |
|---|---|
| `backend/app/services/_bls_cache.json` | Prebuilt BLS cache (~3.4MB) — what actually loads at import time. Carry this over; the xlsx below is only a fallback/rebuild source. |
| `backend/app/services/_off_cache.json` | Prebuilt OFF response cache (~1.7MB). Carrying it over preserves offline/deterministic behavior on day one instead of re-hitting the OFF API cold. |
| `BLS_data/BLS_4_0_Daten_2025_DE.xlsx` | Source spreadsheet. `bls_matcher.py` resolves its path as 3 levels above `services/` (i.e. repo root) — keep that same relative layout in the new repo. |
| `backend/app/scripts/build_bls_off_dataset.py` | The script that rebuilds the two caches above from the xlsx — carry over so the caches aren't a black box. |
| `backend/app/fixtures/mock_receipt.json` | Optional — only used in a `RECEIPT_PARSER_MOCK` deterministic demo/test mode. Nice to have for local dev without a real receipt on hand. |

### Models — port selectively, don't carry the whole file

| File | Decision |
|---|---|
| `backend/app/models/nutrition.py` | Port as-is (`MatchedProduct`, `MatchType`, `NutritionValues`, `MatchQuality`, `ReceiptMapping`). |
| `backend/app/models/profile.py` | **Don't port whole** — it's ~420 lines covering Level-2/next-cart/status-quo fields the new repo doesn't have. Write a fresh, minimal profile schema with just the 7 onboarding fields (Epic 1) + the `IdealProfile` output shape, using this file only as a reference for field types/enums (`Sex`, `Goal`, `ExerciseFrequency`, `DailyMovement`). |
| `backend/app/models/receipt.py` | Not actually imported by any of the matching/parsing modules (they pass plain dicts) — only used by the old `api/receipts.py` for `ParsedReceipt` validation. Port it if you rebuild that validation step (recommended — Epic 3.3 asks for schema validation), otherwise skip. |
| `backend/app/models/snapshot.py` | Only `NutritionProfile` from this file is used transitively; the rest (Gap/DimensionSnapshot classes) isn't needed. Either port the whole file (low cost) or just lift the one class. |

### What NOT to carry over (confirmed unused by everything in scope)

`services/pantry.py`, `services/intake_estimator.py`, `services/day_coverage.py`, `services/auth.py`, `services/account.py`, `services/nutri_coach.py`, `services/recommender.py`, `services/next_cart_engine.py`, `services/recipe_suggester.py`, `services/preference_learning.py`, `services/adoption.py`, `services/ab_assignment.py`, `services/conflict_detector.py`, `services/easy_swaps.py`, `services/explainer.py`, `services/health_score.py`, `services/progress_tracker.py`, `services/symptom_relevance.py`, `services/status_quo.py`, `services/consumption_timeframe.py`, `services/gap_engine.py`, `services/gap_detector.py`, `services/absolute_gap_detector.py`, `services/shelf_life.py`, `services/exclusion_filter.py`, `services/confidence.py`/`confidence_model.py`, `services/grouping.py`, `services/nutrient_requirements.py`, `services/nutrition_snapshot.py`, `services/nutrition_personalization.py`, `services/i18n.py`, `services/error_handler.py`, `services/storage.py` (no image storage), `db/pantry_repo.py`, `db/day_flags_repo.py`, `db/receipt_items_repo.py`, all of `api/*.py` (rewrite the API layer fresh against the new, smaller surface), and `_verified_matches.json`/`_no_match_queue.json` (gitignored local-dev artifacts, regenerate if you use `VERIFIED_STORE_LOCAL`).

Also don't carry over `db/supabase.py`'s `_insert_tolerant`/`_update_tolerant` pattern (the "strip missing columns and retry" safety net). That exists solely because the old repo's schema evolved through 14+ incremental ALTER migrations with no baseline — a new repo with one clean init migration never has a schema/code mismatch to degrade around. Write plain inserts/updates.

### Frontend — nothing carries over as code

The UI is being rebuilt clean per the epics doc. `BasketCompositionCard.tsx`, `TargetsCard.tsx`, and `AnalysisCard.tsx` are fine to glance at for visual/UX inspiration, but write new components against the new API. Do **not** port `frontend/src/lib/supabase.ts` or `AuthScreen.tsx` — with no auth and no client-side Storage access, the frontend never talks to Supabase directly; only the FastAPI backend does.

---

## 2. Create freshly

### Backend (new, slim structure)

- `api/profile.py` — create/read the single profile row (7 fields), return computed targets
- `api/receipts.py` — upload endpoint (image or pasted text) → parse → match → persist; review/correction endpoint for low-confidence items
- `api/analysis.py` — the four read endpoints from Epics 5/6: `/analysis/composition`, `/analysis/target-comparison`, `/analysis/buckets`, `/analysis/diversity`
- `db/repo.py` — a slim CRUD module with only what's needed: create/get profile, create receipt + receipt_items, get all receipt_items, get/set non-food terms, get/set verified matches (a handful of functions, not the ~30 in the old `db/supabase.py`)
- `core/config.py` — simplified settings: `SUPABASE_URL`, `SUPABASE_KEY`, `ALLOWED_ORIGINS`. Drop `SUPABASE_JWT_SECRET` and `COACH_LLM_ENABLED` (no auth, no coach).
- `services/bucketing.py` — **new logic, doesn't exist in the old repo.** Epic 6.1's nutrient-quality + macro-gap scoring has to be designed and built from scratch.
- `services/diversity.py` — **new logic, doesn't exist in the old repo.** Epic 6.2's diversity metric is also net-new.
- One init SQL migration creating `profiles` (single row, no `user_id`), `receipts`, `receipt_items`, `verified_matches`, `non_food_terms` — no RLS policies, no `user_id` scoping anywhere.
- `requirements.txt`, trimmed (see below)
- `Dockerfile` — same tesseract-ocr/tesseract-ocr-deu/libglib2.0-0 setup as the old one; safe to copy that part verbatim
- CI workflow (lint + test), README

### Frontend (new, slim structure)

- 4 routes: onboarding form → targets summary → receipt upload/review → results dashboard
- `lib/api.ts` — new, calling only the new endpoints above
- No `@supabase/supabase-js` dependency, no auth screen

### requirements.txt — keep vs. drop

**Keep:** `fastapi`, `uvicorn`, `python-multipart`, `python-dotenv`, `supabase`, `postgrest`, `pymupdf`, `pytesseract`, `pillow`, `opencv-python-headless`, `numpy`, `pydantic`, `pydantic-settings`, `requests`, `httpx`, `openpyxl` (dev-only, for the cache-rebuild script)

**Drop:** `storage3` (no image storage), `google-genai` (no coach feature in scope), `PyJWT[crypto]` (no auth)

### .env — new minimal set

```
SUPABASE_URL=
SUPABASE_KEY=
ALLOWED_ORIGINS=
VITE_API_BASE_URL=
```

Drop `GEMINI_API_KEY`, `SUPABASE_BUCKET`, `SUPABASE_JWT_SECRET`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `APP_ENV`.

---

## 3. Set up on Supabase

1. **Create a new Supabase project** (separate from the current one). EU region is a reasonable default given the BLS data and German receipts.
2. Grab the **Project URL** and the **service_role key** (not the anon key) — the backend is the only Supabase client in this design (no client-side access, no auth), and the service-role key bypasses RLS, so:
3. **Skip Auth setup entirely** — don't enable/configure Supabase Auth providers.
4. **Skip RLS policies entirely** — with a single implicit user and a service-role-only backend, there's no session to scope rows to.
5. **Skip Storage** — no bucket needed since receipt images are discarded after OCR.
6. Run the one clean init migration (from "Create freshly" above) via the SQL editor or the Supabase CLI to create the 5 tables.
7. Put `SUPABASE_URL` / `SUPABASE_KEY` (service role) into your local `.env` and into Render's (or wherever you deploy) environment variables.
8. Note: Supabase free-tier projects pause after a period of inactivity — worth knowing if this is being demoed on a schedule (e.g. course presentation).

---

## 4. Quick checklist

- [ ] New Supabase project created, service-role key retrieved, no Auth/RLS/Storage configured
- [ ] New repo scaffolded (Epic 0.1 in the epics doc)
- [ ] Ported files copied in per section 1, with the two fixes applied (`non_food_terms.py` lazy DB import, `basket_composition.py` split + DB-agnostic Tier 1)
- [ ] `_bls_cache.json`, `_off_cache.json`, `BLS_data/*.xlsx` copied over
- [ ] One init migration written and run against the new Supabase project
- [ ] `requirements.txt` and `.env.example` trimmed per section 2
- [ ] `services/bucketing.py` and `services/diversity.py` designed and built (net-new, no old-repo equivalent)
- [ ] Frontend rebuilt fresh against the new, smaller API surface
