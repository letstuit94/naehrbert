import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getComposition,
  getDiversity,
  getSummary,
  getTargetComparison,
  getUnlockStatus,
  type CompositionResult,
  type DiversityResult,
  type SummaryResult,
  type TargetComparisonResult,
  type UnlockStatus,
} from '../lib/api'

type Slice<T> = { data: T | null; unavailable: boolean }

const MACROS = ['protein', 'fat', 'carb'] as const
const MACRO_LABEL: Record<(typeof MACROS)[number], string> = {
  protein: 'Protein',
  fat: 'Fat',
  carb: 'Carbs',
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
  const [diversity, setDiversity] = useState<Slice<DiversityResult>>({
    data: null,
    unavailable: false,
  })
  const [unlockStatus, setUnlockStatus] = useState<Slice<UnlockStatus>>({
    data: null,
    unavailable: false,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.allSettled([
      getSummary(),
      getComposition(),
      getTargetComparison(),
      getDiversity(),
      getUnlockStatus(),
    ]).then(([s, c, t, d, u]) => {
      setSummary(
        s.status === 'fulfilled'
          ? { data: s.value, unavailable: false }
          : { data: null, unavailable: true },
      )
      setComposition(
        c.status === 'fulfilled'
          ? { data: c.value, unavailable: false }
          : { data: null, unavailable: true },
      )
      setComparison(
        t.status === 'fulfilled'
          ? { data: t.value, unavailable: false }
          : { data: null, unavailable: true },
      )
      setDiversity(
        d.status === 'fulfilled'
          ? { data: d.value, unavailable: false }
          : { data: null, unavailable: true },
      )
      setUnlockStatus(
        u.status === 'fulfilled'
          ? { data: u.value, unavailable: false }
          : { data: null, unavailable: true },
      )
      setLoading(false)
    })
  }, [])

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

      {summary.data && summary.data.receipts_count > 0 && (
        <p className="muted">
          Based on {summary.data.receipts_count} confirmed receipt
          {summary.data.receipts_count === 1 ? '' : 's'} ({summary.data.items_count} item
          {summary.data.items_count === 1 ? '' : 's'}).
        </p>
      )}

      {noReceiptsYet && (
        <p className="callout">
          No confirmed receipts yet. <Link to="/upload">Upload one</Link> to see your
          macro split.
        </p>
      )}

      {comparison.data && !noReceiptsYet && (
        <ClosenessScore score={comparison.data.closeness_score} />
      )}

      {comparison.data && !noReceiptsYet ? (
        <MacroComparisonChart comparison={comparison.data} />
      ) : composition.data && !noReceiptsYet ? (
        <p className="callout">
          Set up your <Link to="/">profile</Link> to compare this against a target.
        </p>
      ) : null}

      {composition.data &&
        composition.data.unaccounted_pct !== null &&
        composition.data.unaccounted_pct > 5 && (
          <p className="callout callout--muted">
            {composition.data.unaccounted_pct}% of your calories come from items with only
            a rough category estimate, so they don't count toward any one macro above.
          </p>
        )}

      {diversity.data && diversity.data.recommendations.length > 0 && (
        <DiversityCallouts diversity={diversity.data} />
      )}

      {unlockStatus.data && <UnlockRecipesSection status={unlockStatus.data} />}
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

function ClosenessScore({ score }: { score: number | null }) {
  if (score === null) return null
  const status = score >= 80 ? 'good' : score >= 50 ? 'warning' : 'critical'
  return (
    <div className={`stat-tile stat-tile--hero stat-tile--${status}`}>
      <span className="stat-tile__label">Closeness to target</span>
      <span className="stat-tile__value">{score}/100</span>
    </div>
  )
}

function MacroComparisonChart({ comparison }: { comparison: TargetComparisonResult }) {
  return (
    <div className="viz-root macro-chart">
      <div className="macro-chart__legend">
        <span>
          <i className="swatch swatch--actual" /> Actual
        </span>
        <span>
          <i className="swatch swatch--target" /> Target
        </span>
      </div>
      {MACROS.map((macro) => {
        const actual = comparison.actual_pct[macro]
        const target =
          comparison.target_pct[`${macro}_pct` as keyof typeof comparison.target_pct]
        const delta = comparison.delta_pct[macro]
        return (
          <div className="macro-chart__row" key={macro}>
            <div className="macro-chart__row-label">
              {MACRO_LABEL[macro]}
              {delta !== null && (
                <span className="macro-chart__delta">
                  {delta > 0 ? `+${delta}` : delta}pp
                </span>
              )}
            </div>
            <div className="macro-chart__bars">
              <MacroBar variant="actual" value={actual} />
              <MacroBar variant="target" value={target} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MacroBar({
  variant,
  value,
}: {
  variant: 'actual' | 'target'
  value: number | null
}) {
  const pct = value ?? 0
  return (
    <div className="macro-chart__bar-track">
      <div
        className={`macro-chart__bar-fill macro-chart__bar-fill--${variant}`}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
      <span className="macro-chart__bar-label">{value === null ? '—' : `${value}%`}</span>
    </div>
  )
}

function DiversityCallouts({ diversity }: { diversity: DiversityResult }) {
  return (
    <div>
      <h2>Diversity</h2>
      <ul className="callout-list">
        {diversity.recommendations.map((rec, i) => (
          <li key={i} className="callout callout--muted">
            {rec}
          </li>
        ))}
      </ul>
    </div>
  )
}
