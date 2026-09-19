/**
 * Scales, scoring, and the arithmetic that connects a level to a quantity.
 *
 * The one rule this file enforces everywhere: a *level* becomes a *quantity*
 * only by passing through an anchor the user configured. There is no fallback
 * that turns `likelihood: 4` into a probability by dividing by five, and there
 * never will be -- inventing one is the exact error the product exists to
 * find.
 *
 * The shipped presets are ordinary corporate scales, written out so they can
 * be read and argued with. Nothing in the engine depends on them: the
 * dimensions, the labels, the anchors, the aggregation and the bands are all
 * configuration, and `matrix.ts` is written against `model.likelihood.levels`
 * rather than against the number five.
 */

import type {
  Aggregation,
  Appetite,
  Interval,
  Scale,
  ScaleAxis,
  ScaleKind,
  ScaleLevel,
  ScoreBand,
  ScoringModel,
} from './types.ts'

/* -------------------------------------------------------------------------- */
/* Presets                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A 5x5 likelihood scale with frequency anchors in events per year.
 *
 * The anchors are the ones an organisation would have to write down in order
 * for its matrix to mean anything quantitatively. Most never do, which is why
 * every quantitative view in PARALLAX degrades to `insufficient-data` rather
 * than to a guess when they are absent.
 */
export const LIKELIHOOD_5: readonly ScaleLevel[] = [
  { value: 1, label: 'Rare', description: 'Would be surprising within a decade.', anchor: { lo: 0.01, hi: 0.05 } },
  { value: 2, label: 'Unlikely', description: 'Plausible once in several years.', anchor: { lo: 0.05, hi: 0.15 } },
  { value: 3, label: 'Possible', description: 'Could happen in any given year.', anchor: { lo: 0.15, hi: 0.4 } },
  { value: 4, label: 'Likely', description: 'Expected at least once most years.', anchor: { lo: 0.4, hi: 1.2 } },
  { value: 5, label: 'Almost certain', description: 'Expected repeatedly each year.', anchor: { lo: 1.2, hi: 6 } },
]

/** A 5x5 impact scale with loss anchors, per occurrence. */
export const IMPACT_5: readonly ScaleLevel[] = [
  { value: 1, label: 'Insignificant', description: 'Absorbed within normal operating cost.', anchor: { lo: 2_000, hi: 20_000 } },
  { value: 2, label: 'Minor', description: 'Noticed by one team, no external effect.', anchor: { lo: 20_000, hi: 100_000 } },
  { value: 3, label: 'Moderate', description: 'Service degradation, contained externally.', anchor: { lo: 100_000, hi: 500_000 } },
  { value: 4, label: 'Major', description: 'Customer-visible, regulator-notifiable.', anchor: { lo: 500_000, hi: 3_000_000 } },
  { value: 5, label: 'Severe', description: 'Threatens the operating licence or the balance sheet.', anchor: { lo: 3_000_000, hi: 30_000_000 } },
]

/** The same shape at three and four rungs, for registers that use them. */
export const LIKELIHOOD_4: readonly ScaleLevel[] = [
  { value: 1, label: 'Rare', anchor: { lo: 0.01, hi: 0.06 } },
  { value: 2, label: 'Unlikely', anchor: { lo: 0.06, hi: 0.25 } },
  { value: 3, label: 'Likely', anchor: { lo: 0.25, hi: 1 } },
  { value: 4, label: 'Almost certain', anchor: { lo: 1, hi: 6 } },
]

export const IMPACT_4: readonly ScaleLevel[] = [
  { value: 1, label: 'Minor', anchor: { lo: 2_000, hi: 30_000 } },
  { value: 2, label: 'Moderate', anchor: { lo: 30_000, hi: 300_000 } },
  { value: 3, label: 'Major', anchor: { lo: 300_000, hi: 3_000_000 } },
  { value: 4, label: 'Severe', anchor: { lo: 3_000_000, hi: 30_000_000 } },
]

export const LIKELIHOOD_3: readonly ScaleLevel[] = [
  { value: 1, label: 'Low', anchor: { lo: 0.01, hi: 0.1 } },
  { value: 2, label: 'Medium', anchor: { lo: 0.1, hi: 0.8 } },
  { value: 3, label: 'High', anchor: { lo: 0.8, hi: 6 } },
]

export const IMPACT_3: readonly ScaleLevel[] = [
  { value: 1, label: 'Low', anchor: { lo: 5_000, hi: 100_000 } },
  { value: 2, label: 'Medium', anchor: { lo: 100_000, hi: 1_500_000 } },
  { value: 3, label: 'High', anchor: { lo: 1_500_000, hi: 30_000_000 } },
]

