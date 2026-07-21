# Clean Rebuild — Epics, User Stories & Engineering Subtasks

**Purpose:** Planning document for a team building a minimal, clean version of the supermarket-optimizer app in a **new repository**. It scopes down the current (messy, pivot-heavy) app to a single, tight loop:

> **Onboarding → Target Profile → Receipt Upload & Matching → Purchase Macro Analysis**

**Guiding principle:** keep user input as limited as possible. Every scoping decision below is justified against this principle — if a feature from the old app would require more user input or more screens without being asked for, it is cut and listed under Non-Goals.

---

## Scope Summary

The v1 app does exactly four things:

1. Collects the minimum biometric data needed to compute a calorie/macro target.
2. Computes an ideal calorie & macro target profile from that data.
3. Lets the user upload a receipt (photo or pasted text), OCRs/parses it, and matches each item to BLS/Open Food Facts nutrition data.
4. Shows one results screen: the macro distribution of everything purchased, how close it is to the ideal target, a diversity read-out of the cart, and a consume-more / consume-less bucketing of purchased items.

### Explicitly Out of Scope for v1 (deferred, not forgotten)

These exist in the current app and are deliberately **cut** to keep the rebuild clean and input-light:

- Multi-user accounts / auth (single local user only)
- i18n / bilingual UI (single language only)
- Pantry inventory + `confirm_consumption` / "mark unavailable" flows (analysis runs on **purchased** items, not confirmed-eaten items — no extra logging burden on the user)
- "Away day" flags, manual meal/snack logging, meals-eaten-outside logging
- Confidence-ladder gating (50-item unlock threshold, tracking-maturity blending)
- Historical trend charts (7/30/90-day)
- Micronutrient targets/tracking (macro-only, per the requested outcome)
- Extended profile fields: dietary pattern, allergies, dislikes, pregnancy status, symptoms, meals/snacks per day
- "No-match queue" admin/back-office workflow

> **Flag for product owner:** dropping micronutrients and the pantry/consumption-event model are inferences from "keep input minimal" + the outcome you described (macro distribution of *purchased* items). If either was meant to stay in scope, say so and the relevant epics can be added back.

### Reused Components (port, don't rewrite)

The old repo's data-matching and calculation logic is functionally solid — the mess is architectural/UI, not algorithmic. Port these as-is rather than rebuilding:

| Old repo path | Reused for |
|---|---|
| `backend/app/services/ideal_profile.py` | Epic 2 — BMR/TDEE/macro formulas |
| `backend/app/services/local_extractor.py` | Epic 3 — Tesseract OCR + PyMuPDF pipeline |
| `backend/app/services/receipt_text_parser.py`, `non_food_terms.py` | Epic 3 — text → structured items |
| `backend/app/services/resolver.py`, `matcher.py`, `off_api.py` | Epic 4 — OFF matching cascade |
| `backend/app/services/bls_matcher.py`, `BLS_data/BLS_4_0_Daten_2025_DE.xlsx` | Epic 4 — BLS whole-food matching |
| `backend/app/services/basket_composition.py` (Tier 1 logic only) | Epic 5 — calorie-weighted macro % split |

---

## Epic Overview

| # | Epic | Depends on |
|---|---|---|
| 0 | Project Foundation & Repo Setup | — |
| 1 | Minimal Onboarding & Profile Input | 0 |
| 2 | Calorie & Macro Target Profile Calculation | 0, 1 |
| 3 | Receipt Upload & OCR Parsing | 0 |
| 4 | Nutrition Database Matching (BLS + OFF) | 0, 3 |
| 5 | Purchase Macro Distribution & Target Comparison | 2, 4 |
| 6 | Diversification & Consume-More/Less Recommendations | 4, 5 |
| 7 | Results Dashboard (Frontend) | 5, 6 |

Suggested build order: **0 → (1 & 2 in parallel with 3 & 4) → 5 → 6 → 7.**

---

## Epic 0 — Project Foundation & Repo Setup

**Goal:** Stand up a clean new repo with only the scaffolding needed for the four-stage flow — no legacy tables, no dead code paths.

### US 0.1 — As a developer, I want a scaffolded backend + frontend so the team can start building features on day one.
*Acceptance:* fresh clone → one command runs backend + frontend + db locally.
- [ ] Init new git repo, README, `.gitignore`, license
- [ ] Scaffold `backend/` (FastAPI app, uvicorn entrypoint, `pyproject.toml`/requirements)
- [ ] Scaffold `frontend/` (Vite + React + TS, base router with 4 routes: onboarding, targets, upload, results)
- [ ] Single `docker-compose.yml` for backend + frontend + Postgres local dev
- [ ] Configure lint/format (ruff or flake8+black; eslint+prettier) and pre-commit hooks
- [ ] Set up CI (GitHub Actions: lint + backend tests + frontend build)

