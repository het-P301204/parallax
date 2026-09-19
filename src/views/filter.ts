/**
 * The filter predicate.
 *
 * A pure function of (report, filters, risk) so it can be tested without a
 * browser, and so that every view filters identically — a count on the
 * overview that disagreed with the rows in the table underneath it would be
 * worse than no count at all.
 *
 * Search matches on identifier, title, owner, category and business unit, and
 * nothing else. Deliberately not the description: matching free text turns a
 * search for "API" into a list of everything that mentions an API somewhere in
 * a paragraph, which is the behaviour that makes people stop using search.
 */

import type { AuditReport, Risk } from '../engine/index.ts'
import type { Filters } from '../state.ts'

export interface FilterIndex {
  readonly shortlist: ReadonlySet<string>
  readonly estimated: ReadonlySet<string>
  readonly inversion: ReadonlySet<string>
  readonly cellById: ReadonlyMap<string, string>
}

export function buildIndex(report: AuditReport): FilterIndex {
  const cellById = new Map<string, string>()
  for (const cell of report.matrix.cells) {
    for (const id of cell.riskIds) cellById.set(id, cell.key)
  }
  const estimated = new Set<string>()
  for (const [id, model] of report.models) {
    if (model.frequencySource === 'register-estimate' || model.magnitudeSource === 'register-estimate') {
      estimated.add(id)
    }
  }
  return {
    shortlist: new Set(report.quantification.map((q) => q.riskId)),
    estimated,
    inversion: report.inversionIds,
    cellById,
  }
}

export function matches(risk: Risk, filters: Filters, index: FilterIndex): boolean {
  const query = filters.query.trim().toLowerCase()
  if (query !== '') {
    const haystack = [risk.id, risk.title, risk.owner, risk.category, risk.businessUnit]
      .filter((part): part is string => typeof part === 'string')
      .join(' ')
      .toLowerCase()
    if (!haystack.includes(query)) return false
  }
  if (filters.businessUnits.length > 0 && !filters.businessUnits.includes(risk.businessUnit ?? '')) {
    return false
  }
  if (filters.categories.length > 0 && !filters.categories.includes(risk.category ?? '')) return false
  if (filters.assessors.length > 0 && !filters.assessors.includes(risk.assessor ?? '')) return false
  if (filters.treatments.length > 0 && !filters.treatments.includes(risk.treatment)) return false
  if (filters.cellKey && index.cellById.get(risk.id) !== filters.cellKey) return false
  if (filters.estimatedOnly && !index.estimated.has(risk.id)) return false
  if (filters.shortlistOnly && !index.shortlist.has(risk.id)) return false
  if (filters.inversionOnly && !index.inversion.has(risk.id)) return false
  return true
}

export function applyFilters(
  report: AuditReport,
  filters: Filters,
  index: FilterIndex,
): Risk[] {
  return report.register.risks.filter((risk) => matches(risk, filters, index))
}

/** Distinct values for a facet, sorted, blank excluded. */
export function facetValues(risks: readonly Risk[], key: keyof Risk): string[] {
  const seen = new Set<string>()
  for (const risk of risks) {
    const value = risk[key]
    if (typeof value === 'string' && value.trim() !== '') seen.add(value)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/** Adds or removes a value from a facet list. */
export function toggle(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}
