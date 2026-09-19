/**
 * The overview.
 *
 * It does not open with twelve KPI cards, because a KPI card answers "how
 * much" and the question a reader arrives with is "can I trust this". So it
 * opens with a sentence — the single most consequential thing the audit found,
 * written out — and only then shows the counts that support it.
 *
 * Every count has a denominator. "2,908 ambiguous pairs" is meaningless;
 * "2,908 of 6,261" is a finding. Nothing here is computed: each figure is a
 * field of `report.summary`, which the engine produced and the tests check.
 */

import type { AuditReport } from '../engine/index.ts'
import { SURFACE, TYPE, STATE_STYLE } from '../ui/tokens.ts'
import { Bar, Metric, Panel, SectionHeading, StateBadge } from '../ui/primitives.tsx'
import { Tooltip } from '../ui/Tooltip.tsx'
import { count, percent, span } from '../ui/format.ts'
import type { Mode, ViewId } from '../state.ts'

export function Overview({
  report,
  mode,
  onGo,
}: {
  report: AuditReport
  mode: Mode
  onGo: (view: ViewId) => void
}): React.JSX.Element {
  const { summary, confidence, ordinal } = report
  const indeterminateShare =
    summary.comparedPairs === 0 ? 0 : summary.indeterminatePairs / summary.comparedPairs

  return (
    <div className="space-y-6">
      <SectionHeading
        step="Overview"
        title={report.register.name}
        lead={
          <>
            {count(summary.risksImported)} rows from{' '}
            <span className="font-mono text-xs text-ink-3">{report.register.sourceName}</span>.{' '}
            {count(summary.risksAnalysed)} could be placed on the matrix;{' '}
            {count(summary.risksExcluded)} could not, and are listed with reasons.
          </>
        }
      />

      {/* ---- The headline finding, in words ------------------------------- */}
      <section className={`${SURFACE.panel} relative overflow-hidden p-6 sm:p-8`}>
        <div aria-hidden className="grid-field pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <StateBadge state={ordinal.state} />
            <span className={TYPE.eyebrow}>Headline</span>
          </div>
          <p className="max-w-3xl font-display text-xl font-medium leading-snug tracking-tight text-ink-0 sm:text-2xl">
            {headline(report)}
          </p>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink-2">
            {ordinal.explanation.why}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <GoLink label="See the measurement audit" onClick={() => onGo('measurement')} />
            <GoLink label="Open the matrix" onClick={() => onGo('matrix')} />
            <GoLink label="What should I distrust?" onClick={() => onGo('decision')} />
          </div>
        </div>
      </section>

      {/* ---- Counts ------------------------------------------------------- */}
      <Panel eyebrow="Analysis state" title="What the audit found">
        <div className="grid gap-6 sm:grid-cols-3 lg:grid-cols-6">
          <Metric
            label="Risks analysed"
            value={summary.risksAnalysed}
            of={`of ${count(summary.risksImported)}`}
            hint="Rows that carry a readable level on both axes. The rest stay in the register and are listed with a reason against them."
          />
          <Metric
            label="Cells occupied"
            value={summary.occupiedCells}
            of={`of ${summary.totalCells}`}
            hint="How many distinct judgements the register actually expresses. A matrix with twenty-five cells used eleven ways is a five-point scale being used as an eleven-point one."
          />
          <Metric
            label="Ambiguous pairs"
            value={summary.indeterminatePairs}
            of={`of ${count(summary.comparedPairs)}`}
            state={indeterminateShare > 0.2 ? 'ambiguous' : 'supported'}
            hint="Ordered pairs the register ranks, where the ranking reverses under a relabelling of the levels that is just as faithful to the written scale."
          />
          <Metric
            label="Inversion candidates"
            value={summary.inversionCandidates}
            of={`${count(summary.confirmedInversions)} confirmed`}
            state={summary.confirmedInversions > 0 ? 'distorted' : 'supported'}
            hint="Pairs where the register ranks A above B while the configured model puts B's annualised loss higher. Confirmed means the intervals do not overlap at all."
          />
          <Metric
            label="Compressed cells"
            value={summary.compressedCells}
            of={`of ${summary.occupiedCells}`}
            state={summary.compressedCells > 0 ? 'ambiguous' : 'supported'}
            hint="Occupied cells that either straddle the appetite threshold or hold risks whose own estimates differ materially."
          />
          <Metric
            label="Quantification shortlist"
            value={summary.quantificationShortlist}
            state="requires-quantification"
            hint="Risks where a quantitative answer could change a decision. Chosen by six published components, not by score."
          />
        </div>
      </Panel>

      {/* ---- Confidence, as three numbers rather than one ----------------- */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel
          eyebrow="Measurement confidence"
          title="Three numbers, deliberately not averaged"
        >
          <p className="mb-5 max-w-2xl text-xs leading-relaxed text-ink-2">
            Reducing these to one score would be the exact operation this product exists to object
            to: three incommensurable quantities combined by arithmetic that none of them supports.
            The limiting factor is named instead.
          </p>
          <div className="space-y-4">
            <ConfidenceRow
              label="Order determinacy"
              value={confidence.orderDeterminacy}
              detail={`${count(summary.comparedPairs - summary.indeterminatePairs)} of ${count(summary.comparedPairs)} rankings survive every admissible relabelling of the scales.`}
            />
            <ConfidenceRow
              label="Estimate coverage"
              value={confidence.estimateCoverage}
              detail={`${count(summary.risksWithEstimates)} of ${count(summary.risksAnalysed)} risks carry a frequency and loss range of their own. The rest inherit their cell's anchors and are indistinguishable from their cell-mates.`}
            />
            <ConfidenceRow
              label="Data completeness"
              value={confidence.dataCompleteness}
              detail={`${count(summary.risksExcluded)} of ${count(summary.risksImported)} rows could not be placed on the matrix.`}
            />
          </div>
          <p className="mt-5 rounded-md border border-line-1 bg-surface-inset px-3 py-2.5 text-xs leading-relaxed text-ink-1">
            <span className="text-ink-3">Limiting factor — </span>
            {confidence.limitingFactor}.
          </p>
        </Panel>

        <Panel eyebrow="Resolving power" title="What this matrix can see">
          {summary.resolutionFloor === undefined ? (
            <p className="text-xs leading-relaxed text-ink-2">
              The configured scales carry no quantitative anchors, so the matrix&rsquo;s resolving
              power cannot be measured. Adding a frequency band to each likelihood level and a loss
              band to each impact level is the single change that unlocks the most of this audit.
            </p>
          ) : (
            <>
              <p className="font-display text-4xl font-medium tracking-tight tnum text-ink-0">
                {span(summary.resolutionFloor)}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-ink-2">
                The narrowest cell on the grid ({summary.resolutionFloorCell}) still covers a{' '}
                {span(summary.resolutionFloor)} range of annualised loss. Nowhere on this matrix can
                two risks differing by less than that be told apart — and every other cell is
                wider.
              </p>
              <div className="mt-5 border-t border-line-1 pt-4">
                <p className={`${TYPE.eyebrow} mb-2`}>Largest tie group</p>
                <p className="text-xs leading-relaxed text-ink-1">
                  <span className="font-mono text-ink-0 tnum">{summary.largestTieGroup}</span> risks
                  share a single score. The register orders them, but it has not distinguished them.
                </p>
              </div>
            </>
          )}
        </Panel>
      </div>

      {/* ---- Data quality ------------------------------------------------- */}
      {report.dataQuality.length > 0 ? (
        <Panel
          eyebrow="Data quality"
          title={`${report.dataQuality.length} finding${report.dataQuality.length === 1 ? '' : 's'} about the input`}
          actions={
            mode === 'analyst' ? (
              <button
                type="button"
                onClick={() => onGo('register')}
                className="text-2xs text-accent hover:text-accent-strong"
              >
                See the affected rows →
              </button>
            ) : undefined
          }
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {report.dataQuality.slice(0, mode === 'executive' ? 4 : 12).map((finding) => (
              <li key={finding.code} className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    finding.severity === 'blocking'
                      ? 'bg-distorted'
                      : finding.severity === 'degrading'
                        ? 'bg-ambiguous'
                        : 'bg-insufficient'
                  }`}
                />
                <Tooltip title={finding.explanation.what} body={finding.explanation.next} width={320}>
                  <span className="cursor-help text-xs leading-relaxed text-ink-1">
                    {finding.explanation.what}
                  </span>
                </Tooltip>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  )
}

function headline(report: AuditReport): string {
  const { summary, ordinal } = report
  const share =
    summary.comparedPairs === 0 ? 0 : summary.indeterminatePairs / summary.comparedPairs

  if (summary.comparedPairs === 0) {
    return 'Too few risks could be placed on the matrix to compare any pair of them.'
  }
  if (summary.confirmedInversions > 0) {
    return `${percent(share, 0)} of this register's rankings are not determined by its own scale definition, and ${count(summary.confirmedInversions)} pairs are ranked the wrong way round under the configured model.`
  }
  if (share > 0.05) {
    return `${percent(share, 0)} of this register's rankings depend on the numbers chosen to name the levels rather than on the assessments behind them.`
  }
  return ordinal.state === 'supported'
    ? 'Every ranking in this register survives relabelling of its scales. The measurement supports the conclusions being drawn from it.'
    : 'The register is internally consistent, but its scales cannot resolve the differences it is being used to decide between.'
}

function ConfidenceRow({
  label,
  value,
  detail,
}: {
  label: string
  value: number
  detail: string
}): React.JSX.Element {
  const state = value >= 0.8 ? 'supported' : value >= 0.5 ? 'ambiguous' : 'distorted'
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-ink-0">{label}</span>
        <span className={`font-mono text-xs tnum ${STATE_STYLE[state].text}`}>
          {percent(value, 0)}
        </span>
      </div>
      <Bar value={value} tone={state} />
      <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">{detail}</p>
    </div>
  )
}

function GoLink({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-line-2 px-2.5 py-1.5 text-2xs text-ink-1 transition-colors duration-140 hover:border-accent/50 hover:bg-accent/10 hover:text-accent-strong"
    >
      {label} →
    </button>
  )
}
