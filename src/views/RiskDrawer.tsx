/**
 * The risk workspace.
 *
 * Everything the audit knows about one row, in the order an analyst would ask
 * for it: who said what, where it sits, what it is modelled at, what it cannot
 * be told apart from, what it might invert against, and whether it is worth
 * quantifying. It opens as a drawer rather than a page so the reader never
 * loses the view they were in.
 *
 * Focus is trapped while it is open and returned to whatever opened it on
 * close, and Escape closes it. A drawer that steals focus and does not give it
 * back is unusable with a keyboard, which is most of the reason drawers have a
 * bad reputation.
 */

import { useEffect, useMemo, useRef } from 'react'
import type { AuditReport } from '../engine/index.ts'
import {
  annualLossBounds,
  centralAnnualLoss,
  evidenceLabel,
  labelOf,
  relationsFor,
  simulate,
} from '../engine/index.ts'
import { IntervalAxis, IntervalBar, DistributionChart } from '../ui/charts.tsx'
import { RelationshipGraph } from '../ui/RelationshipGraph.tsx'
import { Button, DataRow, ExplanationBlock, Reveal, StateBadge } from '../ui/primitives.tsx'
import { SOURCE_STYLE, SURFACE, TREATMENT_LABEL, TYPE } from '../ui/tokens.ts'
import { count, date, money, percent, rate, span } from '../ui/format.ts'

