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

/** Pregnancy/nursing status -- the DGE's micronutrient reference values
 * (see getMicronutrients()) differ materially by this on top of age/sex. */
export type LifeStage = 'none' | 'pregnant_t1' | 'pregnant_t2' | 'pregnant_t3' | 'nursing'

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
  /** Konsum.md Stufe 4 -- collected at the end of onboarding. Not yet used
   * in any calculation; both optional so existing profiles predating these
   * fields keep working unchanged. */
  household_size?: number | null
  consumption_share_pct?: number | null
  /** Defaults to 'none' server-side when omitted -- see models/profile.py's
   * LifeStage.NONE. */
  life_stage?: LifeStage
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
  price: number | null
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
  /** Calories not attributable to a macro at all (e.g. a sparse product
   * match missing fat/carbs) -- see basket_composition.py's policy note.
   * Distinct from `fallback_share_pct`: a fallback-matched item normally
   * DOES have a full macro breakdown and only shows up here if it's one of
   * the rare categories still missing a value. */
  unaccounted_pct: number | null
  /** Plain item count behind unaccounted_pct (not calorie-weighted) --
   * pair with items_considered for an "X/Y purchased items" display. */
  unaccounted_items_count: number
  /** Share of the counted calories that came from a category-estimate
   * match (MatchType.FALLBACK) rather than an identified product -- already
   * included in the macro split above; this is a confidence label, not an
   * exclusion. */
  fallback_share_pct: number | null
  kcal_total: number | null
  /** Fiber isn't part of the %-of-calories split above -- see
   * ideal_profile.py's FIBER_G_PER_1000KCAL -- so it's reported in the same
   * density unit as its target instead. */
  fiber_per_1000kcal: number | null
  items_considered: number
  /** Distinct confirmed receipts behind the split -- few receipts = shaky. */
  receipts_considered: number
  /** Share of the counted calories that came from items with a full
   * protein/fat/carb breakdown. Low = the split leans on incomplete data. */
  macro_coverage_pct: number | null
  /** Share of the counted calories from confidently identified products
   * (vs a category-only estimate or no match). Drives the honesty label:
   * these results describe what was *purchased*, not necessarily eaten. */
  match_coverage_pct: number | null
  /** Share of the counted calories from a real measured quantity (g/ml/kg/l)
   * vs grams_for's coarse per-piece guess. Low = the weighting is rough. */
  quantity_coverage_pct: number | null
  /** True when the split is too thin to trust (few receipts and/or mostly
   * category estimates) -- the UI labels it "shaky" rather than precise. */
  low_confidence: boolean
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
  /** 100 - sum(|actual% - target%|) across protein/fat/carb, floored at 0
   * (100 = exact match). Summed, not averaged, so one macro badly off
   * target can't hide behind two that are close. */
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

/** A purchased item's per-100g density for this macro -- NOT scaled by how
 * much was bought, so this ranks "which foods you buy are concentrated
 * sources of X", not "what's actually driving your total" (that's
 * top_source/top_share_pct below). */
export interface DiversityDriver {
  name: string
  grams_per_100g: number
}

export interface DiversityGroup {
  diversity_score: number | null
  source_count: number
  top_source: string | null
  top_share_pct: number | null
  /** Up to 10 purchased items ranked by per-100g density for this macro,
   * most concentrated first -- backs the Results page's per-macro
   * "Learn more". */
  top_drivers: DiversityDriver[]
}

/** GET /analysis/diversity */
export interface DiversityResult {
  protein: DiversityGroup
  fat: DiversityGroup
  carb: DiversityGroup
  fiber: DiversityGroup
  recommendations: string[]
}

/** One distinct plant behind the /analysis/plant-diversity count -- `group`
 * is one of the six fixed labels (Fruits, Vegetables, Whole grains,
 * Legumes, Nuts & seeds, Herbs & spices), already ordered by the backend. */
export interface PlantDiversityItem {
  name: string
  group: string
}

/** GET /analysis/plant-diversity -- Results page's plant-diversity progress
 * bar: distinct fruits/vegetables/whole grains/legumes/nuts&seeds/herbs&
 * spices bought in the last `window_days` (see backend/app/services/
 * plant_diversity.py for the category scope). */
export interface PlantDiversityResult {
  count: number
  target: number
  window_days: number
  items: PlantDiversityItem[]
}

