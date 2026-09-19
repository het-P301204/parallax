/**
 * The ordinal validity audit.
 *
 * This is the analysis the rest of the product rests on, so the argument is
 * written out in full.
 *
 * An ordinal scale is a set of ranked labels. The numbers 1..5 attached to
 * "Rare".."Almost certain" are *names* for the rungs, not measurements of
 * them. Formally: an ordinal scale is determined only up to a strictly
 * increasing transformation. If 1,2,3,4,5 is a faithful labelling of those
 * five descriptors, then 1,2,3,4,100 is exactly as faithful — it preserves
 * every statement the scale is entitled to make, namely the order.
 *
 * That has a sharp consequence for a matrix. A conclusion drawn from a
 * register is only supported by the register's own scale definition if it
 * survives *every* admissible relabelling. Conclusions come in two kinds:
 *
 *   "A outranks B"  For an aggregation that is non-decreasing in both axes,
 *                   this survives every relabelling exactly when A's
 *                   likelihood and impact are both at least B's — Pareto
 *                   dominance. If neither dominates, the ranking is an
 *                   artefact of the particular numbers someone chose for the
 *                   labels, and `witnessRelabelling` constructs a legal
 *                   relabelling that reverses it. The reversal is not a
 *                   rhetorical device: it is a counterexample.
 *
 *   "A is twice B"  Never survives. A ratio of two ordinal labels is not a
 *                   quantity in any relabelling, including the register's own.
 *
 * None of this says the register is wrong. It says which of the register's
 * conclusions are consequences of the assessments and which are consequences
 * of the notation. PARALLAX reports the second kind and leaves the first
 * alone.
 *
 * Complexity note: the analysis is over *cells*, not rows. Every risk in a
 * cell has identical levels, so dominance and score comparisons are properties
 * of the cell pair; the risk-pair counts are obtained by multiplying cell
 * occupancies. A 5x5 matrix has 300 unordered cell pairs no matter how many
 * thousand risks are in it.
 */

import { MAX_PAIR_FINDINGS } from './limits.ts'
import {
  aggregationFormula,
  aggregationRequires,
  kindSatisfies,
  labelOf,
  levelValues,
  scoreFor,
  spanOf,
  weakerKind,
} from './scales.ts'
import { scoreCollisions } from './matrix.ts'
import { counted } from './stats.ts'
import type {
  AnalysisState,
  IndeterminatePair,
  Matrix,
  OrdinalAudit,
  OrdinalOperationFinding,
  Risk,
  RiskCell,
  RiskRegister,
  ScaleKind,
  ScoringModel,
} from './types.ts'

/* -------------------------------------------------------------------------- */
/* Dominance                                                                  */
/* -------------------------------------------------------------------------- */

export type Dominance = 'a-dominates' | 'b-dominates' | 'equal' | 'incomparable'

/**
 * Pareto comparison of two cells.
 *
 * `a-dominates` means A is at least as high on both axes and strictly higher
 * on at least one. That is the strongest statement two ordinal scales can
 * jointly support about a pair, and it is the only one that is invariant.
 */
export function compareCells(
  aL: number,
  aI: number,
  bL: number,
  bI: number,
): Dominance {
  if (aL === bL && aI === bI) return 'equal'
  if (aL >= bL && aI >= bI) return 'a-dominates'
  if (bL >= aL && bI >= aI) return 'b-dominates'
  return 'incomparable'
}

/* -------------------------------------------------------------------------- */
/* Witness relabellings                                                       */
/* -------------------------------------------------------------------------- */

export interface Relabelling {
  readonly likelihood: readonly number[]
  readonly impact: readonly number[]
  readonly aScore: number
  readonly bScore: number
}

/**
 * Replaces `atValue` and everything above it with a run starting at `target`,
 * keeping the sequence strictly increasing.
 *
 * This is the smallest edit that produces a legal relabelling: the rungs below
 * the change keep their original names, so the reader can see that only one
 * band was renamed and that its order relative to the others is untouched.
 */
function boostFrom(levels: readonly number[], atValue: number, target: number): number[] {
  const out = [...levels]
  const at = levels.indexOf(atValue)
  if (at < 0) return out
  const previous = at > 0 ? (out[at - 1] as number) : 0
  const base = Math.max(Math.ceil(target), previous + 1)
  for (let k = at; k < out.length; k += 1) out[k] = base + (k - at)
  return out
}