### US 0.2 — As a developer, I want a minimal single-user schema so we don't inherit multi-tenant/legacy tables.
*Acceptance:* one migration creates the full schema from empty; no `user_id` columns, no incremental patch history.
- [ ] Design ERD: `profile` (single row), `receipts`, `receipt_items` (incl. matched-nutrition columns + match tier/confidence)
- [ ] Set up a migration tool (e.g. Alembic) from commit #1
- [ ] Write the single init migration
- [ ] Write a local dev seed script (one fake profile + one sample receipt)

### US 0.3 — As a developer, I want the reusable nutrition-matching modules ported from the old repo so we don't rebuild working logic from scratch.
*Acceptance:* ported modules pass their own unit tests against a sample of real old-repo fixtures.
- [ ] Port `BLS_data/` files + BLS loader
- [ ] Port OFF client (`matcher.py`/`off_api.py`) incl. caching + retry
- [ ] Port resolver tier cascade (`resolver.py`), stripped of pantry/verified-match-learning complexity not needed for v1 (see Epic 4 for what stays)
- [ ] Port OCR pipeline (`local_extractor.py`) + `receipt_text_parser.py` + `non_food_terms.py`
- [ ] Port BMR/TDEE/macro formulas (`ideal_profile.py`), stripped of micronutrient + pregnancy branches
- [ ] Sweep ported code for i18n (`t()`/`bi()` calls) and remove — single-language strings only

---

## Epic 1 — Minimal Onboarding & Profile Input

**Goal:** Collect only the fields the target-profile calculation actually needs. No dietary pattern, allergies, pregnancy, symptoms, or meal-count fields.

**Fields collected (and only these):** sex at birth, date of birth, height (cm), weight (kg), exercise frequency, daily movement level, goal (lose fat / maintain / build muscle).

### US 1.1 — As a new user, I want to enter my basic biometric info in one short form so I get my nutrition targets immediately.
*Acceptance:* form has exactly the 7 fields above; submitting creates/replaces the single profile row and redirects to the targets screen.
- [ ] Build single-screen form UI for the 7 fields (no chat/multi-step wizard needed)
- [ ] Client-side validation (required fields, plausible numeric ranges, valid DOB)
- [ ] `POST /profile` endpoint — create-or-replace the one profile row
- [ ] Persist profile to DB via Epic 0.2 schema
- [ ] On success, redirect to targets screen (Epic 1.2)

### US 1.2 — As a user, I want to see my computed calorie & macro targets right after onboarding so I understand my baseline before uploading receipts.
*Acceptance:* targets screen shows calories + protein/fat/carb grams and % within one request after onboarding submit.
- [ ] Call target-calculation service (Epic 2) synchronously on profile create
- [ ] Build "Your Targets" summary screen (calories, protein/fat/carb/fiber grams + %)
- [ ] Add an "Edit profile" entry point that reopens the same 7-field form and recomputes targets on save

---

## Epic 2 — Calorie & Macro Target Profile Calculation

**Goal:** Deterministic backend service turning the 7 onboarding fields into an ideal macro distribution, ported from `ideal_profile.py`, macro-only (no micronutrients).

### US 2.1 — As a user, I want my calorie target computed with a standard formula (Mifflin-St Jeor) adjusted for my goal, so my target is realistic.
*Acceptance:* unit tests cover male/female/prefer-not-to-say across all 3 goals and all movement/exercise levels; output matches the old repo's formula to the decimal.
- [ ] Implement BMR calc (Mifflin-St Jeor; "prefer not to say" = mean of male/female result)
- [ ] Implement NEAT (movement-based, 0–35% of BMR) + EAT (exercise-based, 0–600 kcal) + TEF (10% of sum) → TDEE
- [ ] Implement goal adjustment (−15% lose, 0% maintain, +10% build muscle)
- [ ] Unit tests across the full sex × goal × movement × exercise combination matrix, incl. edge cases (very low/high weight or height)

