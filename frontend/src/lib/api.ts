/**
 * Thin fetch wrapper around the FastAPI backend.
 *
 * The frontend never talks to Supabase directly -- only the backend does
 * (see instructions/clean_rebuild_migration_guide.md). Base URL comes from
 * VITE_API_BASE_URL (see .env.example).
 *
 * Shapes below mirror the actual backend responses exactly (backend/app/api/*.py
 * and backend/app/db/repo.py), not the earlier Epic-0 placeholder guesses.
 */

import { getCurrentProfileId } from './session'

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? ''

// ── Shared enums (Epic 1, backend/app/models/profile.py) ─────────────────

export type Sex = 'female' | 'male' | 'prefer_not_to_say'

export type Goal = 'lose_weight_gradually' | 'maintain' | 'build_muscle'

export type ExerciseFrequency =
  'none' | 'one_two' | 'three_four' | 'five_six' | 'daily_athlete'

export type DailyMovement =
  'mostly_sitting' | 'mixed' | 'mostly_standing' | 'physical_labor'

/** How the user eats -- recipe recommendations feature. Either
 * auto-inferred from purchase history or confirmed/corrected by the user. */
export type DietaryStyle = 'omnivore' | 'pescatarian' | 'vegetarian' | 'vegan'

// ── Profile / Targets (Epic 1, Epic 2) ───────────────────────────────────

/** The core onboarding fields (clean_rebuild_epics.md Epic 1) plus `name`
 * -- cosmetic only, never used in any BMR/TDEE/macro calculation. */
export interface ProfileInput {
  name?: string | null
  sex: Sex
  date_of_birth: string // ISO "YYYY-MM-DD"
  height_cm: number
  weight_kg: number
  exercise_frequency: ExerciseFrequency
  daily_movement: DailyMovement
  goal: Goal
}

export interface Profile extends ProfileInput {
  /** The multi-user feature's login identity -- stored client-side
   * (lib/session.ts) after signup/login and sent back as X-Profile-Id on
   * every request. */
  id: number
  created_at?: string
  updated_at?: string
  /** Collected in the recipe-preferences chat (or edited on the Profile
   * page), never during onboarding -- absent/null until then. */
  dietary_style?: DietaryStyle | null
  allergies?: string[]
  dislikes?: string[]
  /** Set once the recipe-preferences chat has run -- gates whether later
   * visits skip straight to generating a new recipe. */
  recipe_prefs_completed_at?: string | null
}

/** PATCH /profile/preferences payload. */
export interface DietaryPreferencesInput {
  dietary_style: DietaryStyle
  allergies: string[]
  dislikes: string[]
}

/** services/ideal_profile.py's IdealProfile, macro-only (no micronutrients). */
export interface IdealProfile {
  calories_kcal: number
  protein_g: number
  fat_g: number
  carbs_g: number
  fiber_g: number
  bmr_kcal: number
  neat_kcal: number
  eat_kcal: number
  tef_kcal: number
  tdee_kcal: number
  /** True when the carb target was floored at 0 (Epic 2.2, BR-M3). */
  constrained: boolean
  notes: string[]
}

export interface MacroPercentages {
  protein_pct: number | null
  fat_pct: number | null
  carb_pct: number | null
}

/** POST /profile and GET /profile/targets share this shape. */
export interface TargetsResponse {
  targets: IdealProfile | null
  targets_pct: MacroPercentages | null
}

export interface ProfileWithTargets extends TargetsResponse {
  profile: Profile
}

/** GET /profiles -- the login screen's "pick a user" directory. */
export interface ProfileSummary {
  id: number
  name: string | null
}

// ── Receipts (Epic 3, Epic 4) ─────────────────────────────────────────────

export type MatchType = 'learned' | 'exact' | 'fuzzy' | 'bls' | 'fallback' | 'none'