/** Scores a relabelled pair of levels under an arithmetic aggregation. */
function scoreRelabelled(model: ScoringModel, l: number, i: number): number {
  switch (model.aggregation) {
    case 'product':
      return l * i
    case 'sum':
      return l + i
    case 'max':
      return Math.max(l, i)
    case 'lookup':
      // A lookup table indexes cells, not level values, so a relabelling
      // leaves it unchanged. Callers never reach here; see `auditOrdinal`.
      return scoreFor(model, l, i)
  }
}

/**
 * Constructs a strictly increasing relabelling of one axis under which B
 * outranks A, given that the register's own numbers put A above B and neither
 * dominates the other.
 *
 * Returns `null` when no such relabelling exists, which for a monotone
 * arithmetic aggregation means the pair was comparable after all — a
 * defensive branch rather than an expected one.
 */
export function witnessRelabelling(
  model: ScoringModel,
  aL: number,
  aI: number,
  bL: number,
  bI: number,
): Relabelling | null {
  if (model.aggregation === 'lookup') return null

  const lLevels = levelValues(model.likelihood)
  const iLevels = levelValues(model.impact)

  // Exactly one axis has B above A, because the cells are incomparable.
  const boostImpact = bI > aI
  const axisLevels = boostImpact ? iLevels : lLevels
  const boostAt = boostImpact ? bI : bL

  // The value the boosted rung has to reach for B to overtake A. Solved per
  // aggregation rather than searched, so the witness is exact and instant.
  let target: number
  switch (model.aggregation) {
    case 'product':
      target = boostImpact ? (aL * aI) / bL + 1 : (aL * aI) / bI + 1
      break
    case 'sum':
      target = boostImpact ? aL + aI - bL + 1 : aL + aI - bI + 1
      break
    case 'max':
      target = Math.max(aL, aI) + 1
      break
  }

  const boosted = boostFrom(axisLevels, boostAt, target)
  const likelihood = boostImpact ? lLevels : boosted
  const impact = boostImpact ? boosted : iLevels

  const at = (levels: readonly number[], original: readonly number[], value: number): number =>
    levels[original.indexOf(value)] as number

  const aScore = scoreRelabelled(
    model,
    at(likelihood, lLevels, aL),
    at(impact, iLevels, aI),
  )
  const bScore = scoreRelabelled(
    model,
    at(likelihood, lLevels, bL),
    at(impact, iLevels, bI),
  )

  if (!(bScore > aScore)) return null
  return { likelihood, impact, aScore, bScore }
}

/* -------------------------------------------------------------------------- */
/* The audit                                                                  */
/* -------------------------------------------------------------------------- */

export interface OrdinalInput {
  readonly register: RiskRegister
  readonly matrix: Matrix
  readonly placeable: readonly Risk[]
  readonly scoreById: ReadonlyMap<string, number>
}

interface CellPairCounts {
  readonly compared: number
  readonly determinate: number
  readonly indeterminate: number
  readonly contradicting: number
}

export function auditOrdinal(input: OrdinalInput): OrdinalAudit {
  const { register, matrix } = input
  const { model } = register
  const occupied = matrix.cells.filter((c) => c.riskIds.length > 0)

  const counts = countCellPairs(model, occupied)
  const pairs = collectIndeterminatePairs(model, occupied, input.scoreById)

  const jointKind = weakerKind(model.likelihood.kind, model.impact.kind)
  const operations = buildOperations(input, counts, jointKind)

  const determinacy = counts.compared === 0 ? 1 : counts.determinate / counts.compared
  const state: AnalysisState =
    counts.compared === 0
      ? 'insufficient-data'
      : determinacy === 1
        ? 'supported'
        : kindSatisfies(jointKind, aggregationRequires(model.aggregation))
          ? 'ambiguous'
          : 'distorted'

  const percent = (counts.compared === 0 ? 0 : (1 - determinacy) * 100).toFixed(1)

  return {
    scaleKinds: { likelihood: model.likelihood.kind, impact: model.impact.kind },
    aggregation: model.aggregation,
    operations,
    indeterminatePairs: pairs.pairs,
    indeterminateCount: counts.indeterminate,
    contradictingCount: counts.contradicting,
    truncated: pairs.truncated,
    comparedPairs: counts.compared,
    determinatePairs: counts.determinate,
    collidingCells: scoreCollisions(matrix),
    state,
    explanation: {
      what:
        counts.compared === 0
          ? 'There are not enough placed risks to compare any pair.'
          : `${percent}% of the register's own rankings are not determined by its scale definition.`,
      why: `The ${model.likelihood.name.toLowerCase()} and ${model.impact.name.toLowerCase()} scales are declared ${jointKind}, and ${aggregationFormula(model.aggregation)} is applied to them. Of ${counted(counts.compared)} ordered pairs where the register ranks one risk above another, ${counted(counts.determinate)} hold under every strictly increasing relabelling of the levels. The remaining ${counted((counts.compared - counts.determinate))} reverse under at least one relabelling that is just as faithful to the written scale as the numbers 1 to ${levelValues(model.likelihood).length}.`,
      assumption: `That the scales are ${jointKind} as configured. If your organisation can defend the levels as ratio quantities — that a 4 really is twice a 2, on both axes — this finding does not apply and the scale kind should be changed in the model configuration.`,
      evidence: `${occupied.length} occupied cells of ${matrix.cells.length}; ${matrix.distinctScores.length} distinct scores; ${scoreCollisions(matrix).length} score values shared by more than one cell.`,
      next: 'Look at the indeterminate pairs before using the ranking to allocate anything. For pairs where the decision is expensive, the quantification shortlist is the way to settle them.',
    },
  }
}

