/**
 * The simulation.
 *
 * One risk, one year, many times. Each iteration:
 *
 *   1. Draw a rate λ from a lognormal fitted so the configured frequency
 *      interval is its 5th–95th percentile. This is the outer loop of the
 *      uncertainty: we do not know how often this happens.
 *   2. Draw a count N ~ Poisson(λ). This is the inner loop: given a rate,
 *      years still differ.
 *   3. Draw N loss magnitudes from a lognormal fitted to the loss interval,
 *      and add them.
 *
 * Two deliberate choices worth defending:
 *
 * *Why the rate is itself uncertain.* Fixing λ at the midpoint of the interval
 * would throw away the largest source of uncertainty in most cyber risks —
 * nobody knows the rate — and would produce a distribution far narrower than
 * the analyst's actual state of knowledge. A narrow distribution is exactly
 * the failure mode this product exists to object to, so it would be a strange
 * thing to introduce in its own simulation.
 *
 * *Why lognormal.* It is positive, right-skewed, and fitted uniquely by two
 * percentiles — which is the only form of input a subject-matter expert can
 * give honestly. It has a lighter tail than the loss distributions seen in
 * practice, which means the tail percentiles here are, if anything,
 * optimistic. The interface says so rather than claiming otherwise.
 *
 * Determinism is not a nicety here. Every number is produced from a named
 * seed, the same seed produces the same output in the browser, the CLI and the
 * test suite, and `simulate.test.ts` asserts it.
 */

import { EXCEEDANCE_POINTS, HISTOGRAM_BUCKETS, MAX_ITERATIONS, DEFAULT_ITERATIONS } from './limits.ts'
import { createRng, lognormalFrom90, lognormalParams, poisson, seedFrom, standardNormal } from './rng.ts'
import { quantileSorted } from './stats.ts'
import type {
  ExceedancePoint,
  LossSummary,
  QuantitativeModel,
  SimulationResult,
} from './types.ts'

export interface SimulateOptions {
  readonly iterations?: number
  readonly seed?: number
  /** Annualised-loss figure to report an exceedance probability against. */
  readonly appetite?: number
}

/** The seed a risk gets when nobody chose one. Stable across processes. */
export function defaultSeed(riskId: string): number {
  return seedFrom(riskId, 0x50726c78)
}

/**
 * Draws one year of annualised loss.
 *
 * Extracted so that `compareModels` can draw from two models in the same loop
 * without duplicating the model definition — a paired comparison has to use
 * exactly the same generative model as the individual results, or the two
 * views of the same pair will disagree.
 */
function drawYear(
  rng: { next(): number },
  frequency: { mu: number; sigma: number },
  magnitude: { lo: number; hi: number },
): number {
  const lambda = Math.exp(frequency.mu + frequency.sigma * standardNormal(rng))
  const count = poisson(rng, lambda)
  let loss = 0
  for (let k = 0; k < count; k += 1) loss += lognormalFrom90(rng, magnitude.lo, magnitude.hi)
  return loss
}