export function RiskDrawer({
  report,
  riskId,
  onClose,
  onOpenRisk,
  onSimulate,
}: {
  report: AuditReport
  riskId: string
  onClose: () => void
  onOpenRisk: (riskId: string) => void
  onSimulate: (riskId: string) => void
}): React.JSX.Element | null {
  const panel = useRef<HTMLDivElement>(null)
  const restoreTo = useRef<Element | null>(null)

  const risk = report.byId.get(riskId)
  const model = report.models.get(riskId)
  const { currency, appetite } = report.register.model

  useEffect(() => {
    restoreTo.current = document.activeElement
    panel.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab' || !panel.current) return
      const focusable = panel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (restoreTo.current instanceof HTMLElement) restoreTo.current.focus()
    }
  }, [onClose])

  const relations = useMemo(() => relationsFor(report, riskId), [report, riskId])
  const compression = useMemo(
    () => report.compression.find((c) => c.cellKey === `L${risk?.likelihood}I${risk?.impact}`),
    [report.compression, risk],
  )
  const inversions = useMemo(
    () => report.inversions.filter((i) => i.higherId === riskId || i.lowerId === riskId),
    [report.inversions, riskId],
  )
  const candidate = useMemo(
    () => report.triaged.find((q) => q.riskId === riskId),
    [report.triaged, riskId],
  )
  const result = useMemo(
    () =>
      model
        ? simulate(model, { iterations: 12_000, appetite: appetite?.annualLossThreshold })
        : undefined,
    [model, appetite],
  )

  const cellMates = useMemo(() => {
    if (!compression) return []
    return compression.orderedRiskIds
      .map((id) => {
        const peerModel = report.models.get(id)
        const peer = report.byId.get(id)
        if (!peerModel || !peer) return null
        const bounds = annualLossBounds(peerModel)
        return {
          id,
          title: peer.title,
          lo: bounds.lo,
          hi: bounds.hi,
          centre: centralAnnualLoss(peerModel),
          estimated:
            peerModel.frequencySource === 'register-estimate' ||
            peerModel.magnitudeSource === 'register-estimate',
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
  }, [compression, report.models, report.byId])

  const axis = useMemo(() => {
    const values = cellMates.flatMap((r) => [r.lo, r.hi]).filter((v) => v > 0)
    if (appetite) values.push(appetite.annualLossThreshold)
    if (values.length === 0) return undefined
    return { lo: Math.min(...values) / 1.6, hi: Math.max(...values) * 1.6 }
  }, [cellMates, appetite])

  if (!risk) return null

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <button
        type="button"
        aria-label="Close risk detail"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-surface-0/70 backdrop-blur-[2px]"
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`Risk detail: ${risk.title}`}
        tabIndex={-1}
        className="relative flex w-full max-w-2xl animate-drawer-in flex-col border-l border-line-2 bg-surface-1 shadow-drawer focus:outline-none"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line-1 px-5 py-4">
          <div className="min-w-0">
            <p className={`${TYPE.eyebrow} mb-1.5`}>
              {risk.id} · row {risk.rowNumber}
            </p>
            <h2 className="font-display text-lg font-medium leading-snug tracking-tight text-ink-0">
              {risk.title}
            </h2>
            <p className="mt-1 text-2xs text-ink-3">
              {risk.assessor ?? 'no assessor'} · {date(risk.assessedOn)} ·{' '}
              {TREATMENT_LABEL[risk.treatment] ?? risk.treatment}
            </p>
          </div>
          <Button onClick={onClose} aria-label="Close">
            Close
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto scroll-thin px-5 py-5">
          {risk.description ? (
            <p className="text-xs leading-relaxed text-ink-1">{risk.description}</p>
          ) : null}

          {/* --- Identity and position ----------------------------------- */}
          <Section title="Position">
            <div className="grid gap-x-6 sm:grid-cols-2">
              <dl>
                <DataRow label="Likelihood">
                  {risk.likelihood === null
                    ? '—'
                    : `${risk.likelihood} · ${labelOf(report.register.model.likelihood, risk.likelihood)}`}
                </DataRow>
                <DataRow label="Impact">
                  {risk.impact === null
                    ? '—'
                    : `${risk.impact} · ${labelOf(report.register.model.impact, risk.impact)}`}
                </DataRow>
                <DataRow
                  label="Computed score"
                  hint="What the configured formula gives for these two levels."
                >
                  {report.scoreById.get(riskId) ?? '—'}
                </DataRow>
                <DataRow
                  label="Stated score"
                  hint="What the register's own score column says. A disagreement is reported, never corrected."
                >
                  <span
                    className={
                      risk.statedScore !== null && risk.statedScore !== report.scoreById.get(riskId)
                        ? 'text-ambiguous'
                        : ''
                    }
                  >
                    {risk.statedScore ?? '—'}
                  </span>
                </DataRow>
              </dl>
              <dl>
                <DataRow label="Rank by score">
                  {report.rankById.get(riskId) ?? '—'} of {count(report.summary.risksAnalysed)}
                </DataRow>
                <DataRow label="Category">{risk.category ?? '—'}</DataRow>
                <DataRow label="Business unit">{risk.businessUnit ?? '—'}</DataRow>
                <DataRow label="Owner">{risk.owner ?? '—'}</DataRow>
              </dl>
            </div>
            {risk.controls ? (
              <div className={`${SURFACE.well} mt-3 px-3 py-2.5`}>
                <p className={`${TYPE.eyebrow} mb-1`}>Existing controls</p>
                <p className="text-xs leading-relaxed text-ink-1">{risk.controls}</p>
              </div>
            ) : null}
          </Section>

          {/* --- Quantitative model -------------------------------------- */}
          <Section
            title="Modelled annualised loss"
            badge={model ? undefined : <StateBadge state="insufficient-data" size="xs" />}
          >
            {!model ? (
              <p className="text-xs leading-relaxed text-ink-2">
                No quantitative model. Neither this risk nor its cell carries the anchors a loss
                interval would need, so nothing quantitative is claimed about it.
              </p>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 rounded-full ${SOURCE_STYLE[model.frequencySource].dot}`}
                  />
                  <span className="text-2xs text-ink-2">{evidenceLabel(model)}</span>
                </div>
                <dl className="grid gap-x-6 sm:grid-cols-2">
                  <DataRow label="Frequency">
                    {rate(model.frequency.lo)}–{rate(model.frequency.hi)} / year
                  </DataRow>
                  <DataRow label="Loss per occurrence">
                    {money(model.magnitude.lo, currency)}–{money(model.magnitude.hi, currency)}
                  </DataRow>
                  {result ? (
                    <>
                      <DataRow label="Median year">{money(result.summary.p50, currency)}</DataRow>
                      <DataRow label="1-in-100 year">{money(result.summary.p99, currency)}</DataRow>
                    </>
                  ) : null}
                </dl>
                {result ? (
                  <Reveal className="mt-4">
                    <DistributionChart
                      result={result}
                      currency={currency}
                      appetite={appetite?.annualLossThreshold}
                      height={112}
                    />
                  </Reveal>
                ) : null}
                {result?.probabilityOverAppetite !== undefined && appetite ? (
                  <p className="mt-3 text-xs leading-relaxed text-ink-1">
                    Exceeds the {money(appetite.annualLossThreshold, currency)} appetite in{' '}
                    <span className="font-mono text-ink-0 tnum">
                      {percent(result.probabilityOverAppetite, 1)}
                    </span>{' '}
                    of {count(result.iterations)} simulated years, under the assumptions listed in
                    the simulation view.
                  </p>
                ) : null}
                <Button className="mt-4" onClick={() => onSimulate(riskId)}>
                  Open in the simulation workbench →
                </Button>
              </>
            )}
          </Section>

          {/* --- Compression --------------------------------------------- */}
          {compression && axis && cellMates.length > 1 ? (
            <Section
              title="What it cannot be told apart from"
              badge={<StateBadge state={compression.state} size="xs" />}
            >
              <p className="mb-3 text-xs leading-relaxed text-ink-2">
                {count(compression.riskCount)} risks share cell {compression.cellKey}, which resolves
                annualised loss no finer than {span(compression.anchorSpan)}.
              </p>
              <ul className="space-y-1">
                {cellMates.map((mate) => (
                  <li key={mate.id}>
                    <button
                      type="button"
                      onClick={() => mate.id !== riskId && onOpenRisk(mate.id)}
                      className={`grid w-full grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-2.5 rounded px-1 py-1 text-left transition-colors duration-140 ${
                        mate.id === riskId ? 'bg-accent/10' : 'hover:bg-surface-2'
                      }`}
                    >
                      <span className="truncate-flex text-[11px] text-ink-1">{mate.title}</span>
                      <IntervalBar
                        lo={mate.lo}
                        hi={mate.hi}
                        centre={mate.centre}
                        axisLo={axis.lo}
                        axisHi={axis.hi}
                        currency={currency}
                        estimated={mate.estimated}
                        tone={mate.id === riskId ? 'accent' : 'quant'}
                      />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="ml-[9.6rem] mt-1">
                <IntervalAxis
                  lo={axis.lo}
                  hi={axis.hi}
                  currency={currency}
                  appetite={appetite?.annualLossThreshold}
                />
              </div>
            </Section>
          ) : null}

          {/* --- Inversions ---------------------------------------------- */}
          {inversions.length > 0 ? (
            <Section title={`Inversion findings (${inversions.length})`}>
              <ul className="space-y-2">
                {inversions.slice(0, 6).map((inversion) => {
                  const otherId = inversion.higherId === riskId ? inversion.lowerId : inversion.higherId
                  const thisIsLower = inversion.lowerId === riskId
                  return (
                    <li
                      key={`${inversion.higherId}>${inversion.lowerId}`}
                      className={`${SURFACE.well} px-3 py-2.5`}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <StateBadge
                          state={inversion.status === 'confirmed-under-model' ? 'distorted' : 'ambiguous'}
                          size="xs"
                          label={inversion.status === 'confirmed-under-model' ? 'Confirmed' : 'Candidate'}
                        />
                        <span className="text-2xs text-ink-3">
                          {thisIsLower ? 'this risk is modelled above' : 'this risk is modelled below'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenRisk(otherId)}
                        className="truncate-flex block w-full text-left text-xs text-ink-1 hover:text-ink-0"
                      >
                        {report.byId.get(otherId)?.title ?? otherId}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </Section>
          ) : null}

          {/* --- Triage --------------------------------------------------- */}
          {candidate ? (
            <Section
              title="Quantification triage"
              badge={<StateBadge state={candidate.state} size="xs" />}
            >
              <p className="mb-3 text-xs leading-relaxed text-ink-1">{candidate.explanation.what}</p>
              <ExplanationBlock explanation={candidate.explanation} compact />
            </Section>
          ) : null}

          {/* --- Relationships -------------------------------------------- */}
          <Section title="Related risks">
            <Reveal>
              <RelationshipGraph
                focus={risk}
                relations={relations}
                risks={report.byId}
                scoreById={report.scoreById}
                onOpen={onOpenRisk}
              />
            </Reveal>
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({
  title,
  badge,
  children,
}: {
  title: string
  badge?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className={`${SURFACE.panel} px-4 py-4`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className={TYPE.eyebrow}>{title}</h3>
        {badge}
      </div>
      {children}
    </section>
  )
}
