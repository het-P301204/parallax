/**
 * The analyses, on constructed registers and on the shipped demo.
 *
 * Constructed registers for the properties that must hold in general; the demo
 * register for the claims the README makes about it, so a change that silently
 * alters the headline numbers fails CI rather than a screenshot.
 */

import { describe, expect, it } from 'vitest'
import { DEMO_REGISTER_CSV, DEMO_REGISTER_FILE } from '../demo-register.generated.ts'
import { analyse } from './report.ts'
import { importRegister } from './import.ts'
import { buildMatrix, rankByScore, scoreCollisions } from './matrix.ts'
import { defaultModel, validateScale, makeScale } from './scales.ts'
import { selectAnalysable } from './validate.ts'
import { TRIAGE_WEIGHTS } from './triage.ts'
import type { Interval, Risk, RiskRegister } from './types.ts'

function risk(
  id: string,
  likelihood: number | null,
  impact: number | null,
  extra: Partial<Risk> = {},
): Risk {
  return {
    id,
    title: id,
    likelihood,
    impact,
    statedScore: null,
    treatment: 'unknown',
    rowNumber: 2,
    ...extra,
  }
}

function register(risks: readonly Risk[]): RiskRegister {
  return {
    name: 'test',
    risks,
    model: defaultModel(5),
    sourceName: 'test.csv',
    importedRowCount: risks.length,
  }
}

const estimate = (f: Interval, m: Interval): Partial<Risk> => ({ frequency: f, magnitude: m })

/* -------------------------------------------------------------------------- */
/* Matrix                                                                     */
/* -------------------------------------------------------------------------- */

describe('buildMatrix', () => {
  it('draws every cell, including the empty ones', () => {
    const reg = register([risk('a', 3, 3)])
    const { matrix } = buildMatrix(reg, selectAnalysable(reg).placeable)
    expect(matrix.cells).toHaveLength(25)
    expect(matrix.cells.filter((c) => c.riskIds.length > 0)).toHaveLength(1)
  })

  it('computes a cell’s annualised-loss band from the two anchors at their extremes', () => {
    const reg = register([risk('a', 4, 3)])
    const { matrix } = buildMatrix(reg, selectAnalysable(reg).placeable)
    const cell = matrix.cells.find((c) => c.key === 'L4I3')
    // Likelihood 4 is 0.4–1.2 /yr; impact 3 is £100k–£500k.
    expect(cell?.anchoredAnnualLoss?.lo).toBeCloseTo(40_000)
    expect(cell?.anchoredAnnualLoss?.hi).toBeCloseTo(600_000)
  })

  it('reports the narrowest cell on the grid as the resolution floor', () => {
    const reg = register([risk('a', 3, 3)])
    const built = buildMatrix(reg, selectAnalysable(reg).placeable)
    expect(built.resolutionFloor).toBeGreaterThan(1)
    // Every cell of a typical corporate 5x5 is wider than an order of
    // magnitude. If this ever fails, the claim in the README has changed.
    expect(built.resolutionFloor).toBeGreaterThan(10)
  })

  it('keeps unplaceable rows out of the matrix and records why', () => {
    const reg = register([risk('a', 3, 3), risk('b', null, 2), risk('c', 9, 9)])
    const built = buildMatrix(reg, selectAnalysable(reg).placeable)
    expect(built.matrix.unplaced.map((u) => u.riskId).sort()).toEqual(['b', 'c'])
    expect(built.matrix.unplaced[0]?.reason.length).toBeGreaterThan(5)
  })
})

describe('rankByScore', () => {
  it('gives every member of a tie the same rank and skips the ones it used', () => {
    const ranks = rankByScore(new Map([['a', 16], ['b', 16], ['c', 9]]))
    expect(ranks.get('a')).toBe(1)
    expect(ranks.get('b')).toBe(1)
    expect(ranks.get('c')).toBe(3)
  })
})

describe('scoreCollisions', () => {
  it('finds the distinct cells that share a score under multiplication', () => {
    const reg = register([risk('a', 3, 3)])
    const { matrix } = buildMatrix(reg, selectAnalysable(reg).placeable)
    const groups = scoreCollisions(matrix)
    const twelve = groups.find((g) => g.includes('L3I4'))
    expect(twelve).toContain('L4I3')
  })
})

/* -------------------------------------------------------------------------- */
/* Scales                                                                     */
/* -------------------------------------------------------------------------- */

