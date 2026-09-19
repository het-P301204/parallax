/**
 * The decision view: "what should I distrust?"
 *
 * This is the page a CISO reads. It is the only view in the product organised
 * by *consequence* rather than by analysis — five sections, each one a thing
 * that might be wrong with a decision somebody is about to make, ordered by
 * how expensive being wrong about it would be.
 *
 * It stays accurate. Nothing here is softened into a recommendation the
 * analysis does not support: where the answer is "the data cannot say", that
 * is what it says, and the executive summary at the top names the limiting
 * factor rather than rounding it away.
 */

import type { AnalysisState, AuditReport } from '../engine/index.ts'
import { EXPORTS, exportReport } from '../engine/index.ts'
import type { ExportId } from '../engine/index.ts'
import { Panel, SectionHeading, StateBadge } from '../ui/primitives.tsx'
import { SURFACE, TYPE } from '../ui/tokens.ts'
import { count, money, percent, span } from '../ui/format.ts'
import type { ViewId } from '../state.ts'

export function Decision({
  report,
  onGo,
  onOpenRisk,
}: {
  report: AuditReport
  onGo: (view: ViewId) => void
  onOpenRisk: (riskId: string) => void
}): React.JSX.Element {
  const { summary, confidence, register } = report
  const currency = register.model.currency
  const share = summary.comparedPairs === 0 ? 0 : summary.indeterminatePairs / summary.comparedPairs

  const straddling = report.compression.filter((c) => c.straddlesAppetite)
  const worstCells = report.compression.filter((c) => c.state === 'distorted').slice(0, 5)
  const confirmed = report.inversions.filter((i) => i.status === 'confirmed-under-model').slice(0, 5)
  const miscalibrated = report.calibration.assessors.filter((a) => a.state === 'inconsistent')

  return (
    <div className="space-y-6">
      <SectionHeading
        step="Decision"
        title="What should I distrust?"
        lead="Five things that could be wrong with a decision taken from this register, in the order of how much they would cost. Every one links to the working."
      />

      <section className={`${SURFACE.panel} relative overflow-hidden p-6 sm:p-8`}>
        <div aria-hidden className="grid-field pointer-events-none absolute inset-0 opacity-50" />
        <div className="relative max-w-3xl">
          <p className={`${TYPE.eyebrow} mb-3`}>In one paragraph</p>
          <p className="font-display text-lg font-medium leading-relaxed tracking-tight text-ink-0">
            This register scores {count(summary.risksAnalysed)} risks on a{' '}
            {register.model.likelihood.levels.length}×{register.model.impact.levels.length}{' '}
            {register.model.likelihood.kind} matrix.{' '}
            {percent(share, 0)} of the orderings it implies are not determined by its own scale
            definition
            {summary.resolutionFloor !== undefined
              ? `, and no cell on the grid can resolve annualised loss finer than ${span(summary.resolutionFloor)}`
              : ''}
            .{' '}
            {summary.confirmedInversions > 0
              ? `${count(summary.confirmedInversions)} pairs are ranked the wrong way round under the configured model. `
              : ''}
            {summary.quantificationShortlist} risks would repay quantitative treatment.
          </p>
          <p className="mt-4 text-xs leading-relaxed text-ink-2">
            The limiting factor on everything above is that {confidence.limitingFactor}.
          </p>
        </div>
      </section>

      <Block
        index="01"
        title="Ratings that need review"
        state={report.dataQuality.some((d) => d.severity === 'blocking') ? 'ambiguous' : 'supported'}
        lead={
          summary.risksExcluded > 0
            ? `${count(summary.risksExcluded)} of ${count(summary.risksImported)} rows could not be placed on the matrix at all, so they appear in no ranking, no heatmap and no committee pack that is generated from one.`
            : 'Every row in the register could be placed on the matrix.'
        }
        onGo={() => onGo('register')}
        goLabel="Open the register"
      >
        {report.dataQuality.length > 0 ? (
          <ul className="space-y-2">
            {report.dataQuality.slice(0, 5).map((finding) => (
              <li key={finding.code} className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    finding.severity === 'blocking' ? 'bg-distorted' : 'bg-ambiguous'
                  }`}
                />
                <span className="text-xs leading-relaxed text-ink-1">
                  {finding.explanation.what}
                  <span className="ml-1.5 text-ink-3">{finding.explanation.evidence}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Block>

      <Block
        index="02"
        title="Rankings that may invert"
        state={summary.confirmedInversions > 0 ? 'distorted' : share > 0.2 ? 'ambiguous' : 'supported'}
        lead={`${count(summary.indeterminatePairs)} of ${count(summary.comparedPairs)} orderings reverse under a relabelling of the levels that keeps every rung in the same position. ${count(summary.confirmedInversions)} pairs are ranked against the modelled loss with no overlap at all.`}
        onGo={() => onGo('ranking')}
        goLabel="See the pairs"
      >
        {confirmed.length > 0 ? (
          <ul className="space-y-2">
            {confirmed.map((inversion) => (
              <li
                key={`${inversion.higherId}>${inversion.lowerId}`}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs"
              >
                <button
                  type="button"
                  onClick={() => onOpenRisk(inversion.lowerId)}
                  className="text-ink-0 underline decoration-line-3 underline-offset-2 hover:decoration-accent"
                >
                  {report.byId.get(inversion.lowerId)?.title}
                </button>
                <span className="text-ink-3">
                  (score {inversion.lowerScore}) is modelled above
                </span>
                <button
                  type="button"
                  onClick={() => onOpenRisk(inversion.higherId)}
                  className="text-ink-0 underline decoration-line-3 underline-offset-2 hover:decoration-accent"
                >
                  {report.byId.get(inversion.higherId)?.title}
                </button>
                <span className="text-ink-3">(score {inversion.higherScore})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-2">
            No pair is ranked against the model with non-overlapping intervals.
          </p>
        )}
      </Block>

      <Block
        index="03"
        title="Cells with high compression"
        state={worstCells.length > 0 ? 'distorted' : straddling.length > 0 ? 'requires-quantification' : 'supported'}
        lead={
          register.model.appetite
            ? `${straddling.length} occupied cells straddle the ${money(register.model.appetite.annualLossThreshold, currency)} appetite threshold. For any risk in one of them, the score cannot say whether it is inside appetite or outside it — which is usually the only question being asked of it.`
            : 'No appetite threshold is configured, so cells cannot be checked against one.'
        }
        onGo={() => onGo('compression')}
        goLabel="See the compression findings"
      >
        {worstCells.length > 0 ? (
          <ul className="space-y-2">
            {worstCells.map((cell) => (
              <li key={cell.cellKey} className="text-xs leading-relaxed text-ink-1">
                <span className="font-mono text-ink-2">{cell.cellKey}</span> — {cell.explanation.what}
              </li>
            ))}
          </ul>
        ) : null}
      </Block>

      <Block
        index="04"
        title="Assessor calibration"
        state={report.calibration.state}
        lead={report.calibration.explanation.what}
        onGo={() => onGo('calibration')}
        goLabel="See the comparison"
      >
        {miscalibrated.length > 0 ? (
          <ul className="space-y-2">
            {miscalibrated.map((assessor) => (
              <li key={assessor.assessor} className="text-xs leading-relaxed text-ink-1">
                {assessor.explanation.what}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-2">{report.calibration.explanation.next}</p>
        )}
      </Block>

      <Block
        index="05"
        title="Risks worth quantifying"
        state="requires-quantification"
        lead={`${count(summary.quantificationShortlist)} risks where a quantitative answer could change a decision. Selected by six published components, not by score.`}
        onGo={() => onGo('quantify')}
        goLabel="Open the shortlist"
      >
        <ol className="space-y-1.5">
          {report.quantification.slice(0, 6).map((candidate) => (
            <li key={candidate.riskId} className="flex items-baseline gap-2.5 text-xs">
              <span className="w-4 shrink-0 font-mono text-quantify tnum">{candidate.rank}</span>
              <button
                type="button"
                onClick={() => onOpenRisk(candidate.riskId)}
                className="min-w-0 flex-1 truncate-flex text-left text-ink-1 hover:text-ink-0"
              >
                {report.byId.get(candidate.riskId)?.title ?? candidate.riskId}
                {/* A register carries one row per business unit, so the same
                    scenario appears several times under one title. Without
                    the unit, two legitimately distinct rows read as a bug. */}
                <span className="ml-2 font-mono text-[10px] text-ink-3">
                  {report.byId.get(candidate.riskId)?.businessUnit ?? candidate.riskId}
                </span>
              </button>
              <span className="shrink-0 text-ink-3">{candidate.reasons[0]}</span>
            </li>
          ))}
        </ol>
      </Block>

      <Panel eyebrow="Take it with you" title="Exports">
        <p className="mb-4 max-w-2xl text-xs leading-relaxed text-ink-2">
          Every export carries the assumption each finding rests on, and none of them carries a
          timestamp — so two audits of the same file produce byte-identical output and a diff
          between quarters is a diff of the register.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {EXPORTS.map((descriptor) => (
            <li key={descriptor.id}>
              <button
                type="button"
                onClick={() => download(report, descriptor.id)}
                className={`${SURFACE.tile} flex w-full items-start gap-3 px-3.5 py-3 text-left`}
              >
                <span className="mt-0.5 shrink-0 rounded border border-line-2 px-1.5 py-0.5 font-mono text-[9px] uppercase text-ink-3">
                  {descriptor.format}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-ink-0">{descriptor.label}</span>
                  <span className="mt-0.5 block text-2xs leading-relaxed text-ink-3">
                    {descriptor.description}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}

function Block({
  index,
  title,
  state,
  lead,
  children,
  onGo,
  goLabel,
}: {
  index: string
  title: string
  state: AnalysisState
  lead: string
  children?: React.ReactNode
  onGo: () => void
  goLabel: string
}): React.JSX.Element {
  return (
    <section className={`${SURFACE.panel} p-5 sm:p-6`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="shrink-0 font-mono text-xs text-ink-3 tnum">{index}</span>
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
              <h2 className="font-display text-base font-medium tracking-tight text-ink-0">
                {title}
              </h2>
              <StateBadge state={state} size="xs" />
            </div>
            <p className="max-w-3xl text-xs leading-relaxed text-ink-2">{lead}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onGo}
          className="shrink-0 rounded border border-line-2 px-2.5 py-1.5 text-2xs text-ink-2 transition-colors duration-140 hover:border-accent/50 hover:text-accent-strong"
        >
          {goLabel} →
        </button>
      </div>
      {children ? <div className="mt-4 pl-0 sm:pl-8">{children}</div> : null}
    </section>
  )
}

/**
 * Writes an export to a file the browser downloads.
 *
 * A blob URL created and revoked in the same turn: nothing is uploaded, and
 * the URL never outlives the click. The page's CSP forbids a network request
 * regardless, but building the file locally is what makes that possible rather
 * than merely permitted.
 */
function download(report: AuditReport, id: ExportId): void {
  const descriptor = EXPORTS.find((e) => e.id === id)
  if (!descriptor) return
  const text = exportReport(report, id)
  const blob = new Blob([text], {
    type: descriptor.format === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = descriptor.fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoked on the next task rather than synchronously. Some browsers have
  // not finished reading the blob when the click handler returns, and
  // revoking underneath them cancels the download with no error anywhere.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export { download as downloadExport }