### US 2.2 — As a user, I want a target macro split (protein/fat/carb/fiber, in grams and %) so I can compare it against what I actually buy.
*Acceptance:* `GET /profile/targets` returns calories + all 4 macro targets in grams and as %-of-calories; carb-constrained case is flagged, not negative.
- [ ] Implement protein target (max of g/kg-by-exercise-level, g/kg-by-goal)
- [ ] Implement fat target (max of 30% of kcal, 0.8 g/kg)
- [ ] Implement carb target (remainder after protein+fat calories; floor at 0; set a `constrained` flag if the floor is hit)
- [ ] Implement fiber target (14 g / 1000 kcal)
- [ ] Convert all gram targets to %-of-calories for later comparison (Epic 5)
- [ ] Expose `GET /profile/targets`
- [ ] Unit tests incl. the constrained-carb edge case

---

## Epic 3 — Receipt Upload & OCR Parsing

**Goal:** Turn an uploaded receipt (photo or pasted text) into structured line items, fully offline (no LLM calls), ported from `local_extractor.py` / `receipt_text_parser.py`.

### US 3.1 — As a user, I want to upload a photo of my receipt so items are extracted automatically.
*Acceptance:* JPEG/PNG/PDF upload returns parsed line items without any manual OCR step from the user.
- [ ] Build upload UI (file picker; camera capture on mobile web)
- [ ] `POST /receipts` endpoint accepting image/PDF bytes
- [ ] Port PyMuPDF text-layer extraction for PDFs (OCR fallback for scanned PDFs)
- [ ] Port Tesseract OCR pipeline for images (EXIF fix, greyscale, upscale, adaptive threshold; German-language model)
- [ ] Store raw OCR/extracted text against the receipt row for debugging/re-parsing

### US 3.2 — As a user, I want to paste receipt text directly as an alternative to a photo, for faster or more accurate entry.
*Acceptance:* pasted text bypasses OCR entirely and goes straight to parsing.
- [ ] Add a "paste text" input mode alongside image upload
- [ ] Route pasted text directly into the text parser, skipping the OCR stage

### US 3.3 — As a user, I want the extracted text turned into structured items (name, quantity, price) so the system can match them to nutrition data.
*Acceptance:* parsed items are schema-validated and persisted; non-food lines (deposits, bags, discounts) are filtered out automatically.
- [ ] Port `parse_receipt_text_offline`
- [ ] Port non-food term filtering
- [ ] Validate parsed output against a `ParsedReceipt` schema
- [ ] Persist `receipt_items` rows linked to the parent receipt

### US 3.4 — As a user, I want a lightweight review screen to fix obviously wrong OCR items before they count toward my results, so bad scans don't skew my analysis.
*Acceptance:* user can edit/delete/mark-non-food inline and confirm in one screen; confirming finalizes the receipt.
- [ ] Build a minimal review list UI (name/qty/price editable inline)
- [ ] Support delete-item and mark-as-non-food actions
- [ ] "Confirm & save" action finalizes `receipt_items` and triggers matching (Epic 4)

---

## Epic 4 — Nutrition Database Matching (BLS + OFF)

