import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  getProfile,
  getTargets,
  type Goal,
  type TargetsResponse,
} from '../lib/api'
import { GOAL_LABEL } from '../lib/chatSteps'

type LoadState =
  | { status: 'loading' }
  | { status: 'no-profile' }
  | { status: 'incomplete' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: TargetsResponse; goal: Goal | null }

export function TargetsPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    Promise.all([getTargets(), getProfile().catch(() => null)])
      .then(([targetsData, profile]) =>
        setState({ status: 'ready', data: targetsData, goal: profile?.goal ?? null }),
      )
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setState({ status: 'no-profile' })
        } else if (err instanceof ApiError && err.status === 422) {
          setState({ status: 'incomplete' })
        } else {
          setState({
            status: 'error',
            message: 'Could not load your targets. Please try again.',
          })
        }
      })
  }, [])

  if (state.status === 'loading') {
    return (
      <section>
        <h1>Your targets</h1>
        <p>Loading…</p>
      </section>
    )
  }

  if (state.status === 'no-profile' || state.status === 'incomplete') {
    return (
      <section>
        <h1>Your targets</h1>
        <p>
          {state.status === 'no-profile'
            ? "You haven't set up your profile yet."
            : 'Your profile is missing some information.'}{' '}
          <Link to="/">Complete onboarding</Link> to see your calorie and macro targets.
        </p>
      </section>
    )
  }

  if (state.status === 'error') {
    return (
      <section>
        <h1>Your targets</h1>
        <p className="form-error" role="alert">
          {state.message}
        </p>
      </section>
    )
  }

  const { targets, targets_pct: targetsPct } = state.data
  if (!targets || !targetsPct) {
    return (
      <section>
        <h1>Your targets</h1>
        <p>
          No targets available yet. <Link to="/">Edit your profile</Link>.
        </p>
      </section>
    )
  }

  // Derived rather than hardcoded from the goal->adjustment mapping, so this
  // stays correct even if the backend's constants change -- see
  // backend/app/services/ideal_profile.py's _GOAL_ADJ (-15% / 0% / +10%).
  const goalAdjustmentPct = Math.round(
    (targets.calories_kcal / targets.tdee_kcal - 1) * 100,
  )
  const goalLabel = state.goal ? GOAL_LABEL[state.goal] : null

  return (
    <section>
      <h1>Your targets</h1>

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
        <MacroTile
          label="Protein"
          grams={targets.protein_g}
          pct={targetsPct.protein_pct}
        />
        <MacroTile label="Fat" grams={targets.fat_g} pct={targetsPct.fat_pct} />
        <MacroTile label="Carbs" grams={targets.carbs_g} pct={targetsPct.carb_pct} />
        <MacroTile label="Fiber" grams={targets.fiber_g} pct={null} />
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
              × {goalAdjustmentPct >= 0 ? '+' : ''}
              {goalAdjustmentPct}% {goalLabel ? `(${goalLabel})` : '(goal adjustment)'}
            </dt>
            <dd>{targets.calories_kcal} kcal</dd>
          </div>
        </dl>
      </details>

      <p>
        <Link to="/">Edit profile</Link> · <Link to="/upload">Upload a receipt →</Link>
      </p>
    </section>
  )
}

function MacroTile({
  label,
  grams,
  pct,
}: {
  label: string
  grams: number
  pct: number | null
}) {
  return (
    <div className="stat-tile">
      <span className="stat-tile__label">{label}</span>
      <span className="stat-tile__value">{grams} g</span>
      {pct !== null && <span className="stat-tile__sub">{pct}% of calories</span>}
    </div>
  )
}