/**
 * Exact pair counts, obtained from cell occupancies rather than by iterating
 * over risk pairs. Every risk in a cell has the same levels, so a pair of
 * cells contributes `|A| x |B|` ordered risk pairs of identical character.
 */
function countCellPairs(model: ScoringModel, occupied: readonly RiskCell[]): CellPairCounts {
  let compared = 0
  let determinate = 0
  let indeterminate = 0
  let contradicting = 0

  for (let i = 0; i < occupied.length; i += 1) {
    for (let j = 0; j < occupied.length; j += 1) {
      if (i === j) continue
      const a = occupied[i] as RiskCell
      const b = occupied[j] as RiskCell
      if (!(a.score > b.score)) continue

      const weight = a.riskIds.length * b.riskIds.length
      compared += weight
      const dominance = compareCells(a.likelihood, a.impact, b.likelihood, b.impact)
      if (dominance === 'a-dominates') determinate += weight
      else if (dominance === 'b-dominates') contradicting += weight
      else indeterminate += weight
      void model
    }
  }

  return { compared, determinate, indeterminate, contradicting }
}

interface CollectedPairs {
  readonly pairs: readonly IndeterminatePair[]
  readonly truncated: boolean
}

/**
 * Materialises the indeterminate risk pairs, worst first.
 *
 * "Worst" is the score gap: the pair the register claims are furthest apart
 * while providing no ordinal basis for saying so. A 20-versus-12 pair is a
 * more misleading piece of notation than a 12-versus-10 pair, and it is the
 * one somebody will act on.
 */
function collectIndeterminatePairs(
  model: ScoringModel,
  occupied: readonly RiskCell[],
  scoreById: ReadonlyMap<string, number>,
): CollectedPairs {
  const cellPairs: { a: RiskCell; b: RiskCell; gap: number }[] = []

  for (let i = 0; i < occupied.length; i += 1) {
    for (let j = 0; j < occupied.length; j += 1) {
      if (i === j) continue
      const a = occupied[i] as RiskCell
      const b = occupied[j] as RiskCell
      if (!(a.score > b.score)) continue
      if (compareCells(a.likelihood, a.impact, b.likelihood, b.impact) !== 'incomparable') continue
      cellPairs.push({ a, b, gap: a.score - b.score })
    }
  }
  cellPairs.sort((x, y) => y.gap - x.gap || x.a.key.localeCompare(y.a.key))

  const pairs: IndeterminatePair[] = []
  let truncated = false

  for (const { a, b } of cellPairs) {
    const witness = witnessRelabelling(model, a.likelihood, a.impact, b.likelihood, b.impact)
    if (!witness) continue
    for (const aId of a.riskIds) {
      for (const bId of b.riskIds) {
        if (pairs.length >= MAX_PAIR_FINDINGS) {
          truncated = true
          return { pairs, truncated }
        }
        pairs.push({
          aId,
          bId,
          aScore: scoreById.get(aId) ?? a.score,
          bScore: scoreById.get(bId) ?? b.score,
          aCell: a.key,
          bCell: b.key,
          witness,
        })
      }
    }
  }

  return { pairs, truncated }
}

/* -------------------------------------------------------------------------- */
/* Operations                                                                 */
/* -------------------------------------------------------------------------- */

