/**
 * The simulation.
 *
 * Determinism first, because every quantitative claim the product makes rests
 * on it: the CLI, the browser and this file must agree, and a reader has to be
 * able to reproduce a percentile they are about to quote in a paper.
 *
 * Then the statistical properties that would be silently wrong if the fit were
 * mis-derived — a lognormal fitted to the wrong percentiles still produces a
 * plausible-looking chart.
 */

import { describe, expect, it } from 'vitest'
import { compareModels, defaultSeed, exceedanceAt, simulate } from './simulate.ts'
import { createRng, lognormalParams, poisson, seedFrom, standardNormal } from './rng.ts'
import { annualLossBounds, buildModel, centralAnnualLoss } from './intervals.ts'
import { defaultModel } from './scales.ts'
import { mean, median, quantile } from './stats.ts'
import type { QuantitativeModel, Risk, RiskRegister } from './types.ts'

const model: QuantitativeModel = {
  riskId: 'R-1',
  frequency: { lo: 0.5, hi: 3 },
  magnitude: { lo: 50_000, hi: 500_000 },
  frequencySource: 'register-estimate',
  magnitudeSource: 'register-estimate',
  currency: 'GBP',
  assumptions: [],
}

describe('rng', () => {
  it('is reproducible from a seed', () => {
    const a = createRng(42)
    const b = createRng(42)
    const first = Array.from({ length: 50 }, () => a.next())
    const second = Array.from({ length: 50 }, () => b.next())
    expect(first).toEqual(second)
  })

  it('produces different streams from different seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next())
  })

  it('stays in [0, 1)', () => {
    const rng = createRng(7)
    for (let i = 0; i < 5000; i += 1) {
      const value = rng.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('derives a stable seed from a string', () => {
    expect(seedFrom('R-014')).toBe(seedFrom('R-014'))
    expect(seedFrom('R-014')).not.toBe(seedFrom('R-015'))
  })

  it('generates a standard normal with the right first two moments', () => {
    const rng = createRng(11)
    const draws = Array.from({ length: 40_000 }, () => standardNormal(rng))
    expect(mean(draws)).toBeCloseTo(0, 1)
    const variance = mean(draws.map((v) => v * v))
    expect(variance).toBeCloseTo(1, 1)
  })

  it('generates Poisson counts with the right mean, small and large', () => {
    for (const lambda of [0.3, 4, 45]) {
      const rng = createRng(3)
      const draws = Array.from({ length: 20_000 }, () => poisson(rng, lambda))
      expect(mean(draws)).toBeCloseTo(lambda, lambda < 1 ? 1 : 0)
      expect(Math.min(...draws)).toBeGreaterThanOrEqual(0)
    }
  })

  it('returns zero for a non-positive rate rather than looping', () => {
    expect(poisson(createRng(1), 0)).toBe(0)
    expect(poisson(createRng(1), -1)).toBe(0)
  })
})

describe('lognormalParams', () => {
  it('fits the supplied bounds as the 5th and 95th percentiles', () => {
    const { mu, sigma } = lognormalParams(50_000, 500_000)
    const rng = createRng(5)
    const draws = Array.from({ length: 60_000 }, () => Math.exp(mu + sigma * standardNormal(rng)))
    expect(quantile(draws, 0.05) / 50_000).toBeGreaterThan(0.9)
    expect(quantile(draws, 0.05) / 50_000).toBeLessThan(1.1)
    expect(quantile(draws, 0.95) / 500_000).toBeGreaterThan(0.9)
    expect(quantile(draws, 0.95) / 500_000).toBeLessThan(1.1)
    // The median of a lognormal is exp(mu), the geometric mean of the bounds.
    // Asserted as a ratio: an absolute tolerance on a six-figure quantity
    // estimated from 60,000 draws would be testing the sampling error.
    expect(median(draws) / Math.sqrt(50_000 * 500_000)).toBeCloseTo(1, 1)
  })

  it('collapses to a point when the bounds are equal', () => {
    expect(lognormalParams(100, 100).sigma).toBe(0)
  })
})

describe('simulate', () => {
  it('is reproducible', () => {
    const a = simulate(model, { iterations: 5000, seed: 99 })
    const b = simulate(model, { iterations: 5000, seed: 99 })
    expect(a.summary).toEqual(b.summary)
    expect(a.exceedance).toEqual(b.exceedance)
  })

  it('uses a seed derived from the risk id when none is given', () => {
    expect(simulate(model, { iterations: 2000 }).seed).toBe(defaultSeed('R-1'))
  })

  it('produces ordered percentiles', () => {
    const { summary } = simulate(model, { iterations: 20_000, seed: 1 })
    expect(summary.p10).toBeLessThanOrEqual(summary.p50)
    expect(summary.p50).toBeLessThanOrEqual(summary.p90)
    expect(summary.p90).toBeLessThanOrEqual(summary.p95)
    expect(summary.p95).toBeLessThanOrEqual(summary.p99)
    expect(summary.p99).toBeLessThanOrEqual(summary.max)
  })

  it('puts the mean above the median, as a right-skewed loss must', () => {
    const { summary } = simulate(model, { iterations: 20_000, seed: 2 })
    expect(summary.mean).toBeGreaterThan(summary.p50)
  })

  it('lands inside the analytic bounds it was built from', () => {
    const { summary } = simulate(model, { iterations: 20_000, seed: 3 })
    const bounds = annualLossBounds(model)
    // The analytic band is the product of the extremes, so a simulated median
    // must sit well inside it. If it does not, the fit is wrong.
    expect(summary.p50).toBeGreaterThan(bounds.lo / 20)
    expect(summary.p50).toBeLessThan(bounds.hi)
  })

  it('reports a zero share for a risk that rarely happens at all', () => {
    const rare: QuantitativeModel = { ...model, frequency: { lo: 0.001, hi: 0.01 } }
    const { summary } = simulate(rare, { iterations: 20_000, seed: 4 })
    expect(summary.zeroShare).toBeGreaterThan(0.9)
    expect(summary.p50).toBe(0)
  })

  it('clamps iterations to a usable range', () => {
    expect(simulate(model, { iterations: 1 }).iterations).toBe(1000)
    expect(simulate(model, { iterations: 10_000_000 }).iterations).toBe(200_000)
  })

  it('never emits an exceedance point resting on fewer than five years', () => {
    const result = simulate(model, { iterations: 5000, seed: 6 })
    for (const point of result.exceedance) {
      expect(point.probability).toBeGreaterThanOrEqual(5 / 5000 - 1e-12)
    }
  })

  it('produces a monotonically decreasing exceedance curve', () => {
    const { exceedance } = simulate(model, { iterations: 20_000, seed: 7 })
    for (let i = 1; i < exceedance.length; i += 1) {
      const previous = exceedance[i - 1]
      const current = exceedance[i]
      if (!previous || !current) continue
      expect(current.probability).toBeLessThanOrEqual(previous.probability)
      expect(current.loss).toBeGreaterThanOrEqual(previous.loss)
    }
  })

  it('reports the probability of exceeding a configured appetite', () => {
    const result = simulate(model, { iterations: 20_000, seed: 8, appetite: 1 })
    // Practically every year with any loss exceeds £1.
    expect(result.probabilityOverAppetite).toBeCloseTo(1 - result.summary.zeroShare, 2)
  })

  it('buckets the histogram without losing iterations to rounding', () => {
    const result = simulate(model, { iterations: 20_000, seed: 9 })
    const counted = result.histogram.reduce((total, b) => total + b.count, 0)
    const nonZero = Math.round((1 - result.summary.zeroShare) * result.iterations)
    // Everything above the 99.5th percentile is deliberately outside the
    // drawn range; nothing else may go missing.
    expect(counted).toBeGreaterThan(nonZero * 0.985)
    expect(counted).toBeLessThanOrEqual(nonZero)
  })
})

describe('exceedanceAt', () => {
  it('reads the empirical survival function', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(exceedanceAt(sorted, 0)).toBe(1)
    expect(exceedanceAt(sorted, 5)).toBe(0.5)
    expect(exceedanceAt(sorted, 10)).toBe(0)
    expect(exceedanceAt(sorted, 100)).toBe(0)
  })
})

describe('compareModels', () => {
  it('is reproducible and points the right way', () => {
    const frequent = { lo: 6, hi: 15 }
    const small: QuantitativeModel = {
      ...model,
      riskId: 'small',
      frequency: frequent,
      magnitude: { lo: 1_000, hi: 5_000 },
    }
    const large: QuantitativeModel = {
      ...model,
      riskId: 'large',
      frequency: frequent,
      magnitude: { lo: 1e6, hi: 5e6 },
    }
    const a = compareModels(small, large, 4000, 1)
    const b = compareModels(small, large, 4000, 1)
    expect(a).toBe(b)
    expect(a).toBeGreaterThan(0.95)
    expect(compareModels(large, small, 4000, 1)).toBeLessThan(0.05)
  })

  it('is bounded by the probability that the challenger happens at all', () => {
    // A rare risk cannot exceed a common one in a year it does not occur, so
    // P(B > A) can never reach 1 however large B's losses are. Anyone reading
    // an exceedance probability needs this: 68% is not a weak result for a
    // risk that only happens in 72% of years.
    const rare = { lo: 0.5, hi: 3 }
    const small: QuantitativeModel = { ...model, riskId: 'small', magnitude: { lo: 1_000, hi: 5_000 } }
    const large: QuantitativeModel = {
      ...model,
      riskId: 'large',
      frequency: rare,
      magnitude: { lo: 1e6, hi: 5e6 },
    }
    const probability = compareModels(small, large, 8000, 1)
    const everHappens = 1 - simulate(large, { iterations: 8000, seed: 1 }).summary.zeroShare
    expect(probability).toBeLessThanOrEqual(everHappens + 0.02)
    expect(probability).toBeGreaterThan(0.5)
  })

  it('sits near a half for two identical models', () => {
    const one: QuantitativeModel = { ...model, riskId: 'one' }
    const two: QuantitativeModel = { ...model, riskId: 'two' }
    expect(compareModels(one, two, 20_000)).toBeGreaterThan(0.35)
    expect(compareModels(one, two, 20_000)).toBeLessThan(0.65)
  })
})

describe('buildModel', () => {
  const base = defaultModel(5)
  const register = (risk: Risk): RiskRegister => ({
    name: 't',
    risks: [risk],
    model: base,
    sourceName: 't.csv',
    importedRowCount: 1,
  })
  const risk = (extra: Partial<Risk>): Risk => ({
    id: 'R-1',
    title: 'R-1',
    likelihood: 4,
    impact: 3,
    statedScore: null,
    treatment: 'unknown',
    rowNumber: 2,
    ...extra,
  })

  it('prefers the register’s own estimate and says so', () => {
    const built = buildModel(
      register(risk({ frequency: { lo: 1, hi: 4 }, magnitude: { lo: 10, hi: 100 } })),
      risk({ frequency: { lo: 1, hi: 4 }, magnitude: { lo: 10, hi: 100 } }),
    )
    expect(built?.frequencySource).toBe('register-estimate')
    expect(built?.frequency).toEqual({ lo: 1, hi: 4 })
  })

  it('falls back to the cell anchors and labels the fallback', () => {
    const built = buildModel(register(risk({})), risk({}))
    expect(built?.frequencySource).toBe('scale-anchor')
    expect(built?.assumptions.join(' ')).toMatch(/describes the cell, not this risk/)
  })

  it('gives two un-estimated risks in one cell identical models', () => {
    const a = buildModel(register(risk({ id: 'a' })), risk({ id: 'a' }))
    const b = buildModel(register(risk({ id: 'b' })), risk({ id: 'b' }))
    expect(a?.frequency).toEqual(b?.frequency)
    expect(a?.magnitude).toEqual(b?.magnitude)
    expect(centralAnnualLoss(a as QuantitativeModel)).toBe(centralAnnualLoss(b as QuantitativeModel))
  })

  it('clamps a zero bound and records the clamp as an assumption', () => {
    const zero = risk({ frequency: { lo: 0, hi: 2 }, magnitude: { lo: 0, hi: 100 } })
    const built = buildModel(register(zero), zero)
    expect(built?.frequency.lo).toBeGreaterThan(0)
    expect(built?.assumptions.join(' ')).toMatch(/raised from 0/)
  })

  it('returns undefined when there is nothing to build from', () => {
    const unplaced = risk({ likelihood: null, impact: null })
    expect(buildModel(register(unplaced), unplaced)).toBeUndefined()
  })
})