export function simulate(model: QuantitativeModel, options: SimulateOptions = {}): SimulationResult {
  const iterations = Math.max(
    1000,
    Math.min(options.iterations ?? DEFAULT_ITERATIONS, MAX_ITERATIONS),
  )
  const seed = options.seed ?? defaultSeed(model.riskId)
  const rng = createRng(seed)
  const frequency = lognormalParams(model.frequency.lo, model.frequency.hi)

  const losses = new Float64Array(iterations)
  let zeros = 0
  let total = 0
  for (let n = 0; n < iterations; n += 1) {
    const loss = drawYear(rng, frequency, model.magnitude)
    if (loss === 0) zeros += 1
    total += loss
    losses[n] = loss
  }
  losses.sort()

  const sorted = Array.from(losses)
  const summary: LossSummary = {
    mean: total / iterations,
    p10: quantileSorted(sorted, 0.1),
    p50: quantileSorted(sorted, 0.5),
    p90: quantileSorted(sorted, 0.9),
    p95: quantileSorted(sorted, 0.95),
    p99: quantileSorted(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? 0,
    zeroShare: zeros / iterations,
  }

  return {
    riskId: model.riskId,
    iterations,
    seed,
    summary,
    exceedance: exceedanceCurve(sorted, iterations),
    histogram: histogram(sorted),
    probabilityOverAppetite:
      options.appetite === undefined ? undefined : exceedanceAt(sorted, options.appetite),
    model,
  }
}

/**
 * The loss exceedance curve: for a grid of probabilities p, the loss L with
 * P(annual loss > L) = p.
 *
 * The grid is log-spaced in *probability* rather than in loss, so the curve
 * carries detail where decisions are made — the far tail — instead of
 * spending most of its points on the crowded body of the distribution.
 *
 * The lowest probability on the grid is bounded below by 5/iterations: a point
 * estimated from fewer than five simulated years is noise with a line drawn
 * through it, and drawing it anyway is how a chart starts lying.
 */
function exceedanceCurve(sorted: readonly number[], iterations: number): ExceedancePoint[] {
  const pMax = 0.99
  const pMin = Math.max(5 / iterations, 0.0005)
  if (!(pMin < pMax)) return []
  const points: ExceedancePoint[] = []
  const logMax = Math.log(pMax)
  const logMin = Math.log(pMin)
  for (let k = 0; k < EXCEEDANCE_POINTS; k += 1) {
    const t = k / (EXCEEDANCE_POINTS - 1)
    const probability = Math.exp(logMax + (logMin - logMax) * t)
    points.push({ loss: quantileSorted(sorted, 1 - probability), probability })
  }
  return points
}

/** P(annual loss > threshold), read straight off the empirical sample. */
export function exceedanceAt(sorted: readonly number[], threshold: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((sorted[mid] as number) <= threshold) lo = mid + 1
    else hi = mid
  }
  return (sorted.length - lo) / sorted.length
}

/**
 * A log-spaced histogram of the non-zero losses.
 *
 * Linear buckets are useless here: a distribution running from £2k to £40M
 * puts 99% of its mass in the first linear bucket and draws a single spike.
 * The range runs from the smallest non-zero loss to the 99.5th percentile, so
 * one freak iteration cannot stretch the axis until the shape disappears; the
 * tail beyond it is still visible on the exceedance curve, which is the chart
 * built for it.
 */
function histogram(
  sorted: readonly number[],
): { lo: number; hi: number; count: number }[] {
  const nonZero = sorted.filter((v) => v > 0)
  if (nonZero.length < 2) return []
  const lo = nonZero[0] as number
  const hi = quantileSorted(nonZero, 0.995)
  if (!(hi > lo)) return []

  const logLo = Math.log(lo)
  const logHi = Math.log(hi)
  const step = (logHi - logLo) / HISTOGRAM_BUCKETS
  const buckets = Array.from({ length: HISTOGRAM_BUCKETS }, (_, k) => ({
    lo: Math.exp(logLo + step * k),
    hi: Math.exp(logLo + step * (k + 1)),
    count: 0,
  }))

  for (const value of nonZero) {
    if (value > hi) continue
    const index = Math.min(
      HISTOGRAM_BUCKETS - 1,
      Math.max(0, Math.floor((Math.log(value) - logLo) / step)),
    )
    const bucket = buckets[index]
    if (bucket) bucket.count += 1
  }
  return buckets
}

/**
 * P(B's annualised loss exceeds A's), by paired sampling.
 *
 * The two risks are drawn from independent streams because they are modelled
 * as independent events — which is itself an assumption, and one the inversion
 * finding states. Sampling both inside one loop rather than comparing two
 * pre-computed summaries matters: `p90(B) > p90(A)` says nothing about
 * P(B > A), and conflating the two is one of the more common ways a risk
 * comparison goes wrong.
 */
export function compareModels(
  a: QuantitativeModel,
  b: QuantitativeModel,
  iterations = 8000,
  seed?: number,
): number {
  const resolved = seed ?? seedFrom(`${a.riskId}~${b.riskId}`, 0x6376736c)
  const rngA = createRng(resolved)
  const rngB = createRng(resolved ^ 0x9e3779b9)
  const fa = lognormalParams(a.frequency.lo, a.frequency.hi)
  const fb = lognormalParams(b.frequency.lo, b.frequency.hi)

  let wins = 0
  for (let n = 0; n < iterations; n += 1) {
    const lossA = drawYear(rngA, fa, a.magnitude)
    const lossB = drawYear(rngB, fb, b.magnitude)
    if (lossB > lossA) wins += 1
  }
  return wins / iterations
}

/** Summary of the sample as a plain interval, for compact display. */
export function summaryInterval(summary: LossSummary): { lo: number; hi: number } {
  return { lo: summary.p10, hi: summary.p90 }
}