function buildOperations(
  input: OrdinalInput,
  counts: CellPairCounts,
  jointKind: ScaleKind,
): OrdinalOperationFinding[] {
  const { register, matrix, placeable } = input
  const { model } = register
  const out: OrdinalOperationFinding[] = []

  const needed = aggregationRequires(model.aggregation)
  const satisfied = kindSatisfies(jointKind, needed)
  const levelCount = levelValues(model.likelihood).length

  /* 1. The aggregation itself. ------------------------------------------- */
  out.push({
    id: 'aggregate',
    title: 'Combining the two axes into one number',
    registerDoes: `Every row is given a score by ${aggregationFormula(model.aggregation)}.`,
    scaleMeans: `Both axes are declared ${jointKind}. ${
      jointKind === 'ordinal'
        ? `The levels 1 to ${levelCount} are names for ranked descriptors; the gap between "${labelOf(model.likelihood, 1)}" and "${labelOf(model.likelihood, 2)}" is not claimed to equal the gap between "${labelOf(model.likelihood, levelCount - 1)}" and "${labelOf(model.likelihood, levelCount)}".`
        : jointKind === 'interval'
          ? 'Differences between levels are claimed to be comparable; ratios are not.'
          : 'Levels are claimed to be quantities with a true zero.'
    }`,
    requires: needed,
    state: satisfied ? 'valid' : 'distorted',
    affected: placeable.length,
    explanation: {
      what: satisfied
        ? `${aggregationFormula(model.aggregation)} is a defensible operation on ${jointKind} scales.`
        : `${aggregationFormula(model.aggregation)} requires ${needed} scales, and these are ${jointKind}.`,
      why: satisfied
        ? `The operation needs at most a ${needed} scale, and the configuration declares ${jointKind}.`
        : model.aggregation === 'product'
          ? 'Multiplication of two scales produces a quantity only when both have a true zero and meaningful ratios. On ranked labels the product is not even stable: renaming the top rung from 5 to 6 changes every score it appears in, and changes their order relative to scores it does not appear in.'
          : 'Addition requires that a one-level step means the same amount everywhere on the scale. An ordinal scale makes no such claim — and adding a frequency descriptor to a consequence descriptor has no unit even when it does.',
      assumption: `That the declared scale kind is correct. It is set in the scoring model and can be changed.`,
      evidence: `${placeable.length} rows scored; ${matrix.distinctScores.length} distinct score values across ${matrix.cells.length} cells.`,
      next: satisfied
        ? 'Nothing. This operation is not the source of any finding elsewhere in the audit.'
        : 'The score is still usable as a coarse sorting key. It is not usable as a magnitude, a budget weight, or an input to further arithmetic.',
    },
  })

  /* 2. Ranking by the score. ---------------------------------------------- */
  const indeterminateShare =
    counts.compared === 0 ? 0 : (counts.compared - counts.determinate) / counts.compared
  out.push({
    id: 'rank-by-score',
    title: 'Ordering risks by score',
    registerDoes: 'Risks are sorted by score to decide what is looked at first.',
    scaleMeans:
      'An order between two risks is supported by ordinal scales exactly when one is at least as high as the other on both axes.',
    requires: 'ordinal',
    state:
      counts.compared === 0
        ? 'insufficient-data'
        : indeterminateShare === 0
          ? 'supported'
          : 'ambiguous',
    affected: counts.compared - counts.determinate,
    explanation: {
      what:
        counts.compared === 0
          ? 'No pairs could be compared.'
          : `${(indeterminateShare * 100).toFixed(1)}% of ordered pairs are ranked by the score without the scales supporting the ranking.`,
      why: 'Those pairs cross: one risk is higher on likelihood, the other is higher on impact. Which one the score puts first depends entirely on the numbers chosen to name the levels, and a different but equally faithful set of names reverses it.',
      assumption: 'That the aggregation is non-decreasing in both axes, which all four configurable aggregations are.',
      evidence: `${counted(counts.compared)} ordered pairs compared; ${counted(counts.determinate)} determined by dominance; ${counted(counts.indeterminate)} crossing.`,
      next: 'Sort by dominance rather than by score where you can: it produces a partial order with genuine ties instead of a total order with invented ones.',
    },
  })

  /* 3. Treating a score gap as a magnitude. ------------------------------- */
  const topScore = matrix.distinctScores[matrix.distinctScores.length - 1] ?? 0
  const bottomScore = matrix.distinctScores[0] ?? 0
  out.push({
    id: 'score-difference',
    title: 'Reading a score gap as an amount of risk',
    registerDoes: `Scores range from ${bottomScore} to ${topScore}, inviting statements such as "this risk is ${bottomScore > 0 ? Math.round(topScore / bottomScore) : 0} times that one".`,
    scaleMeans:
      'A ratio of two ordinal scores is not a quantity. Neither is a difference, unless the scales are interval.',
    requires: 'ratio',
    state: kindSatisfies(jointKind, 'ratio') ? 'valid' : 'distorted',
    affected: matrix.distinctScores.length,
    explanation: {
      what: kindSatisfies(jointKind, 'ratio')
        ? 'The configured scales are ratio, so score ratios carry meaning.'
        : 'Differences and ratios between scores do not correspond to differences and ratios in risk.',
      why: `Under the relabelling 1, 2, 3, 4, 100 — which ranks the levels identically — the top score becomes ${topScore === 0 ? 0 : 100 * 100} and every ratio in the register changes. Nothing about the assessments changed.`,
      assumption: 'None beyond the declared scale kind.',
      evidence: `${matrix.distinctScores.length} distinct scores; ${scoreCollisions(matrix).length} of them shared by more than one cell.`,
      next: 'Where a ratio is genuinely needed — to size a budget, to compare against an appetite — that is the signal to quantify the risk rather than to score it.',
    },
  })

  /* 4. Evidence of further arithmetic in the register itself. ------------- */
  const arithmetic = detectDerivedArithmetic(register)
  if (arithmetic.count > 0) {
    out.push({
      id: 'average-levels',
      title: 'Arithmetic beyond the configured formula',
      registerDoes: arithmetic.description,
      scaleMeans:
        'An average of ranked labels is not a label. "Rare" and "Almost certain" have no midpoint on an ordinal scale, and the number that looks like one is a property of the naming.',
      requires: 'interval',
      state: kindSatisfies(jointKind, 'interval') ? 'valid' : 'distorted',
      affected: arithmetic.count,
      explanation: {
        what: `${arithmetic.count} row${arithmetic.count === 1 ? ' carries' : 's carry'} a score that the configured formula cannot produce from any pair of legal levels.`,
        why: 'The most common cause is a score column computed by a different rule — an average across assessors, a weighted blend, or a residual score after controls. Whichever it is, it is not the rule configured here, so nothing downstream of it should be read as if it were.',
        assumption: 'That the configured aggregation is the register\'s own.',
        evidence: arithmetic.evidence,
        next: 'Find out what the score column actually is. If it is an average of several assessments, the calibration analysis is the place to look at those assessments individually.',
      },
    })
  }

  /* 5. Band thresholds. --------------------------------------------------- */
  const bands = auditBands(register, matrix)
  if (bands) out.push(bands)

  return out
}

