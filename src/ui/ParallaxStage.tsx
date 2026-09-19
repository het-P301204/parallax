/**
 * The parallax separation — the product's signature interaction.
 *
 * The idea in one line: a qualitative cell is a flat label, and the risks
 * inside it are at different depths behind it. Select a cell and the label
 * lifts away from the continuous loss axis; the intervals it was covering fan
 * out behind it, each at its own depth, and move against the label as the
 * pointer moves. Parallax is exactly the right metaphor because it is exactly
 * the right mechanism: the separation between two things is only visible when
 * you move relative to them, and a matrix never moves.
 *
 * Three rules keep it from being a gimmick.
 *
 * 1. *Depth is data.* A plane's depth is its rank inside the cell by modelled
 *    annualised loss. The largest exposure is nearest the reader. Shuffling
 *    the risks changes the picture, because the picture is about them.
 *
 * 2. *The axis is real.* Horizontal position is annualised loss on a base-ten
 *    log axis with labelled decade ticks, shared by every element on the
 *    stage, including the cell's own anchored band and the appetite line. A
 *    bar twice as far right is not twice as bad — it is ten times, and the
 *    axis says so.
 *
 * 3. *Inherited intervals look inherited.* A risk with no estimate of its own
 *    is drawn in the muted "from cell anchor" treatment at exactly the cell's
 *    own width, because that is genuinely all the register knows about it.
 *    Two such risks are drawn identically, on purpose. The moment of the whole
 *    interaction is seeing three identical grey bars and two wildly different
 *    cyan ones inside one label.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import type {
  Appetite,
  CompressionFinding,
  QuantitativeModel,
  Risk,
  RiskCell,
  ScoringModel,
} from '../engine/index.ts'
import { annualLossBounds, centralAnnualLoss, labelOf } from '../engine/index.ts'
import { decadeTicks, logPosition, money, span } from './format.ts'
import { STATE_STYLE, TYPE } from './tokens.ts'
import { Tooltip } from './Tooltip.tsx'

export interface ParallaxStageProps {
  readonly cell?: RiskCell
  readonly finding?: CompressionFinding
  readonly model: ScoringModel
  readonly risks: ReadonlyMap<string, Risk>
  readonly models: ReadonlyMap<string, QuantitativeModel>
  readonly appetite?: Appetite
  readonly focusedRiskId?: string
  readonly onFocusRisk: (riskId: string) => void
  readonly onOpenRisk: (riskId: string) => void
}

/**
 * One grid, used by the plate, every interval row and the axis. Changing it
 * here moves all three together, which is the only way they stay aligned.
 *
 * On a phone the numeric column is dropped and the label column narrows. The
 * interval and its axis survive, which is the right order of sacrifice: the
 * figures are also in the risk workspace, but the drawn comparison is the only
 * place this panel exists to make.
 */
const TRACK_GRID =
  'grid grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)] items-center gap-2 px-1.5 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_minmax(0,6.5rem)]'

interface Plane {
  readonly riskId: string
  readonly title: string
  readonly lo: number
  readonly hi: number
  readonly centre: number
  readonly estimated: boolean
  readonly depth: number
}

