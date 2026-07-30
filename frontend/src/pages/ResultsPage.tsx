import { Fragment, useEffect, useState } from 'react'
import { PageSkeleton } from '../components/Skeleton'
import { Link } from 'react-router-dom'
import {
  getComposition,
  getDiversity,
  getMealCoverage,
  getMicronutrients,
  getPlantDiversity,
  getProfile,
  getSummary,
  getTargetComparison,
  getTargets,
  type CompositionResult,
  type DiversityDriver,
  type DiversityResult,
  type Goal,
  type MealCoverageResult,
  type MicronutrientsResult,
  type PlantDiversityItem,
  type PlantDiversityResult,
  type SummaryResult,
  type TargetComparisonResult,
  type TargetsResponse,
} from '../lib/api'
import { goalLabel as goalLabelFor } from '../lib/chatSteps'
import { useI18n, type TranslateFn } from '../lib/i18n'

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
  const [diversity, setDiversity] = useState<Slice<DiversityResult>>({
    data: null,
    unavailable: false,
  })
  const [mealCoverage, setMealCoverage] = useState<Slice<MealCoverageResult>>({
    data: null,
    unavailable: false,
  })
  const [micronutrients, setMicronutrients] = useState<Slice<MicronutrientsResult>>({
    data: null,
    unavailable: false,
  })
  const [profileGoal, setProfileGoal] = useState<Goal | null>(null)
  const [loading, setLoading] = useState(true)
  const { t } = useI18n()

  useEffect(() => {
    Promise.allSettled([
      getSummary(),
      getComposition(),
      getTargetComparison(),
      getTargets(),
      getProfile(),
      getPlantDiversity(),
      getDiversity(),
      getMealCoverage(),
      getMicronutrients(),
    ]).then(([s, c, t, tg, p, pd, d, mc, mn]) => {
      setSummary(settledSlice(s))
      setComposition(settledSlice(c))
      setComparison(settledSlice(t))
      setTargets(settledSlice(tg))
      setProfileGoal(p.status === 'fulfilled' ? p.value.goal : null)
      setPlantDiversity(settledSlice(pd))
      setDiversity(settledSlice(d))
      setMealCoverage(settledSlice(mc))
      setMicronutrients(settledSlice(mn))
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
      <section aria-busy="true">
        <h1>{t('Your insights', 'Deine Einblicke')}</h1>
        <PageSkeleton cards={2} lines={3} />
      </section>
    )
  }

  const noReceiptsYet = composition.data?.items_considered === 0

  return (
    <section>
      <h1>
        {t('Your insights', 'Deine Einblicke')}{' '}
        <span className="title-note">
          {t('(calculated over the last 28 days)', '(berechnet über die letzten 28 Tage)')}
        </span>
      </h1>
      <p className="page-lead">
        {t(
          "How your recent shopping stacks up against your targets — think trends, not exact numbers. Based on your purchases, weighted toward what's recent — this reflects your diet, not a food log.",
          'Wie sich dein jüngster Einkauf im Vergleich zu deinen Zielen schlägt – denk in Trends, nicht in exakten Zahlen. Basiert auf deinen Einkäufen, stärker gewichtet nach dem, was aktuell ist – das spiegelt deine Ernährung wider, kein Ernährungstagebuch.',
        )}
      </p>

      {!noReceiptsYet && composition.data && <p className="muted"></p>}

      {noReceiptsYet && (
        <p className="callout">
          {t('No confirmed receipts yet.', 'Noch keine bestätigten Belege.')}{' '}
          <Link to="/upload">{t('Upload one', 'Lade einen hoch')}</Link>{' '}
          {t(
            'to see your purchase macro split.',
            'um die Makro-Aufteilung deiner Einkäufe zu sehen.',
          )}
        </p>
      )}

      {comparison.data && !noReceiptsYet && (
        <ClosenessScore comparison={comparison.data} />
      )}

      {summary.data && summary.data.receipts_count > 0 && (
        <div className="summary-line">
          <p className="muted">
            {t('Based on', 'Basiert auf')} {summary.data.receipts_count}{' '}
            {t(
              summary.data.receipts_count === 1 ? 'confirmed receipt' : 'confirmed receipts',
              summary.data.receipts_count === 1 ? 'bestätigtem Beleg' : 'bestätigten Belegen',
            )}{' '}
            ({summary.data.items_count}{' '}
            {t(
              summary.data.items_count === 1 ? 'item' : 'items',
              summary.data.items_count === 1 ? 'Artikel' : 'Artikeln',
            )}
            ).
          </p>
          <Link to="/upload" className="btn btn-secondary btn-accent">
            {t('Upload more', 'Mehr hochladen')}
          </Link>
        </div>
      )}

      {targets.data?.targets && targets.data.targets_pct && (
        <TargetsSection
          targets={targets.data.targets}
          targetsPct={targets.data.targets_pct}
          goal={profileGoal}
          comparison={comparison.data}
          diversity={diversity.data}
          mealCoverage={mealCoverage.data}
        />
      )}

      {composition.data && !noReceiptsYet && !targets.data?.targets && (
        <p className="callout">
          {t('Set up your', 'Richte dein')}{' '}
          <Link to="/">{t('profile', 'Profil')}</Link>{' '}
          {t('to compare this against a target.', 'ein, um das mit einem Ziel zu vergleichen.')}
        </p>
      )}

      {composition.data &&
        composition.data.fallback_share_pct !== null &&
        composition.data.fallback_share_pct > 5 && (
          <p className="callout callout--muted">
            {t(
              `${composition.data.fallback_share_pct}% of your calories rely on a category estimate rather than an exact product match — they're already included in the macro split above, just with lower confidence.`,
              `${composition.data.fallback_share_pct}% deiner Kalorien beruhen auf einer Kategorie-Schätzung statt auf einem exakten Produkt-Match – sie sind oben in der Makro-Aufteilung bereits enthalten, nur mit geringerer Sicherheit.`,
            )}
          </p>
        )}

      {composition.data && composition.data.unaccounted_items_count > 0 && (
        <p className="callout callout--muted">
          {t(
            `${composition.data.unaccounted_items_count}/${composition.data.items_considered} purchased items have incomplete product data, so they don't count toward any one macro above.`,
            `${composition.data.unaccounted_items_count}/${composition.data.items_considered} gekaufte Artikel haben unvollständige Produktdaten und zählen daher zu keinem der obigen Makros.`,
          )}
        </p>
      )}

      {!noReceiptsYet && composition.data && composition.data.low_confidence && (
        <p className="callout callout--warning">
          <strong>{t('These numbers are still shaky.', 'Diese Zahlen sind noch wackelig.')}</strong>{' '}
          {composition.data.receipts_considered < 3 &&
            t(
              `Only ${composition.data.receipts_considered} confirmed receipt${
                composition.data.receipts_considered === 1 ? '' : 's'
              } so far. `,
              `Bisher erst ${composition.data.receipts_considered} bestätigte${
                composition.data.receipts_considered === 1 ? 'r Beleg' : ' Belege'
              }. `,
            )}
          {composition.data.match_coverage_pct !== null &&
            composition.data.match_coverage_pct < 60 &&
            t(
              `${composition.data.match_coverage_pct}% of the calories are category estimates rather than identified products. `,
              `${composition.data.match_coverage_pct}% der Kalorien sind Kategorie-Schätzungen statt identifizierter Produkte. `,
            )}
          {t(
            "They'll sharpen as you upload more receipts.",
            'Sie werden schärfer, je mehr Belege du hochlädst.',
          )}
        </p>
      )}

      {!noReceiptsYet &&
        composition.data &&
        !composition.data.low_confidence &&
        composition.data.match_coverage_pct !== null &&
        composition.data.match_coverage_pct < 80 && (
          <p className="callout callout--muted">
            {t(
              `${composition.data.match_coverage_pct}% of these calories come from confidently identified products; the rest are category estimates. Treat the split as a rough guide.`,
              `${composition.data.match_coverage_pct}% dieser Kalorien stammen aus sicher identifizierten Produkten; der Rest sind Kategorie-Schätzungen. Nimm die Aufteilung als groben Anhaltspunkt.`,
            )}
          </p>
        )}

      {plantDiversity.data && !noReceiptsYet && (
        <PlantDiversitySection diversity={plantDiversity.data} />
      )}

      {micronutrients.data && !noReceiptsYet && (
        <MicronutrientsSection micronutrients={micronutrients.data} />
      )}
    </section>
  )
}

type MacroKey = 'protein' | 'fat' | 'carb' | 'fiber'

function macroLabels(t: TranslateFn): Record<MacroKey, string> {
  return {
    protein: t('Protein', 'Protein'),
    fat: t('Fat', 'Fett'),
    carb: t('Carbs', 'Kohlenhydrate'),
    fiber: t('Fiber', 'Ballaststoffe'),
  }
}

// Shown above both the macro-grid and the micronutrients table -- these
// values only ever reflect scanned supermarket purchases, never a meal log,
// so any gap against target could be genuine or could just be untracked
// eating (home-cooked meals not run through Upload, eating out, etc.).
function purchasesOnlyNote(t: TranslateFn): string {
  return t(
    'These are the values counted from your supermarket purchases. Any gaps you should ideally close with all your other consumed meals — or try running more of your home-cooked meals through the app to track them too.',
    'Das sind die Werte aus deinen Supermarkt-Einkäufen. Etwaige Lücken solltest du idealerweise mit all deinen übrigen Mahlzeiten schließen – oder erfasse mehr deiner selbst gekochten Mahlzeiten über die App.',
  )
}

function TargetsSection({
  targets,
  targetsPct,
  goal,
  comparison,
  diversity,
  mealCoverage,
}: {
  targets: NonNullable<TargetsResponse['targets']>
  targetsPct: NonNullable<TargetsResponse['targets_pct']>
  goal: Goal | null
  comparison: TargetComparisonResult | null
  diversity: DiversityResult | null
  mealCoverage: MealCoverageResult | null
}) {
  const { t } = useI18n()
  // Derived rather than hardcoded from the goal->adjustment mapping, so this
  // stays correct even if the backend's constants change -- see
  // backend/app/services/ideal_profile.py's _GOAL_ADJ (-15% / 0% / +10%).
  const goalAdjustmentPct = Math.round(
    (targets.calories_kcal / targets.tdee_kcal - 1) * 100,
  )
  const goalLabel = goal ? goalLabelFor(t, goal) : null

  // At most one macro's driver list is expanded at a time -- one shared
  // panel below, rather than 4 independent inline expanders, so it can span
  // the full row and float over whatever's below it instead of squeezing
  // into a single 140px-wide card.
  const [expandedMacro, setExpandedMacro] = useState<MacroKey | null>(null)
  const expandedDrivers = expandedMacro ? diversity?.[expandedMacro].top_drivers : undefined

  // Average daily calories purchased, as a fraction of the daily target --
  // shown inline on the Daily calories card rather than as its own "X meals
  // covered" tile. Divides by days_of_data (capped at window_days, but
  // shorter for a user whose earliest purchase is more recent than the
  // window itself), not blindly by the window -- otherwise a user 17 days
  // in would have their average diluted by 11 days with no purchases at all.
  const avgDailyKcal = mealCoverage
    ? Math.round(mealCoverage.effective_kcal / mealCoverage.days_of_data)
    : null
  const pctOfTarget =
    avgDailyKcal !== null && targets.calories_kcal > 0
      ? Math.round((avgDailyKcal / targets.calories_kcal) * 100)
      : null
  const shareWasDefaulted = mealCoverage?.consumption_share_pct === 100
  const partialWindow = mealCoverage !== null && mealCoverage.days_of_data < mealCoverage.window_days

  return (
    <div className="targets-section">
      <h2>{t('Your targets', 'Deine Ziele')}</h2>

      <div className="stat-tile stat-tile--hero">
        <div className="stat-tile__row">
          <div className="stat-tile__col">
            <span className="stat-tile__label">
              {t('Daily average from purchases', 'Täglicher Durchschnitt aus Einkäufen')}
            </span>
            <span className="stat-tile__value">
              {avgDailyKcal !== null ? avgDailyKcal.toLocaleString() : '—'} kcal
            </span>
          </div>
          <div className="stat-tile__col">
            <span className="stat-tile__label">
              {t('Daily calorie target', 'Tägliches Kalorienziel')}
            </span>
            <span className="stat-tile__value">
              {targets.calories_kcal.toLocaleString()} kcal
            </span>
          </div>
        </div>
        {avgDailyKcal !== null && pctOfTarget !== null && (
          <span className="muted">
            {t(
              `(${pctOfTarget}% of target, last ${mealCoverage?.days_of_data} day${
                mealCoverage?.days_of_data === 1 ? '' : 's'
              })`,
              `(${pctOfTarget}% des Ziels, letzte ${mealCoverage?.days_of_data} Tage${
                mealCoverage?.days_of_data === 1 ? '' : ''
              })`,
            )}
          </span>
        )}
        {avgDailyKcal !== null && shareWasDefaulted && (
          <span className="muted">
            {t('Assuming all these groceries are yours — set your', 'Wir nehmen an, dass all diese Lebensmittel deine sind – lege deinen')}{' '}
            <Link to="/profile">{t('grocery share', 'Einkaufsanteil')}</Link>{' '}
            {t('for a more accurate number.', 'fest, um eine genauere Zahl zu erhalten.')}
          </span>
        )}
        {partialWindow && (
          <span className="muted">
            {t(
              `Your purchase history only goes back ${mealCoverage.days_of_data} day${
                mealCoverage.days_of_data === 1 ? '' : 's'
              } so far (less than the ${mealCoverage.window_days}-day window) — this average is calculated over that shorter span, and will settle in as you upload more receipts over time.`,
              `Deine Einkaufshistorie reicht bisher nur ${mealCoverage.days_of_data} Tag${
                mealCoverage.days_of_data === 1 ? '' : 'e'
              } zurück (weniger als das ${mealCoverage.window_days}-Tage-Fenster) – dieser Durchschnitt wird über diesen kürzeren Zeitraum berechnet und pendelt sich ein, je mehr Belege du mit der Zeit hochlädst.`,
            )}
          </span>
        )}
      </div>

      <details className="details-panel">
        <summary>{t('How this was calculated', 'So wurde das berechnet')}</summary>
        <dl className="kv-list">
          <div>
            <dt>{t('BMR', 'Grundumsatz')}</dt>
            <dd>{targets.bmr_kcal} kcal</dd>
          </div>
          <div>
            <dt>{t('+ NEAT (daily movement)', '+ NEAT (Alltagsbewegung)')}</dt>
            <dd>{targets.neat_kcal} kcal</dd>
          </div>
          <div>
            <dt>{t('+ EAT (exercise)', '+ EAT (Sport)')}</dt>
            <dd>{targets.eat_kcal} kcal</dd>
          </div>
          <div>
            <dt>{t('+ TEF (digestion)', '+ TEF (Verdauung)')}</dt>
            <dd>{targets.tef_kcal} kcal</dd>
          </div>
          <div>
            <dt>{t('= TDEE', '= Gesamtumsatz')}</dt>
            <dd>{targets.tdee_kcal} kcal</dd>
          </div>
          <div>
            <dt>
              {goalAdjustmentPct >= 0 ? '+' : ''}
              {goalAdjustmentPct}%{' '}
              {goalLabel
                ? `(${goalLabel})`
                : t('(goal adjustment)', '(Ziel-Anpassung)')}
            </dt>
            <dd>{targets.calories_kcal} kcal</dd>
          </div>
        </dl>
      </details>

      {targets.constrained && targets.notes.length > 0 && (
        <p className="callout callout--warning">{targets.notes[0]}</p>
      )}

      <p className="callout callout--muted">{purchasesOnlyNote(t)}</p>

      <div className="macro-grid">
        <MacroRingTile
          label={t('Protein', 'Protein')}
          macroKey="protein"
          grams={targets.protein_g}
          targetValue={targetsPct.protein_pct}
          actualValue={comparison?.actual_pct.protein ?? null}
          unit="pct"
          topDrivers={diversity?.protein.top_drivers}
          isExpanded={expandedMacro === 'protein'}
          onToggleDrivers={setExpandedMacro}
        />
        <MacroRingTile
          label="Fat"
          macroKey="fat"
          grams={targets.fat_g}
          targetValue={targetsPct.fat_pct}
          actualValue={comparison?.actual_pct.fat ?? null}
          unit="pct"
          topDrivers={diversity?.fat.top_drivers}
          isExpanded={expandedMacro === 'fat'}
          onToggleDrivers={setExpandedMacro}
        />
        <MacroRingTile
          label="Carbs"
          macroKey="carb"
          grams={targets.carbs_g}
          targetValue={targetsPct.carb_pct}
          actualValue={comparison?.actual_pct.carb ?? null}
          unit="pct"
          topDrivers={diversity?.carb.top_drivers}
          isExpanded={expandedMacro === 'carb'}
          onToggleDrivers={setExpandedMacro}
        />
        <MacroRingTile
          label="Fiber"
          macroKey="fiber"
          grams={targets.fiber_g}
          targetValue={comparison?.fiber_target_per_1000kcal ?? null}
          actualValue={comparison?.fiber_actual_per_1000kcal ?? null}
          unit="density"
          topDrivers={diversity?.fiber.top_drivers}
          isExpanded={expandedMacro === 'fiber'}
          onToggleDrivers={setExpandedMacro}
        />

        {expandedMacro && expandedDrivers && expandedDrivers.length > 0 && (
          <div className="macro-drivers-overlay">
            <div className="macro-drivers-overlay__header">
              <strong>
                {t('Top sources', 'Top-Quellen')} — {macroLabels(t)[expandedMacro]}
              </strong>
              <button
                type="button"
                className="btn-link"
                onClick={() => setExpandedMacro(null)}
              >
                Close
              </button>
            </div>
            <ol className="driver-list">
              {expandedDrivers.map((driver) => (
                <li key={driver.name}>
                  {driver.name} — {driver.grams_per_100g} g/100g
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}

// Ring color reflects how far actual is from target in EITHER direction --
// being well under is just as much a signal as being well over, so this is
// symmetric around 100% rather than only escalating above it.
// Signal tokens (CI §2.2), theme-aware. Used only as a ring-fill here
// (non-textual), collapsed onto the 4-state scale: far off target -> danger,
// then warn/caution, on-track (within ±10%) -> ok. The ±10% band matches the
// KEEP/REDUCE/INCREASE action logic below.
function ringTierColor(ratioPct: number): string {
  const distance = Math.abs(ratioPct - 100)
  if (distance > 30) return 'var(--danger)'
  if (distance > 20) return 'var(--warn)'
  if (distance > 10) return 'var(--caution)'
  return 'var(--ok)'
}

// Under target: a single-color partial ring, same as before -- the filled
// share IS how much of the target was reached, colored by how far under,
// growing clockwise from 12 o'clock as that share increases.
// Over target: the ring is full (you've consumed at least the whole
// target), split into the over-target surplus share and the up-to-target
// share (green -- you got there). The surplus is drawn FIRST (0% onward)
// so it grows clockwise from 12 o'clock exactly like the under-target
// fill does, with green filling whatever's left -- putting green first
// instead (surplus as the second/remainder stop) made the surplus's
// leading edge retreat counterclockwise as it grew, since a conic-gradient
// stop only ever advances forward from wherever the previous one ended.
function ringGradient(ratioPct: number): string {
  if (ratioPct <= 100) {
    return `conic-gradient(${ringTierColor(ratioPct)} ${ratioPct}%, var(--code-bg) 0)`
  }
  const surplusSharePct = 100 - (100 / ratioPct) * 100
  return `conic-gradient(${ringTierColor(ratioPct)} ${surplusSharePct}%, var(--ok) 0)`
}

function MacroRingTile({
  label,
  macroKey,
  grams,
  targetValue,
  actualValue,
  unit,
  topDrivers,
  isExpanded,
  onToggleDrivers,
}: {
  label: string
  macroKey: MacroKey
  grams: number
  targetValue: number | null
  actualValue: number | null
  /** "pct" for Protein/Fat/Carbs (%-of-calories vs. their target %).
   * "density" for Fiber (g/1000kcal vs. its fixed 14g/1000kcal target) --
   * see ideal_profile.py's FIBER_G_PER_1000KCAL for why fiber isn't a
   * %-of-calories figure like the other three. */
  unit: 'pct' | 'density'
  /** Up to 10 items ranked by their share of this macro's calories/grams. */
  topDrivers?: DiversityDriver[]
  isExpanded: boolean
  onToggleDrivers: (key: MacroKey | null) => void
}) {
  const hasTracking = actualValue !== null && targetValue !== null && targetValue > 0
  const ratioPct = hasTracking ? Math.round((actualValue / targetValue) * 100) : null
  const color = ratioPct !== null ? ringTierColor(ratioPct) : 'var(--code-bg)'
  const ringBackground = ratioPct !== null ? ringGradient(ratioPct) : 'var(--code-bg)'
  // More than 10% over/under target -> act on it; within that band, on track.
  const action =
    ratioPct === null
      ? null
      : ratioPct > 110
        ? 'REDUCE'
        : ratioPct < 90
          ? 'INCREASE'
          : 'KEEP'

  return (
    <div className="macro-ring-tile">
      <span className="macro-ring-tile__label">{label}</span>
      <div className="macro-ring">
        <div className="macro-ring__fill" style={{ background: ringBackground }} />
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
      {topDrivers && topDrivers.length > 0 && (
        <button
          type="button"
          className="driver-toggle"
          aria-expanded={isExpanded}
          onClick={() => onToggleDrivers(isExpanded ? null : macroKey)}
        >
          Show drivers
        </button>
      )}
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
  const totalDiff = diffs.length ? diffs.reduce((sum, d) => sum + Math.abs(d), 0) : null

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

// Same 4-state signal scale as ringTierColor, re-purposed for an absolute count
// instead of a %-of-target ratio: danger under 10 distinct plants, warn under
// 20, caution under the 28-30 target range, ok at/above it. Uses the AA-safe
// text tones (not the -bright variants) because this value also colours the
// count text in PlantDiversitySection, not just the progress-bar fill (§2.2).
function plantDiversityColor(count: number): string {
  if (count < 10) return 'var(--danger)'
  if (count < 20) return 'var(--warn)'
  if (count < 28) return 'var(--caution)'
  return 'var(--ok)'
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
        Eat 30 different plants regularly to maximize gut microbiome diversity, improve
        immune function, and lower the risk of chronic diseases.
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

// Display label + unit per key -- matches bls_matcher._MICRO_COLS' units
// (µg for vitamin D/folate/B12/iodine, mg for everything else).
const MICRONUTRIENT_LABELS: { key: keyof MicronutrientsResult['totals']; label: string; unit: string }[] = [
  { key: 'vitamin_a_ug', label: 'Vitamin A', unit: 'µg' },
  { key: 'vitamin_c_mg', label: 'Vitamin C', unit: 'mg' },
  { key: 'vitamin_d_ug', label: 'Vitamin D', unit: 'µg' },
  { key: 'vitamin_e_mg', label: 'Vitamin E', unit: 'mg' },
  { key: 'vitamin_k_ug', label: 'Vitamin K', unit: 'µg' },
  { key: 'vitamin_b1_mg', label: 'Vitamin B1', unit: 'mg' },
  { key: 'vitamin_b2_mg', label: 'Vitamin B2', unit: 'mg' },
  { key: 'niacin_mg', label: 'Niacin (B3)', unit: 'mg' },
  { key: 'pantothenic_acid_mg', label: 'Pantothenic Acid (B5)', unit: 'mg' },
  { key: 'vitamin_b6_mg', label: 'Vitamin B6', unit: 'mg' },
  { key: 'biotin_ug', label: 'Biotin (B7)', unit: 'µg' },
  { key: 'vitamin_b12_ug', label: 'Vitamin B12', unit: 'µg' },
  { key: 'folate_ug', label: 'Folate', unit: 'µg' },
  { key: 'calcium_mg', label: 'Calcium', unit: 'mg' },
  { key: 'phosphorus_mg', label: 'Phosphorus', unit: 'mg' },
  { key: 'magnesium_mg', label: 'Magnesium', unit: 'mg' },
  { key: 'sodium_mg', label: 'Sodium', unit: 'mg' },
  { key: 'chloride_mg', label: 'Chloride', unit: 'mg' },
  { key: 'potassium_mg', label: 'Potassium', unit: 'mg' },
  { key: 'sulfur_mg', label: 'Sulfur', unit: 'mg' },
  { key: 'iron_mg', label: 'Iron', unit: 'mg' },
  { key: 'zinc_mg', label: 'Zinc', unit: 'mg' },
  { key: 'copper_mg', label: 'Copper', unit: 'mg' },
  { key: 'manganese_mg', label: 'Manganese', unit: 'mg' },
  { key: 'iodine_ug', label: 'Iodine', unit: 'µg' },
  { key: 'fluoride_mg', label: 'Fluoride', unit: 'mg' },
  { key: 'chromium_ug', label: 'Chromium', unit: 'µg' },
  { key: 'molybdenum_ug', label: 'Molybdenum', unit: 'µg' },
]

function MicronutrientsSection({ micronutrients }: { micronutrients: MicronutrientsResult }) {
  const {
    totals,
    targets,
    micro_coverage_pct,
    window_days,
    days_of_data,
    items_with_micros_count,
    items_considered,
    top_drivers,
    nutrient_info,
  } = micronutrients
  const { t } = useI18n()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const partialWindow = days_of_data < window_days

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Lowest coverage first -- surfaces the nutrients furthest from target at
  // the top rather than in a fixed, alphabetical-ish order. Nutrients with
  // no resolvable target (coveragePct null) sort last since they can't be
  // ranked at all.
  const rows = MICRONUTRIENT_LABELS.map(({ key, label, unit }) => {
    const purchasedPerDay = totals[key] / days_of_data
    const target = targets?.[key] ?? null
    const coveragePct = target !== null && target > 0
      ? Math.round((purchasedPerDay / target) * 100)
      : null
    return {
      key,
      label,
      unit,
      purchasedPerDay,
      target,
      coveragePct,
      drivers: top_drivers[key],
      info: nutrient_info[key],
    }
  }).sort((a, b) => {
    if (a.coveragePct === null) return 1
    if (b.coveragePct === null) return -1
    return a.coveragePct - b.coveragePct
  })

  return (
    <div className="section-divider">
      <h2>Your micronutrients</h2>
      <p className="muted">
        Averaged daily intake from the last {days_of_data} day{days_of_data === 1 ? '' : 's'}{' '}
        of purchases, sourced from the German BLS food database, against your personal
        daily target.
      </p>
      <p className="callout callout--muted">{purchasesOnlyNote(t)}</p>
      {partialWindow && (
        <p className="callout callout--muted">
          Your purchase history only goes back {days_of_data} day{days_of_data === 1 ? '' : 's'}{' '}
          so far (less than the {window_days}-day window) — the daily averages below are
          calculated over that shorter span, and will settle in as you upload more
          receipts over time.
        </p>
      )}
      <div className="card micronutrient-card">
        <div className="table-scroll">
          <table className="micronutrient-table">
            <thead>
              <tr>
                <th>Nutrient</th>
                <th>Purchased</th>
                <th>Target</th>
                <th>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, label, unit, purchasedPerDay, target, coveragePct, drivers, info }) => {
                const isOpen = expanded.has(key)
                return (
                  <Fragment key={key}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          className="micronutrient-row-toggle"
                          aria-expanded={isOpen}
                          onClick={() => toggleExpanded(key)}
                        >
                          {label}
                        </button>
                      </td>
                      <td>
                        {purchasedPerDay.toFixed(1)} {unit}
                      </td>
                      <td>{target !== null ? `${target.toFixed(1)} ${unit}` : '—'}</td>
                      <td>{coveragePct !== null ? `${coveragePct}%` : '—'}</td>
                    </tr>
                    {isOpen && (
                      <tr className="micronutrient-drivers-row">
                        <td colSpan={4}>
                          {info.map((section) => (
                            <div key={section.title} className="micronutrient-info-section">
                              <p className="micronutrient-info-section__title">
                                {section.title}
                              </p>
                              <p className="muted">{section.body}</p>
                            </div>
                          ))}
                          <div className="micronutrient-info-section">
                            <p className="micronutrient-info-section__title">
                              Drivers from your purchases
                            </p>
                            {drivers.length > 0 ? (
                              <ol className="driver-list">
                                {drivers.map((driver) => (
                                  <li key={driver.name}>
                                    {driver.name} — {driver.value_per_100g} {unit}/100g
                                  </li>
                                ))}
                              </ol>
                            ) : (
                              <p className="muted">
                                None of your purchases contain {label.toLowerCase()} yet.
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="muted">
        Target values are personalized to your age, sex, and life stage, sourced from
        the{' '}
        <a href="https://www.dge.de/" target="_blank" rel="noreferrer">
          DGE
        </a>{' '}
        (Deutsche Gesellschaft für Ernährung — the German Nutrition Society).
      </p>
      {micro_coverage_pct !== null && (
        <p className="callout callout--muted">
          {items_with_micros_count}/{items_considered} purchased items have real
          micronutrient data behind them, sourced from the German BLS food database —
          the rest come from packaged-product or category-estimate data that doesn't
          include micronutrients.
        </p>
      )}
    </div>
  )
}
