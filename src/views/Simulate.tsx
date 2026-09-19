/**
 * The simulation workbench.
 *
 * Four things on one page, in the order a quantitative argument is actually
 * made: the assumptions, the run, the distribution, and what it means for the
 * decision. The assumptions come first and are editable, because a reader who
 * cannot change them cannot test them — and a simulation nobody can test is a
 * number with a chart attached.
 *
 * Nothing here is presented as truth. The panel at the bottom lists every
 * assumption the engine baked in, including the ones that make the result
 * optimistic, and the heading says "modelled" rather than "actual" everywhere
 * it appears.
 */

import { useMemo, useState } from 'react'
import type { AuditReport, QuantitativeModel, SimulationResult } from '../engine/index.ts'
import { DEFAULT_ITERATIONS, evidenceLabel, simulate } from '../engine/index.ts'
import { DistributionChart, LossExceedanceCurve } from '../ui/charts.tsx'
import { Button, EmptyState, Panel, SectionHeading, StateBadge } from '../ui/primitives.tsx'
import { CONTROL, SOURCE_STYLE, SURFACE, TYPE } from '../ui/tokens.ts'
import { Tooltip } from '../ui/Tooltip.tsx'
import { count, money, percent, rate } from '../ui/format.ts'

const ITERATION_CHOICES = [5_000, 20_000, 50_000, 100_000] as const

