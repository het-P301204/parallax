/**
 * The qualitative matrix, as an analytical instrument rather than a heatmap.
 *
 * A conventional risk heatmap colours each cell by its score, which tells the
 * reader something they can already compute from the axes. This one colours
 * each cell by *what it cannot resolve* — the compression state the engine
 * assigned it — so the grid answers a question the axes do not: where is this
 * scoring system losing the information the reader is about to act on.
 *
 * Three things are drawn in every occupied cell and none of them is the score:
 *   - how many risks are in it, at a size the eye can compare across the grid;
 *   - a resolution figure, the factor by which two risks inside it can differ;
 *   - a marker when the organisation's own appetite threshold falls inside it,
 *     which is the case where the cell cannot answer the only question being
 *     asked of it.
 *
 * It is a real grid for a screen reader: `role="grid"`, a row per impact
 * level, and arrow-key navigation between cells with the selection following
 * focus. A matrix that can only be used with a mouse is a picture.
 */

import { useCallback, useRef } from 'react'
import type { CompressionFinding, Matrix, ScoringModel } from '../engine/index.ts'
import { labelOf } from '../engine/index.ts'
import { STATE_STYLE } from './tokens.ts'
import { span } from './format.ts'
import { Tooltip } from './Tooltip.tsx'

export interface RiskMatrixProps {
  readonly matrix: Matrix
  readonly model: ScoringModel
  readonly compression: readonly CompressionFinding[]
  readonly selected?: string
  readonly onSelect: (cellKey: string) => void
  /** Ids to highlight, e.g. the current filter result. Empty means all. */
  readonly highlight?: ReadonlySet<string>
  readonly compact?: boolean
}