/** A row from receipt_items -- parsed fields always present; match/nutrition
 * fields are null until the receipt is confirmed (Epic 4.1). */
export interface ReceiptItem {
  id: string
  receipt_id: string
  name: string
  original_text: string
  quantity: number
  unit: string
  price: number
  category: string
  is_non_food: boolean
  uncertain: boolean

  match_type: MatchType | null
  confidence: number | null
  matched_name: string | null
  off_id: string | null
  bls_code: string | null
  fallback_category: string | null

  protein_g: number | null
  fat_g: number | null
  carbs_g: number | null
  fiber_g: number | null
  sugar_g: number | null
  calories_kcal: number | null
}

export type ReceiptSource = 'image' | 'pdf' | 'pasted_text'
export type ReceiptStatus = 'pending' | 'confirmed'

export interface Receipt {
  id: string
  source: ReceiptSource
  raw_text: string | null
  store: string | null
  purchased_at: string | null
  status: ReceiptStatus
  created_at: string
}

export interface UploadResponse {
  receipt: Receipt
  items: ReceiptItem[]
}

export interface MatchQuality {
  total_items: number
  matched_items: number
  fallback_items: number
  failed_items: number
  match_rate: number
  coverage_rate: number
}

export interface ConfirmResponse {
  receipt_id: string
  status: 'confirmed'
  items: ReceiptItem[]
  match_quality: MatchQuality | null
}

export interface ItemUpdate {
  name?: string
  quantity?: number
  unit?: string
  price?: number
  is_non_food?: boolean
}

/** Per-100g macro fields a candidate must carry in full to be returned
 * by GET /receipts/{id}/items/{id}/candidates (backend/app/api/receipts.py). */
export interface CandidateNutrition {
  protein_g: number | null
  fat_g: number | null
  carbs_g: number | null
  saturated_fat_g: number | null
  fiber_g: number | null
  sugar_g: number | null
  calories_kcal: number | null
  processed_score: number | null
}

export interface MatchCandidate {
  source: 'off' | 'bls'
  off_id: string | null
  bls_code?: string | null
  matched_name: string
  nutrition: CandidateNutrition
}

export interface CandidatesResponse {
  candidates: MatchCandidate[]
}

export interface ItemCorrection {
  matched_name: string | null
  off_id?: string | null
  bls_code?: string | null
  nutrition: CandidateNutrition
}

// ── Analysis (Epic 5, Epic 6) ─────────────────────────────────────────────

/** GET /analysis/summary -- how much data the rest of this page is based on. */
export interface SummaryResult {
  receipts_count: number
  items_count: number
}

/** GET /analysis/purchases -- one row per item across every confirmed
 * receipt (food AND non-food), with actual kcal/macros for the purchased
 * quantity (already scaled from the stored per-100g values), not the
 * per-100g reference values themselves. */
export interface PurchaseItem {
  id: string
  receipt_id: string
  name: string
  store: string | null
  purchased_at: string | null
  quantity: number | null
  unit: string | null
  is_non_food: boolean
  match_type: MatchType | null
  matched_name: string | null
  fallback_category: string | null
  confidence: number | null
  calories_kcal: number | null
  protein_g: number | null
  fat_g: number | null
  carbs_g: number | null
  fiber_g: number | null
}

export interface PurchasesResult {
  items: PurchaseItem[]
}

/** GET /analysis/composition -- calorie-weighted macro % split. Null fields
 * mean no confirmed receipts yet. */
export interface CompositionResult {
  protein_pct: number | null
  fat_pct: number | null
  carb_pct: number | null
  /** Calories not attributable to a macro -- see basket_composition.py's
   * policy note on low-confidence category-fallback matches. */
  unaccounted_pct: number | null
  kcal_total: number | null
  /** Fiber isn't part of the %-of-calories split above -- see
   * ideal_profile.py's FIBER_G_PER_1000KCAL -- so it's reported in the same
   * density unit as its target instead. */
  fiber_per_1000kcal: number | null
  items_considered: number
}

