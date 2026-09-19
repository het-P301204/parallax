import { describe, expect, it } from 'vitest'
import {
  buildRegister,
  detectMapping,
  importRegister,
  mappingProblems,
  parseDate,
  parseJsonTable,
  parseLevel,
  parseNumber,
  parseTable,
  parseTreatment,
} from './import.ts'
import { defaultModel } from './scales.ts'
import { ImportError } from './errors.ts'

const MODEL = defaultModel(5)

describe('parseNumber', () => {
  it('reads the shapes a spreadsheet actually produces', () => {
    expect(parseNumber('1200')).toBe(1200)
    expect(parseNumber('1,200')).toBe(1200)
    expect(parseNumber('£1,200,000')).toBe(1_200_000)
    expect(parseNumber('$1200.50')).toBe(1200.5)
    expect(parseNumber('(500)')).toBe(-500)
    expect(parseNumber('12%')).toBeCloseTo(0.12)
    expect(parseNumber('1.2e3')).toBe(1200)
    expect(parseNumber(`${String.fromCharCode(0xa0)}42 `)).toBe(42)
  })

  it('returns null rather than NaN for anything it cannot read', () => {
    for (const value of ['', 'n/a', 'TBC', '3-4', '1.2.3', '--5', 'twelve']) {
      expect(parseNumber(value)).toBeNull()
    }
  })
})

describe('parseLevel', () => {
  const allowed = [1, 2, 3, 4, 5]
  const labels = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain']

  it('reads a number in range', () => {
    expect(parseLevel('4', allowed, labels)).toEqual({ value: 4 })
  })

  it('reads a level label, including with a trailing qualifier', () => {
    expect(parseLevel('Likely', allowed, labels).value).toBe(4)
    expect(parseLevel('almost certain (5)', allowed, labels).value).toBe(5)
  })

  it('reports out-of-range separately from unreadable', () => {
    expect(parseLevel('7', allowed, labels)).toEqual({ value: null, reason: 'out-of-range' })
    expect(parseLevel('N/A', allowed, labels)).toEqual({ value: null, reason: 'not-a-number' })
    expect(parseLevel('', allowed, labels)).toEqual({ value: null, reason: 'blank' })
  })

  it('refuses a fractional level rather than rounding somebody’s assessment', () => {
    expect(parseLevel('3.5', allowed, labels).value).toBeNull()
  })
})

describe('parseDate', () => {
  it('reads ISO exactly', () => {
    expect(parseDate('2025-03-04')).toBe('2025-03-04')
  })

  it('reads a slash date day-first, as documented', () => {
    expect(parseDate('03/04/2025')).toBe('2025-04-03')
  })

  it('swaps when the first component cannot be a day', () => {
    expect(parseDate('13/04/2025')).toBe('2025-04-13')
    expect(parseDate('04/13/2025')).toBe('2025-13-04'.length === 10 ? '2025-04-13' : '2025-04-13')
  })

  it('rejects an impossible date rather than rolling it over', () => {
    expect(parseDate('2025-02-30')).toBeNull()
    expect(parseDate('Q2 2025')).toBeNull()
  })
})

describe('parseTreatment', () => {
  it('normalises the vocabulary registers actually use', () => {
    expect(parseTreatment('Mitigate')).toBe('mitigate')
    expect(parseTreatment('reduce')).toBe('mitigate')
    expect(parseTreatment('Insurance')).toBe('transfer')
    expect(parseTreatment('Terminate')).toBe('avoid')
    expect(parseTreatment('Tolerate')).toBe('accept')
    expect(parseTreatment('')).toBe('unknown')
    expect(parseTreatment('something else')).toBe('unknown')
  })
})

describe('detectMapping', () => {
  it('binds the demo register’s real header names', () => {
    const header = [
      'Risk Ref',
      'Risk Title',
      'Likelihood Score',
      'Impact Score',
      'Risk Score',
      'Risk Category',
      'Business Unit',
      'Assessed By',
      'Freq Min (per yr)',
      'Freq Max (per yr)',
      'Loss Min (GBP)',
      'Loss Max (GBP)',
    ]
    const mapping = detectMapping(header)
    expect(mapping.id).toBe('Risk Ref')
    expect(mapping.title).toBe('Risk Title')
    expect(mapping.likelihood).toBe('Likelihood Score')
    expect(mapping.impact).toBe('Impact Score')
    expect(mapping.score).toBe('Risk Score')
    expect(mapping.category).toBe('Risk Category')
    expect(mapping.businessUnit).toBe('Business Unit')
    expect(mapping.assessor).toBe('Assessed By')
    expect(mapping.frequencyMin).toBe('Freq Min (per yr)')
    expect(mapping.magnitudeMax).toBe('Loss Max (GBP)')
  })

  it('does not bind the frequency-interval columns to the likelihood axis', () => {
    // `frequency` is a synonym for likelihood, so a header of "Freq Min" is
    // exactly the kind of near-miss that silently audits the wrong column.
    const mapping = detectMapping(['Freq Min', 'Freq Max', 'Likelihood', 'Impact'])
    expect(mapping.likelihood).toBe('Likelihood')
    expect(mapping.frequencyMin).toBe('Freq Min')
  })

  it('never binds one column to two fields', () => {
    const mapping = detectMapping(['id', 'risk', 'likelihood', 'impact', 'score'])
    const bound = Object.values(mapping).filter((v): v is string => typeof v === 'string')
    expect(new Set(bound).size).toBe(bound.length)
  })
})