export function likelihoodPreset(size: number): readonly ScaleLevel[] {
  if (size === 3) return LIKELIHOOD_3
  if (size === 4) return LIKELIHOOD_4
  return LIKELIHOOD_5
}

export function impactPreset(size: number): readonly ScaleLevel[] {
  if (size === 3) return IMPACT_3
  if (size === 4) return IMPACT_4
  return IMPACT_5
}

/**
 * The score bands a 5x5 product register typically uses. Purely descriptive:
 * PARALLAX never treats a band as a quantity, only as the label the register
 * attaches to a score range.
 */
export const BANDS_5x5: readonly ScoreBand[] = [
  { label: 'Low', min: 1, max: 4 },
  { label: 'Moderate', min: 5, max: 9 },
  { label: 'High', min: 10, max: 16 },
  { label: 'Critical', min: 17, max: 25 },
]

export const DEFAULT_APPETITE: Appetite = {
  label: 'Board risk appetite',
  annualLossThreshold: 250_000,
}

export function makeScale(
  axis: ScaleAxis,
  levels: readonly ScaleLevel[],
  overrides: Partial<Scale> = {},
): Scale {
  const isLikelihood = axis === 'likelihood'
  return {
    axis,
    name: isLikelihood ? 'Likelihood' : 'Impact',
    kind: 'ordinal',
    levels,
    anchorUnit: isLikelihood ? 'events / year' : 'loss per occurrence',
    definition: isLikelihood
      ? 'Ranked descriptors of how often the event is expected. The numbers are labels for the descriptors.'
      : 'Ranked descriptors of the consequence of one occurrence. The numbers are labels for the descriptors.',
    ...overrides,
  }
}

/** The model the demo register is scored under, and the import default. */
export function defaultModel(size = 5): ScoringModel {
  return {
    likelihood: makeScale('likelihood', likelihoodPreset(size)),
    impact: makeScale('impact', impactPreset(size)),
    aggregation: 'product',
    currency: 'GBP',
    bands: size === 5 ? BANDS_5x5 : bandsFor(size),
    appetite: DEFAULT_APPETITE,
  }
}

