/**
 * Range compression.
 *
 * The visual proof: for each flagged cell, every risk in it drawn as an
 * interval on one shared logarithmic axis, all of them carrying the same
 * score. A reader who sees a three-pixel bar and a two-hundred-pixel bar under
 * one label does not need the paragraph underneath — but the paragraph is
 * there, because the bar chart alone cannot say *why* they differ or how much
 * of the difference is evidence rather than assumption.
 *
 * The distinction this view exists to protect: hatched grey bars are risks
 * with no estimate of their own, drawn at exactly their cell's width because
 * that is genuinely all the register knows about them. Two of those are drawn
 * identically on purpose. Inventing a difference between them would be the
 * same error the product is auditing for.
 */

import { useMemo, useState } from 'react'
import type { AuditReport, CompressionFinding } from '../engine/index.ts'
import { annualLossBounds, centralAnnualLoss, labelOf } from '../engine/index.ts'
import { IntervalAxis, IntervalBar } from '../ui/charts.tsx'
import { ExplanationBlock, EmptyState, Panel, SectionHeading, StateBadge } from '../ui/primitives.tsx'
import { SURFACE, TYPE } from '../ui/tokens.ts'
import { count, money, span } from '../ui/format.ts'
import type { Mode } from '../state.ts'

export function Compression({
  report,
  mode,
  onOpenRisk,
  onSelectCell,
}: {
  report: AuditReport
  mode: Mode
  onOpenRisk: (riskId: string) => void
  onSelectCell: (key: string) => void
}): React.JSX.Element {
  const flagged = report.compression.filter(
    (c) => c.state === 'distorted' || c.state === 'requires-quantification' || c.state === 'ambiguous',
  )
  const [open, setOpen] = useState<string | undefined>(flagged[0]?.cellKey)
  const shown = mode === 'executive' ? flagged.slice(0, 4) : flagged

  return (
    <div className="space-y-6">
      <SectionHeading
        step="Range compression"
        title="Where does the matrix lose information?"
        lead={
          report.summary.resolutionFloor === undefined
            ? 'The configured scales carry no quantitative anchors, so compression cannot be measured. Adding them is the single change that unlocks the most of this audit.'
            : `No cell on this grid resolves annualised loss finer than ${span(report.summary.resolutionFloor)}. Below, the cells where that costs the most — ranked by what they provably hide, not by their score.`
        }
      />

      {shown.length === 0 ? (
        <Panel>
          <EmptyState
            icon="clean"
            title="No cell is compressing anything materially"
            body="Every occupied cell resolves annualised loss tightly enough, and no cell holds risks whose own estimates differ by more than the flagging threshold. That is an unusual and good result."
          />
        </Panel>
      ) : (
        <ul className="space-y-4">
          {shown.map((finding) => (
            <li key={finding.cellKey}>
              <CompressionCard
                report={report}
                finding={finding}
                open={open === finding.cellKey}
                onToggle={() => setOpen(open === finding.cellKey ? undefined : finding.cellKey)}
                onOpenRisk={onOpenRisk}
                onSelectCell={onSelectCell}
              />
            </li>
          ))}
        </ul>
      )}

      {mode === 'analyst' && report.compression.length > flagged.length ? (
        <Panel eyebrow="Every other occupied cell" title="Not flagged" dense>
          <ul className="divide-y divide-line-1">
            {report.compression
              .filter((c) => !flagged.includes(c))
              .map((finding) => (
                <li
                  key={finding.cellKey}
                  className="flex items-center justify-between gap-4 px-5 py-2.5"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="font-mono text-xs text-ink-2">{finding.cellKey}</span>
                    <span className="truncate-flex text-xs text-ink-1">
                      {finding.explanation.what}
                    </span>
                  </span>
                  <StateBadge state={finding.state} size="xs" />
                </li>
              ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  )
}

function CompressionCard({
  report,
  finding,
  open,
  onToggle,
  onOpenRisk,
  onSelectCell,
}: {
  report: AuditReport
  finding: CompressionFinding
  open: boolean
  onToggle: () => void
  onOpenRisk: (riskId: string) => void
  onSelectCell: (key: string) => void
}): React.JSX.Element {
  const { model } = report.register
  // A cell can legitimately hold hundreds of risks. Drawing all of them is
  // both slow and useless -- the finding is the *spread*, and the widest and
  // narrowest are at the ends of an already-sorted list. The cut is stated
  // under the chart rather than made silently.
  const DRAWN = 24
  const hidden = Math.max(0, finding.orderedRiskIds.length - DRAWN)
  const rows = useMemo(
    () =>
      finding.orderedRiskIds
        .slice(0, DRAWN)
        .map((id) => {
          const quantModel = report.models.get(id)
          const risk = report.byId.get(id)
          if (!quantModel || !risk) return null
          const bounds = annualLossBounds(quantModel)
          return {
            id,
            title: risk.title,
            unit: risk.businessUnit,
            lo: bounds.lo,
            hi: bounds.hi,
            centre: centralAnnualLoss(quantModel),
            estimated:
              quantModel.frequencySource === 'register-estimate' ||
              quantModel.magnitudeSource === 'register-estimate',
          }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),
    [finding.orderedRiskIds, report.models, report.byId],
  )

  const axis = useMemo(() => {
    const values = rows.flatMap((r) => [r.lo, r.hi]).filter((v) => v > 0)
    if (finding.anchoredAnnualLoss) values.push(finding.anchoredAnnualLoss.lo, finding.anchoredAnnualLoss.hi)
    if (model.appetite) values.push(model.appetite.annualLossThreshold)
    if (values.length === 0) return undefined
    return { lo: Math.min(...values) / 1.6, hi: Math.max(...values) * 1.6 }
  }, [rows, finding.anchoredAnnualLoss, model.appetite])

  return (
    <article className={`${SURFACE.panel} overflow-hidden`}>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line-1 px-5 py-4">
        <div className="min-w-0">
          <p className={`${TYPE.eyebrow} mb-1.5`}>
            Cell {finding.cellKey} · score {finding.score} · {count(finding.riskCount)} risks
          </p>
          <h3 className="font-display text-base font-medium tracking-tight text-ink-0">
            {labelOf(model.likelihood, finding.likelihood)} × {labelOf(model.impact, finding.impact)}
          </h3>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-ink-2">
            {finding.explanation.what}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StateBadge state={finding.state} />
          <button
            type="button"
            onClick={() => onSelectCell(finding.cellKey)}
            className="rounded border border-line-2 px-2 py-1 text-2xs text-ink-2 transition-colors duration-140 hover:border-accent/50 hover:text-accent-strong"
          >
            Open in matrix →
          </button>
        </div>
      </header>

      <div className="px-5 py-4">
        {axis === undefined ? (
          <p className="py-4 text-xs text-ink-2">
            No quantitative basis exists for any risk in this cell, so there is nothing to draw.
          </p>
        ) : (
          <>
            {finding.anchoredAnnualLoss ? (
              <div className="mb-3">
                <p className={`${TYPE.eyebrow} mb-1.5`}>
                  What the score covers — {span(finding.anchorSpan)}
                </p>
                <IntervalBar
                  lo={finding.anchoredAnnualLoss.lo}
                  hi={finding.anchoredAnnualLoss.hi}
                  axisLo={axis.lo}
                  axisHi={axis.hi}
                  currency={model.currency}
                  estimated
                  tone="accent"
                  label="The cell's own anchored band"
                />
              </div>
            ) : null}

            <p className={`${TYPE.eyebrow} mb-2`}>The risks inside it</p>
            <ul className="space-y-1">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onOpenRisk(row.id)}
                    className="group grid w-full grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,7.5rem)] items-center gap-3 rounded px-1 py-1 text-left transition-colors duration-140 hover:bg-surface-2 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,8.5rem)]"
                  >
                    <span className="min-w-0">
                      <span className="truncate-flex block text-xs text-ink-1 group-hover:text-ink-0">
                        {row.title}
                      </span>
                      <span className="font-mono text-[10px] text-ink-3">
                        {row.id}
                        {row.unit ? ` · ${row.unit}` : ''}
                      </span>
                    </span>
                    <IntervalBar
                      lo={row.lo}
                      hi={row.hi}
                      centre={row.centre}
                      axisLo={axis.lo}
                      axisHi={axis.hi}
                      currency={model.currency}
                      estimated={row.estimated}
                      label={`${row.title}: ${money(row.lo, model.currency)} to ${money(row.hi, model.currency)} a year`}
                    />
                    <span className="text-right font-mono text-[10px] text-ink-3 tnum">
                      {money(row.lo, model.currency)}–{money(row.hi, model.currency)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-2 grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,7.5rem)] gap-3 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,8.5rem)]">
              <span />
              <IntervalAxis
                lo={axis.lo}
                hi={axis.hi}
                currency={model.currency}
                appetite={model.appetite?.annualLossThreshold}
              />
              <span />
            </div>

            {hidden > 0 ? (
              <p className="mt-2 text-2xs text-ink-3">
                {hidden} further risk{hidden === 1 ? '' : 's'} in this cell are not drawn. The list
                is ordered by modelled annualised loss, so the widest and the narrowest are both
                shown; the full set is in the annotated register export.
              </p>
            ) : null}

            <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs text-ink-3">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-5 rounded-full bg-quant" />
                estimated for this risk
              </span>
              <span className="flex items-center gap-1.5">
                <span className="hatch h-1.5 w-5 rounded-full bg-insufficient" />
                inherited from the cell anchor — identical for every risk that inherits it
              </span>
              {model.appetite ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-px bg-quantify" />
                  appetite {money(model.appetite.annualLossThreshold, model.currency)}
                </span>
              ) : null}
            </p>
          </>
        )}

        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="mt-4 text-2xs text-accent transition-colors duration-140 hover:text-accent-strong"
        >
          {open ? 'Hide the reasoning' : 'Why this matters, and what to do →'}
        </button>
        {open ? (
          <div className="animate-stage-in mt-3 border-t border-line-1 pt-4">
            <ExplanationBlock explanation={finding.explanation} />
          </div>
        ) : null}
      </div>
    </article>
  )
}