export interface MacroDeltaMap {
  protein: number | null
  fat: number | null
  carb: number | null
}

/** GET /analysis/target-comparison. */
export interface TargetComparisonResult {
  actual_pct: MacroDeltaMap
  target_pct: MacroPercentages
  delta_pct: MacroDeltaMap
  fiber_actual_per_1000kcal: number | null
  fiber_target_per_1000kcal: number
  fiber_delta_per_1000kcal: number | null
  /** Normalized distance across the 3 macros, 0-100 (100 = exact match). */
  closeness_score: number | null
  items_considered: number
}

export type Bucket = 'consume_more' | 'consume_less' | 'insufficient_data'

export interface BucketedItem {
  name: string
  matched_name: string | null
  bucket: Bucket
  reason: string
}

/** GET /analysis/buckets */
export interface BucketsResult {
  buckets: BucketedItem[]
}

export interface DiversityGroup {
  diversity_score: number | null
  source_count: number
  top_source: string | null
  top_share_pct: number | null
}

/** GET /analysis/diversity */
export interface DiversityResult {
  protein: DiversityGroup
  fat: DiversityGroup
  carb: DiversityGroup
  recommendations: string[]
}

// ── Recipe recommendations feature ────────────────────────────────────────

/** GET /recipes/unlock-status -- Results page's "Unlock recipes" section. */
export interface UnlockStatus {
  matched_items_count: number
  threshold: number
  unlocked: boolean
  /** True once the recipe-preferences chat has run at least once, so the
   * frontend knows whether to run the full chat or skip straight to
   * generating a new recipe. */
  prefs_completed: boolean
}

export interface RecipeIngredient {
  name: string
  /** Free-form amount, e.g. "200 g", "1 tbsp", "2 cloves". */
  quantity: string
}

/** A generated recipe (backend/app/models/recipe.py's Recipe). The
 * calorie/macro fields are Gemini's own estimate for the whole recipe,
 * not backend-recomputed -- the user gets exact numbers once they
 * actually shop the ingredients and upload that receipt like any other
 * purchase. */
export interface Recipe {
  id: string
  title: string
  ingredients: RecipeIngredient[]
  steps: string[]
  prep_minutes: number
  cook_minutes: number
  /** Null for recipes generated before this field existed. */
  servings: number | null
  calories_kcal: number
  protein_g: number
  fat_g: number
  carbs_g: number
  fiber_g: number
  created_at?: string
}

// ── fetch helper ──────────────────────────────────────────────────────────

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const profileId = getCurrentProfileId()
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(profileId !== null ? { 'X-Profile-Id': String(profileId) } : {}),
      ...init?.headers,
    },
    ...init,
  })

  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = (await response.json()) as { detail?: string }
      if (body?.detail) detail = body.detail
    } catch {
      // body wasn't JSON -- fall back to statusText
    }
    throw new ApiError(response.status, detail)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

// ── Profiles directory (multi-user login screen) ──────────────────────────

export function listProfiles(): Promise<ProfileSummary[]> {
  return request<ProfileSummary[]>('/profiles')
}

// ── Profile (Epic 1) ──────────────────────────────────────────────────────

export function createProfile(profile: ProfileInput): Promise<ProfileWithTargets> {
  return request<ProfileWithTargets>('/profile', {
    method: 'POST',
    body: JSON.stringify(profile),
  })
}

export function getProfile(): Promise<Profile> {
  return request<Profile>('/profile')
}

// ── Targets (Epic 2) ──────────────────────────────────────────────────────

export function getTargets(): Promise<TargetsResponse> {
  return request<TargetsResponse>('/profile/targets')
}

// ── Receipts (Epic 3) ──────────────────────────────────────────────────────

