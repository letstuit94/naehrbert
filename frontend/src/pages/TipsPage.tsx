import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  generateRecipe,
  getRecipes,
  getUnlockStatus,
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

  useEffect(() => {
    if (!loading && window.location.hash) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView()
    }
  }, [loading])

  if (loading) {
    return (
      <section>
        <h1>Recipes</h1>
        <p>Loading…</p>
      </section>
    )
  }

  return (
    <section>
      <h1>Recipes</h1>

      {unlockStatus.data?.unlocked && unlockStatus.data.prefs_completed ? (
        <>
          <h2 id="recipes">Recipe generation</h2>
          <RecipeGenerationForm onGenerated={prependRecipe} />

          <h2>Recipes</h2>
          {recipes.data && recipes.data.length === 0 && (
            <p>
              No recipes yet — fill in the form above (or leave it blank) and generate
              one.
            </p>
          )}
          {recipes.data?.map((recipe) => (
            <RecipeSummaryCard key={recipe.id} recipe={recipe} />
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

  async function handleGenerate(e: FormEvent) {
    e.preventDefault()
    setGenerating(true)
    setGenerateError(null)
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
    }
  }

  return (
    <form className="recipe-generate-form" onSubmit={handleGenerate}>
      <div className="form-row">
        <div className="form-field">
          <label htmlFor="recipe-cuisine">Cuisine (optional)</label>
          <input
            id="recipe-cuisine"
            type="text"
            placeholder="e.g. Italian, Thai, Mexican..."
            value={cuisine}
            onChange={(e) => setCuisine(e.target.value)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="recipe-max-time">Max. cooking time (minutes)</label>
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

function RecipeSummaryCard({ recipe }: { recipe: Recipe }) {
  const totalMinutes = recipe.prep_minutes + recipe.cook_minutes
  const share = macroShare(recipe)
  const kcalPerServing =
    recipe.servings && recipe.servings > 0
      ? Math.round(recipe.calories_kcal / recipe.servings)
      : null

  return (
    <details className="recipe-card">
      <summary className="recipe-card__summary">
        <span className="recipe-card__title">{recipe.title}</span>
        <span className="recipe-card__meta">
          {totalMinutes} min · Serves {recipe.servings ?? '—'} ·{' '}
          {kcalPerServing !== null
            ? `${kcalPerServing} kcal/serving`
            : `${Math.round(recipe.calories_kcal)} kcal total`}
          {share && ` · P ${share.protein}% F ${share.fat}% C ${share.carb}%`}
        </span>
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

        <p className="recipe-card__macros">
          {Math.round(recipe.calories_kcal)} kcal · P {Math.round(recipe.protein_g)}g · F{' '}
          {Math.round(recipe.fat_g)}g · C {Math.round(recipe.carbs_g)}g · Fiber{' '}
          {Math.round(recipe.fiber_g)}g
        </p>
        <p className="muted recipe-card__estimate-note">
          Estimated by Nährbert — shop these ingredients and upload the receipt to log the
          exact numbers.
        </p>
      </div>
    </details>
  )
}
