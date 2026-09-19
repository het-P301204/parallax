/**
 * Rank inversion.
 *
 * Each finding is a pair drawn on one shared axis, so the claim is visible
 * before it is read: the risk the register ranks lower has its interval
 * further right. The status badge carries the strength of the claim and the
 * badge's tooltip carries its definition, because "confirmed" and "candidate"
 * are doing very different work and the difference has to survive being
 * skim-read.
 *
 * What this view refuses to do is say that a ranking is wrong. It says the
 * register's order and the configured model disagree, names the assumptions
 * the model is resting on, and leaves the judgement where it belongs.
 */

import { useMemo, useState } from 'react'
import type { AuditReport, InversionCandidate } from '../engine/index.ts'
import { annualLossBounds, centralAnnualLoss } from '../engine/index.ts'
import { IntervalAxis, IntervalBar } from '../ui/charts.tsx'
import { ExplanationBlock, EmptyState, Panel, SectionHeading, StateBadge } from '../ui/primitives.tsx'
import { INVERSION_LABEL, INVERSION_STATE, SURFACE, TYPE } from '../ui/tokens.ts'
import { count, money, percent } from '../ui/format.ts'
import type { Mode } from '../state.ts'

type StatusFilter = 'all' | InversionCandidate['status']

export function Ranking({
  report,
  mode,
  onOpenRisk,
}: {
  report: AuditReport
  mode: Mode
  onOpenRisk: (riskId: string) => void
}): React.JSX.Element {
  const [status, setStatus] = useState<StatusFilter>('all')
  const [open, setOpen] = useState<string | undefined>()

  const counts = useMemo(() => {
    const map = new Map<InversionCandidate['status'], number>()
    for (const inversion of report.inversions) {
      map.set(inversion.status, (map.get(inversion.status) ?? 0) + 1)
    }
    return map
  }, [report.inversions])

  const visible = report.inversions
    .filter((i) => status === 'all' || i.status === status)
    .slice(0, mode === 'executive' ? 5 : 40)

  return (
    <div className="space-y-6">
      <SectionHeading
        step="Rank order"
        title="Which rankings may be unreliable?"
        lead={
          <>
            {count(report.summary.inversionCandidates)} ordered pairs where the register ranks one
            risk above another while the configured model puts the other&rsquo;s annualised loss
            higher. {count(report.summary.confirmedInversions)} of them do not overlap at all.
          </>
        }
      />

      {report.inversions.length === 0 ? (
        <Panel>
          <EmptyState
            icon="clean"
            title="No inversion candidates"
            body="Under the configured anchors and estimates, the register's order and the modelled annualised loss agree everywhere they can be compared. If very few risks carry their own estimates, that agreement is partly a statement about how little there is to disagree with — the estimate-coverage figure on the overview says how much."
          />
        </Panel>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <FilterChip
              label="All"
              value={report.inversions.length}
              active={status === 'all'}
              onClick={() => setStatus('all')}
            />
            {(['confirmed-under-model', 'candidate'] as const).map((key) =>
              counts.get(key) ? (
                <FilterChip
                  key={key}
                  label={INVERSION_LABEL[key]}
                  value={counts.get(key) ?? 0}
                  active={status === key}
                  onClick={() => setStatus(key)}
                />
              ) : null,
            )}
          </div>

          <ul className="space-y-3">
            {visible.map((inversion) => {
              const key = `${inversion.higherId}>${inversion.lowerId}`
              return (
                <li key={key}>
                  <InversionCard
                    report={report}
                    inversion={inversion}
                    open={open === key}
                    onToggle={() => setOpen(open === key ? undefined : key)}
                    onOpenRisk={onOpenRisk}
                  />
                </li>
              )
            })}
          </ul>

          {report.summary.inversionCandidates > report.summary.inversionsShown ? (
            <p className="text-2xs text-ink-3">
              Showing the {count(report.summary.inversionsShown)} most severe of{' '}
              {count(report.summary.inversionCandidates)} found. The full set is in the inversion
              export.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

function FilterChip({
  label,
  value,
  active,
  onClick,
}: {
  label: string
  value: number
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-2xs transition-colors duration-140 ${
        active
          ? 'border-accent/50 bg-accent/15 text-accent-strong'
          : 'border-line-2 text-ink-2 hover:border-line-3 hover:text-ink-1'
      }`}
    >
      {label}
      <span className="font-mono text-[10px] tnum opacity-70">{value}</span>
    </button>
  )
}

function InversionCard({
  report,
  inversion,
  open,
  onToggle,
  onOpenRisk,
}: {
  report: AuditReport
  inversion: InversionCandidate
  open: boolean
  onToggle: () => void
  onOpenRisk: (riskId: string) => void
}): React.JSX.Element {
  const { currency, appetite } = report.register.model
  const higher = report.byId.get(inversion.higherId)
  const lower = report.byId.get(inversion.lowerId)
  const higherModel = report.models.get(inversion.higherId)
  const lowerModel = report.models.get(inversion.lowerId)
  if (!higher || !lower || !higherModel || !lowerModel) {
    return <div />
  }

  const hb = annualLossBounds(higherModel)
  const lb = annualLossBounds(lowerModel)
  const values = [hb.lo, hb.hi, lb.lo, lb.hi].filter((v) => v > 0)
  const axis = { lo: Math.min(...values) / 1.6, hi: Math.max(...values) * 1.6 }
  const state = INVERSION_STATE[inversion.status]

  return (
    <article className={`${SURFACE.panel} overflow-hidden`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line-1 px-5 py-3">
        <p className="min-w-0 text-xs leading-relaxed text-ink-2">{inversion.explanation.what}</p>
        <div className="flex shrink-0 items-center gap-2">
          {inversion.exceedanceProbability !== undefined ? (
            <span className="font-mono text-[10px] text-ink-3 tnum">
              P(lower exceeds higher) = {percent(inversion.exceedanceProbability, 0)}
            </span>
          ) : null}
          <StateBadge state={state} label={INVERSION_LABEL[inversion.status]} size="xs" />
        </div>
      </header>

      <div className="px-5 py-4">
        <Side
          role="Ranked higher"
          id={inversion.higherId}
          title={higher.title}
          cell={inversion.higherCell}
          score={inversion.higherScore}
          lo={hb.lo}
          hi={hb.hi}
          centre={centralAnnualLoss(higherModel)}
          estimated={
            higherModel.frequencySource === 'register-estimate' ||
            higherModel.magnitudeSource === 'register-estimate'
          }
          axis={axis}
          currency={currency}
          onOpen={() => onOpenRisk(inversion.higherId)}
        />
        <Side
          role="Ranked lower"
          id={inversion.lowerId}
          title={lower.title}
          cell={inversion.lowerCell}
          score={inversion.lowerScore}
          lo={lb.lo}
          hi={lb.hi}
          centre={centralAnnualLoss(lowerModel)}
          estimated={
            lowerModel.frequencySource === 'register-estimate' ||
            lowerModel.magnitudeSource === 'register-estimate'
          }
          axis={axis}
          currency={currency}
          tone="distorted"
          onOpen={() => onOpenRisk(inversion.lowerId)}
        />

        <div className="ml-0 mt-1 sm:ml-[13rem]">
          <IntervalAxis
            lo={axis.lo}
            hi={axis.hi}
            currency={currency}
            appetite={appetite?.annualLossThreshold}
          />
        </div>

        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="mt-3 text-2xs text-accent transition-colors duration-140 hover:text-accent-strong"
        >
          {open ? 'Hide the reasoning' : 'Why, and on what assumptions →'}
        </button>
        {open ? (
          <div className="animate-stage-in mt-3 border-t border-line-1 pt-4">
            <ExplanationBlock explanation={inversion.explanation} />
          </div>
        ) : null}
      </div>
    </article>
  )
}

function Side({
  role,
  id,
  title,
  cell,
  score,
  lo,
  hi,
  centre,
  estimated,
  axis,
  currency,
  tone,
  onOpen,
}: {
  role: string
  id: string
  title: string
  cell: string
  score: number
  lo: number
  hi: number
  centre: number
  estimated: boolean
  axis: { lo: number; hi: number }
  currency: string
  tone?: 'distorted'
  onOpen: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group grid w-full grid-cols-1 items-center gap-2 rounded py-1.5 text-left transition-colors duration-140 hover:bg-surface-2 sm:grid-cols-[13rem_minmax(0,1fr)_8.5rem] sm:gap-3"
    >
      <span className="min-w-0">
        <span className={`${TYPE.eyebrow} block`}>{role}</span>
        <span className="truncate-flex block text-xs text-ink-1 group-hover:text-ink-0">
          {title}
        </span>
        <span className="font-mono text-[10px] text-ink-3">
          {id} · {cell} · score {score}
        </span>
      </span>
      <IntervalBar
        lo={lo}
        hi={hi}
        centre={centre}
        axisLo={axis.lo}
        axisHi={axis.hi}
        currency={currency}
        estimated={estimated}
        tone={tone ?? 'quant'}
        label={`${title}: ${money(lo, currency)} to ${money(hi, currency)} a year`}
      />
      <span className="text-right font-mono text-[10px] text-ink-3 tnum">
        {money(lo, currency)}–{money(hi, currency)}
      </span>
    </button>
  )
}
