import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, getRecipes, type Recipe } from '../lib/api'

type LoadState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; recipes: Recipe[] }

export function RecipesPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    getRecipes()
      .then((recipes) => {
        setState(
          recipes.length === 0 ? { status: 'empty' } : { status: 'ready', recipes },
        )
      })
      .catch((err) => {
        setState({
          status: 'error',
          message: err instanceof ApiError ? err.message : 'Could not load your recipes.',
        })
      })
  }, [])

  if (state.status === 'loading') {
    return (
      <section>
        <h1>Recipes</h1>
        <p>Loading…</p>
      </section>
    )
  }

  if (state.status === 'error') {
    return (
      <section>
        <h1>Recipes</h1>
        <p className="form-error" role="alert">
          {state.message}
        </p>
      </section>
    )
  }

  if (state.status === 'empty') {
    return (
      <section>
        <h1>Recipes</h1>
        <p>
          No recipes yet. Once you've uploaded 50+ matched food items, head to your{' '}
          <Link to="/results">Results</Link> to unlock recipe recommendations.
        </p>
      </section>
    )
  }

  return (
    <section>
      <h1>Recipes</h1>
      <p>
        Recipes Nährbert has suggested to help close your nutrient gaps, newest first.
      </p>

      {state.recipes.map((recipe) => (
        <RecipeCard key={recipe.id} recipe={recipe} />
      ))}
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
