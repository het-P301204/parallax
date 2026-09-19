/**
 * Small, explicit descriptive statistics.
 *
 * Nothing here is clever. It is in one file, with the definition of each
 * estimator written down, because the methodology page quotes these
 * definitions and a reader has to be able to check that the code does what the
 * page says.
 *
 * One deliberate absence: there is no mean of a set of ordinal levels anywhere
 * in this file. Every summary of a level uses the median, the range or the
 * median absolute deviation -- statistics that are defined for a ranking.
 * Averaging "Likely" and "Rare" to get "Possible" is precisely the operation
 * PARALLAX exists to flag, so the engine does not have a function for it.
 */

/** Ascending copy. Never sorts in place: callers pass shared arrays. */
export function sorted(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b)
}

/**
 * The p-quantile of a sample, by linear interpolation between order
 * statistics (the "type 7" definition, the same one R and NumPy use by
 * default).
 */
export function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN
  const s = sorted(values)
  const last = s.length - 1
  if (p <= 0) return s[0] as number
  if (p >= 1) return s[last] as number
  const pos = p * last
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const frac = pos - lo
  const a = s[lo] as number
  const b = s[hi] as number
  return a + (b - a) * frac
}

/**
 * The p-quantile of an *already sorted* sample. Same definition as
 * `quantile`; used in the simulation, where the sample is sorted once and
 * queried a dozen times and a copy per call would dominate the run.
 */
export function quantileSorted(s: readonly number[], p: number): number {
  if (s.length === 0) return Number.NaN
  const last = s.length - 1
  if (p <= 0) return s[0] as number
  if (p >= 1) return s[last] as number
  const pos = p * last
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const frac = pos - lo
  const a = s[lo] as number
  const b = s[hi] as number
  return a + (b - a) * frac
}

export function median(values: readonly number[]): number {
  return quantile(values, 0.5)
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN
  let total = 0
  for (const v of values) total += v
  return total / values.length
}

/** max - min. Defined for an ordinal scale as a count of rungs crossed. */
export function range(values: readonly number[]): number {
  if (values.length === 0) return 0
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return hi - lo
}

/**
 * Median absolute deviation from the median.
 *
 * Preferred over the standard deviation for levels because it needs only
 * order and distance-from-centre, and because one assessor who scored a single
 * risk at 5 should not make a whole group look dispersed.
 */
export function mad(values: readonly number[]): number {
  if (values.length === 0) return 0
  const m = median(values)
  return median(values.map((v) => Math.abs(v - m)))
}

/** Median of the sample with the element at `index` removed. */
export function medianExcluding(values: readonly number[], index: number): number {
  const rest = values.filter((_, i) => i !== index)
  return rest.length === 0 ? Number.NaN : median(rest)
}

/** Median of the sample with every element of `exclude` removed. */
export function medianExcludingIds(
  values: readonly { readonly key: string; readonly value: number }[],
  exclude: string,
): number {
  const rest = values.filter((v) => v.key !== exclude).map((v) => v.value)
  return rest.length === 0 ? Number.NaN : median(rest)
}

/** Clamps to [0, 1]. Used wherever a component of a transparent score is set. */
export function unit(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

/**
 * Maps a positive ratio onto [0, 1] logarithmically, saturating at `at`.
 *
 * Used for spans and uncertainty widths, where the difference between 1x and
 * 10x matters enormously and the difference between 400x and 500x does not.
 */
export function logScore(ratio: number, at: number): number {
  if (!Number.isFinite(ratio) || ratio <= 1) return 0
  if (at <= 1) return 1
  return unit(Math.log(ratio) / Math.log(at))
}

/** Sum. Separate function so the intent reads at the call site. */
export function sum(values: readonly number[]): number {
  let total = 0
  for (const v of values) total += v
  return total
}

/** Distinct values, order of first appearance preserved. */
export function distinct<T>(values: readonly T[]): T[] {
  const seen = new Set<T>()
  const out: T[] = []
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v)
      out.push(v)
    }
  }
  return out
}

/** Groups by a key function, preserving first-appearance order of the keys. */
export function groupBy<T>(
  values: readonly T[],
  key: (value: T) => string,
): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const v of values) {
    const k = key(v)
    const bucket = out.get(k)
    if (bucket) bucket.push(v)
    else out.set(k, [v])
  }
  return out
}

/**
 * Groups a count for prose: `6,261`.
 *
 * The locale is pinned. `toLocaleString()` with no argument uses the *host's*
 * locale, so the same register produces "115,247" on one machine and
 * "1,15,247" on another — and because these strings are embedded in the
 * findings, they reach the exports. An export whose bytes depend on the
 * machine that produced it is not the deterministic artifact this product
 * claims to emit, and a diff between two of them would be a diff of the
 * operating system.
 */
export function counted(value: number): string {
  return value.toLocaleString('en-GB')
}

/**
 * Formats a ratio the way the interface speaks about spans: `23x`, `1.8x`.
 * One decimal below ten, none above, because "23.4x" implies a precision the
 * inputs do not have.
 */
export function formatSpan(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—'
  if (ratio < 10) return `${ratio.toFixed(1)}x`
  return `${Math.round(ratio)}x`
}