export function RiskMatrix({
  matrix,
  model,
  compression,
  selected,
  onSelect,
  highlight,
  compact = false,
}: RiskMatrixProps): React.JSX.Element {
  const findings = new Map(compression.map((c) => [c.cellKey, c]))
  const cells = new Map(matrix.cells.map((c) => [c.key, c]))
  const grid = useRef<HTMLDivElement>(null)

  const maxCount = Math.max(1, ...matrix.cells.map((c) => c.riskIds.length))
  // Impact ascends up the page, which is the orientation every risk
  // practitioner already reads, so the rows are reversed rather than the data.
  const rows = [...matrix.impactLevels].reverse()

  const move = useCallback(
    (likelihood: number, impact: number, dx: number, dy: number): void => {
      const li = matrix.likelihoodLevels.indexOf(likelihood)
      const ii = matrix.impactLevels.indexOf(impact)
      const nextL = matrix.likelihoodLevels[Math.min(matrix.likelihoodLevels.length - 1, Math.max(0, li + dx))]
      const nextI = matrix.impactLevels[Math.min(matrix.impactLevels.length - 1, Math.max(0, ii + dy))]
      if (nextL === undefined || nextI === undefined) return
      const key = `L${nextL}I${nextI}`
      onSelect(key)
      const node = grid.current?.querySelector<HTMLButtonElement>(`[data-cell="${key}"]`)
      node?.focus()
    },
    [matrix.likelihoodLevels, matrix.impactLevels, onSelect],
  )

  return (
    <div className="w-full">
      <div className="flex">
        {/* Impact axis label, rotated, on the outside of the row headers. */}
        <div className="flex w-6 shrink-0 items-center justify-center">
          <span className="whitespace-nowrap font-mono text-2xs uppercase tracking-[0.16em] text-ink-3 [writing-mode:vertical-rl] [transform:rotate(180deg)]">
            {model.impact.name} →
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div ref={grid} role="grid" aria-label="Qualitative risk matrix" className="w-full">
            {rows.map((impact) => (
              <div role="row" key={impact} className="flex items-stretch gap-1 pb-1">
                <div
                  role="rowheader"
                  className="flex w-[4.5rem] shrink-0 flex-col justify-center pr-2 text-right sm:w-24"
                >
                  <span className="truncate-flex text-2xs font-medium text-ink-2">
                    {labelOf(model.impact, impact)}
                  </span>
                  <span className="font-mono text-[10px] text-ink-3 tnum">{impact}</span>
                </div>

                {matrix.likelihoodLevels.map((likelihood) => {
                  const key = `L${likelihood}I${impact}`
                  const cell = cells.get(key)
                  const finding = findings.get(key)
                  if (!cell) return null
                  const count = cell.riskIds.length
                  const visible = highlight
                    ? cell.riskIds.filter((id) => highlight.has(id)).length
                    : count
                  return (
                    <MatrixCell
                      key={key}
                      cellKey={key}
                      count={count}
                      visible={visible}
                      maxCount={maxCount}
                      score={cell.score}
                      band={cell.band}
                      resolution={finding?.anchorSpan}
                      straddles={finding?.straddlesAppetite ?? false}
                      state={finding?.state}
                      selected={selected === key}
                      compact={compact}
                      label={`${labelOf(model.likelihood, likelihood)} by ${labelOf(model.impact, impact)}`}
                      onSelect={() => onSelect(key)}
                      onMove={(dx, dy) => move(likelihood, impact, dx, dy)}
                    />
                  )
                })}
              </div>
            ))}

            <div role="row" className="flex gap-1 pt-1">
              <div className="w-[4.5rem] shrink-0 sm:w-24" />
              {matrix.likelihoodLevels.map((likelihood) => (
                <div role="columnheader" key={likelihood} className="min-w-0 flex-1 text-center">
                  <span className="block truncate-flex text-2xs font-medium text-ink-2">
                    {labelOf(model.likelihood, likelihood)}
                  </span>
                  <span className="font-mono text-[10px] text-ink-3 tnum">{likelihood}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-2 pl-[4.5rem] text-center font-mono text-2xs uppercase tracking-[0.16em] text-ink-3 sm:pl-24">
            {model.likelihood.name} →
          </p>
        </div>
      </div>
    </div>
  )
}

interface MatrixCellProps {
  readonly cellKey: string
  readonly count: number
  readonly visible: number
  readonly maxCount: number
  readonly score: number
  readonly band?: string
  readonly resolution?: number
  readonly straddles: boolean
  readonly state?: CompressionFinding['state']
  readonly selected: boolean
  readonly compact: boolean
  readonly label: string
  readonly onSelect: () => void
  readonly onMove: (dx: number, dy: number) => void
}

function MatrixCell({
  cellKey,
  count,
  visible,
  maxCount,
  score,
  band,
  resolution,
  straddles,
  state,
  selected,
  compact,
  label,
  onSelect,
  onMove,
}: MatrixCellProps): React.JSX.Element {
  const style = state ? STATE_STYLE[state] : undefined
  const density = count === 0 ? 0 : 0.1 + 0.55 * (count / maxCount)
  const dimmed = visible === 0 && count > 0

  const tooltip = (
    <>
      <strong className="text-ink-0">{label}</strong>
      <br />
      {count === 0 ? (
        'No risks scored here.'
      ) : (
        <>
          {count} risk{count === 1 ? '' : 's'}, scored {score}
          {band ? ` (${band})` : ''}.
          {resolution !== undefined ? (
            <>
              <br />
              Cannot resolve annualised loss finer than {span(resolution)}.
            </>
          ) : null}
          {straddles ? (
            <>
              <br />
              The appetite threshold falls inside this cell.
            </>
          ) : null}
          {state ? (
            <>
              <br />
              <span className={style?.text}>{STATE_STYLE[state].label}:</span>{' '}
              {STATE_STYLE[state].meaning}
            </>
          ) : null}
        </>
      )}
    </>
  )

  return (
    <Tooltip body={tooltip} width={276} className="min-w-0 flex-1">
      <button
        type="button"
        data-cell={cellKey}
        role="gridcell"
        aria-selected={selected}
        aria-label={`${label}, ${count} risks, score ${score}`}
        onClick={onSelect}
        onKeyDown={(event) => {
          const moves: Record<string, [number, number]> = {
            ArrowRight: [1, 0],
            ArrowLeft: [-1, 0],
            ArrowUp: [0, 1],
            ArrowDown: [0, -1],
          }
          const delta = moves[event.key]
          if (delta) {
            event.preventDefault()
            onMove(delta[0], delta[1])
          }
        }}
        className={`group relative flex w-full flex-col items-center justify-center rounded-md border transition-all duration-220 ease-out ${
          compact ? 'h-14' : 'h-[4.5rem] sm:h-20'
        } ${
          selected
            ? 'border-accent/70 shadow-plate -translate-y-0.5 z-10'
            : count === 0
              ? 'border-line-1 hover:border-line-2'
              : `${style?.border ?? 'border-line-2'} hover:-translate-y-px hover:shadow-lift`
        } ${dimmed ? 'opacity-30' : ''}`}
        style={
          count === 0
            ? undefined
            : { backgroundColor: `color-mix(in srgb, ${style?.rgb ?? 'rgb(var(--accent))'} ${Math.round(density * 100)}%, transparent)` }
        }
      >
        {count === 0 ? (
          <span aria-hidden className="font-mono text-[10px] text-ink-3/60 tnum">
            {score}
          </span>
        ) : (
          <>
            <span className="font-display text-lg font-medium tabular-nums text-ink-0">
              {highlightCount(visible, count)}
            </span>
            <span className="font-mono text-[10px] text-ink-2 tnum">
              {resolution === undefined ? `score ${score}` : span(resolution)}
            </span>
            {/* The cell's state is carried by a mark as well as by its fill.
                Five hues that all clear AA against both themes cannot also be
                separated by luminance -- see the note in tokens.ts -- so the
                glyph is what a reader who cannot separate them relies on. */}
            {style ? (
              <span
                aria-hidden
                className={`absolute left-1 top-0.5 font-mono text-[10px] leading-none ${style.text} opacity-80`}
              >
                {style.glyph}
              </span>
            ) : null}
            {straddles ? (
              <span
                aria-hidden
                title="The appetite threshold falls inside this cell"
                className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-quantify"
              />
            ) : null}
            {state === 'insufficient-data' ? (
              <span aria-hidden className="hatch absolute inset-0 rounded-md text-insufficient opacity-30" />
            ) : null}
          </>
        )}
      </button>
    </Tooltip>
  )
}

function highlightCount(visible: number, total: number): string {
  return visible === total ? String(total) : `${visible}/${total}`
}
