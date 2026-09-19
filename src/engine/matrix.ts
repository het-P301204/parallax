/**
 * Building the matrix.
 *
 * Nothing here assumes five by five. The axes come from the configured scale's
 * level values, the score of a cell comes from the configured aggregation, and
 * the annualised-loss band of a cell comes from the configured anchors or is
 * absent. A 3x4 register with a lookup table and no anchors produces a valid
 * matrix with fewer conclusions attached, which is the correct behaviour.
 *
 * The one number in this file worth arguing about is `resolutionFloor`: the
 * narrowest annualised-loss band any cell of the matrix has. It is the
 * matrix's *resolving power* — the smallest difference in annualised loss that
 * the scoring system is capable of noticing anywhere on the grid. For a
 * typical corporate 5x5 it is over an order of magnitude, and that single
 * number explains most of what the rest of the product goes on to find.
 */

import { cellAnnualLoss, bandFor, hasAnchors, levelValues, scoreFor, spanOf } from './scales.ts'
import { distinct } from './stats.ts'
import type { Matrix, Risk, RiskCell, RiskRegister } from './types.ts'

export interface MatrixBuild {
  readonly matrix: Matrix
  /** Computed score per placed risk. */
  readonly scoreById: Map<string, number>
  /** 1-based rank by descending score; ties share the better rank. */
  readonly rankById: Map<string, number>
  /** Cell key per placed risk. */
  readonly cellById: Map<string, string>
  /**
   * The narrowest cell band on the grid, as a ratio. Undefined when the
   * scales carry no anchors.
   */
  readonly resolutionFloor?: number
  /** Cell key of the narrowest band, for citing it. */
  readonly resolutionFloorCell?: string
}

export function cellKey(likelihood: number, impact: number): string {
  return `L${likelihood}I${impact}`
}

export function parseCellKey(key: string): { likelihood: number; impact: number } | null {
  const match = /^L(\d+)I(\d+)$/.exec(key)
  if (!match) return null
  return { likelihood: Number(match[1]), impact: Number(match[2]) }
}

/**
 * Builds every cell of the grid, including empty ones.
 *
 * Empty cells are kept because the matrix view has to draw them, and because
 * an *unused* cell is itself information: a register whose risks occupy eleven
 * of twenty-five cells is using a five-point scale to express eleven distinct
 * judgements.
 */
export function buildMatrix(register: RiskRegister, placeable: readonly Risk[]): MatrixBuild {
  const { model } = register
  const likelihoodLevels = levelValues(model.likelihood)
  const impactLevels = levelValues(model.impact)
  const anchored = hasAnchors(model.likelihood) && hasAnchors(model.impact)

  const members = new Map<string, string[]>()
  const cellById = new Map<string, string>()
  const scoreById = new Map<string, number>()

  for (const risk of placeable) {
    const l = risk.likelihood as number
    const i = risk.impact as number
    const key = cellKey(l, i)
    cellById.set(risk.id, key)
    scoreById.set(risk.id, scoreFor(model, l, i))
    const bucket = members.get(key)
    if (bucket) bucket.push(risk.id)
    else members.set(key, [risk.id])
  }

  const cells: RiskCell[] = []
  let resolutionFloor: number | undefined
  let resolutionFloorCell: string | undefined

  for (const impact of impactLevels) {
    for (const likelihood of likelihoodLevels) {
      const key = cellKey(likelihood, impact)
      const score = scoreFor(model, likelihood, impact)
      const anchoredAnnualLoss = anchored ? cellAnnualLoss(model, likelihood, impact) : undefined
      const span = spanOf(anchoredAnnualLoss)
      if (span !== undefined && (resolutionFloor === undefined || span < resolutionFloor)) {
        resolutionFloor = span
        resolutionFloorCell = key
      }
      cells.push({
        key,
        likelihood,
        impact,
        score,
        band: bandFor(model, score),
        riskIds: members.get(key) ?? [],
        anchoredAnnualLoss,
      })
    }
  }

  const unplaced = register.risks
    .filter((r) => !cellById.has(r.id))
    .map((r) => ({
      riskId: r.id,
      reason:
        r.likelihood === null && r.impact === null
          ? 'Neither level could be read.'
          : r.likelihood === null
            ? 'No likelihood level.'
            : r.impact === null
              ? 'No impact level.'
              : 'Level outside the configured scale.',
    }))

  const matrix: Matrix = {
    likelihoodLevels,
    impactLevels,
    cells,
    unplaced,
    distinctScores: distinct(cells.map((c) => c.score)).sort((a, b) => a - b),
  }

  return {
    matrix,
    scoreById,
    rankById: rankByScore(scoreById),
    cellById,
    resolutionFloor,
    resolutionFloorCell,
  }
}

/**
 * Standard competition ranking: sort descending by score, and every member of
 * a tie gets the rank of the first of them. Thirty risks tied at score 16 are
 * all rank 1, and the next distinct score is rank 31.
 *
 * The size of those tie groups is not an implementation detail — it is the
 * measurement finding the ranking view leads with.
 */
export function rankByScore(scoreById: ReadonlyMap<string, number>): Map<string, number> {
  const entries = [...scoreById.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const ranks = new Map<string, number>()
  let rank = 0
  let previous: number | undefined
  entries.forEach(([id, score], index) => {
    if (previous === undefined || score !== previous) {
      rank = index + 1
      previous = score
    }
    ranks.set(id, rank)
  })
  return ranks
}

/** Cells holding at least one risk, densest first. */
export function occupiedCells(matrix: Matrix): RiskCell[] {
  return matrix.cells
    .filter((c) => c.riskIds.length > 0)
    .sort((a, b) => b.riskIds.length - a.riskIds.length || b.score - a.score)
}

/**
 * Groups of distinct cells that share a score.
 *
 * Under a product aggregation these are everywhere: 2×6, 3×4 and 4×3 all score
 * 12, and a register that ranks by score therefore treats "unlikely but
 * catastrophic" and "frequent but minor" as the same risk. The grouping is
 * computed rather than hard-coded so it holds for any aggregation the user
 * configures — under `max` it produces large groups, under a well-chosen
 * lookup table it may produce none.
 */
export function scoreCollisions(matrix: Matrix): string[][] {
  const byScore = new Map<number, string[]>()
  for (const cell of matrix.cells) {
    const bucket = byScore.get(cell.score)
    if (bucket) bucket.push(cell.key)
    else byScore.set(cell.score, [cell.key])
  }
  return [...byScore.values()]
    .filter((group) => group.length > 1)
    .sort((a, b) => b.length - a.length)
}

/** Lookup helper the views use constantly. */
export function cellMap(matrix: Matrix): Map<string, RiskCell> {
  return new Map(matrix.cells.map((c) => [c.key, c]))
}
