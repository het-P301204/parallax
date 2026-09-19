/**
 * The filter predicate.
 *
 * Tested as the pure function it is, with no browser. The property that
 * matters is that a count shown anywhere in the interface is the length of
 * this function's output — a summary figure that disagreed with the table
 * beneath it would be worse than no figure at all.
 */

import { describe, expect, it } from 'vitest'
import { DEMO_REGISTER_CSV, DEMO_REGISTER_FILE } from '../demo-register.generated.ts'
import { analyse, defaultModel, importRegister } from '../engine/index.ts'
import { EMPTY_FILTERS, filtersActive } from '../state.ts'
import { applyFilters, buildIndex, facetValues, matches, toggle } from './filter.ts'

const built = importRegister(DEMO_REGISTER_FILE, DEMO_REGISTER_CSV, defaultModel(5))
const report = analyse(built.register, built.issues)
const index = buildIndex(report)

describe('applyFilters', () => {
  it('returns every row when nothing is set', () => {
    expect(applyFilters(report, EMPTY_FILTERS, index)).toHaveLength(report.register.risks.length)
    expect(filtersActive(EMPTY_FILTERS)).toBe(0)
  })

  it('searches id, title, owner, category and business unit', () => {
    const byId = applyFilters(report, { ...EMPTY_FILTERS, query: 'RR-003' }, index)
    expect(byId.map((r) => r.id)).toContain('RR-003')

    const byTitle = applyFilters(report, { ...EMPTY_FILTERS, query: 'ransomware' }, index)
    expect(byTitle.length).toBeGreaterThan(3)
    expect(byTitle.every((r) => `${r.id} ${r.title} ${r.category}`.toLowerCase().includes('ransomware'))).toBe(true)
  })

  it('does not search the description, which would match everything', () => {
    const risk = report.register.risks.find((r) => (r.description ?? '').includes('domain privilege'))
    expect(risk).toBeDefined()
    const found = applyFilters(report, { ...EMPTY_FILTERS, query: 'domain privilege' }, index)
    expect(found).toHaveLength(0)
  })

  it('is case-insensitive and ignores surrounding space', () => {
    const a = applyFilters(report, { ...EMPTY_FILTERS, query: '  PHISHING ' }, index)
    const b = applyFilters(report, { ...EMPTY_FILTERS, query: 'phishing' }, index)
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id))
  })

  it('combines facets conjunctively', () => {
    const unit = facetValues(report.register.risks, 'businessUnit')[0] as string
    const category = facetValues(report.register.risks, 'category')[0] as string
    const both = applyFilters(
      report,
      { ...EMPTY_FILTERS, businessUnits: [unit], categories: [category] },
      index,
    )
    expect(both.every((r) => r.businessUnit === unit && r.category === category)).toBe(true)
  })

  it('treats multiple values within one facet as a union', () => {
    const units = facetValues(report.register.risks, 'businessUnit').slice(0, 2)
    const result = applyFilters(report, { ...EMPTY_FILTERS, businessUnits: units }, index)
    const single = applyFilters(
      report,
      { ...EMPTY_FILTERS, businessUnits: [units[0] as string] },
      index,
    )
    expect(result.length).toBeGreaterThan(single.length)
  })

  it('filters by matrix cell', () => {
    const cell = report.matrix.cells.find((c) => c.riskIds.length > 2)
    expect(cell).toBeDefined()
    const result = applyFilters(report, { ...EMPTY_FILTERS, cellKey: cell?.key }, index)
    expect(result.map((r) => r.id).sort()).toEqual([...(cell?.riskIds ?? [])].sort())
  })

  it('filters by finding type, agreeing with the report', () => {
    const shortlisted = applyFilters(report, { ...EMPTY_FILTERS, shortlistOnly: true }, index)
    expect(shortlisted).toHaveLength(report.quantification.length)

    const estimated = applyFilters(report, { ...EMPTY_FILTERS, estimatedOnly: true }, index)
    expect(estimated).toHaveLength(report.summary.risksWithEstimates)

    const inverted = applyFilters(report, { ...EMPTY_FILTERS, inversionOnly: true }, index)
    expect(inverted.every((r) => report.inversionIds.has(r.id))).toBe(true)
  })

  it('keeps unplaceable rows visible unless a cell filter excludes them', () => {
    const unplaced = report.matrix.unplaced[0]?.riskId
    expect(unplaced).toBeDefined()
    const all = applyFilters(report, EMPTY_FILTERS, index)
    expect(all.map((r) => r.id)).toContain(unplaced)
  })

  it('returns nothing for a query that matches nothing, without throwing', () => {
    expect(applyFilters(report, { ...EMPTY_FILTERS, query: 'zzzz-no-such-risk' }, index)).toEqual([])
  })
})

describe('matches', () => {
  it('is the predicate applyFilters uses', () => {
    const filters = { ...EMPTY_FILTERS, query: 'ransomware' }
    const viaPredicate = report.register.risks.filter((r) => matches(r, filters, index))
    expect(viaPredicate).toEqual(applyFilters(report, filters, index))
  })
})

describe('filtersActive', () => {
  it('counts each facet value and each toggle', () => {
    expect(
      filtersActive({
        ...EMPTY_FILTERS,
        query: 'x',
        businessUnits: ['a', 'b'],
        shortlistOnly: true,
        cellKey: 'L3I3',
      }),
    ).toBe(5)
  })
})

describe('toggle', () => {
  it('adds and removes', () => {
    expect(toggle([], 'a')).toEqual(['a'])
    expect(toggle(['a', 'b'], 'a')).toEqual(['b'])
  })
})

describe('facetValues', () => {
  it('returns sorted distinct non-blank values', () => {
    const values = facetValues(report.register.risks, 'assessor')
    expect(values).toEqual([...values].sort((a, b) => a.localeCompare(b)))
    expect(new Set(values).size).toBe(values.length)
    expect(values).not.toContain('')
  })
})
