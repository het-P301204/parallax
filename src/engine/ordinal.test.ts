/**
 * The measurement audit's own proofs.
 *
 * The witness test is the one that matters: it does not check that the code
 * produces *a* relabelling, it checks that the relabelling it produces is
 * legal — strictly increasing on both axes — and that the register's own
 * scoring formula, applied to it, reverses the pair. If that held only by
 * accident the product's central claim would be decoration.
 */

import { describe, expect, it } from 'vitest'
import { auditOrdinal, compareCells, witnessRelabelling } from './ordinal.ts'
import { buildMatrix } from './matrix.ts'
import { defaultModel, levelValues, scoreFor } from './scales.ts'
import { selectAnalysable } from './validate.ts'
import type { Risk, RiskRegister, ScoringModel } from './types.ts'

function risk(id: string, likelihood: number, impact: number): Risk {
  return {
    id,
    title: id,
    likelihood,
    impact,
    statedScore: null,
    treatment: 'unknown',
    rowNumber: 2,
  }
}

function register(risks: readonly Risk[], model: ScoringModel = defaultModel(5)): RiskRegister {
  return { name: 'test', risks, model, sourceName: 'test.csv', importedRowCount: risks.length }
}

function audit(risks: readonly Risk[], model: ScoringModel = defaultModel(5)) {
  const reg = register(risks, model)
  const { placeable } = selectAnalysable(reg)
  const built = buildMatrix(reg, placeable)
  return auditOrdinal({
    register: reg,
    matrix: built.matrix,
    placeable,
    scoreById: built.scoreById,
  })
}

describe('compareCells', () => {
  it('recognises dominance in both directions', () => {
    expect(compareCells(4, 4, 3, 3)).toBe('a-dominates')
    expect(compareCells(3, 3, 4, 4)).toBe('b-dominates')
    expect(compareCells(4, 3, 4, 3)).toBe('equal')
  })

  it('treats a tie on one axis as dominance, not incomparability', () => {
    expect(compareCells(4, 3, 4, 2)).toBe('a-dominates')
  })

  it('recognises a crossing pair as incomparable', () => {
    expect(compareCells(5, 2, 2, 5)).toBe('incomparable')
    expect(compareCells(4, 1, 1, 3)).toBe('incomparable')
  })
})

