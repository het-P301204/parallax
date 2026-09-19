/**
 * The matrix view — where the signature interaction lives.
 *
 * Two panels side by side that are really one space: the qualitative matrix on
 * the left, the continuous loss axis on the right. Selecting a cell lifts its
 * plate and separates the intervals it was covering. On a narrow screen they
 * stack, the matrix stays first, and the stage scrolls into view on selection,
 * because the interaction is the point and it has to survive a tablet.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AuditReport } from '../engine/index.ts'
import { labelOf } from '../engine/index.ts'
import { RiskMatrix } from '../ui/RiskMatrix.tsx'
import { ParallaxStage } from '../ui/ParallaxStage.tsx'
import { ExplanationBlock, Panel, SectionHeading, StateBadge } from '../ui/primitives.tsx'
import { SURFACE, TYPE } from '../ui/tokens.ts'
import { count, money, span } from '../ui/format.ts'

export function MatrixView({
  report,
  selectedCell,
  onSelectCell,
  onOpenRisk,
  highlight,
}: {
  report: AuditReport
  selectedCell?: string
  onSelectCell: (key: string | undefined) => void
  onOpenRisk: (riskId: string) => void
  highlight?: ReadonlySet<string>
}): React.JSX.Element {
  const [focusedRisk, setFocusedRisk] = useState<string | undefined>()
  const stageRef = useRef<HTMLDivElement>(null)
  const firstSelection = useRef(true)

  const cell = useMemo(
    () => report.matrix.cells.find((c) => c.key === selectedCell),
    [report.matrix.cells, selectedCell],
  )
  const finding = useMemo(
    () => report.compression.find((c) => c.cellKey === selectedCell),
    [report.compression, selectedCell],
  )

  // Scroll the stage into view on a narrow screen, but never on first paint.
  useEffect(() => {
    if (!selectedCell) return
    if (firstSelection.current) {
      firstSelection.current = false
      return
    }
    if (window.innerWidth >= 1024) return
    stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selectedCell])

  const occupied = report.matrix.cells.filter((c) => c.riskIds.length > 0).length

  return (
    <div className="space-y-6">
      <SectionHeading
        step="The matrix"
        title="What does a single cell hide?"
        lead={
          <>
            Cells are coloured by what they <em>cannot resolve</em> rather than by their score — the
            score is already on the axes. Select one to separate it from the continuous loss axis
            and see the intervals underneath.
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <Panel
          eyebrow={`${occupied} of ${report.matrix.cells.length} cells occupied`}
          title="Qualitative matrix"
          actions={
            selectedCell ? (
              <button
                type="button"
                onClick={() => onSelectCell(undefined)}
                className="text-2xs text-ink-2 hover:text-ink-0"
              >
                Clear
              </button>
            ) : undefined
          }
        >
          <RiskMatrix
            matrix={report.matrix}
            model={report.register.model}
            compression={report.compression}
            selected={selectedCell}
            onSelect={(key) => onSelectCell(key === selectedCell ? undefined : key)}
            highlight={highlight}
          />

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-1 pt-4">
            <span className={TYPE.eyebrow}>Cell colour</span>
            {(['distorted', 'requires-quantification', 'ambiguous', 'supported', 'insufficient-data'] as const).map(
              (state) => (
                <span key={state} className="flex items-center gap-1.5">
                  <StateBadge state={state} size="xs" />
                </span>
              ),
            )}
            <span className="flex items-center gap-1.5 text-2xs text-ink-3">
              <span className="h-1.5 w-1.5 rounded-full bg-quantify" />
              appetite falls inside
            </span>
          </div>
        </Panel>

        <div ref={stageRef}>
          <ParallaxStage
            cell={cell}
            finding={finding}
            model={report.register.model}
            risks={report.byId}
            models={report.models}
            appetite={report.register.model.appetite}
            focusedRiskId={focusedRisk}
            onFocusRisk={setFocusedRisk}
            onOpenRisk={onOpenRisk}
          />
        </div>
      </div>

      {cell && finding ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Panel
            eyebrow="Cell summary"
            title={`${labelOf(report.register.model.likelihood, cell.likelihood)} × ${labelOf(report.register.model.impact, cell.impact)}`}
          >
            <dl className="space-y-0 divide-y divide-line-1">
              <Row label="Risks in this cell" value={count(cell.riskIds.length)} />
              <Row
                label="With their own estimate"
                value={`${finding.estimatedCount} of ${finding.riskCount}`}
              />
              <Row label="Score" value={`${cell.score}${cell.band ? ` · ${cell.band}` : ''}`} />
              <Row
                label="Anchored annualised loss"
                value={
                  cell.anchoredAnnualLoss
                    ? `${money(cell.anchoredAnnualLoss.lo, report.register.model.currency)}–${money(cell.anchoredAnnualLoss.hi, report.register.model.currency)}`
                    : '—'
                }
              />
              <Row label="Cell resolution" value={span(finding.anchorSpan)} />
              <Row
                label="Spread among estimated members"
                value={finding.estimateSpan === undefined ? '—' : span(finding.estimateSpan)}
              />
              <Row
                label="Straddles the appetite"
                value={finding.straddlesAppetite ? 'Yes' : 'No'}
              />
            </dl>
          </Panel>

          <Panel eyebrow="Compression finding" title="Why this cell is flagged">
            <div className="mb-4">
              <StateBadge state={finding.state} />
            </div>
            <ExplanationBlock explanation={finding.explanation} />
          </Panel>
        </div>
      ) : (
        <section className={`${SURFACE.panel} px-6 py-7`}>
          <p className={`${TYPE.eyebrow} mb-2`}>How to read this</p>
          <p className="max-w-3xl text-sm leading-relaxed text-ink-2">
            A cell is a label. Behind it sit the risks that were given that label, and the
            organisation&rsquo;s own anchors say how wide a band of annualised loss that label
            covers. When the band is wide, two risks an order of magnitude apart get the same score
            — and when the band crosses the appetite threshold, the score cannot say whether
            anything in it is inside appetite or outside it. That is the whole argument, and the
            panel on the right draws it for whichever cell you choose.
          </p>
        </section>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-xs text-ink-3">{label}</dt>
      <dd className="min-w-0 text-right font-mono text-xs text-ink-0 tnum">{value}</dd>
    </div>
  )
}