export function ParallaxStage({
  cell,
  finding,
  model,
  risks,
  models,
  appetite,
  focusedRiskId,
  onFocusRisk,
  onOpenRisk,
}: ParallaxStageProps): React.JSX.Element {
  const stage = useRef<HTMLDivElement>(null)
  const [shift, setShift] = useState(0)
  const [separated, setSeparated] = useState(false)

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const box = stage.current?.getBoundingClientRect()
    if (!box) return
    // −1 at the left edge, +1 at the right. The planes translate by this times
    // their depth, so the nearest plane travels furthest — which is what makes
    // the stack read as a stack rather than as a list.
    const t = ((event.clientX - box.left) / box.width) * 2 - 1
    setShift(Math.max(-1, Math.min(1, t)))
  }, [])

  const planes = useMemo<Plane[]>(() => {
    if (!cell) return []
    const rows = cell.riskIds
      .map((id) => {
        const quantModel = models.get(id)
        const risk = risks.get(id)
        if (!quantModel || !risk) return null
        const bounds = annualLossBounds(quantModel)
        return {
          riskId: id,
          title: risk.title,
          lo: bounds.lo,
          hi: bounds.hi,
          centre: centralAnnualLoss(quantModel),
          estimated:
            quantModel.frequencySource === 'register-estimate' ||
            quantModel.magnitudeSource === 'register-estimate',
        }
      })
      .filter((row): row is Omit<Plane, 'depth'> => row !== null)
      .sort((a, b) => b.centre - a.centre)
    return rows.map((row, index) => ({ ...row, depth: rows.length - index }))
  }, [cell, models, risks])

  const axis = useMemo(() => {
    const values: number[] = []
    for (const plane of planes) values.push(plane.lo, plane.hi)
    if (cell?.anchoredAnnualLoss) values.push(cell.anchoredAnnualLoss.lo, cell.anchoredAnnualLoss.hi)
    if (appetite) values.push(appetite.annualLossThreshold)
    const positive = values.filter((v) => v > 0)
    if (positive.length === 0) return undefined
    // A little headroom either side so nothing is drawn flush against an edge.
    const lo = Math.min(...positive) / 2.2
    const hi = Math.max(...positive) * 2.2
    return { lo, hi, ticks: decadeTicks(lo, hi, 4) }
  }, [planes, cell, appetite])

  if (!cell) {
    return (
      <StageFrame>
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
          <SplitGlyph />
          <p className="mt-5 max-w-xs text-xs leading-relaxed text-ink-2">
            Select a cell in the matrix. Its label will lift away from the loss axis and the
            intervals it covers will separate behind it.
          </p>
        </div>
      </StageFrame>
    )
  }

  if (!axis || planes.length === 0) {
    return (
      <StageFrame header={<StageHeader cell={cell} model={model} finding={finding} />}>
        <div className="flex h-full items-center justify-center px-8 text-center">
          <p className="max-w-sm text-xs leading-relaxed text-ink-2">
            Nothing quantitative can be drawn for this cell. Neither axis of the configured scale
            carries an anchor range, and none of the {cell.riskIds.length} risks here supplied an
            estimate of its own — so the register contains no basis for placing them on a loss axis.
            <span className="mt-2 block text-ink-3">
              This is the honest empty state, not a failure: adding frequency and loss anchors to the
              scale levels is what fills it.
            </span>
          </p>
        </div>
      </StageFrame>
    )
  }

  const anchored = cell.anchoredAnnualLoss
  const maxDepth = Math.max(...planes.map((p) => p.depth))

  return (
    <StageFrame
      header={<StageHeader cell={cell} model={model} finding={finding} />}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setShift(0)}
      stageRef={stage}
    >
      <div
        // Top padding leaves room for the appetite label, which sits above
        // the plate at the head of its own line.
        className="relative px-4 pb-3 pt-9 sm:px-6"
        style={{ ['--px-shift' as string]: String(shift * 100) }}
      >
        {/* ---- The qualitative label: one flat plate, at the cell's width ---
            Drawn in the same three-column grid as the rows and the axis, so
            the plate, the intervals and the ticks all share one coordinate
            space. That shared space is the whole illusion: without it the
            separation would be two pictures rather than one movement. */}
        {anchored ? (
          <div className={`${TRACK_GRID} mb-3`}>
            <span className="self-center font-mono text-[10px] uppercase leading-tight tracking-[0.12em] text-ink-3">
              What the score says
            </span>
            <div className="relative h-10">
              <div
                className="absolute inset-y-0 rounded-md border border-accent/45 bg-accent/12 shadow-plate transition-[left,right] duration-560 ease-out"
                style={{
                  left: `${logPosition(anchored.lo, axis.lo, axis.hi) * 100}%`,
                  right: `${(1 - logPosition(anchored.hi, axis.lo, axis.hi)) * 100}%`,
                }}
              >
                <div className="flex h-full items-center justify-between gap-2 px-2">
                  <span className="truncate-flex font-mono text-[10px] uppercase tracking-[0.08em] text-accent-strong">
                    {labelOf(model.likelihood, cell.likelihood)} ×{' '}
                    {labelOf(model.impact, cell.impact)}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-accent-strong/80 tnum">
                    {span(finding?.anchorSpan)}
                  </span>
                </div>
              </div>
            </div>
            <span className="hidden sm:block" />
          </div>
        ) : null}

        {/* ---- The depth planes: what the label was covering ---------------- */}
        <p className="mb-2 px-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          What is underneath — {planes.length} risk{planes.length === 1 ? '' : 's'},{' '}
          {planes.filter((p) => p.estimated).length} with their own estimate
        </p>

        <ul className="space-y-1">
          {planes.map((plane, index) => {
            const focused = focusedRiskId === plane.riskId
            return (
              <li
                key={plane.riskId}
                className="px-plane"
                style={{
                  ['--depth' as string]: String(plane.depth - (maxDepth + 1) / 2),
                  animation: separated
                    ? undefined
                    : `parallax-split 720ms cubic-bezier(0.16,1,0.3,1) ${index * 55}ms both`,
                }}
                onAnimationEnd={() => setSeparated(true)}
              >
                <IntervalRow
                  plane={plane}
                  axis={axis}
                  currency={model.currency}
                  focused={focused}
                  onFocus={() => onFocusRisk(plane.riskId)}
                  onOpen={() => onOpenRisk(plane.riskId)}
                />
              </li>
            )
          })}
        </ul>

        {/* ---- The shared axis --------------------------------------------- */}
        <div className={`${TRACK_GRID} mt-2`}>
          <span className="hidden sm:block" />
          <Axis
            axis={axis}
            appetite={appetite}
            currency={model.currency}
            overhang={planes.length * 28 + (anchored ? 84 : 32)}
          />
          <span className="hidden sm:block" />
        </div>
      </div>
    </StageFrame>
  )
}

