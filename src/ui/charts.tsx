/**
 * The quantitative charts.
 *
 * Two of them, both SVG, both hand-drawn rather than delegated to a charting
 * library. The reason is not purity: it is that both charts are on a
 * logarithmic loss axis with domain-specific annotations — an appetite line, a
 * percentile marker, an interval that inherits its width from an assumption —
 * and every general-purpose library fights that arrangement harder than
 * drawing it costs.
 *
 * Both obey the same three rules:
 *
 *   - The axis is labelled, always, including the unit and the fact that it is
 *     logarithmic. An unlabelled log axis is a chart that lies by a factor of
 *     ten.
 *   - Uncertainty is drawn, not smoothed away. The exceedance curve stops
 *     where the sample stops supporting it rather than extrapolating a tail.
 *   - There is a table underneath. A chart a screen reader cannot read is a
 *     decoration, and the percentile table is the same numbers.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ExceedancePoint, SimulationResult } from '../engine/index.ts'
import { decadeTicks, logPosition, money, percent } from './format.ts'
import { TYPE } from './tokens.ts'

/**
 * The rendered width of an element, tracked.
 *
 * An SVG with a fixed viewBox and a fluid width letterboxes: the drawing keeps
 * its aspect ratio and floats in the middle of the space it was given. For a
 * chart whose horizontal axis carries meaning that is not a cosmetic problem,
 * so the viewBox is sized from the real measurement instead.
 */
function useElementWidth(ref: React.RefObject<HTMLElement | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width
      if (next && next > 0) setWidth(Math.round(next))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  return width
}

/* -------------------------------------------------------------------------- */
/* Loss distribution                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The simulated annual loss distribution, as a log-spaced histogram.
 *
 * The columns animate in left to right when the result changes, staggered by
 * bucket. That is a transition on arrival rather than a simulation of
 * progress: the numbers already exist by the time this renders, and pretending
 * otherwise would be the kind of fake loading the rest of the product objects
 * to.
 */
export function DistributionChart({
  result,
  currency,
  appetite,
  height = 168,
}: {
  result: SimulationResult
  currency: string
  appetite?: number
  height?: number
}): React.JSX.Element {
  const buckets = result.histogram
  const maxCount = Math.max(1, ...buckets.map((b) => b.count))
  const lo = buckets[0]?.lo ?? 1
  const hi = buckets[buckets.length - 1]?.hi ?? 10
  const ticks = decadeTicks(lo, hi, 6)

  const markers = [
    { label: 'p50', value: result.summary.p50 },
    { label: 'p90', value: result.summary.p90 },
    { label: 'p99', value: result.summary.p99 },
  ].filter((m) => m.value > lo && m.value < hi)

  if (buckets.length === 0) {
    return (
      <p className="py-10 text-center text-xs text-ink-2">
        {percent(result.summary.zeroShare, 1)} of simulated years had no loss at all, and the rest
        are too few to shape a distribution. The exceedance curve is the better read here.
      </p>
    )
  }

  return (
    <figure className="m-0">
      <div className="relative" style={{ height }}>
        <div className="absolute inset-0 flex items-end gap-px">
          {buckets.map((bucket, index) => (
            <span
              key={`${bucket.lo}-${index}`}
              className="animate-column-in min-w-0 flex-1 origin-bottom rounded-t-[2px] bg-quant/70 transition-colors duration-140 hover:bg-quant"
              style={{
                height: `${Math.max(1, (bucket.count / maxCount) * 100)}%`,
                animationDelay: `${index * 9}ms`,
              }}
              title={`${money(bucket.lo, currency)}–${money(bucket.hi, currency)}: ${bucket.count.toLocaleString()} of ${result.iterations.toLocaleString()} years`}
            />
          ))}
        </div>

        {markers.map((marker) => (
          <span
            key={marker.label}
            className="pointer-events-none absolute inset-y-0 w-px bg-ink-0/40"
            style={{ left: `${logPosition(marker.value, lo, hi) * 100}%` }}
          >
            <span className="absolute -top-0.5 left-1 font-mono text-[10px] text-ink-2">
              {marker.label}
            </span>
          </span>
        ))}

        {appetite !== undefined && appetite > lo && appetite < hi ? (
          <span
            className="pointer-events-none absolute inset-y-0 w-px bg-quantify"
            style={{ left: `${logPosition(appetite, lo, hi) * 100}%` }}
          />
        ) : null}
      </div>

      <div className="relative mt-1 h-7 border-t border-line-2">
        {ticks.map((tick) => (
          <span
            key={tick}
            className="absolute top-1 font-mono text-[10px] text-ink-3 tnum"
            style={{ left: `${logPosition(tick, lo, hi) * 100}%`, transform: 'translateX(-50%)' }}
          >
            {money(tick, currency)}
          </span>
        ))}
      </div>

      <figcaption className={`${TYPE.note} mt-1`}>
        Annual loss, log scale. {result.iterations.toLocaleString()} simulated years;{' '}
        {percent(result.summary.zeroShare, 1)} of them had no loss and are not drawn.
      </figcaption>
    </figure>
  )
}

