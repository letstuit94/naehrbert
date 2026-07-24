import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getComposition,
  getPlantDiversity,
  getProfile,
  getSummary,
  getTargetComparison,
  getTargets,
  type CompositionResult,
  type Goal,
  type PlantDiversityItem,
  type PlantDiversityResult,
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
  const [plantDiversity, setPlantDiversity] = useState<Slice<PlantDiversityResult>>({
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
      getPlantDiversity(),
    ]).then(([s, c, t, tg, p, pd]) => {
      setSummary(settledSlice(s))
      setComposition(settledSlice(c))
      setComparison(settledSlice(t))
      setTargets(settledSlice(tg))
      setProfileGoal(p.status === 'fulfilled' ? p.value.goal : null)
      setPlantDiversity(settledSlice(pd))
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
        <ClosenessScore comparison={comparison.data} />
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

      {plantDiversity.data && !noReceiptsYet && (
        <PlantDiversitySection diversity={plantDiversity.data} />
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

const CLOSENESS_MACRO_ROWS: { label: string; macro: 'protein' | 'fat' | 'carb' }[] = [
  { label: 'Protein', macro: 'protein' },
  { label: 'Fat', macro: 'fat' },
  { label: 'Carbs', macro: 'carb' },
]

function ClosenessScore({ comparison }: { comparison: TargetComparisonResult }) {
  const score = comparison.closeness_score
  if (score === null) return null
  const status = score >= 80 ? 'good' : score >= 50 ? 'warning' : 'critical'

  // Same 3 per-macro |actual% - target%| differences the backend sums (see
  // analysis.py's get_target_comparison) -- shown individually so the final
  // score isn't just asserted, only the sum-then-subtract-from-100 step is
  // redone here, from these same already-rounded numbers.
  const diffs = CLOSENESS_MACRO_ROWS.map((row) => comparison.delta_pct[row.macro]).filter(
    (d): d is number => d !== null,
  )
  const totalDiff = diffs.length
    ? diffs.reduce((sum, d) => sum + Math.abs(d), 0)
    : null

  return (
    <div>
      <div className={`stat-tile stat-tile--hero stat-tile--${status}`}>
        <span className="stat-tile__label">Purchases vs. target</span>
        <span className="stat-tile__value">{score}/100</span>
      </div>

      <details className="details-panel">
        <summary>How this was calculated</summary>
        <dl className="kv-list">
          {CLOSENESS_MACRO_ROWS.map(({ label, macro }) => {
            const actual = comparison.actual_pct[macro]
            const target = comparison.target_pct[`${macro}_pct`]
            const delta = comparison.delta_pct[macro]
            return (
              <div key={macro}>
                <dt>
                  {label}: {actual ?? '—'}% actual vs {target ?? '—'}% target
                </dt>
                <dd>
                  {delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta} pts off`}
                </dd>
              </div>
            )
          })}
          <div>
            <dt>Total absolute difference</dt>
            <dd>{totalDiff === null ? '—' : `${totalDiff.toFixed(1)} pts`}</dd>
          </div>
          <div>
            <dt>= 100 − total difference</dt>
            <dd>{score}/100</dd>
          </div>
        </dl>
      </details>
    </div>
  )
}

// Same 4-color scale as ringTierColor above, re-purposed for an absolute
// count instead of a %-of-target ratio: red under 10 distinct plants,
// orange under 20, yellow under the 28-30 target range, green at/above it.
function plantDiversityColor(count: number): string {
  if (count < 10) return '#d03b3b' // red
  if (count < 20) return '#e07b1f' // orange
  if (count < 28) return '#d1a300' // yellow
  return '#0ca30c' // green
}

function PlantDiversitySection({ diversity }: { diversity: PlantDiversityResult }) {
  const { count, target, items } = diversity
  const color = plantDiversityColor(count)
  const pct = Math.min(100, Math.round((count / target) * 100))

  // Items already arrive grouped+sorted by the backend (fixed group order,
  // alphabetical within group) -- just fold consecutive same-group entries
  // together rather than re-deriving the grouping here.
  const groups: { label: string; items: PlantDiversityItem[] }[] = []
  for (const item of items) {
    const current = groups[groups.length - 1]
    if (current && current.label === item.group) {
      current.items.push(item)
    } else {
      groups.push({ label: item.group, items: [item] })
    }
  }

  return (
    <div className="section-divider">
      <h2>Plant diversity</h2>
      <p className="muted">
        Eat 30 different plants regularly to maximize gut
        microbiome diversity, improve immune function, and lower the risk of
        chronic diseases.
      </p>
      <div
        className="progress-bar"
        role="progressbar"
        aria-valuenow={count}
        aria-valuemin={0}
        aria-valuemax={target}
      >
        <div
          className="progress-bar__fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <p className="muted">
        <strong style={{ color }}>{count}</strong> / {target} different plants
      </p>

      <details className="details-panel">
        <summary>See what counted ({count})</summary>
        {groups.length === 0 ? (
          <p className="muted">Nothing purchased in this window yet.</p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="plant-diversity-group">
              <h3 className="plant-diversity-group__label">
                {group.label} ({group.items.length})
              </h3>
              <ul className="chip-list">
                {group.items.map((item) => (
                  <li key={item.name} className="chip">
                    {item.name}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </details>
    </div>
  )
}