/* -------------------------------------------------------------------------- */

function StageFrame({
  children,
  header,
  onPointerMove,
  onPointerLeave,
  stageRef,
}: {
  children: React.ReactNode
  header?: React.ReactNode
  onPointerMove?: (event: React.PointerEvent<HTMLDivElement>) => void
  onPointerLeave?: () => void
  stageRef?: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  return (
    <div
      ref={stageRef}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className="grid-field relative flex h-full min-h-[22rem] flex-col overflow-hidden rounded-lg border border-line-1 bg-surface-1"
    >
      {header}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

function StageHeader({
  cell,
  model,
  finding,
}: {
  cell: RiskCell
  model: ScoringModel
  finding?: CompressionFinding
}): React.JSX.Element {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-line-1 px-5 py-3.5">
      <div className="min-w-0">
        <p className={`${TYPE.eyebrow} mb-1`}>Selected cell</p>
        <h3 className="truncate-flex font-display text-base font-medium tracking-tight text-ink-0">
          {labelOf(model.likelihood, cell.likelihood)} × {labelOf(model.impact, cell.impact)}
          <span className="ml-2 font-mono text-xs text-ink-3">
            {cell.key} · score {cell.score}
          </span>
        </h3>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 sm:inline">
          annualised loss · log
        </span>
      {finding ? (
        <Tooltip title={STATE_STYLE[finding.state].label} body={finding.explanation.what}>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-2xs uppercase tracking-[0.08em] ${STATE_STYLE[finding.state].border} ${STATE_STYLE[finding.state].wash} ${STATE_STYLE[finding.state].text}`}
          >
            {STATE_STYLE[finding.state].label}
          </span>
        </Tooltip>
      ) : null}
      </div>
    </header>
  )
}

interface AxisRange {
  readonly lo: number
  readonly hi: number
  readonly ticks: readonly number[]
}

function IntervalRow({
  plane,
  axis,
  currency,
  focused,
  onFocus,
  onOpen,
}: {
  plane: Plane
  axis: AxisRange
  currency: string
  focused: boolean
  onFocus: () => void
  onOpen: () => void
}): React.JSX.Element {
  const left = logPosition(plane.lo, axis.lo, axis.hi) * 100
  const right = (1 - logPosition(plane.hi, axis.lo, axis.hi)) * 100
  const centre = logPosition(plane.centre, axis.lo, axis.hi) * 100

  return (
    <button
      type="button"
      onMouseEnter={onFocus}
      onFocus={onFocus}
      onClick={onOpen}
      aria-label={`${plane.title}: modelled ${money(plane.lo, currency)} to ${money(plane.hi, currency)} a year`}
      // Three columns rather than one layer: the title never sits on top of the
      // bar, so a long risk name cannot obscure the very interval the panel
      // exists to show.
      className={`group ${TRACK_GRID} w-full rounded py-1 text-left transition-colors duration-140 ${
        focused ? 'bg-surface-2' : 'hover:bg-surface-2/60'
      }`}
    >
      <span
        className={`truncate-flex text-[11px] ${focused ? 'text-ink-0' : 'text-ink-2'}`}
        title={plane.title}
      >
        {plane.title}
      </span>

      <span className="relative block h-5">
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-1" />
        <span
          className={`absolute inset-y-[0.3rem] animate-span-in origin-center rounded-full ${
            plane.estimated ? 'bg-quant' : 'bg-insufficient hatch'
          } ${focused ? 'opacity-100' : 'opacity-75'}`}
          style={{
            left: `${left}%`,
            right: `${right}%`,
            boxShadow: focused ? '0 0 0 1px rgb(var(--quant) / 0.5)' : undefined,
          }}
        />
        <span
          aria-hidden
          className="absolute inset-y-0.5 w-px bg-ink-0/70"
          style={{ left: `${centre}%` }}
        />
      </span>

      <span className="hidden text-right font-mono text-[10px] text-ink-3 tnum sm:block">
        {money(plane.lo, currency)}–{money(plane.hi, currency)}
      </span>
    </button>
  )
}

/**
 * The shared axis, and the appetite line that rises out of it.
 *
 * `overhang` is how far above the axis the appetite line reaches, in pixels,
 * computed by the caller from the number of rows it has to cross. A line that
 * stopped at the axis would be a tick; one that crosses every interval is the
 * thing that makes "this cell straddles the threshold" visible at a glance.
 */
function Axis({
  axis,
  appetite,
  currency,
  overhang,
}: {
  axis: AxisRange
  appetite?: Appetite
  currency: string
  overhang: number
}): React.JSX.Element {
  const appetiteLeft = appetite
    ? logPosition(appetite.annualLossThreshold, axis.lo, axis.hi) * 100
    : 0
  const inside = appetite
    ? appetite.annualLossThreshold > axis.lo && appetite.annualLossThreshold < axis.hi
    : false

  return (
    <div className="relative h-11 border-t border-line-2">
      {axis.ticks.map((tick) => (
        <span
          key={tick}
          className="absolute top-0 flex animate-tick-in flex-col items-center"
          style={{
            left: `${logPosition(tick, axis.lo, axis.hi) * 100}%`,
            transform: 'translateX(-50%)',
          }}
        >
          <span aria-hidden className="h-1.5 w-px bg-line-3" />
          <span className="mt-1 font-mono text-[10px] text-ink-3 tnum">{money(tick, currency)}</span>
        </span>
      ))}

      {/* The appetite line rises out of the axis and crosses every interval,
          and its label sits at the top of the line rather than the bottom:
          down there it collided with the decade ticks, which are the one
          thing on this panel that must stay readable. */}
      {appetite && inside ? (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute w-px bg-quantify/70"
            style={{ left: `${appetiteLeft}%`, top: -overhang, height: overhang }}
          />
          <span
            className="absolute -translate-x-1/2 whitespace-nowrap rounded bg-quantify/15 px-1.5 py-0.5 font-mono text-[10px] text-quantify"
            style={{ left: `${appetiteLeft}%`, top: -overhang - 18 }}
            title={`${appetite.label}: ${money(appetite.annualLossThreshold, currency)} of annualised loss. A cell whose band crosses this line cannot say which side of it a risk falls on.`}
          >
            appetite
          </span>
        </>
      ) : null}

    </div>
  )
}

/** The idle-state glyph: one plate, three depths behind it. */
function SplitGlyph(): React.JSX.Element {
  return (
    <svg width="132" height="72" viewBox="0 0 132 72" fill="none" aria-hidden>
      <rect
        x="6"
        y="14"
        width="30"
        height="44"
        rx="4"
        fill="rgb(var(--accent) / 0.12)"
        stroke="rgb(var(--accent) / 0.5)"
      />
      <g>
        <rect x="52" y="18" width="70" height="6" rx="3" fill="rgb(var(--quant))" opacity="0.9" />
        <rect x="52" y="33" width="34" height="6" rx="3" fill="rgb(var(--quant))" opacity="0.6" />
        <rect x="52" y="48" width="54" height="6" rx="3" fill="rgb(var(--quant))" opacity="0.35" />
      </g>
      <path
        d="M40 36h8"
        stroke="rgb(var(--line-3))"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeDasharray="2 3"
      />
    </svg>
  )
}
