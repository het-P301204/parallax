/**
 * The ordinal validity audit, on screen.
 *
 * Each operation the register performs gets three columns and they are always
 * in this order: what the register does, what the scale actually represents,
 * and why the gap between them matters. Never a bare "INVALID" — the verdict
 * is the least useful part of the finding, and the reader has to be able to
 * disagree with it.
 *
 * The witness relabelling is the centrepiece. It turns "your ranking is not
 * ordinally determined" from an assertion into a demonstration: here is a
 * renaming of the levels that ranks them identically, and here is your score
 * formula reversing the two risks under it. Nobody has to take that on trust.
 */

import { useMemo, useState } from 'react'
import type { AuditReport, IndeterminatePair } from '../engine/index.ts'
import { aggregationFormula, labelOf, levelValues } from '../engine/index.ts'
import { SURFACE, TYPE, STATE_STYLE } from '../ui/tokens.ts'
import { ExplanationBlock, Panel, SectionHeading, StateBadge, StateRule } from '../ui/primitives.tsx'
import { cellPretty, count, percent } from '../ui/format.ts'
import type { Mode } from '../state.ts'

export function Measurement({
  report,
  mode,
  onOpenRisk,
}: {
  report: AuditReport
  mode: Mode
  onOpenRisk: (riskId: string) => void
}): React.JSX.Element {
  const { ordinal, register } = report
  const [openOperation, setOpenOperation] = useState<string | undefined>(
    ordinal.operations[0]?.id,
  )
  const share =
    ordinal.comparedPairs === 0 ? 0 : ordinal.indeterminateCount / ordinal.comparedPairs

  return (
    <div className="space-y-6">
      <SectionHeading
        step="Measurement audit"
        title="What kind of scale is this, and what is it entitled to do?"
        lead={`Both axes are declared ${ordinal.scaleKinds.likelihood}, and ${aggregationFormula(ordinal.aggregation)} is applied to them. Each operation below is checked against what that declaration permits.`}
      />

      {/* ---- The scale itself -------------------------------------------- */}
      <div className="grid gap-6 lg:grid-cols-2">
        {[register.model.likelihood, register.model.impact].map((scale) => (
          <Panel key={scale.axis} eyebrow={`${scale.kind} scale`} title={scale.name}>
            <p className="mb-4 text-xs leading-relaxed text-ink-2">{scale.definition}</p>
            <ul className="space-y-1.5">
              {[...scale.levels]
                .sort((a, b) => b.value - a.value)
                .map((level) => (
                  <li key={level.value} className="flex items-baseline gap-3">
                    <span className="w-5 shrink-0 font-mono text-xs text-ink-3 tnum">
                      {level.value}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-xs text-ink-0">{level.label}</span>
                      {level.description ? (
                        <span className="ml-2 text-2xs text-ink-3">{level.description}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-quant tnum">
                      {level.anchor
                        ? `${trim(level.anchor.lo)}–${trim(level.anchor.hi)}`
                        : 'no anchor'}
                    </span>
                  </li>
                ))}
            </ul>
            <p className="mt-4 border-t border-line-1 pt-3 text-2xs leading-relaxed text-ink-3">
              {scale.kind === 'ordinal'
                ? `Declared ordinal: the numbers 1 to ${scale.levels.length} name the rungs. Any strictly increasing renaming — 1, 2, 3, 4, 100 — is exactly as faithful to this table.`
                : scale.kind === 'interval'
                  ? 'Declared interval: a one-level step is claimed to mean the same amount everywhere on the scale.'
                  : 'Declared ratio: the levels are claimed to be quantities with a true zero.'}
            </p>
          </Panel>
        ))}
      </div>

      {/* ---- Operations --------------------------------------------------- */}
      <Panel
        eyebrow="Operations the register performs"
        title={`${ordinal.operations.length} operations checked`}
        dense
      >
        <ul className="divide-y divide-line-1">
          {ordinal.operations.map((operation) => {
            const open = openOperation === operation.id
            return (
              <li key={operation.id} className="relative">
                <StateRule state={operation.state} />
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenOperation(open ? undefined : operation.id)}
                  className="flex w-full items-start gap-4 px-5 py-4 text-left transition-colors duration-140 hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2.5">
                      <span className="text-sm font-medium text-ink-0">{operation.title}</span>
                      <StateBadge state={operation.state} size="xs" />
                    </span>
                    <span className="mt-1.5 block text-xs leading-relaxed text-ink-2">
                      {operation.explanation.what}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-xs text-ink-1 tnum">
                      {count(operation.affected)}
                    </span>
                    <span className="block font-mono text-[10px] text-ink-3">affected</span>
                  </span>
                </button>

                {open ? (
                  <div className="animate-stage-in px-5 pb-5">
                    <div className="mb-4 grid gap-3 md:grid-cols-3">
                      <Column label="What the register does" body={operation.registerDoes} />
                      <Column label="What the scale represents" body={operation.scaleMeans} />
                      <Column
                        label="What the operation requires"
                        body={`A ${operation.requires} scale. ${
                          operation.state === 'valid'
                            ? 'The declaration satisfies that.'
                            : `The declaration is ${ordinal.scaleKinds.likelihood}, which does not.`
                        }`}
                        tone={operation.state}
                      />
                    </div>
                    <ExplanationBlock explanation={operation.explanation} compact />
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      </Panel>

      {/* ---- Indeterminate pairs ------------------------------------------ */}
      <Panel
        eyebrow="Rankings that are not determined by the scales"
        title={`${count(ordinal.indeterminateCount)} of ${count(ordinal.comparedPairs)} ordered pairs`}
        actions={
          <span className={`font-mono text-xs tnum ${STATE_STYLE['ambiguous'].text}`}>
            {percent(share, 1)}
          </span>
        }
      >
        <p className="mb-5 max-w-3xl text-xs leading-relaxed text-ink-2">
          These pairs <em>cross</em>: one risk is higher on likelihood, the other on impact. Under
          ordinal scales no ordering of ranked labels decides between them, so whichever the score
          puts first is a consequence of the numbers chosen to name the levels. Each row below
          carries a witness — a renaming that preserves the order of every level and reverses the
          pair.
        </p>

        {ordinal.indeterminatePairs.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-2">
            Every ranking in this register is determined by dominance. Nothing to show — which is
            the result you want.
          </p>
        ) : (
          <WitnessList report={report} mode={mode} onOpenRisk={onOpenRisk} />
        )}
      </Panel>

      {/* ---- Score collisions --------------------------------------------- */}
      {ordinal.collidingCells.length > 0 ? (
        <Panel
          eyebrow="Distinct cells sharing a score"
          title={`${ordinal.collidingCells.length} score${ordinal.collidingCells.length === 1 ? '' : 's'} used by more than one cell`}
        >
          <p className="mb-4 max-w-3xl text-xs leading-relaxed text-ink-2">
            Under {aggregationFormula(ordinal.aggregation)}, different judgements produce the same
            number. A register that sorts by score treats every group below as a single position in
            its ranking.
          </p>
          <ul className="flex flex-wrap gap-2">
            {ordinal.collidingCells.map((group) => (
              <li
                key={group.join('-')}
                className={`${SURFACE.well} px-3 py-2 font-mono text-2xs text-ink-1`}
              >
                {group.map((key) => cellPretty(key)).join('  =  ')}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  )
}

function Column({
  label,
  body,
  tone,
}: {
  label: string
  body: string
  tone?: keyof typeof STATE_STYLE
}): React.JSX.Element {
  return (
    <div className={`${SURFACE.well} px-3 py-2.5`}>
      <p className={`${TYPE.eyebrow} mb-1.5`}>{label}</p>
      <p className={`text-xs leading-relaxed ${tone ? STATE_STYLE[tone].text : 'text-ink-1'}`}>
        {body}
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function WitnessList({
  report,
  mode,
  onOpenRisk,
}: {
  report: AuditReport
  mode: Mode
  onOpenRisk: (riskId: string) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<string | undefined>()
  const limit = mode === 'executive' ? 4 : 14

  // The materialised pairs repeat each cell pair once per risk pair. The list
  // shows one row per *cell* pair, which is the unit the finding is really
  // about, with the risk count beside it.
  const grouped = useMemo(() => {
    const map = new Map<string, { pair: IndeterminatePair; risks: number }>()
    for (const pair of report.ordinal.indeterminatePairs) {
      const key = `${pair.aCell}>${pair.bCell}`
      const existing = map.get(key)
      if (existing) existing.risks += 1
      else map.set(key, { pair, risks: 1 })
    }
    return [...map.values()]
  }, [report.ordinal.indeterminatePairs])

  return (
    <>
      <ul className="space-y-2">
        {grouped.slice(0, limit).map(({ pair, risks }) => {
          const key = `${pair.aCell}>${pair.bCell}`
          const open = expanded === key
          const a = report.byId.get(pair.aId)
          const b = report.byId.get(pair.bId)
          if (!a || !b) return null
          return (
            <li key={key} className={`${SURFACE.tile} overflow-hidden`}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setExpanded(open ? undefined : key)}
                className="flex w-full items-center gap-4 px-4 py-3 text-left"
              >
                <span className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                  <span className="min-w-0">
                    <span className="truncate-flex block text-xs text-ink-0">{a.title}</span>
                    <span className="font-mono text-[10px] text-ink-3">
                      {labelOf(report.register.model.likelihood, a.likelihood)} ×{' '}
                      {labelOf(report.register.model.impact, a.impact)} · score {pair.aScore}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-ambiguous">
                    ranked above
                  </span>
                  <span className="min-w-0">
                    <span className="truncate-flex block text-xs text-ink-0">{b.title}</span>
                    <span className="font-mono text-[10px] text-ink-3">
                      {labelOf(report.register.model.likelihood, b.likelihood)} ×{' '}
                      {labelOf(report.register.model.impact, b.impact)} · score {pair.bScore}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right font-mono text-[10px] text-ink-3">
                  {risks} pair{risks === 1 ? '' : 's'}
                </span>
              </button>

              {open ? (
                <div className="animate-stage-in border-t border-line-1 px-4 py-4">
                  <Witness report={report} pair={pair} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenRisk(pair.aId)}
                      className="rounded border border-line-2 px-2 py-1 font-mono text-[10px] text-ink-2 hover:border-accent/50 hover:text-accent-strong"
                    >
                      {pair.aId} →
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenRisk(pair.bId)}
                      className="rounded border border-line-2 px-2 py-1 font-mono text-[10px] text-ink-2 hover:border-accent/50 hover:text-accent-strong"
                    >
                      {pair.bId} →
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      {grouped.length > limit ? (
        <p className="mt-3 text-2xs text-ink-3">
          {grouped.length - limit} further cell pairs cross in the same way.
          {report.ordinal.truncated
            ? ' The example list is capped; the count above is exact and is computed from cell occupancies rather than from this list.'
            : ''}
        </p>
      ) : null}
    </>
  )
}

/**
 * The witness relabelling, drawn as two rows of levels with the changed rungs
 * highlighted, and the two scores recomputed underneath.
 */
function Witness({
  report,
  pair,
}: {
  report: AuditReport
  pair: IndeterminatePair
}): React.JSX.Element {
  const { model } = report.register
  const originalL = levelValues(model.likelihood)
  const originalI = levelValues(model.impact)

  return (
    <div className={`${SURFACE.well} px-4 py-3.5`}>
      <p className={`${TYPE.eyebrow} mb-3`}>A relabelling that reverses the pair</p>

      <div className="space-y-2.5">
        <LevelRow
          name={model.likelihood.name}
          original={originalL}
          witness={pair.witness.likelihood}
        />
        <LevelRow name={model.impact.name} original={originalI} witness={pair.witness.impact} />
      </div>

      <div className="mt-4 grid gap-3 border-t border-line-1 pt-3 sm:grid-cols-2">
        <div>
          <p className={`${TYPE.eyebrow} mb-1`}>As written</p>
          <p className="font-mono text-xs text-ink-1 tnum">
            {pair.aId} = {pair.aScore} &nbsp;&gt;&nbsp; {pair.bId} = {pair.bScore}
          </p>
        </div>
        <div>
          <p className={`${TYPE.eyebrow} mb-1`}>Under the relabelling</p>
          <p className="font-mono text-xs text-ambiguous tnum">
            {pair.aId} = {pair.witness.aScore} &nbsp;&lt;&nbsp; {pair.bId} = {pair.witness.bScore}
          </p>
        </div>
      </div>

      <p className="mt-3 text-2xs leading-relaxed text-ink-3">
        Every level keeps its position in the order, so the relabelling says exactly what the
        original numbers said about which rung is higher than which. The ranking between these two
        risks nonetheless reverses — which means it was never a consequence of the assessments.
      </p>
    </div>
  )
}

function LevelRow({
  name,
  original,
  witness,
}: {
  name: string
  original: readonly number[]
  witness: readonly number[]
}): React.JSX.Element {
  const changed = original.some((value, index) => value !== witness[index])
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 shrink-0 text-2xs text-ink-3">{name}</span>
      <span className="font-mono text-xs text-ink-2 tnum">{original.join(', ')}</span>
      <span aria-hidden className="text-ink-3">
        →
      </span>
      <span className="font-mono text-xs tnum">
        {witness.map((value, index) => (
          <span
            key={index}
            className={value === original[index] ? 'text-ink-2' : 'text-ambiguous font-medium'}
          >
            {value}
            {index < witness.length - 1 ? ', ' : ''}
          </span>
        ))}
      </span>
      {!changed ? <span className="text-2xs text-ink-3">(unchanged)</span> : null}
    </div>
  )
}

function trim(value: number): string {
  if (value >= 1000) return `${Math.round(value / 1000)}k`
  if (value >= 1) return String(Math.round(value * 100) / 100)
  return String(Number(value.toPrecision(2)))
}