interface DerivedArithmetic {
  readonly count: number
  readonly description: string
  readonly evidence: string
}

/**
 * Looks for evidence that the register did arithmetic the configured model
 * does not describe.
 *
 * Two signals, both conservative:
 *   - a non-integer score, which a product or sum of integer levels cannot be;
 *   - a score that is not in the set of values the formula can produce.
 *
 * Neither proves averaging. Both prove that the score column is not the
 * formula configured here, which is the claim actually made.
 */
function detectDerivedArithmetic(register: RiskRegister): DerivedArithmetic {
  const { model } = register
  const achievable = new Set<number>()
  for (const l of levelValues(model.likelihood)) {
    for (const i of levelValues(model.impact)) achievable.add(scoreFor(model, l, i))
  }

  let fractional = 0
  let unreachable = 0
  const rows: number[] = []
  for (const risk of register.risks) {
    if (risk.statedScore === null) continue
    if (!Number.isInteger(risk.statedScore)) {
      fractional += 1
      rows.push(risk.rowNumber)
    } else if (!achievable.has(risk.statedScore)) {
      unreachable += 1
      rows.push(risk.rowNumber)
    }
  }

  const count = fractional + unreachable
  const parts: string[] = []
  if (fractional > 0) parts.push(`${fractional} row${fractional === 1 ? ' has' : 's have'} a fractional score`)
  if (unreachable > 0)
    parts.push(
      `${unreachable} row${unreachable === 1 ? ' has' : 's have'} a score the formula cannot reach`,
    )

  return {
    count,
    description:
      count === 0
        ? 'No evidence of arithmetic beyond the configured formula.'
        : `The score column contains values the configured formula cannot produce: ${parts.join(' and ')}.`,
    evidence:
      count === 0
        ? 'Every stated score matched a value the formula can produce.'
        : `Source rows ${rows.slice(0, 8).join(', ')}${rows.length > 8 ? ` and ${rows.length - 8} more` : ''}. Achievable score values: ${[...achievable].sort((a, b) => a - b).join(', ')}.`,
  }
}