export function uploadReceiptFile(file: File): Promise<UploadResponse> {
  const body = new FormData()
  body.append('file', file)
  return request<UploadResponse>('/receipts', { method: 'POST', body })
}

export function uploadReceiptText(text: string): Promise<UploadResponse> {
  return request<UploadResponse>('/receipts/text', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export function getReceipt(receiptId: string): Promise<UploadResponse> {
  return request<UploadResponse>(`/receipts/${receiptId}`)
}

export function updateReceiptItem(
  receiptId: string,
  itemId: string,
  fields: ItemUpdate,
): Promise<ReceiptItem> {
  return request<ReceiptItem>(`/receipts/${receiptId}/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
}

export function deleteReceiptItem(receiptId: string, itemId: string): Promise<void> {
  return request<void>(`/receipts/${receiptId}/items/${itemId}`, { method: 'DELETE' })
}

/** Finalizes a receipt after review (US 3.4) and triggers matching (Epic 4). */
export function confirmReceipt(receiptId: string): Promise<ConfirmResponse> {
  return request<ConfirmResponse>(`/receipts/${receiptId}/confirm`, { method: 'POST' })
}

/** Manual search-and-pick against OFF + BLS for a low-confidence item (US 4.2). */
export function searchCandidates(
  receiptId: string,
  itemId: string,
  query: string,
): Promise<CandidatesResponse> {
  const q = encodeURIComponent(query)
  return request<CandidatesResponse>(
    `/receipts/${receiptId}/items/${itemId}/candidates?q=${q}`,
  )
}

/** Persists a manually-picked candidate and remembers it as a verified match. */
export function correctReceiptItem(
  receiptId: string,
  itemId: string,
  correction: ItemCorrection,
): Promise<ReceiptItem> {
  return request<ReceiptItem>(`/receipts/${receiptId}/items/${itemId}/correct`, {
    method: 'POST',
    body: JSON.stringify(correction),
  })
}

// ── Analysis (Epic 5, Epic 6) ──────────────────────────────────────────────

export function getSummary(): Promise<SummaryResult> {
  return request<SummaryResult>('/analysis/summary')
}

export function getPurchases(): Promise<PurchasesResult> {
  return request<PurchasesResult>('/analysis/purchases')
}

export function getComposition(): Promise<CompositionResult> {
  return request<CompositionResult>('/analysis/composition')
}

export function getTargetComparison(): Promise<TargetComparisonResult> {
  return request<TargetComparisonResult>('/analysis/target-comparison')
}

export function getBuckets(): Promise<BucketsResult> {
  return request<BucketsResult>('/analysis/buckets')
}

export function getDiversity(): Promise<DiversityResult> {
  return request<DiversityResult>('/analysis/diversity')
}

// ── Dietary preferences (recipe recommendations feature) ─────────────────

export function updateDietaryPreferences(
  input: DietaryPreferencesInput,
): Promise<Profile> {
  return request<Profile>('/profile/preferences', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

// ── Recipes (recipe recommendations feature) ──────────────────────────────

export function getUnlockStatus(): Promise<UnlockStatus> {
  return request<UnlockStatus>('/recipes/unlock-status')
}

export function getInferredDietaryStyle(): Promise<{ dietary_style: DietaryStyle }> {
  return request<{ dietary_style: DietaryStyle }>('/recipes/inferred-dietary-style')
}

export interface RecipeGenerateInput {
  cuisine?: string
  max_time_minutes?: number
  servings?: number
}

export function generateRecipe(input: RecipeGenerateInput = {}): Promise<Recipe> {
  return request<Recipe>('/recipes/generate', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getRecipes(): Promise<Recipe[]> {
  return request<Recipe[]>('/recipes')
}

// ── Feedback (recipe recommendations feature) ─────────────────────────────

export function submitFeedback(npsScore: number): Promise<void> {
  return request<void>('/feedback', {
    method: 'POST',
    body: JSON.stringify({ nps_score: npsScore }),
  })
}