/* -------------------------------------------------------------------------- */
/* Loss exceedance curve                                                      */
/* -------------------------------------------------------------------------- */

/**
 * P(annual loss > L) against L.
 *
 * The curve is read from the right: "there is a 1% chance of losing more than
 * this much in a year". Hovering gives the exact pair plus the number of
 * simulated years behind it, so a reader can see when a point on the far tail
 * is resting on twelve observations.
 */
export function LossExceedanceCurve({
  result,
  currency,
  appetite,
  height = 200,
}: {
  result: SimulationResult
  currency: string
  appetite?: number
  height?: number
}): React.JSX.Element {
  const points = result.exceedance.filter((p) => p.loss > 0)
  const svg = useRef<SVGSVGElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<ExceedancePoint | undefined>()
  // The viewBox is sized to the element's real width rather than fixed, so the
  // curve fills the panel instead of being letterboxed inside a 560-unit box
  // and stranded in the middle of it.
  const width = useElementWidth(frame, 560)

  const domain = useMemo(() => {
    if (points.length === 0) return undefined
    const losses = points.map((p) => p.loss)
    const lo = Math.min(...losses)
    const hi = Math.max(...losses)
    return { lo: lo / 1.2, hi: hi * 1.2 }
  }, [points])

  const geometry = useMemo(() => {
    if (!domain || points.length === 0) return undefined
    const pad = { left: 46, right: 14, top: 10, bottom: 26 }
    const inner = { w: Math.max(80, width - pad.left - pad.right), h: height - pad.top - pad.bottom }
    // Probability is drawn on a log axis too: the interesting part of an
    // exceedance curve is the decade between 1% and 0.1%, and a linear
    // probability axis compresses it into the last two pixels.
    const pLo = Math.min(...points.map((p) => p.probability))
    const pHi = Math.max(...points.map((p) => p.probability))
    const x = (loss: number): number => pad.left + logPosition(loss, domain.lo, domain.hi) * inner.w
    const y = (probability: number): number =>
      pad.top + (1 - logPosition(probability, pLo, pHi)) * inner.h
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.loss).toFixed(1)},${y(p.probability).toFixed(1)}`).join(' ')
    const area = `${path} L${x(points[points.length - 1]?.loss ?? domain.lo).toFixed(1)},${pad.top + inner.h} L${x(points[0]?.loss ?? domain.lo).toFixed(1)},${pad.top + inner.h} Z`
    return { pad, width, inner, x, y, path, area, pLo, pHi }
  }, [domain, points, height, width])

  const onMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!geometry || !svg.current) return
      const box = svg.current.getBoundingClientRect()
      const ratio = (event.clientX - box.left) / box.width
      const px = ratio * geometry.width
      let best: ExceedancePoint | undefined
      let bestDistance = Infinity
      for (const point of points) {
        const distance = Math.abs(geometry.x(point.loss) - px)
        if (distance < bestDistance) {
          bestDistance = distance
          best = point
        }
      }
      setHover(best)
    },
    [geometry, points],
  )

  if (!geometry || !domain) {
    return <p className="py-10 text-center text-xs text-ink-2">No losses were simulated, so there is no curve to draw.</p>
  }

  const ticks = decadeTicks(domain.lo, domain.hi, 6)
  const probabilityTicks = [0.5, 0.2, 0.1, 0.05, 0.01, 0.005, 0.001].filter(
    (p) => p <= geometry.pHi && p >= geometry.pLo,
  )

  return (
    <figure ref={frame} className="m-0 w-full">
      <svg
        ref={svg}
        viewBox={`0 0 ${geometry.width} ${height}`}
        className="block w-full"
        style={{ height }}
        role="img"
        aria-label="Loss exceedance curve: the probability that annual loss exceeds a given amount"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(undefined)}
      >
        {probabilityTicks.map((p) => (
          <g key={p}>
            <line
              x1={geometry.pad.left}
              x2={geometry.width - geometry.pad.right}
              y1={geometry.y(p)}
              y2={geometry.y(p)}
              stroke="rgb(var(--line-1))"
              strokeWidth="1"
            />
            <text
              x={geometry.pad.left - 8}
              y={geometry.y(p) + 3}
              textAnchor="end"
              className="fill-[rgb(var(--ink-3))] font-mono"
              fontSize="9"
            >
              {percent(p, p < 0.01 ? 1 : 0)}
            </text>
          </g>
        ))}

        {ticks.map((tick) => (
          <text
            key={tick}
            x={geometry.x(tick)}
            y={height - 8}
            textAnchor="middle"
            className="fill-[rgb(var(--ink-3))] font-mono"
            fontSize="9"
          >
            {money(tick, currency)}
          </text>
        ))}

        <path d={geometry.area} fill="rgb(var(--quant) / 0.12)" />
        <path
          d={geometry.path}
          fill="none"
          stroke="rgb(var(--quant))"
          strokeWidth="1.75"
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          className="px-trace"
        />

        {appetite !== undefined && appetite > domain.lo && appetite < domain.hi ? (
          <g>
            <line
              x1={geometry.x(appetite)}
              x2={geometry.x(appetite)}
              y1={geometry.pad.top}
              y2={geometry.pad.top + geometry.inner.h}
              stroke="rgb(var(--state-quantify))"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <text
              x={geometry.x(appetite) + 4}
              y={geometry.pad.top + 9}
              className="fill-[rgb(var(--state-quantify))] font-mono"
              fontSize="9"
            >
              appetite
            </text>
          </g>
        ) : null}

        {hover ? (
          <g>
            <line
              x1={geometry.x(hover.loss)}
              x2={geometry.x(hover.loss)}
              y1={geometry.pad.top}
              y2={geometry.pad.top + geometry.inner.h}
              stroke="rgb(var(--ink-2))"
              strokeWidth="1"
            />
            <circle
              cx={geometry.x(hover.loss)}
              cy={geometry.y(hover.probability)}
              r="3.5"
              fill="rgb(var(--quant))"
              stroke="rgb(var(--surface-1))"
              strokeWidth="1.5"
            />
          </g>
        ) : null}
      </svg>

      <figcaption className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
        <span className={TYPE.note}>
          Probability that annual loss exceeds the amount on the horizontal axis. Both axes
          logarithmic.
        </span>
        <span className="font-mono text-2xs text-ink-1 tnum">
          {hover
            ? `${percent(hover.probability, 2)} chance of exceeding ${money(hover.loss, currency)} — about ${Math.round(hover.probability * result.iterations).toLocaleString()} of ${result.iterations.toLocaleString()} simulated years`
            : 'Hover the curve for a probability and the years behind it'}
        </span>
      </figcaption>
    </figure>
  )
}

/* -------------------------------------------------------------------------- */
/* Interval bar                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One interval against a shared log axis. Used in every list where two
 * intervals have to be compared by eye — the compression view, the inversion
 * view, the risk workspace.
 */
export function IntervalBar({
  lo,
  hi,
  centre,
  axisLo,
  axisHi,
  currency,
  estimated,
  tone = 'quant',
  label,
}: {
  lo: number
  hi: number
  centre?: number
  axisLo: number
  axisHi: number
  currency: string
  estimated: boolean
  tone?: 'quant' | 'distorted' | 'accent'
  label?: string
}): React.JSX.Element {
  const left = logPosition(lo, axisLo, axisHi) * 100
  const right = (1 - logPosition(hi, axisLo, axisHi)) * 100
  const fill =
    !estimated ? 'bg-insufficient hatch' : tone === 'distorted' ? 'bg-distorted' : tone === 'accent' ? 'bg-accent' : 'bg-quant'

  return (
    <span
      className="relative block h-4 w-full"
      title={`${money(lo, currency)}–${money(hi, currency)}${estimated ? '' : ' (inherited from the cell anchors)'}`}
      aria-label={label ?? `${money(lo, currency)} to ${money(hi, currency)} a year`}
    >
      <span aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-1" />
      <span
        className={`absolute inset-y-[0.3rem] animate-span-in rounded-full ${fill}`}
        style={{ left: `${left}%`, right: `${right}%` }}
      />
      {centre !== undefined ? (
        <span
          aria-hidden
          className="absolute inset-y-0.5 w-px bg-ink-0/70"
          style={{ left: `${logPosition(centre, axisLo, axisHi) * 100}%` }}
        />
      ) : null}
    </span>
  )
}

/** A shared axis strip for a stack of `IntervalBar`s. */
export function IntervalAxis({
  lo,
  hi,
  currency,
  appetite,
}: {
  lo: number
  hi: number
  currency: string
  appetite?: number
}): React.JSX.Element {
  const ticks = decadeTicks(lo, hi, 6)
  return (
    <div className="relative h-6 border-t border-line-2">
      {ticks.map((tick) => (
        <span
          key={tick}
          className="absolute top-1 font-mono text-[10px] text-ink-3 tnum"
          style={{ left: `${logPosition(tick, lo, hi) * 100}%`, transform: 'translateX(-50%)' }}
        >
          {money(tick, currency)}
        </span>
      ))}
      {appetite !== undefined && appetite > lo && appetite < hi ? (
        <span
          className="absolute -top-2 bottom-3 w-px bg-quantify/70"
          style={{ left: `${logPosition(appetite, lo, hi) * 100}%` }}
        />
      ) : null}
    </div>
  )
}
