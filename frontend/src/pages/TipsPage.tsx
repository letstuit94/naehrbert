import { useEffect, useRef, useState } from 'react'
import { PageSkeleton } from '../components/Skeleton'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  archiveRecipe,
  generateRecipe,
  getRecipes,
  getUnlockStatus,
  setRecipeFeedback,
  type DietaryStyle,
  type Recipe,
  type RecipeGenerateInput,
  type UnlockStatus,
} from '../lib/api'

type Slice<T> = { data: T | null; unavailable: boolean }

function settledSlice<T>(result: PromiseSettledResult<T>): Slice<T> {
  return result.status === 'fulfilled'
    ? { data: result.value, unavailable: false }
    : { data: null, unavailable: true }
}

// Filter chip labels intentionally plainer than the badge text on the card
// itself (DIETARY_LABEL_DISPLAY below) -- "Meat"/"Fish"/"Veggie" read faster
// as quick filter toggles than the more precise "Omnivore"/"Pescatarian".
const LABEL_FILTERS: { value: DietaryStyle; label: string }[] = [
  { value: 'omnivore', label: 'Meat' },
  { value: 'pescatarian', label: 'Fish' },
  { value: 'vegetarian', label: 'Veggie' },
  { value: 'vegan', label: 'Vegan' },
]

const DIETARY_LABEL_DISPLAY: Record<DietaryStyle, string> = {
  omnivore: 'Omnivore',
  pescatarian: 'Pescatarian',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
}

// Restrictiveness order (fewer animal products -> higher rank) -- mirrors
// backend/app/services/recipe_engine.py's _DIET_RANK, which uses the exact
// same hierarchy to check a generated recipe against the requested diet.
// vegan/vegetarian/pescatarian nest: a vegan recipe (zero animal products)
// is *also*, definitionally, vegetarian (no meat/fish) and pescatarian (no
// meat) -- so selecting "Veggie" alone must still surface vegan recipes,
// not just ones explicitly labeled vegetarian. "Meat" (omnivore) is
// deliberately NOT part of that widening: it's a "this recipe contains
// meat" tag, not a restriction level with a looser tier below it -- if it
// widened the same way (rank 0 matching everything), selecting only
// "Meat" would show every recipe instead of just the ones with meat in
// them, making it a no-op filter.
const DIET_RANK: Record<DietaryStyle, number> = {
  omnivore: 0,
  pescatarian: 1,
  vegetarian: 2,
  vegan: 3,
}

function matchesLabelFilters(recipe: Recipe, activeLabels: Set<DietaryStyle>): boolean {
  // A recipe with no label (generated before dietary_label existed) always
  // shows -- filtering out data we simply don't have would silently hide
  // older recipes rather than just not classifying them.
  if (!recipe.dietary_label) return true

  if (recipe.dietary_label === 'omnivore') return activeLabels.has('omnivore')

  const recipeRank = DIET_RANK[recipe.dietary_label]
  for (const filter of activeLabels) {
    if (filter !== 'omnivore' && DIET_RANK[filter] <= recipeRank) return true
  }
  return false
}

function matchesSearch(recipe: Recipe, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (recipe.title.toLowerCase().includes(q)) return true
  return recipe.ingredients.some((ing) => ing.name.toLowerCase().includes(q))
}