describe('mappingProblems', () => {
  it('requires both levels', () => {
    const problems = mappingProblems({ likelihood: null, impact: 'Impact' })
    expect(problems.map((p) => p.field)).toContain('likelihood')
  })

  it('flags a half-mapped interval', () => {
    const problems = mappingProblems({
      likelihood: 'L',
      impact: 'I',
      frequencyMin: 'Freq Min',
      frequencyMax: null,
    })
    expect(problems.map((p) => p.field)).toContain('frequencyMax')
  })
})

describe('buildRegister', () => {
  const csv = [
    'Risk Ref,Risk Title,Likelihood Score,Impact Score,Risk Score,Assessed By,Assessment Date',
    'R-1,Ransomware,2,5,10,A. Okafor,2025-01-04',
    'R-1,Duplicate ref,3,3,9,A. Okafor,2025-01-05',
    ',No id at all,4,2,8,,2025-01-06',
    'R-4,,7,2,14,M. Reyes,not a date',
    'R-5,Missing impact,3,,,M. Reyes,2025-02-01',
  ].join('\n')

  const built = importRegister('r.csv', csv, MODEL)

  it('keeps one risk per input row, including the unusable ones', () => {
    expect(built.register.risks).toHaveLength(5)
    expect(built.register.importedRowCount).toBe(5)
  })

  it('suffixes a duplicate id so both rows remain addressable, and reports it', () => {
    expect(built.register.risks.map((r) => r.id)).toContain('R-1#2')
    expect(built.issues.some((i) => i.code === 'duplicate-id')).toBe(true)
  })

  it('records every defect with its source row number', () => {
    const codes = built.issues.map((i) => i.code)
    expect(codes).toContain('missing-id')
    expect(codes).toContain('missing-title')
    expect(codes).toContain('missing-assessor')
    expect(codes).toContain('unparseable-date')
    expect(codes).toContain('level-out-of-range')
    expect(codes).toContain('missing-impact')
    const outOfRange = built.issues.find((i) => i.code === 'level-out-of-range')
    expect(outOfRange?.rowNumber).toBe(5)
  })

  it('leaves an unreadable level null rather than defaulting it to a number', () => {
    const missing = built.register.risks.find((r) => r.id === 'R-5')
    expect(missing?.impact).toBeNull()
    expect(missing?.likelihood).toBe(3)
  })

  it('refuses to build when a required column is not mapped', () => {
    const table = parseTable('r.csv', 'a,b\n1,2\n')
    expect(() => buildRegister(table, { likelihood: 'a' }, MODEL, 'r.csv')).toThrow(ImportError)
  })

  it('refuses a header with no rows beneath it', () => {
    expect(() => importRegister('r.csv', 'Likelihood,Impact\n', MODEL)).toThrow(ImportError)
  })
})

describe('JSON import', () => {
  it('reads a bare array of objects', () => {
    const table = parseJsonTable('[{"id":"R-1","likelihood":2},{"id":"R-2","impact":3}]')
    expect(table.header).toEqual(['id', 'likelihood', 'impact'])
    expect(table.rows[1]).toEqual(['R-2', '', '3'])
  })

  it('unwraps the four containers GRC exports use', () => {
    for (const key of ['risks', 'items', 'data', 'rows']) {
      const table = parseJsonTable(`{"${key}":[{"id":"R-1"}]}`)
      expect(table.rows).toHaveLength(1)
    }
  })

  it('flattens a nested value rather than dropping it', () => {
    const table = parseJsonTable('[{"id":"R-1","meta":{"a":1}}]')
    expect(table.rows[0]?.[1]).toBe('{"a":1}')
  })

  it('reports invalid JSON with a remedy', () => {
    try {
      parseJsonTable('{"risks":[{"id":1},]}')
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ImportError)
      expect((error as ImportError).code).toBe('not-json')
    }
  })

  it('reports a top-level object that holds no list', () => {
    expect(() => parseJsonTable('{"total": 4}')).toThrow(ImportError)
  })

  it('is selected by content when the extension is unhelpful', () => {
    const table = parseTable('export.txt', '[{"id":"R-1","likelihood":"2","impact":"3"}]')
    expect(table.header).toContain('likelihood')
  })
})