/** Quartered bands for a non-5x5 matrix, so a band label always exists. */
function bandsFor(size: number): readonly ScoreBand[] {
  const top = size * size
  const step = Math.ceil(top / 4)
  return [
    { label: 'Low', min: 1, max: step },
    { label: 'Moderate', min: step + 1, max: step * 2 },
    { label: 'High', min: step * 2 + 1, max: step * 3 },
    { label: 'Critical', min: step * 3 + 1, max: top },
  ]
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The score the configured aggregation gives a cell.
 *
 * This computes what the register's own rule produces; it does not endorse it.
 * Whether the rule is entitled to produce a number at all is the question
 * `ordinal.ts` answers.
 */
export function scoreFor(model: ScoringModel, likelihood: number, impact: number): number {
  switch (model.aggregation) {
    case 'product':
      return likelihood * impact
    case 'sum':
      return likelihood + impact
    case 'max':
      return Math.max(likelihood, impact)
    case 'lookup': {
      const row = model.lookup?.[impact - 1]
      const value = row?.[likelihood - 1]
      return typeof value === 'number' ? value : likelihood * impact
    }
  }
}

export function bandFor(model: ScoringModel, score: number): string | undefined {
  for (const band of model.bands) {
    if (score >= band.min && score <= band.max) return band.label
  }
  return undefined
}

/** Human-readable statement of the aggregation, for the audit page. */
export function aggregationFormula(aggregation: Aggregation): string {
  switch (aggregation) {
    case 'product':
      return 'score = likelihood × impact'
    case 'sum':
      return 'score = likelihood + impact'
    case 'max':
      return 'score = max(likelihood, impact)'
    case 'lookup':
      return 'score = table[impact][likelihood]'
  }
}

/**
 * The weakest scale kind under which the aggregation is a defensible
 * operation.
 *
 *   product  Multiplying two scales requires both to have a true zero and
 *            meaningful ratios, i.e. ratio scales. On ordinal levels the
 *            product is not even invariant to relabelling.
 *   sum      Addition requires meaningful differences, i.e. interval or
 *            better. (Also, adding a frequency to a loss is dimensionally
 *            meaningless, but that objection is separate and is raised
 *            separately.)
 *   max      Uses only order, so it is safe on an ordinal scale.
 *   lookup   A table is a ranking device if it is only ever read as one.
 */
export function aggregationRequires(aggregation: Aggregation): ScaleKind {
  switch (aggregation) {
    case 'product':
      return 'ratio'
    case 'sum':
      return 'interval'
    case 'max':
    case 'lookup':
      return 'ordinal'
  }
}

const KIND_ORDER: Record<ScaleKind, number> = { ordinal: 0, interval: 1, ratio: 2 }

/** True when `have` is at least as strong as `need`. */
export function kindSatisfies(have: ScaleKind, need: ScaleKind): boolean {
  return KIND_ORDER[have] >= KIND_ORDER[need]
}

/** The weaker of two kinds, which is what a pair of scales jointly provides. */
export function weakerKind(a: ScaleKind, b: ScaleKind): ScaleKind {
  return KIND_ORDER[a] <= KIND_ORDER[b] ? a : b
}

/* -------------------------------------------------------------------------- */
/* Anchors                                                                    */
/* -------------------------------------------------------------------------- */

export function levelOf(scale: Scale, value: number): ScaleLevel | undefined {
  return scale.levels.find((l) => l.value === value)
}

export function labelOf(scale: Scale, value: number | null): string {
  if (value === null) return '—'
  return levelOf(scale, value)?.label ?? String(value)
}

export function anchorOf(scale: Scale, value: number | null): Interval | undefined {
  if (value === null) return undefined
  return levelOf(scale, value)?.anchor
}

export function hasAnchors(scale: Scale): boolean {
  return scale.levels.every((l) => l.anchor !== undefined)
}

/**
 * The annualised loss band a cell's own anchors imply.
 *
 * `[frequency.lo × magnitude.lo, frequency.hi × magnitude.hi]`. This is the
 * widest band consistent with the two anchors, which is the honest reading:
 * the cell genuinely cannot tell the reader where inside it a risk sits, so
 * the band is not narrowed by assuming independence or a central tendency.
 *
 * The ratio of its endpoints is the cell's *resolution*: the factor by which
 * two risks can differ while receiving the same score.
 */
export function cellAnnualLoss(
  model: ScoringModel,
  likelihood: number,
  impact: number,
): Interval | undefined {
  const f = anchorOf(model.likelihood, likelihood)
  const m = anchorOf(model.impact, impact)
  if (!f || !m) return undefined
  return { lo: f.lo * m.lo, hi: f.hi * m.hi }
}

export function spanOf(interval: Interval | undefined): number | undefined {
  if (!interval) return undefined
  if (!(interval.lo > 0) || !Number.isFinite(interval.hi)) return undefined
  return interval.hi / interval.lo
}

/** True when the decision threshold falls strictly inside the band. */
export function straddles(interval: Interval | undefined, threshold: number): boolean {
  if (!interval) return false
  return interval.lo < threshold && interval.hi > threshold
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export interface ScaleProblem {
  readonly axis: ScaleAxis
  readonly message: string
}

/**
 * Structural checks on a configured scale. These are errors in the *scale*,
 * not in the register, and they block analysis: a matrix built on a scale with
 * duplicate levels is not a matrix.
 */
export function validateScale(scale: Scale): ScaleProblem[] {
  const problems: ScaleProblem[] = []
  const { axis, levels } = scale

  if (levels.length < 2) {
    problems.push({ axis, message: 'A scale needs at least two levels.' })
    return problems
  }
  if (levels.length > 12) {
    problems.push({ axis, message: 'A scale with more than twelve levels is not a matrix axis.' })
  }

  const seen = new Set<number>()
  for (const level of levels) {
    if (!Number.isFinite(level.value)) {
      problems.push({ axis, message: `Level "${level.label}" has no numeric value.` })
      continue
    }
    if (seen.has(level.value)) {
      problems.push({ axis, message: `Level value ${level.value} appears more than once.` })
    }
    seen.add(level.value)
    if (level.label.trim() === '') {
      problems.push({ axis, message: `Level ${level.value} has no label.` })
    }
    if (level.anchor) {
      if (!(level.anchor.lo > 0)) {
        problems.push({
          axis,
          message: `Level ${level.value} ("${level.label}") has a lower anchor of ${level.anchor.lo}. Anchors are multiplied to produce an annualised loss, so they must be strictly positive.`,
        })
      } else if (level.anchor.hi < level.anchor.lo) {
        problems.push({
          axis,
          message: `Level ${level.value} ("${level.label}") has an anchor whose upper bound is below its lower bound.`,
        })
      }
    }
  }

  const ordered = [...levels].sort((a, b) => a.value - b.value)
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1] as ScaleLevel
    const curr = ordered[i] as ScaleLevel
    if (prev.anchor && curr.anchor && curr.anchor.lo < prev.anchor.lo) {
      problems.push({
        axis,
        message: `The anchor for level ${curr.value} ("${curr.label}") starts below the anchor for level ${prev.value} ("${prev.label}"). A higher level must denote a higher quantity, or the ranking and the anchors disagree.`,
      })
    }
  }

  return problems
}

/** Every level value on an axis, ascending. */
export function levelValues(scale: Scale): number[] {
  return [...scale.levels].map((l) => l.value).sort((a, b) => a - b)
}