describe('validateScale', () => {
  it('accepts the shipped presets', () => {
    expect(validateScale(defaultModel(5).likelihood)).toEqual([])
    expect(validateScale(defaultModel(3).impact)).toEqual([])
  })

  it('rejects duplicate level values', () => {
    const scale = makeScale('likelihood', [
      { value: 1, label: 'a' },
      { value: 1, label: 'b' },
    ])
    expect(validateScale(scale).length).toBeGreaterThan(0)
  })

  it('rejects an anchor of zero, which cannot be multiplied or logged', () => {
    const scale = makeScale('impact', [
      { value: 1, label: 'a', anchor: { lo: 0, hi: 10 } },
      { value: 2, label: 'b', anchor: { lo: 10, hi: 20 } },
    ])
    expect(validateScale(scale)[0]?.message).toMatch(/strictly positive/)
  })

  it('rejects anchors that disagree with the ranking', () => {
    const scale = makeScale('impact', [
      { value: 1, label: 'a', anchor: { lo: 100, hi: 200 } },
      { value: 2, label: 'b', anchor: { lo: 10, hi: 20 } },
    ])
    expect(validateScale(scale).some((p) => /starts below/.test(p.message))).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* Compression                                                                */
/* -------------------------------------------------------------------------- */

describe('compression', () => {
  it('reports a cell with no estimated members as ambiguous rather than distorted', () => {
    // Nothing in the register distinguishes them, so nothing is claimed to.
    const report = analyse(register([risk('a', 4, 3), risk('b', 4, 3)]))
    const cell = report.compression.find((c) => c.cellKey === 'L4I3')
    expect(cell?.estimatedCount).toBe(0)
    expect(cell?.estimateSpan).toBeUndefined()
    expect(cell?.state).not.toBe('distorted')
  })

  it('reports a cell as distorted when its estimated members provably differ', () => {
    const report = analyse(
      register([
        risk('a', 4, 3, estimate({ lo: 0.4, hi: 1.2 }, { lo: 400_000, hi: 500_000 })),
        risk('b', 4, 3, estimate({ lo: 0.4, hi: 1.2 }, { lo: 4_000, hi: 5_000 })),
      ]),
    )
    const cell = report.compression.find((c) => c.cellKey === 'L4I3')
    expect(cell?.estimatedCount).toBe(2)
    expect(cell?.estimateSpan).toBeGreaterThan(4)
    expect(cell?.state).toBe('distorted')
  })

  it('marks a cell that straddles the appetite as requiring quantification', () => {
    // L4I3 is anchored £40k–£600k; the default appetite is £250k.
    const report = analyse(register([risk('a', 4, 3)]))
    const cell = report.compression.find((c) => c.cellKey === 'L4I3')
    expect(cell?.straddlesAppetite).toBe(true)
    expect(cell?.state).toBe('requires-quantification')
  })

  it('reports insufficient data when the scales carry no anchors', () => {
    const bare = defaultModel(5)
    const stripped = {
      ...bare,
      likelihood: makeScale('likelihood', bare.likelihood.levels.map((l) => ({ value: l.value, label: l.label }))),
      impact: makeScale('impact', bare.impact.levels.map((l) => ({ value: l.value, label: l.label }))),
    }
    const report = analyse({ ...register([risk('a', 4, 3), risk('b', 4, 3)]), model: stripped })
    const cell = report.compression.find((c) => c.cellKey === 'L4I3')
    expect(cell?.state).toBe('insufficient-data')
    expect(report.summary.resolutionFloor).toBeUndefined()
  })
})

/* -------------------------------------------------------------------------- */
/* Inversion                                                                  */
/* -------------------------------------------------------------------------- */

describe('inversion', () => {
  it('confirms an inversion only when the intervals do not overlap', () => {
    const report = analyse(
      register([
        // Scored 16, but estimated at once every few decades for a modest loss.
        risk('high', 4, 4, estimate({ lo: 0.02, hi: 0.08 }, { lo: 300_000, hi: 900_000 })),
        // Scored 9, but several times a year at six figures each.
        risk('low', 3, 3, estimate({ lo: 2, hi: 6 }, { lo: 80_000, hi: 240_000 })),
      ]),
    )
    const finding = report.inversions.find((i) => i.higherId === 'high' && i.lowerId === 'low')
    expect(finding?.status).toBe('confirmed-under-model')
    expect(finding?.exceedanceProbability).toBeGreaterThan(0.5)
  })

  it('reports an overlapping pair as a candidate, not as confirmed', () => {
    const report = analyse(
      register([
        risk('high', 4, 4, estimate({ lo: 0.2, hi: 2 }, { lo: 100_000, hi: 900_000 })),
        risk('low', 3, 3, estimate({ lo: 0.5, hi: 3 }, { lo: 150_000, hi: 800_000 })),
      ]),
    )
    const finding = report.inversions.find((i) => i.higherId === 'high' && i.lowerId === 'low')
    expect(finding?.status).toBe('candidate')
  })

  it('never reports a pair whose modelled order agrees with the register', () => {
    const report = analyse(
      register([
        risk('high', 5, 5, estimate({ lo: 2, hi: 6 }, { lo: 3_000_000, hi: 20_000_000 })),
        risk('low', 1, 1, estimate({ lo: 0.01, hi: 0.05 }, { lo: 2_000, hi: 20_000 })),
      ]),
    )
    expect(report.inversions).toHaveLength(0)
  })

  it('states the independence assumption on every finding', () => {
    const report = analyse(
      register([
        risk('high', 4, 4, estimate({ lo: 0.02, hi: 0.08 }, { lo: 300_000, hi: 900_000 })),
        risk('low', 3, 3, estimate({ lo: 2, hi: 6 }, { lo: 80_000, hi: 240_000 })),
      ]),
    )
    for (const finding of report.inversions) {
      expect(finding.explanation.assumption).toMatch(/independent/)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Calibration                                                                */
/* -------------------------------------------------------------------------- */

describe('calibration', () => {
  const group = (category: string, assessor: string, likelihood: number, n: number): Risk[] =>
    Array.from({ length: n }, (_, i) =>
      risk(`${category}-${assessor}-${i}`, likelihood, 3, { category, assessor }),
    )

  it('reports insufficient data when nobody shares a peer group', () => {
    const report = analyse(register([...group('A', 'solo', 4, 4)]))
    expect(report.calibration.state).toBe('insufficient-data')
  })

  const spread = (category: string, assessor: string, levels: readonly number[]): Risk[] =>
    levels.map((level, i) => risk(`${category}-${assessor}-${i}`, level, 3, { category, assessor }))

  it('finds a systematic offset and calls it variation, never error', () => {
    const risks = ['A', 'B', 'C', 'D'].flatMap((category) => [
      ...spread(category, 'high', [4, 5, 5, 5, 4, 5]),
      ...spread(category, 'base', [2, 3, 3, 3, 2, 3]),
    ])
    const report = analyse(register(risks))
    const high = report.calibration.assessors.find((a) => a.assessor === 'high')
    expect(high?.likelihoodOffset).toBe(2)
    expect(high?.pValue).toBeLessThan(0.01)
    expect(high?.state).toBe('inconsistent')
    // The words "wrong" and "error" do appear — in the sentence that says this
    // is not one. What must never appear is the accusation itself.
    const prose = `${high?.explanation.what} ${high?.explanation.next}`
    expect(prose).not.toMatch(/\b(is|are|was|were)\s+(wrong|incorrect|mistaken)\b/i)
    expect(prose).not.toMatch(/\bover-?(scores|scored|states)\b/i)
    expect(prose).toMatch(/calibration variation/i)
    expect(prose).toMatch(/no ground truth/i)
  })

  it('reports a degenerate peer group as ambiguous rather than significant', () => {
    // Every risk in a group scored identically by each assessor. The median is
    // a threshold statistic, so on a two-valued sample a permuted split lands
    // on the same two medians about half the time however many rows there are
    // -- the test genuinely has no power here, and says so instead of
    // manufacturing a p-value. See the note in calibration.ts.
    const risks = ['A', 'B', 'C'].flatMap((category) => [
      ...group(category, 'high', 5, 8),
      ...group(category, 'base', 3, 8),
    ])
    const report = analyse(register(risks))
    const high = report.calibration.assessors.find((a) => a.assessor === 'high')
    expect(high?.likelihoodOffset).toBe(2)
    expect(high?.pValue).toBeGreaterThan(0.05)
    expect(high?.state).toBe('ambiguous')
  })

  it('does not quote a p-value below the observation threshold', () => {
    const risks = [
      ...group('A', 'high', 5, 2),
      ...group('A', 'base', 3, 2),
      ...group('B', 'high', 5, 2),
      ...group('B', 'base', 3, 2),
    ]
    const report = analyse(register(risks))
    const high = report.calibration.assessors.find((a) => a.assessor === 'high')
    expect(high?.observations).toBeLessThan(6)
    expect(high?.pValue).toBeUndefined()
    expect(high?.state).toBe('ambiguous')
  })

  it('is deterministic despite using a permutation test', () => {
    const risks = [
      ...group('A', 'high', 5, 5),
      ...group('A', 'base', 3, 5),
      ...group('B', 'high', 4, 5),
      ...group('B', 'base', 2, 5),
    ]
    const first = analyse(register(risks)).calibration.assessors
    const second = analyse(register(risks)).calibration.assessors
    expect(first.map((a) => a.pValue)).toEqual(second.map((a) => a.pValue))
  })
})

/* -------------------------------------------------------------------------- */
/* Triage                                                                     */
/* -------------------------------------------------------------------------- */

describe('triage', () => {
  it('publishes weights that sum to one', () => {
    const total = Object.values(TRIAGE_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('scores every risk with all six components and a matching total', () => {
    const report = analyse(register([risk('a', 4, 3), risk('b', 2, 2)]))
    for (const candidate of report.triaged) {
      expect(candidate.components).toHaveLength(6)
      const total = candidate.components.reduce((sum, c) => sum + c.value * c.weight, 0)
      expect(candidate.priority).toBeCloseTo(total, 10)
      for (const component of candidate.components) {
        expect(component.value).toBeGreaterThanOrEqual(0)
        expect(component.value).toBeLessThanOrEqual(1)
        expect(component.detail.length).toBeGreaterThan(10)
      }
    }
  })

  it('does not simply rank by score', () => {
    const report = analyse(
      register([
        // Top of the matrix, already decided, no ambiguity about acting.
        risk('top', 5, 5, { treatment: 'accept' }),
        // Mid-matrix, straddles the appetite, money being committed.
        risk('middle', 4, 3, {
          treatment: 'mitigate',
          ...estimate({ lo: 0.4, hi: 2 }, { lo: 90_000, hi: 900_000 }),
        }),
      ]),
    )
    const top = report.triaged.find((c) => c.riskId === 'top')
    const middle = report.triaged.find((c) => c.riskId === 'middle')
    expect(middle?.priority).toBeGreaterThan(top?.priority ?? 1)
  })
})

/* -------------------------------------------------------------------------- */
/* The demo register                                                          */
/* -------------------------------------------------------------------------- */

describe('the demo register', () => {
  const built = importRegister(DEMO_REGISTER_FILE, DEMO_REGISTER_CSV, defaultModel(5))
  const report = analyse(built.register, built.issues)

  it('imports every row', () => {
    expect(report.summary.risksImported).toBe(126)
  })

  it('demonstrates each finding the product claims to make', () => {
    expect(report.summary.risksExcluded).toBeGreaterThan(0)
    expect(report.summary.indeterminatePairs).toBeGreaterThan(0)
    expect(report.summary.confirmedInversions).toBeGreaterThan(0)
    expect(report.summary.compressedCells).toBeGreaterThan(0)
    expect(report.summary.quantificationShortlist).toBeGreaterThan(0)
    expect(report.calibration.assessors.some((a) => a.state === 'inconsistent')).toBe(true)
    expect(report.dataQuality.length).toBeGreaterThan(5)
  })

  it('shortlists risks the register itself does not rank highest', () => {
    // If this were zero the triage would be an expensive re-sort of one column.
    const shortlist = new Set(report.quantification.map((q) => q.riskId))
    const topByScore = new Set(
      [...report.scoreById.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, shortlist.size)
        .map(([id]) => id),
    )
    const outside = [...shortlist].filter((id) => !topByScore.has(id))
    expect(outside.length).toBeGreaterThan(0)
  })

  it('produces an identical report from an identical file', () => {
    const again = analyse(
      importRegister(DEMO_REGISTER_FILE, DEMO_REGISTER_CSV, defaultModel(5)).register,
      built.issues,
    )
    expect(again.summary).toEqual(report.summary)
    expect(again.confidence).toEqual(report.confidence)
    expect(again.quantification.map((q) => q.riskId)).toEqual(
      report.quantification.map((q) => q.riskId),
    )
  })

  it('gives every finding a complete explanation', () => {
    const explanations = [
      ...report.dataQuality.map((f) => f.explanation),
      ...report.ordinal.operations.map((o) => o.explanation),
      ...report.compression.map((c) => c.explanation),
      ...report.inversions.map((i) => i.explanation),
      ...report.calibration.assessors.map((a) => a.explanation),
      ...report.quantification.map((q) => q.explanation),
      report.ordinal.explanation,
      report.calibration.explanation,
    ]
    expect(explanations.length).toBeGreaterThan(50)
    for (const explanation of explanations) {
      for (const part of ['what', 'why', 'evidence', 'next'] as const) {
        expect(explanation[part].trim().length, part).toBeGreaterThan(8)
      }
      // `assumption` is allowed to be short, because the shortest honest
      // answer to "what did you assume?" is "None." and a product that
      // padded it would be padding the one field that must be read literally.
      expect(explanation.assumption.trim().length, 'assumption').toBeGreaterThan(3)
    }
  })

  it('never claims a true risk', () => {
    const prose = JSON.stringify([
      report.ordinal,
      report.compression,
      report.inversions,
      report.calibration,
      report.quantification,
    ])
    expect(prose).not.toMatch(/\btrue risk\b/i)
    expect(prose).not.toMatch(/\bactual risk\b/i)
  })
})
