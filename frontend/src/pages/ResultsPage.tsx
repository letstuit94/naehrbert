import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  generateRecipe,
  getComposition,
  getProfile,
  getRecipes,
  getSummary,
  getTargetComparison,
  getTargets,
  getUnlockStatus,
  type CompositionResult,
  type Goal,
  type Recipe,
  type RecipeGenerateInput,
  type SummaryResult,
  type TargetComparisonResult,
  type TargetsResponse,
  type UnlockStatus,
} from '../lib/api'
import { GOAL_LABEL } from '../lib/chatSteps'

type Slice<T> = { data: T | null; unavailable: boolean }

function settledSlice<T>(result: PromiseSettledResult<T>): Slice<T> {
  return result.status === 'fulfilled'
    ? { data: result.value, unavailable: false }
    : { data: null, unavailable: true }
}

export function ResultsPage() {
  const [summary, setSummary] = useState<Slice<SummaryResult>>({
    data: null,
    unavailable: false,
  })
  const [composition, setComposition] = useState<Slice<CompositionResult>>({
    data: null,
    unavailable: false,
  })
  const [comparison, setComparison] = useState<Slice<TargetComparisonResult>>({
    data: null,
    unavailable: false,
  })
  const [targets, setTargets] = useState<Slice<TargetsResponse>>({
    data: null,
    unavailable: false,
  })
  const [profileGoal, setProfileGoal] = useState<Goal | null>(null)
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
    Promise.allSettled([
      getSummary(),
      getComposition(),
      getTargetComparison(),
      getTargets(),
      getProfile(),
      getUnlockStatus(),
      getRecipes(),
    ]).then(([s, c, t, tg, p, u, r]) => {
      setSummary(settledSlice(s))
      setComposition(settledSlice(c))
      setComparison(settledSlice(t))
      setTargets(settledSlice(tg))
      setProfileGoal(p.status === 'fulfilled' ? p.value.goal : null)
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
        <h1>Your results</h1>
        <p>Loading…</p>
      </section>
    )
  }

  const noReceiptsYet = composition.data?.items_considered === 0

  return (
    <section>
      <h1>Your results</h1>

      {!noReceiptsYet && composition.data && (
        <p className="muted">
          Based on what you've <strong>bought</strong> — not necessarily what you eat.
          Purchases are a proxy for your diet, not a food log.
        </p>
      )}

      {noReceiptsYet && (
        <p className="callout">
          No confirmed receipts yet. <Link to="/upload">Upload one</Link> to see your
          purchase macro split.
        </p>
      )}

      {comparison.data && !noReceiptsYet && (
        <ClosenessScore score={comparison.data.closeness_score} />
      )}

      {summary.data && summary.data.receipts_count > 0 && (
        <div className="summary-line">
          <p className="muted">
            Based on {summary.data.receipts_count} confirmed receipt
            {summary.data.receipts_count === 1 ? '' : 's'} ({summary.data.items_count}{' '}
            item
            {summary.data.items_count === 1 ? '' : 's'}).
          </p>
          <Link to="/upload" className="btn btn-secondary">
            Upload more
          </Link>
        </div>
      )}

      {targets.data?.targets && targets.data.targets_pct && (
        <TargetsSection
          targets={targets.data.targets}
          targetsPct={targets.data.targets_pct}
          goal={profileGoal}
          comparison={comparison.data}
        />
      )}

      {composition.data && !noReceiptsYet && !targets.data?.targets && (
        <p className="callout">
          Set up your <Link to="/">profile</Link> to compare this against a target.
        </p>
      )}

      {composition.data &&
        composition.data.unaccounted_pct !== null &&
        composition.data.unaccounted_pct > 5 && (
          <p className="callout callout--muted">
            {composition.data.unaccounted_pct}% of your calories come from items with only
            a rough category estimate, so they don't count toward any one macro above.
          </p>
        )}

      {!noReceiptsYet &&
        composition.data &&
        composition.data.match_coverage_pct !== null &&
        composition.data.match_coverage_pct < 80 && (
          <p className="callout callout--warning">
            Only {composition.data.match_coverage_pct}% of these calories come from
            confidently identified products; the rest are category estimates. Treat the
            split as a rough guide, not an exact figure.
          </p>
        )}

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

function TargetsSection({
  targets,
  targetsPct,
  goal,
  comparison,
}: {
  targets: NonNullable<TargetsResponse['targets']>
  targetsPct: NonNullable<TargetsResponse['targets_pct']>
  goal: Goal | null
  comparison: TargetComparisonResult | null
}) {
  // Derived rather than hardcoded from the goal->adjustment mapping, so this
  // stays correct even if the backend's constants change -- see
  // backend/app/services/ideal_profile.py's _GOAL_ADJ (-15% / 0% / +10%).
  const goalAdjustmentPct = Math.round(
    (targets.calories_kcal / targets.tdee_kcal - 1) * 100,
  )
  const goalLabel = goal ? GOAL_LABEL[goal] : null

  return (
    <div className="targets-section">
      <h2>Your targets</h2>

      <div className="stat-tile stat-tile--hero">
        <span className="stat-tile__label">Daily calories</span>
        <span className="stat-tile__value">
          {targets.calories_kcal.toLocaleString()} kcal
        </span>
      </div>

      {targets.constrained && targets.notes.length > 0 && (
        <p className="callout callout--warning">{targets.notes[0]}</p>
      )}

      <div className="macro-grid">
        <MacroRingTile
          label="Protein"
          grams={targets.protein_g}
          targetValue={targetsPct.protein_pct}
          actualValue={comparison?.actual_pct.protein ?? null}
          unit="pct"
        />
        <MacroRingTile
          label="Fat"
          grams={targets.fat_g}
          targetValue={targetsPct.fat_pct}
          actualValue={comparison?.actual_pct.fat ?? null}
          unit="pct"
        />
        <MacroRingTile
          label="Carbs"
          grams={targets.carbs_g}
          targetValue={targetsPct.carb_pct}
          actualValue={comparison?.actual_pct.carb ?? null}
          unit="pct"
        />
        <MacroRingTile
          label="Fiber"
          grams={targets.fiber_g}
          targetValue={comparison?.fiber_target_per_1000kcal ?? null}
          actualValue={comparison?.fiber_actual_per_1000kcal ?? null}
          unit="density"
        />
      </div>

      <details className="details-panel">
        <summary>How this was calculated</summary>
        <dl className="kv-list">
          <div>
            <dt>BMR</dt>
            <dd>{targets.bmr_kcal} kcal</dd>
          </div>
          <div>
            <dt>+ NEAT (daily movement)</dt>
            <dd>{targets.neat_kcal} kcal</dd>
          </div>
          <div>
            <dt>+ EAT (exercise)</dt>
            <dd>{targets.eat_kcal} kcal</dd>
          </div>
          <div>
            <dt>+ TEF (digestion)</dt>
            <dd>{targets.tef_kcal} kcal</dd>
          </div>
          <div>
            <dt>= TDEE</dt>
            <dd>{targets.tdee_kcal} kcal</dd>
          </div>
          <div>
            <dt>
              {goalAdjustmentPct >= 0 ? '+' : ''}
              {goalAdjustmentPct}% {goalLabel ? `(${goalLabel})` : '(goal adjustment)'}
            </dt>
            <dd>{targets.calories_kcal} kcal</dd>
          </div>
        </dl>
      </details>
    </div>
  )
}

// Ring color reflects how far actual is from target in EITHER direction --
// being well under is just as much a signal as being well over, so this is
// symmetric around 100% rather than only escalating above it.
function ringTierColor(ratioPct: number): string {
  const distance = Math.abs(ratioPct - 100)
  if (distance > 30) return '#d03b3b' // red
  if (distance > 20) return '#e07b1f' // orange
  if (distance > 10) return '#d1a300' // yellow
  if (distance > 5) return '#5cab1e' // bright green
  return '#0ca30c' // green
}

function MacroRingTile({
  label,
  grams,
  targetValue,
  actualValue,
  unit,
}: {
  label: string
  grams: number
  targetValue: number | null
  actualValue: number | null
  /** "pct" for Protein/Fat/Carbs (%-of-calories vs. their target %).
   * "density" for Fiber (g/1000kcal vs. its fixed 14g/1000kcal target) --
   * see ideal_profile.py's FIBER_G_PER_1000KCAL for why fiber isn't a
   * %-of-calories figure like the other three. */
  unit: 'pct' | 'density'
}) {
  const hasTracking = actualValue !== null && targetValue !== null && targetValue > 0
  const ratioPct = hasTracking ? Math.round((actualValue / targetValue) * 100) : null
  const color = ratioPct !== null ? ringTierColor(ratioPct) : 'var(--code-bg)'
  const fillPct = ratioPct !== null ? Math.min(100, ratioPct) : 0
  // More than 10% over/under target -> act on it; within that band, on track.
  const action =
    ratioPct === null ? null : ratioPct > 110 ? 'REDUCE' : ratioPct < 90 ? 'INCREASE' : 'KEEP'

  return (
    <div className="macro-ring-tile">
      <span className="macro-ring-tile__label">{label}</span>
      <div className="macro-ring">
        <div
          className="macro-ring__fill"
          style={{ background: `conic-gradient(${color} ${fillPct}%, var(--code-bg) 0)` }}
        />
        <div className="macro-ring__hole">
          <span className="macro-ring__value">{grams} g</span>
          {ratioPct !== null && (
            <span className="macro-ring__ratio" style={{ color }}>
              {ratioPct}%
            </span>
          )}
        </div>
      </div>
      <span className="macro-ring-tile__caption">
        {hasTracking
          ? unit === 'pct'
            ? `${actualValue}% of cal.`
            : `${actualValue} g/1000kcal`
          : 'No tracking data yet'}
      </span>
      {action !== null && <span className="macro-ring-tile__action">{action}</span>}
    </div>
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

function ClosenessScore({ score }: { score: number | null }) {
  if (score === null) return null
  const status = score >= 80 ? 'good' : score >= 50 ? 'warning' : 'critical'
  return (
    <div className={`stat-tile stat-tile--hero stat-tile--${status}`}>
      <span className="stat-tile__label">Purchases vs. target</span>
      <span className="stat-tile__value">{score}/100</span>
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