// Recipe generation + the recipe list (and the "unlock recipes" gate that
// precedes them) were split out of Results into their own "Recipes" page so
// Results stays a pure analysis view. This page only needs the unlock status
// and the recipe list -- not the full targets/composition fetch Results does.
export function TipsPage() {
  const [unlockStatus, setUnlockStatus] = useState<Slice<UnlockStatus>>({
    data: null,
    unavailable: false,
  })
  const [recipes, setRecipes] = useState<Slice<Recipe[]>>({
    data: null,
    unavailable: false,
  })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeLabels, setActiveLabels] = useState<Set<DietaryStyle>>(
    new Set(LABEL_FILTERS.map((f) => f.value)),
  )

  useEffect(() => {
    Promise.allSettled([getUnlockStatus(), getRecipes()]).then(([u, r]) => {
      setUnlockStatus(settledSlice(u))
      setRecipes(settledSlice(r))
      setLoading(false)
    })
  }, [])

  function prependRecipe(recipe: Recipe) {
    setRecipes((prev) => ({ data: [recipe, ...(prev.data ?? [])], unavailable: false }))
  }

  function removeRecipe(id: string) {
    setRecipes((prev) => ({
      data: (prev.data ?? []).filter((r) => r.id !== id),
      unavailable: false,
    }))
  }

  function replaceRecipe(updated: Recipe) {
    setRecipes((prev) => ({
      data: (prev.data ?? []).map((r) => (r.id === updated.id ? updated : r)),
      unavailable: false,
    }))
  }

  function toggleLabelFilter(value: DietaryStyle) {
    setActiveLabels((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  function resetFilters() {
    setSearch('')
    setActiveLabels(new Set(LABEL_FILTERS.map((f) => f.value)))
  }

  useEffect(() => {
    if (!loading && window.location.hash) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView()
    }
  }, [loading])

  if (loading) {
    return (
      <section aria-busy="true">
        <h1>Recipes</h1>
        <PageSkeleton cards={3} lines={2} />
      </section>
    )
  }

  const allRecipes = recipes.data ?? []
  const visibleRecipes = allRecipes.filter(
    (r) => matchesSearch(r, search) && matchesLabelFilters(r, activeLabels),
  )

  return (
    <section>
      <h1>Recipes</h1>
      <p className="page-lead">
        Recipes are to generated to help close the gap from your Result page, using your saved dietary
        preferences plus whatever cuisine, time and servings you set below.
      </p>

      {unlockStatus.data?.unlocked && unlockStatus.data.prefs_completed ? (
        <>
          <h2 id="recipes">Recipe generation</h2>
          <RecipeGenerationForm onGenerated={prependRecipe} />

          <h2>Your recipes</h2>
          {allRecipes.length === 0 && (
            <p>
              No recipes yet — fill in the form above (or leave it blank) and generate
              one.
            </p>
          )}

          {allRecipes.length > 0 && (
            <div className="recipe-filters">
              <div
                className="filter-bar"
                role="group"
                aria-label="Filter by dietary label"
              >
                {LABEL_FILTERS.map((filter) => {
                  const active = activeLabels.has(filter.value)
                  return (
                    <button
                      key={filter.value}
                      type="button"
                      className={
                        active ? 'filter-chip filter-chip--active' : 'filter-chip'
                      }
                      aria-pressed={active}
                      onClick={() => toggleLabelFilter(filter.value)}
                    >
                      {active && (
                        <span className="filter-chip__check" aria-hidden="true">
                          ✓
                        </span>
                      )}
                      {filter.label}
                    </button>
                  )
                })}
              </div>
              <input
                type="search"
                className="recipe-search-input"
                placeholder="Search recipes or ingredients…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search recipes"
              />
            </div>
          )}

          {allRecipes.length > 0 && visibleRecipes.length === 0 && (
            <div className="empty-state">
              <span className="empty-state__emoji" aria-hidden="true">
                🔍
              </span>
              <p>No recipes match your search or filters.</p>
              <button type="button" className="btn btn-soft" onClick={resetFilters}>
                Clear filters
              </button>
            </div>
          )}

          {visibleRecipes.map((recipe) => (
            <RecipeSummaryCard
              key={recipe.id}
              recipe={recipe}
              onArchived={() => removeRecipe(recipe.id)}
              onFeedback={replaceRecipe}
            />
          ))}
        </>
      ) : (
        unlockStatus.data && <UnlockRecipesSection status={unlockStatus.data} />
      )}
    </section>
  )
}

function UnlockRecipesSection({ status }: { status: UnlockStatus }) {
  const pct = Math.min(
    100,
    Math.round((status.matched_items_count / status.threshold) * 100),
  )

  return (
    <div className="unlock-recipes">
      <h2>Unlock recipes</h2>
      {status.unlocked ? (
        <>
          <p className="callout callout--success">
            You've uploaded {status.matched_items_count} matched food items -- recipe
            recommendations are unlocked.
          </p>
          <Link to="/recipes/new" className="btn btn-primary">
            Get recipe recommendations to close your gaps
          </Link>
        </>
      ) : (
        <>
          <p>To unlock recipe recommendations upload 50+ food items.</p>
          <div
            className="progress-bar"
            role="progressbar"
            aria-valuenow={status.matched_items_count}
            aria-valuemin={0}
            aria-valuemax={status.threshold}
          >
            <div className="progress-bar__fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="muted">
            {status.matched_items_count} / {status.threshold} matched items
          </p>
        </>
      )}
    </div>
  )
}

// Purely cosmetic while the one Gemini call is in flight -- there's no
// discrete backend phase to reflect (unlike Upload's OCR->parse->match
// steps), so these just rotate on a timer to keep the wait from feeling
// like a frozen "Generating..." button.
const FUN_GENERATING_PHRASES = [
  "Digging through Grandma's cookbook for something you'll love…",
  'Double-checking it fits your targets and your taste…',
  'Adding a little Nährbert magic…',
] as const
const PHRASE_ROTATE_MS = 5000

function RecipeGenerationForm({
  onGenerated,
}: {
  onGenerated: (recipe: Recipe) => void
}) {
  const [cuisine, setCuisine] = useState('')
  const [maxTimeMinutes, setMaxTimeMinutes] = useState('')
  const [servings, setServings] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [phraseIndex, setPhraseIndex] = useState(0)
  const phraseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function startPhraseRotation() {
    setPhraseIndex(0)
    if (phraseTimerRef.current) clearInterval(phraseTimerRef.current)
    phraseTimerRef.current = setInterval(() => {
      setPhraseIndex((i) => (i + 1) % FUN_GENERATING_PHRASES.length)
    }, PHRASE_ROTATE_MS)
  }

  function stopPhraseRotation() {
    if (phraseTimerRef.current) {
      clearInterval(phraseTimerRef.current)
      phraseTimerRef.current = null
    }
  }

  useEffect(() => stopPhraseRotation, [])

  async function handleGenerate(e: FormEvent) {
    e.preventDefault()
    setGenerating(true)
    setGenerateError(null)
    startPhraseRotation()
    try {
      const input: RecipeGenerateInput = {}
      const trimmedCuisine = cuisine.trim()
      if (trimmedCuisine) input.cuisine = trimmedCuisine
      const parsedTime = Number(maxTimeMinutes)
      if (maxTimeMinutes.trim() && Number.isFinite(parsedTime) && parsedTime > 0) {
        input.max_time_minutes = parsedTime
      }
      const parsedServings = Number(servings)
      if (servings.trim() && Number.isFinite(parsedServings) && parsedServings > 0) {
        input.servings = parsedServings
      }

      const recipe = await generateRecipe(input)
      onGenerated(recipe)
      setCuisine('')
      setMaxTimeMinutes('')
      setServings('')
    } catch (err) {
      setGenerateError(
        err instanceof ApiError ? err.message : 'Could not generate a recipe right now.',
      )
    } finally {
      setGenerating(false)
      stopPhraseRotation()
    }
  }

  return (
    <form className="recipe-generate-form" onSubmit={handleGenerate}>
      <div className="form-row">
        <div className="form-field">
          <label htmlFor="recipe-cuisine">Cuisine</label>
          <input
            id="recipe-cuisine"
            type="text"
            placeholder="e.g. Italian, Thai, Mexican..."
            value={cuisine}
            onChange={(e) => setCuisine(e.target.value)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="recipe-max-time">Max. cooking time </label>
          <input
            id="recipe-max-time"
            type="number"
            min={1}
            placeholder="e.g. 30"
            value={maxTimeMinutes}
            onChange={(e) => setMaxTimeMinutes(e.target.value)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="recipe-servings">Servings / portions </label>
          <input
            id="recipe-servings"
            type="number"
            min={1}
            placeholder="e.g. 2"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
          />
        </div>
      </div>

      {generateError && (
        <p className="form-error" role="alert">
          {generateError}
        </p>
      )}

      <button className="btn btn-primary" type="submit" disabled={generating}>
        {generating ? 'Generating…' : 'Generate recipe'}
      </button>

      {generating && (
        <p className="muted recipe-generating-note">
          {FUN_GENERATING_PHRASES[phraseIndex]}
        </p>
      )}
    </form>
  )
}

function macroShare(
  recipe: Recipe,
): { protein: number; fat: number; carb: number } | null {
  const proteinKcal = recipe.protein_g * 4
  const fatKcal = recipe.fat_g * 9
  const carbKcal = recipe.carbs_g * 4
  const total = proteinKcal + fatKcal + carbKcal
  if (total <= 0) return null
  return {
    protein: Math.round((proteinKcal / total) * 100),
    fat: Math.round((fatKcal / total) * 100),
    carb: Math.round((carbKcal / total) * 100),
  }
}

function RecipeSummaryCard({
  recipe,
  onArchived,
  onFeedback,
}: {
  recipe: Recipe
  onArchived: () => void
  onFeedback: (updated: Recipe) => void
}) {
  const totalMinutes = recipe.prep_minutes + recipe.cook_minutes
  const share = macroShare(recipe)
  const kcalPerServing =
    recipe.servings && recipe.servings > 0
      ? Math.round(recipe.calories_kcal / recipe.servings)
      : null
  const [archiving, setArchiving] = useState(false)
  const [feedbackBusy, setFeedbackBusy] = useState(false)

  async function handleDelete() {
    if (!window.confirm(`Delete "${recipe.title}"? This can't be undone.`)) return
    setArchiving(true)
    try {
      await archiveRecipe(recipe.id)
      onArchived()
    } catch {
      window.alert('Could not delete that recipe. Please try again.')
      setArchiving(false)
    }
  }

  // Tapping the already-active thumb again clears it (sends null) rather
  // than being a one-way rating.
  async function handleFeedback(value: 'up' | 'down') {
    if (feedbackBusy) return
    const next = recipe.feedback === value ? null : value
    setFeedbackBusy(true)
    try {
      const updated = await setRecipeFeedback(recipe.id, next)
      onFeedback(updated)
    } catch {
      // best-effort -- a rating that fails to save isn't worth an error banner
    } finally {
      setFeedbackBusy(false)
    }
  }

  return (
    <details className="recipe-card">
      <summary className="recipe-card__summary">
        {/* Native <details> only renders/hit-tests <summary>'s own subtree
            while closed -- everything else in a closed <details> is
            unclickable regardless of position:absolute, so the delete
            button has to live inside <summary>, not beside it. Its click
            handler calls preventDefault()/stopPropagation() so pressing it
            doesn't also toggle the card open (summary's native behavior). */}
        <button
          type="button"
          className="review-row__delete recipe-card__delete"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void handleDelete()
          }}
          disabled={archiving}
          aria-label={`Delete ${recipe.title}`}
        >
          ×
        </button>
        <div className="recipe-card__title-row">
          <span className="recipe-card__title">{recipe.title}</span>
        </div>
        <div className="recipe-card__meta-row">
          <span className="recipe-card__meta">
            {totalMinutes} min · Serves {recipe.servings ?? '—'} ·{' '}
            {kcalPerServing !== null
              ? `${kcalPerServing} kcal/serving`
              : `${Math.round(recipe.calories_kcal)} kcal total`}
            {share && ` · P ${share.protein}% F ${share.fat}% C ${share.carb}%`}
          </span>
          {recipe.dietary_label && (
            <span className="chip recipe-card__label">
              {DIETARY_LABEL_DISPLAY[recipe.dietary_label]}
            </span>
          )}
        </div>
      </summary>

      <div className="recipe-card__body">
        <h3>Ingredients</h3>
        <ul className="recipe-card__ingredients">
          {recipe.ingredients.map((ing, i) => (
            <li key={i}>
              {ing.quantity} {ing.name}
            </li>
          ))}
        </ul>

        <h3>Steps</h3>
        <ol className="recipe-card__steps">
          {recipe.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>

        <h3>Nutrition</h3>
        <div className="recipe-card__nutrition">
          <span className="nutrient-chip">
            <strong>{Math.round(recipe.calories_kcal)}</strong> kcal
          </span>
          <span className="nutrient-chip">
            <strong>{Math.round(recipe.protein_g)}g</strong> protein
          </span>
          <span className="nutrient-chip">
            <strong>{Math.round(recipe.fat_g)}g</strong> fat
          </span>
          <span className="nutrient-chip">
            <strong>{Math.round(recipe.carbs_g)}g</strong> carbs
          </span>
          <span className="nutrient-chip">
            <strong>{Math.round(recipe.fiber_g)}g</strong> fiber
          </span>
        </div>
        <p className="muted recipe-card__estimate-note">
          Whole recipe, estimated by Nährbert — shop these ingredients and upload the
          receipt to log the exact numbers.
        </p>

        <div className="recipe-card__feedback">
          <span className="muted">What did you think of this recipe?</span>
          <button
            type="button"
            className={
              recipe.feedback === 'up'
                ? 'recipe-card__feedback-btn recipe-card__feedback-btn--active'
                : 'recipe-card__feedback-btn'
            }
            onClick={() => handleFeedback('up')}
            disabled={feedbackBusy}
            aria-pressed={recipe.feedback === 'up'}
            aria-label="Thumbs up"
          >
            👍
          </button>
          <button
            type="button"
            className={
              recipe.feedback === 'down'
                ? 'recipe-card__feedback-btn recipe-card__feedback-btn--active'
                : 'recipe-card__feedback-btn'
            }
            onClick={() => handleFeedback('down')}
            disabled={feedbackBusy}
            aria-pressed={recipe.feedback === 'down'}
            aria-label="Thumbs down"
          >
            👎
          </button>
        </div>
      </div>
    </details>
  )
}