describe('witnessRelabelling', () => {
  const strictlyIncreasing = (values: readonly number[]): boolean =>
    values.every((v, i) => i === 0 || v > (values[i - 1] as number))

  for (const aggregation of ['product', 'sum', 'max'] as const) {
    it(`produces a legal, order-reversing relabelling under ${aggregation}`, () => {
      const model: ScoringModel = { ...defaultModel(5), aggregation }
      const lLevels = levelValues(model.likelihood)
      const iLevels = levelValues(model.impact)

      let checked = 0
      for (const aL of lLevels) {
        for (const aI of iLevels) {
          for (const bL of lLevels) {
            for (const bI of iLevels) {
              const aScore = scoreFor(model, aL, aI)
              const bScore = scoreFor(model, bL, bI)
              if (!(aScore > bScore)) continue
              if (compareCells(aL, aI, bL, bI) !== 'incomparable') continue

              const witness = witnessRelabelling(model, aL, aI, bL, bI)
              expect(witness, `no witness for ${aL}x${aI} over ${bL}x${bI}`).not.toBeNull()
              if (!witness) continue

              // Legal: both relabellings preserve the order of the rungs.
              expect(strictlyIncreasing(witness.likelihood)).toBe(true)
              expect(strictlyIncreasing(witness.impact)).toBe(true)
              // Same number of rungs: a relabelling renames, it does not add.
              expect(witness.likelihood).toHaveLength(lLevels.length)
              expect(witness.impact).toHaveLength(iLevels.length)
              // And it reverses the pair under the register's own formula.
              expect(witness.bScore).toBeGreaterThan(witness.aScore)
              checked += 1
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(10)
    })
  }

  it('returns null for a lookup table, where relabelling changes nothing', () => {
    const model: ScoringModel = { ...defaultModel(5), aggregation: 'lookup' }
    expect(witnessRelabelling(model, 5, 2, 2, 5)).toBeNull()
  })
})

describe('auditOrdinal', () => {
  it('counts every dominating pair as determinate', () => {
    // A chain: each dominates the next, so nothing is indeterminate.
    const result = audit([risk('a', 5, 5), risk('b', 4, 4), risk('c', 3, 3)])
    expect(result.comparedPairs).toBe(3)
    expect(result.determinatePairs).toBe(3)
    expect(result.indeterminateCount).toBe(0)
    expect(result.state).toBe('supported')
  })

  it('counts a crossing pair as indeterminate and supplies a witness', () => {
    const result = audit([risk('a', 5, 2), risk('b', 2, 4)])
    // 5x2 = 10 > 2x4 = 8, and neither dominates.
    expect(result.comparedPairs).toBe(1)
    expect(result.indeterminateCount).toBe(1)
    expect(result.indeterminatePairs[0]?.aId).toBe('a')
    expect(result.indeterminatePairs[0]?.witness.bScore).toBeGreaterThan(
      result.indeterminatePairs[0]?.witness.aScore ?? 0,
    )
  })

  it('weights pair counts by cell occupancy rather than counting cells', () => {
    // Three risks in one cell, two in another; 3 x 2 = 6 ordered pairs.
    const result = audit([
      risk('a1', 5, 2),
      risk('a2', 5, 2),
      risk('a3', 5, 2),
      risk('b1', 2, 4),
      risk('b2', 2, 4),
    ])
    expect(result.comparedPairs).toBe(6)
    expect(result.indeterminateCount).toBe(6)
  })

  it('never compares two risks in the same cell', () => {
    const result = audit([risk('a', 3, 3), risk('b', 3, 3)])
    expect(result.comparedPairs).toBe(0)
    expect(result.state).toBe('insufficient-data')
  })

  it('flags multiplication of ordinal scales as distorted', () => {
    const result = audit([risk('a', 4, 4), risk('b', 2, 2)])
    const aggregate = result.operations.find((o) => o.id === 'aggregate')
    expect(aggregate?.state).toBe('distorted')
    expect(aggregate?.requires).toBe('ratio')
  })

  it('accepts multiplication when the scales are declared ratio', () => {
    const base = defaultModel(5)
    const model: ScoringModel = {
      ...base,
      likelihood: { ...base.likelihood, kind: 'ratio' },
      impact: { ...base.impact, kind: 'ratio' },
    }
    const result = audit([risk('a', 4, 4), risk('b', 2, 2)], model)
    expect(result.operations.find((o) => o.id === 'aggregate')?.state).toBe('valid')
    expect(result.operations.find((o) => o.id === 'score-difference')?.state).toBe('valid')
  })

  it('accepts max as an ordinal-safe aggregation', () => {
    const model: ScoringModel = { ...defaultModel(5), aggregation: 'max' }
    const result = audit([risk('a', 4, 4), risk('b', 2, 2)], model)
    expect(result.operations.find((o) => o.id === 'aggregate')?.state).toBe('valid')
  })

  it('finds the cells that share a score under multiplication', () => {
    // 2x5 and 5x2 both score 10 on a 5x5 product matrix.
    const result = audit([risk('a', 2, 5), risk('b', 5, 2)])
    expect(result.collidingCells.some((group) => group.length > 1)).toBe(true)
  })

  it('gives every operation all five parts of an explanation', () => {
    const result = audit([risk('a', 5, 2), risk('b', 2, 4)])
    for (const operation of result.operations) {
      for (const part of ['what', 'why', 'assumption', 'evidence', 'next'] as const) {
        expect(operation.explanation[part].length, `${operation.id}.${part}`).toBeGreaterThan(10)
      }
    }
  })
})
