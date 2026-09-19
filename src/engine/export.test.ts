/**
 * Exports.
 *
 * The property that matters most is determinism: two audits of the same file
 * must produce byte-identical output, so that a diff between last quarter's
 * export and this one is a diff of the register rather than of the clock.
 */

import { describe, expect, it } from 'vitest'
import { DEMO_REGISTER_CSV, DEMO_REGISTER_FILE } from '../demo-register.generated.ts'
import { EXPORTS, exportReport } from './export.ts'
import { analyse } from './report.ts'
import { importRegister } from './import.ts'
import { parseCsv } from './csv.ts'
import { defaultModel } from './scales.ts'
import { counted } from './stats.ts'

const built = importRegister(DEMO_REGISTER_FILE, DEMO_REGISTER_CSV, defaultModel(5))
const report = analyse(built.register, built.issues)

describe('exportReport', () => {
  it('produces every declared export', () => {
    for (const descriptor of EXPORTS) {
      const text = exportReport(report, descriptor.id)
      expect(text.length, descriptor.id).toBeGreaterThan(100)
    }
  })

  it('is byte-identical across two runs of the same file', () => {
    const again = analyse(
      importRegister(DEMO_REGISTER_FILE, DEMO_REGISTER_CSV, defaultModel(5)).register,
      built.issues,
    )
    for (const descriptor of EXPORTS) {
      expect(exportReport(again, descriptor.id), descriptor.id).toBe(
        exportReport(report, descriptor.id),
      )
    }
  })

  it('groups numbers in a fixed locale, not the host’s', () => {
    // `toLocaleString()` with no argument uses the host locale, so the same
    // register produces "6,261" on one machine and "6,26,1" on another. Those
    // strings are embedded in the findings, so they reach the exports — which
    // would make a "deterministic" artifact depend on the operating system.
    expect(counted(1_234_567)).toBe('1,234,567')
    const evidence = report.ordinal.explanation.evidence + report.ordinal.explanation.why
    expect(evidence).not.toMatch(/\d,\d\d,\d/)
    const csv = exportReport(report, 'measurement-audit')
    expect(csv).not.toMatch(/\d,\d\d,\d\d\d/)
  })

  it('carries no timestamp, which is what makes the diff meaningful', () => {
    for (const descriptor of EXPORTS) {
      const text = exportReport(report, descriptor.id)
      expect(text, descriptor.id).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
      expect(text, descriptor.id).not.toMatch(/"(generatedAt|timestamp|runId)"/)
    }
  })

  it('writes an assumption column on every findings export', () => {
    for (const id of ['measurement-audit', 'compression', 'inversions', 'calibration', 'shortlist'] as const) {
      const table = parseCsv(exportReport(report, id))
      expect(table.header, id).toContain('assumption')
      expect(table.header, id).toContain('evidence')
      expect(table.header, id).toContain('next')
      const assumptions = table.rows.map((r) => r[table.header.indexOf('assumption')] ?? '')
      expect(assumptions.every((a) => a.trim().length > 3), id).toBe(true)
    }
  })

  it('writes one annotated row per imported row, including the unplaceable ones', () => {
    const table = parseCsv(exportReport(report, 'register'))
    expect(table.rows).toHaveLength(report.register.risks.length)
    const reasons = table.rows.map((r) => r[table.header.indexOf('excluded_reason')] ?? '')
    expect(reasons.filter((r) => r !== '')).toHaveLength(report.summary.risksExcluded)
  })

  it('never writes NaN or undefined into a cell', () => {
    for (const descriptor of EXPORTS.filter((e) => e.format === 'csv')) {
      const text = exportReport(report, descriptor.id)
      expect(text, descriptor.id).not.toMatch(/(^|,)"?(NaN|undefined|Infinity)"?(,|\r)/)
    }
  })

  it('produces JSON that parses and carries the engine version', () => {
    const parsed = JSON.parse(exportReport(report, 'full-report')) as Record<string, unknown>
    expect(parsed.engineVersion).toBe(report.engineVersion)
    expect(Array.isArray(parsed.compression)).toBe(true)
    expect(Array.isArray(parsed.risks)).toBe(true)
    expect((parsed.risks as unknown[]).length).toBe(report.register.risks.length)
  })

  it('sorts the JSON model list so the output does not depend on insertion order', () => {
    const parsed = JSON.parse(exportReport(report, 'full-report')) as {
      models: { riskId: string }[]
    }
    const ids = parsed.models.map((m) => m.riskId)
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })

  it('agrees with the report it was built from', () => {
    const table = parseCsv(exportReport(report, 'shortlist'))
    const shortlisted = table.rows.filter(
      (r) => r[table.header.indexOf('shortlisted')] === 'true',
    )
    expect(shortlisted).toHaveLength(report.quantification.length)

    const compression = parseCsv(exportReport(report, 'compression'))
    expect(compression.rows).toHaveLength(report.compression.length)
  })
})