export function Simulate({
  report,
  riskId,
  onSelectRisk,
  onOpenRisk,
}: {
  report: AuditReport
  riskId?: string
  onSelectRisk: (riskId: string) => void
  onOpenRisk: (riskId: string) => void
}): React.JSX.Element {
  const candidates = report.quantification
  const selected = riskId ?? candidates[0]?.riskId
  const baseModel = selected ? report.models.get(selected) : undefined

  const [iterations, setIterations] = useState<number>(DEFAULT_ITERATIONS)
  const [overrides, setOverrides] = useState<Record<string, { f: [number, number]; m: [number, number] }>>({})

  const model = useMemo<QuantitativeModel | undefined>(() => {
    if (!baseModel || !selected) return undefined
    const override = overrides[selected]
    if (!override) return baseModel
    return {
      ...baseModel,
      frequency: { lo: override.f[0], hi: override.f[1] },
      magnitude: { lo: override.m[0], hi: override.m[1] },
      frequencySource: 'register-estimate',
      magnitudeSource: 'register-estimate',
      assumptions: [
        'The frequency and loss ranges below were entered by hand in this session. They are not what the register says.',
        ...baseModel.assumptions.slice(2),
      ],
    }
  }, [baseModel, selected, overrides])

  const result = useMemo<SimulationResult | undefined>(() => {
    if (!model) return undefined
    return simulate(model, {
      iterations,
      appetite: report.register.model.appetite?.annualLossThreshold,
    })
  }, [model, iterations, report.register.model.appetite])

  if (candidates.length === 0 || !selected) {
    return (
      <div className="space-y-6">
        <SectionHeading step="Simulation" title="What does the quantitative interval look like?" />
        <Panel>
          <EmptyState
            title="Nothing has been shortlisted to simulate"
            body="The simulation is deliberately reachable only for risks the triage selected. Simulating an entire register would reproduce the error this product exists to find: a precise-looking number built on inputs nobody examined."
          />
        </Panel>
      </div>
    )
  }

  const risk = report.byId.get(selected)
  const currency = report.register.model.currency
  const appetite = report.register.model.appetite

  return (
    <div className="space-y-6">
      <SectionHeading
        step="Simulation"
        title="What does the quantitative interval look like?"
        lead="Inputs are 90% intervals — the range you would be surprised to fall outside. Rate uncertainty is modelled explicitly, so the result is wider than a point-estimate calculation and honestly so."
        actions={
          <select
            value={selected}
            onChange={(event) => onSelectRisk(event.target.value)}
            aria-label="Risk to simulate"
            className={`${CONTROL.select} max-w-[18rem]`}
          >
            {candidates.map((candidate) => (
              <option key={candidate.riskId} value={candidate.riskId}>
                {candidate.rank}. {report.byId.get(candidate.riskId)?.title ?? candidate.riskId}
              </option>
            ))}
          </select>
        }
      />

      {!model || !result ? (
        <Panel>
          <EmptyState
            title="This risk has no quantitative model"
            body="Neither a register estimate nor a scale anchor is available for it, so there is nothing to simulate. This is reported rather than filled in with a default."
          />
        </Panel>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <Panel eyebrow="Input assumptions" title="What is being modelled">
              <div className="mb-4">
                <p className="text-sm text-ink-0">{risk?.title}</p>
                <p className="mt-1 font-mono text-[10px] text-ink-3">
                  {selected} · L{risk?.likelihood}I{risk?.impact} · score{' '}
                  {report.scoreById.get(selected)}
                </p>
              </div>

              <div className="mb-4 flex items-center gap-2">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${SOURCE_STYLE[baseModel?.frequencySource ?? 'none'].dot}`}
                />
                <span className="text-2xs text-ink-2">
                  {baseModel ? evidenceLabel(baseModel) : 'No model'}
                </span>
              </div>

              <IntervalInput
                label="Frequency"
                unit="events / year"
                lo={model.frequency.lo}
                hi={model.frequency.hi}
                format={rate}
                onChange={(lo, hi) =>
                  setOverrides((current) => ({
                    ...current,
                    [selected]: {
                      f: [lo, hi],
                      m: current[selected]?.m ?? [model.magnitude.lo, model.magnitude.hi],
                    },
                  }))
                }
              />
              <IntervalInput
                label="Loss per occurrence"
                unit={currency}
                lo={model.magnitude.lo}
                hi={model.magnitude.hi}
                format={(v) => money(v, currency)}
                onChange={(lo, hi) =>
                  setOverrides((current) => ({
                    ...current,
                    [selected]: {
                      f: current[selected]?.f ?? [model.frequency.lo, model.frequency.hi],
                      m: [lo, hi],
                    },
                  }))
                }
              />

              <div className="mt-5 border-t border-line-1 pt-4">
                <p className={`${TYPE.eyebrow} mb-2`}>Iterations</p>
                <div className="flex flex-wrap gap-1.5">
                  {ITERATION_CHOICES.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      aria-pressed={iterations === choice}
                      onClick={() => setIterations(choice)}
                      className={iterations === choice ? CONTROL.chipOn : CONTROL.chip}
                    >
                      {choice.toLocaleString()}
                    </button>
                  ))}
                </div>
                <p className="mt-2.5 font-mono text-[10px] text-ink-3">
                  seed {result.seed} · same seed, same numbers, in the browser and in the CLI
                </p>
              </div>

              {overrides[selected] ? (
                <Button
                  className="mt-4"
                  onClick={() =>
                    setOverrides((current) => {
                      const next = { ...current }
                      delete next[selected]
                      return next
                    })
                  }
                >
                  Reset to the register&rsquo;s values
                </Button>
              ) : null}
            </Panel>

            <Panel
              eyebrow="Modelled annualised loss"
              title="Distribution"
              actions={
                appetite && result.probabilityOverAppetite !== undefined ? (
                  <Tooltip
                    title="Probability over appetite"
                    body={`In ${percent(result.probabilityOverAppetite, 1)} of ${count(result.iterations)} simulated years, the total loss from this risk alone exceeded the ${money(appetite.annualLossThreshold, currency)} appetite.`}
                  >
                    <span
                      className={`cursor-help rounded-full border px-2.5 py-1 font-mono text-2xs tnum ${
                        result.probabilityOverAppetite > 0.2
                          ? 'border-distorted/40 bg-distorted/10 text-distorted'
                          : 'border-line-2 text-ink-2'
                      }`}
                    >
                      {percent(result.probabilityOverAppetite, 1)} over appetite
                    </span>
                  </Tooltip>
                ) : undefined
              }
            >
              <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Median year" value={money(result.summary.p50, currency)} />
                <Stat label="Mean" value={money(result.summary.mean, currency)} hint="The mean sits well above the median because the distribution is right-skewed. Budgeting to the mean under-funds most years and under-provisions the bad ones." />
                <Stat label="1-in-10 year" value={money(result.summary.p90, currency)} />
                <Stat label="1-in-100 year" value={money(result.summary.p99, currency)} tone="quant" />
              </div>

              <DistributionChart
                result={result}
                currency={currency}
                appetite={appetite?.annualLossThreshold}
              />
            </Panel>
          </div>

          <Panel eyebrow="Loss exceedance" title="Probability of exceeding a loss">
            <LossExceedanceCurve
              result={result}
              currency={currency}
              appetite={appetite?.annualLossThreshold}
            />
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel eyebrow="Model assumptions" title="What had to be true">
              <ul className="space-y-2.5">
                {model.assumptions.map((assumption) => (
                  <li key={assumption} className="flex items-start gap-2.5">
                    <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-3" />
                    <span className="text-xs leading-relaxed text-ink-1">{assumption}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 rounded-md border border-line-1 bg-surface-inset px-3 py-2.5 text-xs leading-relaxed text-ink-2">
                A lognormal has a lighter tail than the loss distributions seen in practice, so the
                1-in-100 figure above is, if anything, optimistic. These outputs inherit every
                uncertainty in the inputs and add the model&rsquo;s own.
              </p>
            </Panel>

            <Panel eyebrow="Decision impact" title="What this changes">
              <DecisionImpact report={report} riskId={selected} result={result} onOpenRisk={onOpenRisk} />
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: string
  tone?: 'quant'
  hint?: string
}): React.JSX.Element {
  const body = (
    <div>
      <p className={`${TYPE.eyebrow} mb-1.5`}>{label}</p>
      <p
        className={`font-display text-xl font-medium tracking-tight tnum ${
          tone === 'quant' ? 'text-quant' : 'text-ink-0'
        }`}
      >
        {value}
      </p>
    </div>
  )
  return hint ? (
    <Tooltip title={label} body={hint}>
      <span className="block cursor-help">{body}</span>
    </Tooltip>
  ) : (
    body
  )
}

function IntervalInput({
  label,
  unit,
  lo,
  hi,
  format,
  onChange,
}: {
  label: string
  unit: string
  lo: number
  hi: number
  format: (value: number) => string
  onChange: (lo: number, hi: number) => void
}): React.JSX.Element {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className={TYPE.eyebrow}>{label}</span>
        <span className="font-mono text-[10px] text-ink-3">{unit}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={round(lo)}
          min={0}
          step={lo < 1 ? 0.01 : lo < 100 ? 1 : 1000}
          aria-label={`${label} lower bound`}
          onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0), hi)}
          className={`${CONTROL.input} font-mono tnum`}
        />
        <span aria-hidden className="shrink-0 text-ink-3">
          –
        </span>
        <input
          type="number"
          value={round(hi)}
          min={0}
          step={hi < 1 ? 0.01 : hi < 100 ? 1 : 1000}
          aria-label={`${label} upper bound`}
          onChange={(event) => onChange(lo, Math.max(lo, Number(event.target.value) || 0))}
          className={`${CONTROL.input} font-mono tnum`}
        />
      </div>
      <p className="mt-1 font-mono text-[10px] text-ink-3">
        90% interval · {format(lo)} to {format(hi)}
      </p>
    </div>
  )
}

function round(value: number): number {
  if (value >= 1000) return Math.round(value)
  if (value >= 1) return Math.round(value * 100) / 100
  return Number(value.toPrecision(3))
}

function DecisionImpact({
  report,
  riskId,
  result,
  onOpenRisk,
}: {
  report: AuditReport
  riskId: string
  result: SimulationResult
  onOpenRisk: (riskId: string) => void
}): React.JSX.Element {
  const currency = report.register.model.currency
  const appetite = report.register.model.appetite
  const candidate = report.quantification.find((q) => q.riskId === riskId)
  const inversions = report.inversions.filter(
    (i) => i.higherId === riskId || i.lowerId === riskId,
  )

  return (
    <div className="space-y-4">
      {appetite && result.probabilityOverAppetite !== undefined ? (
        <div className={`${SURFACE.well} px-4 py-3`}>
          <p className={`${TYPE.eyebrow} mb-1.5`}>Against the appetite</p>
          <p className="text-xs leading-relaxed text-ink-1">
            {result.probabilityOverAppetite < 0.05
              ? `This risk alone exceeds the ${money(appetite.annualLossThreshold, currency)} appetite in ${percent(result.probabilityOverAppetite, 1)} of simulated years. Under these assumptions it is comfortably inside appetite, which the qualitative score could not establish either way.`
              : result.probabilityOverAppetite > 0.5
                ? `This risk alone exceeds the ${money(appetite.annualLossThreshold, currency)} appetite in ${percent(result.probabilityOverAppetite, 0)} of simulated years — more often than not. Under these assumptions it is outside appetite on its own.`
                : `This risk alone exceeds the ${money(appetite.annualLossThreshold, currency)} appetite in ${percent(result.probabilityOverAppetite, 0)} of simulated years. That is the answer the qualitative score could not give, and it is genuinely ambiguous — which is a useful thing to know before funding a decision either way.`}
          </p>
        </div>
      ) : null}

      {candidate ? (
        <div>
          <p className={`${TYPE.eyebrow} mb-1.5`}>Why it was shortlisted</p>
          <p className="text-xs leading-relaxed text-ink-1">{candidate.explanation.why}</p>
        </div>
      ) : null}

      {inversions.length > 0 ? (
        <div>
          <p className={`${TYPE.eyebrow} mb-2`}>
            Appears in {inversions.length} inversion finding{inversions.length === 1 ? '' : 's'}
          </p>
          <ul className="space-y-1.5">
            {inversions.slice(0, 4).map((inversion) => {
              const otherId = inversion.higherId === riskId ? inversion.lowerId : inversion.higherId
              return (
                <li key={`${inversion.higherId}>${inversion.lowerId}`} className="flex items-center gap-2">
                  <StateBadge
                    state={inversion.status === 'confirmed-under-model' ? 'distorted' : 'ambiguous'}
                    size="xs"
                    label={inversion.status === 'confirmed-under-model' ? 'Confirmed' : 'Candidate'}
                  />
                  <button
                    type="button"
                    onClick={() => onOpenRisk(otherId)}
                    className="truncate-flex text-left text-xs text-ink-1 hover:text-ink-0"
                  >
                    {report.byId.get(otherId)?.title ?? otherId}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      <p className="border-t border-line-1 pt-3 text-2xs leading-relaxed text-ink-3">
        Every figure on this page is conditional on the two intervals in the left-hand panel. Change
        them and the answer changes — which is the point of putting them where they can be changed.
      </p>
    </div>
  )
}
