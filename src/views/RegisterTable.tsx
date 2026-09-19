/**
 * The register, every row of it.
 *
 * Two things make this more than a table dump. Rows that could not be placed
 * on the matrix are *still here*, greyed, with the reason against them —
 * because a register that silently loses four rows between the file and the
 * heatmap is how a risk stops being managed. And every row carries what the
 * audit found about it: its cell, its modelled interval, whether it is in an
 * inversion, whether it is shortlisted.
 *
 * Rows are windowed once the register passes a thousand rows. Below that,
 * rendering them all is faster than the arithmetic of not doing so.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import type { AuditReport, Risk } from '../engine/index.ts'
import { annualLossBounds, centralAnnualLoss } from '../engine/index.ts'
import { EmptyState, Panel, SectionHeading } from '../ui/primitives.tsx'
import { SOURCE_STYLE, TREATMENT_LABEL, TYPE } from '../ui/tokens.ts'
import { Tooltip } from '../ui/Tooltip.tsx'
import { count, date, money } from '../ui/format.ts'

type SortKey = 'row' | 'score' | 'loss' | 'title' | 'unit'

const ROW_HEIGHT = 40
const WINDOW_THRESHOLD = 600
const OVERSCAN = 12

export function RegisterTable({
  report,
  risks,
  onOpenRisk,
}: {
  report: AuditReport
  risks: readonly Risk[]
  onOpenRisk: (riskId: string) => void
}): React.JSX.Element {
  const [sort, setSort] = useState<SortKey>('score')
  const [ascending, setAscending] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(720)
  const container = useRef<HTMLDivElement>(null)

  const unplaced = useMemo(
    () => new Map(report.matrix.unplaced.map((u) => [u.riskId, u.reason])),
    [report.matrix.unplaced],
  )
  const shortlisted = useMemo(
    () => new Set(report.quantification.map((q) => q.riskId)),
    [report.quantification],
  )

  const sorted = useMemo(() => {
    const direction = ascending ? 1 : -1
    const lossOf = (risk: Risk): number => {
      const model = report.models.get(risk.id)
      return model ? centralAnnualLoss(model) : -1
    }
    return [...risks].sort((a, b) => {
      switch (sort) {
        case 'row':
          return (a.rowNumber - b.rowNumber) * direction
        case 'title':
          return a.title.localeCompare(b.title) * direction
        case 'unit':
          return (a.businessUnit ?? '').localeCompare(b.businessUnit ?? '') * direction
        case 'loss':
          return (lossOf(a) - lossOf(b)) * direction
        case 'score':
        default:
          return (
            ((report.scoreById.get(a.id) ?? -1) - (report.scoreById.get(b.id) ?? -1)) * direction ||
            a.id.localeCompare(b.id)
          )
      }
    })
  }, [risks, sort, ascending, report.scoreById, report.models])

  const windowed = sorted.length > WINDOW_THRESHOLD
  const start = windowed ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0
  const end = windowed
    ? Math.min(sorted.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN)
    : sorted.length
  const visible = sorted.slice(start, end)

  const onScroll = useCallback(() => {
    const node = container.current
    if (!node) return
    setScrollTop(node.scrollTop)
    setViewport(node.clientHeight)
  }, [])

  const header = (key: SortKey, label: string, align: 'left' | 'right' = 'left'): React.JSX.Element => (
    <th
      scope="col"
      aria-sort={sort === key ? (ascending ? 'ascending' : 'descending') : 'none'}
      className={`sticky top-0 z-10 whitespace-nowrap border-b border-line-2 bg-surface-1 px-3 py-2 font-mono text-[10px] font-normal uppercase tracking-[0.08em] text-ink-3 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      <button
        type="button"
        onClick={() => {
          if (sort === key) setAscending(!ascending)
          else {
            setSort(key)
            setAscending(false)
          }
        }}
        className="transition-colors duration-140 hover:text-ink-1"
      >
        {label}
        {sort === key ? <span aria-hidden> {ascending ? '↑' : '↓'}</span> : null}
      </button>
    </th>
  )

  return (
    <div className="space-y-6">
      <SectionHeading
        step="Register"
        title="Every row, with what the audit found against it"
        lead={
          <>
            {count(risks.length)} of {count(report.register.risks.length)} rows shown. Rows that
            could not be placed on the matrix are kept here with the reason — a register that
            silently loses rows between the file and the heatmap is how a risk stops being managed.
          </>
        }
      />

      {risks.length === 0 ? (
        <Panel>
          <EmptyState
            icon="search"
            title="No rows match the current filters"
            body="Clear a filter, or search for a risk identifier, title, owner, category or business unit."
          />
        </Panel>
      ) : (
        <Panel dense>
          <div
            ref={container}
            onScroll={onScroll}
            className="max-h-[70vh] overflow-auto scroll-thin"
          >
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr>
                  {header('row', 'Row')}
                  {header('title', 'Risk')}
                  {header('unit', 'Unit')}
                  <th scope="col" className="sticky top-0 z-10 whitespace-nowrap border-b border-line-2 bg-surface-1 px-3 py-2 font-mono text-[10px] font-normal uppercase tracking-[0.08em] text-ink-3">
                    Cell
                  </th>
                  {header('score', 'Score', 'right')}
                  {header('loss', 'Modelled / year', 'right')}
                  <th scope="col" className="sticky top-0 z-10 whitespace-nowrap border-b border-line-2 bg-surface-1 px-3 py-2 font-mono text-[10px] font-normal uppercase tracking-[0.08em] text-ink-3">
                    Flags
                  </th>
                </tr>
              </thead>
              <tbody>
                {windowed && start > 0 ? (
                  <tr style={{ height: start * ROW_HEIGHT }}>
                    <td colSpan={7} />
                  </tr>
                ) : null}

                {visible.map((risk) => {
                  const model = report.models.get(risk.id)
                  const bounds = model ? annualLossBounds(model) : undefined
                  const reason = unplaced.get(risk.id)
                  return (
                    <tr
                      key={risk.id}
                      onClick={() => onOpenRisk(risk.id)}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onOpenRisk(risk.id)
                        }
                      }}
                      style={{ height: ROW_HEIGHT }}
                      className={`cursor-pointer border-b border-line-1 transition-colors duration-90 hover:bg-surface-2 ${
                        reason ? 'opacity-55' : ''
                      }`}
                    >
                      <td className="whitespace-nowrap px-3 font-mono text-[10px] text-ink-3 tnum">
                        {risk.rowNumber}
                      </td>
                      <td className="max-w-0 px-3">
                        <span className="truncate-flex block text-ink-0">{risk.title}</span>
                        <span className="font-mono text-[10px] text-ink-3">
                          {risk.id}
                          {risk.category ? ` · ${risk.category}` : ''}
                          {risk.assessor ? ` · ${risk.assessor}` : ''}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 text-ink-2">
                        {risk.businessUnit ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 font-mono text-[11px] text-ink-1">
                        {reason ? (
                          <Tooltip title="Not placed" body={reason}>
                            <span className="cursor-help text-ambiguous">—</span>
                          </Tooltip>
                        ) : (
                          `L${risk.likelihood}I${risk.impact}`
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 text-right font-mono text-[11px] text-ink-0 tnum">
                        {report.scoreById.get(risk.id) ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 text-right font-mono text-[11px] tnum">
                        {bounds ? (
                          <span
                            className={
                              model &&
                              (model.frequencySource === 'register-estimate' ||
                                model.magnitudeSource === 'register-estimate')
                                ? 'text-quant'
                                : 'text-ink-3'
                            }
                          >
                            {money(bounds.lo, report.register.model.currency)}–
                            {money(bounds.hi, report.register.model.currency)}
                          </span>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3">
                        <span className="flex items-center gap-1.5">
                          {shortlisted.has(risk.id) ? (
                            <Flag tone="quantify" title="On the quantification shortlist">
                              Q
                            </Flag>
                          ) : null}
                          {report.inversionIds.has(risk.id) ? (
                            <Flag tone="distorted" title="Appears in an inversion finding">
                              I
                            </Flag>
                          ) : null}
                          {risk.statedScore !== null &&
                          risk.statedScore !== report.scoreById.get(risk.id) ? (
                            <Flag
                              tone="ambiguous"
                              title={`The register states ${risk.statedScore}; the configured formula gives ${report.scoreById.get(risk.id) ?? '—'}`}
                            >
                              S
                            </Flag>
                          ) : null}
                          {!risk.assessor ? (
                            <Flag tone="insufficient" title="No assessor recorded">
                              A
                            </Flag>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  )
                })}

                {windowed && end < sorted.length ? (
                  <tr style={{ height: (sorted.length - end) * ROW_HEIGHT }}>
                    <td colSpan={7} />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-1 px-4 py-3">
            <span className={TYPE.eyebrow}>Flags</span>
            <Legend tone="quantify" letter="Q">
              on the quantification shortlist
            </Legend>
            <Legend tone="distorted" letter="I">
              appears in an inversion finding
            </Legend>
            <Legend tone="ambiguous" letter="S">
              stated score disagrees with the formula
            </Legend>
            <Legend tone="insufficient" letter="A">
              no assessor recorded
            </Legend>
            <span className="flex items-center gap-1.5 text-2xs text-ink-3">
              <span className={`h-1.5 w-1.5 rounded-full ${SOURCE_STYLE['register-estimate'].dot}`} />
              a cyan interval came from the register; grey was inherited from the cell
            </span>
          </div>
        </Panel>
      )}
    </div>
  )
}

function Flag({
  tone,
  title,
  children,
}: {
  tone: 'quantify' | 'distorted' | 'ambiguous' | 'insufficient'
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  const classes: Record<string, string> = {
    quantify: 'border-quantify/40 text-quantify',
    distorted: 'border-distorted/40 text-distorted',
    ambiguous: 'border-ambiguous/40 text-ambiguous',
    insufficient: 'border-insufficient/40 text-insufficient',
  }
  return (
    <span
      title={title}
      className={`inline-flex h-4 w-4 items-center justify-center rounded border font-mono text-[9px] ${classes[tone]}`}
    >
      {children}
    </span>
  )
}

function Legend({
  tone,
  letter,
  children,
}: {
  tone: 'quantify' | 'distorted' | 'ambiguous' | 'insufficient'
  letter: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span className="flex items-center gap-1.5 text-2xs text-ink-3">
      <Flag tone={tone} title="">
        {letter}
      </Flag>
      {children}
    </span>
  )
}

/** Exported for the drawer, which shows the same provenance line. */
export function assessedLine(risk: Risk): string {
  const parts = [risk.assessor ?? 'no assessor', date(risk.assessedOn), TREATMENT_LABEL[risk.treatment] ?? risk.treatment]
  return parts.join(' · ')
}