**Goal:** Attach macro nutrient data (plus fiber/sugar/saturated fat/sodium for Epic 6's bucketing) to each parsed line item via the existing tiered resolver, ported as-is.

### US 4.1 — As the system, I want each parsed item matched to a nutrition record via cache → OFF → BLS → category fallback, so items get nutrient data without manual entry.
*Acceptance:* every finalized `receipt_item` has matched macro fields + a match tier/confidence, even in the worst case (category fallback).
- [ ] Port `resolve_item` tier cascade: learned verified-match → OFF identity match → OFF↔BLS nutrient bridge → BLS whole-food identity match → category-based fallback
- [ ] Port OFF client (caching + retry against Open Food Facts)
- [ ] Port BLS matcher + BLS spreadsheet loader
- [ ] Port category fallback table (lowest-confidence tier)
- [ ] Persist matched macro fields (protein/fat/carb/fiber/sugar/saturated fat/sodium) + match tier/confidence per `receipt_item`

### US 4.2 — As a user, I want to see which items couldn't be confidently matched, so I can quickly confirm or correct them without much effort.
*Acceptance:* only below-threshold items surface for correction; a corrected match is remembered so the same product never needs re-correcting.
- [ ] Flag items below a confidence threshold in the review screen (US 3.4)
- [ ] Provide a simple search-and-pick UI against OFF/BLS for flagged items only
- [ ] Persist user-corrected matches as "verified matches" so future receipts skip the correction for the same product

---

## Epic 5 — Purchase Macro Distribution & Target Comparison

**Goal:** Aggregate all matched purchased items into a calorie-weighted macro distribution and compare it against the Epic 2 target.

### US 5.1 — As a user, I want to see the overall macro split (protein/fat/carb %) of everything I've purchased, so I understand my actual pattern.
*Acceptance:* `GET /analysis/composition` returns a %-split across protein/fat/carb that sums to 100%, computed across every finalized receipt item to date.
- [ ] Implement aggregation service: sum matched macro grams across all `receipt_items`, quantity-weighted
- [ ] Convert aggregate grams to a calorie-weighted % split (protein/fat/carb, normalized to 100%)
- [ ] Decide and document the policy for unmatched/low-confidence items (exclude vs. include with fallback nutrient estimate)
- [ ] Expose `GET /analysis/composition`

### US 5.2 — As a user, I want to see how close my actual macro split is to my ideal target, so I know what to adjust.
*Acceptance:* `GET /analysis/target-comparison` returns a per-macro delta (actual % vs. target %) and one overall closeness score.
- [ ] Implement per-macro closeness/gap calc (actual % vs. target %)
- [ ] Implement one overall closeness score (e.g. normalized distance across the 3 macros, 0–100)
- [ ] Expose `GET /analysis/target-comparison`

---

## Epic 6 — Diversification & Consume-More/Less Recommendations

**Goal:** Bucket purchased items into "consume more" / "consume less" using a nutrient-quality signal (fiber, sugar, saturated fat, sodium) combined with the macro gap from Epic 5, plus a plain-language diversity read-out of the cart.

### US 6.1 — As a user, I want each purchased item scored on nutrient quality and my current macro gap, so items get sorted into a "consume more" or "consume less" bucket with a reason.
*Acceptance:* `GET /analysis/buckets` returns every item with a bucket + a one-line rationale; boundary cases (missing nutrient data, ties) resolve deterministically.
- [ ] Define the nutrient-quality scoring rule (Nutri-Score-style thresholds for fiber/sugar/saturated fat/sodium per 100 kcal or 100 g)
- [ ] Define macro-gap weighting (e.g. if protein is under target, up-weight protein-dense items toward "consume more")
- [ ] Combine both signals into one bucket decision per item + a short rationale string
- [ ] Handle items with missing/low-confidence nutrient data (exclude from bucketing or flag as "insufficient data")
- [ ] Expose `GET /analysis/buckets`
- [ ] Unit tests for boundary cases (missing data, scores that tie)

### US 6.2 — As a user, I want a diversity read-out of my cart (e.g. how many distinct food sources contribute to each macro), so I know if I'm over-relying on a few products.
*Acceptance:* `GET /analysis/diversity` returns a diversity metric per macro group plus at least one plain-language recommendation string.
- [ ] Define the diversity metric (distinct-category count, or a Simpson/Shannon index, weighted by calorie contribution)
- [ ] Compute diversity per macro group (protein sources, carb sources, fat sources)
- [ ] Generate plain-language recommendation strings (e.g. "80% of your protein comes from a single product — consider adding variety")
- [ ] Expose `GET /analysis/diversity`

---

## Epic 7 — Results Dashboard (Frontend)

**Goal:** One minimal results screen presenting Epics 5 & 6's output. No extra tabs or pages beyond onboarding → targets → upload → results.

### US 7.1 — As a user, I want one screen showing my macro split vs. my target, so I don't have to dig through multiple pages.
*Acceptance:* loading the results route renders composition + comparison from a single view with no extra navigation.
- [ ] Build macro-split visualization (actual vs. target — e.g. grouped bar or paired donut)
- [ ] Build closeness-score display (single number/badge + per-macro delta labels)
- [ ] Wire to `GET /analysis/composition` + `GET /analysis/target-comparison`

### US 7.2 — As a user, I want to see my consume-more/consume-less buckets and diversity recommendations on the same screen.
*Acceptance:* buckets and diversity callouts render below the macro comparison on the same page, no separate route.
- [ ] Build a two-list bucket display ("consume more" / "consume less") with item name + short reason
- [ ] Build a diversity recommendation callout/banner
- [ ] Wire to `GET /analysis/buckets` + `GET /analysis/diversity`

### US 7.3 — As a user, I want to get back to this results screen any time after uploading more receipts, so I can track progress without re-entering data.
*Acceptance:* results always reflect the latest set of finalized receipts; no manual "recalculate" step needed.
- [ ] Add a persistent "Results" nav entry/route
- [ ] Ensure results recompute automatically (or on-demand at page load) whenever new receipts are finalized
