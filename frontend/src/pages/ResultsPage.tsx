import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getComposition,
  getProfile,
  getSummary,
  getTargetComparison,
  getTargets,
  type CompositionResult,
  type Goal,
  type SummaryResult,
  type TargetComparisonResult,
  type TargetsResponse,
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
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.allSettled([
      getSummary(),
      getComposition(),
      getTargetComparison(),
      getTargets(),
      getProfile(),
    ]).then(([s, c, t, tg, p]) => {
      setSummary(settledSlice(s))
      setComposition(settledSlice(c))
      setComparison(settledSlice(t))
      setTargets(settledSlice(tg))
      setProfileGoal(p.status === 'fulfilled' ? p.value.goal : null)
      setLoading(false)
    })
  }, [])

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
          Based on what you've <strong>bought</strong>, weighted toward your recent
          purchases — not necessarily what you eat. Purchases are a proxy for your diet,
          not a food log.
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

      {!noReceiptsYet && composition.data && composition.data.low_confidence && (
        <p className="callout callout--warning">
          <strong>These numbers are still shaky.</strong>{' '}
          {composition.data.receipts_considered < 3 &&
            `Only ${composition.data.receipts_considered} confirmed receipt${
              composition.data.receipts_considered === 1 ? '' : 's'
            } so far. `}
          {composition.data.match_coverage_pct !== null &&
            composition.data.match_coverage_pct < 60 &&
            `${composition.data.match_coverage_pct}% of the calories are category estimates rather than identified products. `}
          They'll sharpen as you upload more receipts.
        </p>
      )}

      {!noReceiptsYet &&
        composition.data &&
        !composition.data.low_confidence &&
        composition.data.match_coverage_pct !== null &&
        composition.data.match_coverage_pct < 80 && (
          <p className="callout callout--muted">
            {composition.data.match_coverage_pct}% of these calories come from confidently
            identified products; the rest are category estimates. Treat the split as a
            rough guide.
          </p>
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