/** GET /analysis/meal-coverage -- how much of the daily calorie target the
 * last `window_days` of grocery purchases would cover if fully consumed,
 * shown inline on the Results page's Daily calories card. */
export interface MealCoverageResult {
  window_days: number
  /** Actual divisor for "per day" figures -- less than window_days for a
   * user whose earliest purchase is more recent than the window itself,
   * so a new user's daily average isn't diluted by days before they had
   * any receipts at all. */
  days_of_data: number
  kcal_purchased: number
  /** From Profile.consumption_share_pct, or 100 (assume all groceries are
   * yours) when the profile hasn't set it. */
  consumption_share_pct: number
  effective_kcal: number
  daily_target_kcal: number
}

/** GET /analysis/micronutrients -- 28-day BLS-sourced micronutrient totals,
 * plus DGE daily reference values for this profile's age/sex/life_stage
 * (services/dge_matcher.py) -- an external reference table, not one of
 * this app's own IdealProfile formulas. */
export interface MicronutrientTotals {
  vitamin_a_ug: number
  vitamin_d_ug: number
  vitamin_e_mg: number
  vitamin_k_ug: number
  vitamin_b1_mg: number
  vitamin_b2_mg: number
  niacin_mg: number
  pantothenic_acid_mg: number
  vitamin_b6_mg: number
  biotin_ug: number
  folate_ug: number
  vitamin_b12_ug: number
  vitamin_c_mg: number
  sodium_mg: number
  chloride_mg: number
  potassium_mg: number
  calcium_mg: number
  phosphorus_mg: number
  magnesium_mg: number
  iron_mg: number
  zinc_mg: number
  copper_mg: number
  manganese_mg: number
  iodine_ug: number
  fluoride_mg: number
}

/** A purchased item's per-100g density for this micronutrient -- same
 * ranking convention as DiversityDriver for macros. */
export interface MicronutrientDriver {
  name: string
  value_per_100g: number
}