/**
 * Whether the band boundaries separate what they claim to separate.
 *
 * A band says "everything in here is Moderate and everything above is High".
 * If the scales carry anchors, that claim is checkable: find pairs of cells in
 * adjacent bands whose annualised-loss ranges overlap. Every such pair is a
 * place where the band label asserts a difference the organisation's own
 * anchors do not support.
 *
 * Returns `undefined` when there are no bands or no anchors, rather than
 * inventing a verdict.
 */
function auditBands(register: RiskRegister, matrix: Matrix): OrdinalOperationFinding | undefined {
  const { model } = register
  if (model.bands.length < 2) return undefined
  const withAnchors = matrix.cells.filter((c) => c.anchoredAnnualLoss !== undefined)
  if (withAnchors.length === 0) {
    return {
      id: 'band-threshold',
      title: 'Cutting the score into named bands',
      registerDoes: `Scores are labelled ${model.bands.map((b) => `${b.label} (${b.min}–${b.max})`).join(', ')}.`,
      scaleMeans: 'A band boundary claims that everything above it is materially worse than everything below it.',
      requires: 'ordinal',
      state: 'insufficient-data',
      affected: 0,
      explanation: {
        what: 'Whether the band boundaries separate anything cannot be checked.',
        why: 'The claim is about quantities, and the scales carry no quantitative anchors to compare against.',
        assumption: 'None.',
        evidence: 'No level on either axis has an anchor range configured.',
        next: 'Add frequency and loss anchors to the scale levels. It is the single change that unlocks the most of this audit, and it is usually a half-day workshop rather than a project.',
      },
    }
  }

  const bandOf = (score: number): number =>
    model.bands.findIndex((b) => score >= b.min && score <= b.max)

  let overlaps = 0
  let totalPairs = 0
  let example: string | undefined
  for (const lower of withAnchors) {
    for (const higher of withAnchors) {
      const lb = bandOf(lower.score)
      const hb = bandOf(higher.score)
      if (lb < 0 || hb < 0 || hb !== lb + 1) continue
      totalPairs += 1
      const l = lower.anchoredAnnualLoss
      const h = higher.anchoredAnnualLoss
      if (!l || !h) continue
      if (l.hi > h.lo) {
        overlaps += 1
        if (!example) example = `${lower.key} (${model.bands[lb]?.label}) and ${higher.key} (${model.bands[hb]?.label})`
      }
    }
  }

  const share = totalPairs === 0 ? 0 : overlaps / totalPairs
  return {
    id: 'band-threshold',
    title: 'Cutting the score into named bands',
    registerDoes: `Scores are labelled ${model.bands.map((b) => `${b.label} (${b.min}–${b.max})`).join(', ')}.`,
    scaleMeans:
      'A band boundary claims that everything above it is materially worse than everything below it.',
    requires: 'ordinal',
    state: share === 0 ? 'supported' : share > 0.5 ? 'distorted' : 'ambiguous',
    affected: overlaps,
    explanation: {
      what:
        overlaps === 0
          ? 'Every adjacent band pair is separated by the configured anchors.'
          : `${overlaps} of ${totalPairs} adjacent-band cell pairs overlap in annualised loss.`,
      why: 'Two cells in adjacent bands whose anchor-implied loss ranges overlap can describe identical situations while carrying different band labels. The boundary between them is a property of where the score line was cut, not of the losses involved.',
      assumption: 'That the configured anchors describe what the levels mean.',
      evidence: example
        ? `For example ${example}. Compared across ${totalPairs} adjacent-band cell pairs with anchors.`
        : `Compared across ${totalPairs} adjacent-band cell pairs with anchors.`,
      next: 'Treat the band as a queue label rather than a threshold. Where an actual threshold is needed, the appetite figure in the decision view is the one to test against.',
    },
  }
}

/** Exposed for the methodology page and the tests. */
export function resolutionOf(cell: RiskCell): number | undefined {
  return spanOf(cell.anchoredAnnualLoss)
}
