import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ApiError,
  generateRecipe,
  getRecipes,
  type Recipe,
  type RecipeGenerateInput,
} from '../lib/api'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; recipes: Recipe[] }

export function RecipesPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [cuisine, setCuisine] = useState('')
  const [maxTimeMinutes, setMaxTimeMinutes] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)

  useEffect(() => {
    getRecipes()
      .then((recipes) => setState({ status: 'ready', recipes }))
      .catch((err) => {
        setState({
          status: 'error',
          message: err instanceof ApiError ? err.message : 'Could not load your recipes.',
        })
      })
  }, [])

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

      const recipe = await generateRecipe(input)
      setState((prev) => ({
        status: 'ready',
        recipes: [recipe, ...(prev.status === 'ready' ? prev.recipes : [])],
      }))
      setCuisine('')
      setMaxTimeMinutes('')
    } catch (err) {
      setGenerateError(
        err instanceof ApiError ? err.message : 'Could not generate a recipe right now.',
      )
    } finally {
      setGenerating(false)
    }
  }

  return (
    <section>
      <h1>Recipes</h1>

      <form className="form" onSubmit={handleGenerate}>
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
          <label htmlFor="recipe-max-time">Max. total time in minutes (optional)</label>
          <input
            id="recipe-max-time"
            type="number"
            min={1}
            placeholder="e.g. 30"
            value={maxTimeMinutes}
            onChange={(e) => setMaxTimeMinutes(e.target.value)}
          />
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

      {state.status === 'loading' && <p>Loading…</p>}

      {state.status === 'error' && (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      )}

      {state.status === 'ready' && state.recipes.length === 0 && (
        <p>
          No recipes yet — fill in the form above (or leave it blank) and generate one.
        </p>
      )}

      {state.status === 'ready' &&
        state.recipes.map((recipe) => <RecipeCard key={recipe.id} recipe={recipe} />)}
    </section>
  )
}

function RecipeCard({ recipe }: { recipe: Recipe }) {
  return (
    <article className="recipe-card">
      <h2 className="recipe-card__title">{recipe.title}</h2>
      <p className="muted">
        Prep {recipe.prep_minutes} min · Cook {recipe.cook_minutes} min
      </p>

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
    </article>
  )
}