export interface MicronutrientsResult {
  window_days: number
  /** Actual divisor for the "Purchased" daily average -- less than
   * window_days for a user whose earliest purchase is more recent than
   * the window itself. */
  days_of_data: number
  totals: MicronutrientTotals
  /** Share of the counted calories that came from an item carrying real
   * micronutrient data (BLS-tier or bridged-OFF) -- the trust signal for
   * how much to read into the totals above. */
  micro_coverage_pct: number | null
  /** Plain item counts behind micro_coverage_pct (not calorie-weighted)
   * -- pair for an "X/Y purchased items" display. */
  items_with_micros_count: number
  items_considered: number
  /** DGE daily targets for this profile's age/sex/life_stage, or null if
   * the profile's age can't be resolved (e.g. incomplete profile).
   * Partial (defensively) in case a future tracked micronutrient ever
   * lacks a DGE reference value the way dropped Sulfur once did -- every
   * currently tracked key does have one (see services/dge_matcher.py's
   * _NUTRIENT_MAP). */
  targets: Partial<MicronutrientTotals> | null
  /** Up to 5 purchased items ranked by per-100g density, per micronutrient
   * -- backs each row's "Show drivers" expansion. */
  top_drivers: Record<keyof MicronutrientTotals, MicronutrientDriver[]>
  /** Plain-language reference content parsed from the repo-root
   * micronutrients.md (services/micronutrient_info.py), one ordered list
   * of {title, body} sections per tracked micronutrient -- shown above the
   * "Drivers from your purchases" list in each row's expansion. */
  nutrient_info: Record<keyof MicronutrientTotals, { title: string; body: string }[]>
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
  /** Gemini's own classification of what's actually in the recipe (not
   * just the dietary style that was requested) -- reuses the same 4
   * values as a profile's dietary_style. Null for recipes generated before
   * this field existed. */
  dietary_label: DietaryStyle | null
  /** Thumbs up/down on this specific recipe -- separate from the app-wide
   * NPS score submitted via submitFeedback(). Null until rated. */
  feedback: 'up' | 'down' | null
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

/** Permanently deletes the caller's account and all data they own. Verified
 * matches are kept server-side (global correction cache -- see backend
 * repo.delete_profile). Caller should clear the session afterward. */
export function deleteProfile(): Promise<void> {
  return request<void>('/profile', { method: 'DELETE' })
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

export interface ReceiptUpdate {
  store?: string
  purchased_at?: string
}

/** Fills in a receipt's store/purchase date when the scan couldn't detect
 * them -- required by the review screen before Confirm in that case. */
export function updateReceipt(receiptId: string, fields: ReceiptUpdate): Promise<Receipt> {
  return request<Receipt>(`/receipts/${receiptId}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
}

/** Distinct store names this profile has used before -- backs the review
 * screen's "pick an existing store" option. */
export function getReceiptStores(): Promise<string[]> {
  return request<{ stores: string[] }>('/receipts/stores').then((r) => r.stores)
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

/** Same OFF + BLS search as searchCandidates, but not tied to an existing
 * receipt item -- used by the manual "add to pantry" flow, where the item
 * doesn't exist yet (GET /match/candidates). */
export function searchMatchCandidates(query: string): Promise<CandidatesResponse> {
  return request<CandidatesResponse>(`/match/candidates?q=${encodeURIComponent(query)}`)
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

export function getPlantDiversity(): Promise<PlantDiversityResult> {
  return request<PlantDiversityResult>('/analysis/plant-diversity')
}

export function getMealCoverage(): Promise<MealCoverageResult> {
  return request<MealCoverageResult>('/analysis/meal-coverage')
}

export function getMicronutrients(): Promise<MicronutrientsResult> {
  return request<MicronutrientsResult>('/analysis/micronutrients')
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

/** Thumbs up/down on a specific recipe; pass null to clear it. */
export function setRecipeFeedback(
  recipeId: string,
  feedback: 'up' | 'down' | null,
): Promise<Recipe> {
  return request<Recipe>(`/recipes/${recipeId}/feedback`, {
    method: 'PATCH',
    body: JSON.stringify({ feedback }),
  })
}

/** Soft-deletes ("archives") a recipe -- it stops showing up in
 * getRecipes(), but isn't hard-deleted server-side. */
export function archiveRecipe(recipeId: string): Promise<void> {
  return request<void>(`/recipes/${recipeId}`, { method: 'DELETE' })
}

// ── Pantry / Pantry (Vorrat.md) ───────────────────────────────────────────

/** Why a lot left the pantry. 'eaten' (gegessen) counts as consumption;
 * 'removed' (entfernt) left without being eaten (spoiled/given away/miscan).
 * Both reduce the pantry; only the later consumption-gap analysis tells them
 * apart (GapUndEmpfehlung.md §4). */
export type PantryRemovalReason = 'eaten' | 'removed'

/** GET /pantry -- one row per in-stock lot (a single receipt_items line on a
 * single receipt). `quantity` is the amount STILL in stock (remaining after
 * withdrawals); `original_quantity` is what was bought. kcal/macros are
 * scaled to the remaining amount. Pantry is food-only so there's no
 * is_non_food. */
/** Fuzzy urgency buckets (see shelf_life.py). Ordered most -> least urgent. */
export type Urgency = 'expired' | 'soon' | 'week' | 'long' | 'unknown'

/** Stable keys of the coarse food groups (see shelf_life.FOOD_GROUP_LABELS). */
export type FoodGroup =
  | 'fruits'
  | 'vegetables'
  | 'dairy_eggs'
  | 'meat'
  | 'fish_seafood'
  | 'bread_bakery'
  | 'grains_starches'
  | 'legumes_pantry'
  | 'oils_condiments'
  | 'sweets_snacks'
  | 'beverages'
  | 'nuts_seeds'
  | 'frozen'
  | 'other'

export interface PantryItem {
  id: string
  receipt_id: string
  name: string
  store: string | null
  purchased_at: string | null
  /** Remaining amount in stock, in `unit`. Pre-fills the withdrawal control. */
  quantity: number | null
  /** What was originally purchased -- for a "0.5 l of 1 l" hint. */
  original_quantity: number | null
  unit: string | null
  /** Always false -- the pantry view is food-only; present so the match
   * helpers (matchInfo/matchCategory) accept a PantryItem. */
  is_non_food: boolean
  match_type: MatchType | null
  matched_name: string | null
  /** Canonical leaf category set for every lot at parse time (e.g.
   * "tropical_fruits") -- drives the Pantry's food-group emoji. */
  category: string | null
  /** Coarse food group (e.g. "fish_seafood") -- drives the "by category"
   * view, the category filter, and which shelf-life estimate applies. */
  food_group: FoodGroup
  /** Human label for `food_group` ("Fish & Seafood"). */
  food_group_label: string
  /** Fuzzy urgency bucket from the ESTIMATED shelf life. The server never
   * sends the estimated date or a day count -- only this bucket -- so the UI
   * can show a traffic-light / soft label without presenting a guess as a
   * fact. 'expired'+'soon' together are the "next 3 days" set. */
  urgency: Urgency
  fallback_category: string | null
  confidence: number | null
  calories_kcal: number | null
  protein_g: number | null
  fat_g: number | null
  carbs_g: number | null
  fiber_g: number | null
}

export interface PantryResult {
  items: PantryItem[]
}

/** A row appended to the withdrawal ledger (pantry_removals), plus the
 * server's view of the effect: how much was actually applied (after
 * clamping), what's left afterward, and whether the request over-shot the
 * remaining amount and was clamped down. */
export interface PantryRemoval {
  id: string
  receipt_item_id: string
  reason: PantryRemovalReason
  quantity: number | null
  removed_at: string
  applied_quantity: number
  remaining_after: number
  clamped: boolean
}

export function getPantry(): Promise<PantryResult> {
  return request<PantryResult>('/pantry')
}

/** Withdraw all or part of a lot (eaten/removed). `quantity` is in the lot's
 * own unit; omit it to withdraw the whole remaining amount. A quantity above
 * what's left is clamped server-side (see PantryRemoval.clamped). Returns the
 * ledger row so the caller can offer an undo (deletePantryRemoval). */
export function addPantryRemoval(
  receiptItemId: string,
  reason: PantryRemovalReason,
  quantity?: number,
): Promise<PantryRemoval> {
  return request<PantryRemoval>('/pantry/removals', {
    method: 'POST',
    body: JSON.stringify({
      receipt_item_id: receiptItemId,
      reason,
      ...(quantity !== undefined ? { quantity } : {}),
    }),
  })
}

/** Undo a withdrawal -- the lot reappears in the pantry. */
export function deletePantryRemoval(removalId: string): Promise<void> {
  return request<void>(`/pantry/removals/${removalId}`, { method: 'DELETE' })
}

/** One food group's effective shelf-life estimate: the days the urgency sort
 * uses (code default merged with this profile's override), plus whether the
 * current value is a user override. `shelf_life_days` is null for groups with
 * no estimate (Other) or ones the user opted out. */
export interface ShelfLifeGroup {
  food_group: FoodGroup
  label: string
  shelf_life_days: number | null
  is_override: boolean
}

export interface ShelfLifeConfig {
  groups: ShelfLifeGroup[]
}

/** The effective per-group shelf-life config driving the pantry's urgency. */
export function getShelfLife(): Promise<ShelfLifeConfig> {
  return request<ShelfLifeConfig>('/pantry/shelf-life')
}

/** Save per-group overrides ({food_group: days|null}) for this profile and
 * get the recomputed effective config back. A null value opts a group out of
 * urgency; omit a group to keep its current value. */
export function updateShelfLife(
  days: Partial<Record<FoodGroup, number | null>>,
): Promise<ShelfLifeConfig> {
  return request<ShelfLifeConfig>('/pantry/shelf-life', {
    method: 'PUT',
    body: JSON.stringify({ days }),
  })
}

/** A candidate picked in the fix-match search, attached to a manual add so
 * its verified name + nutrition are used instead of the auto-resolver. */
export interface ManualItemMatch {
  matched_name: string
  off_id?: string | null
  bls_code?: string | null
  nutrition: CandidateNutrition
}

/** Manually add a food to the pantry (POST /pantry/items). Creates a one-item
 * confirmed "Manuell" receipt dated today, so the item appears in both the
 * pantry and the purchases view. Omit `match` to let the server resolve
 * nutrition from the name; pass one to use a fix-match pick. */
export function createPantryItem(input: {
  name: string
  quantity: number
  unit: string | null
  match?: ManualItemMatch | null
}): Promise<ReceiptItem> {
  return request<ReceiptItem>('/pantry/items', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      quantity: input.quantity,
      unit: input.unit,
      ...(input.match ? { match: input.match } : {}),
    }),
  })
}

// ── Feedback (recipe recommendations feature) ─────────────────────────────

export function submitFeedback(npsScore: number): Promise<void> {
  return request<void>('/feedback', {
    method: 'POST',
    body: JSON.stringify({ nps_score: npsScore }),
  })
}
