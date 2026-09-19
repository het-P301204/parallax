/**
 * Errors the user is meant to read.
 *
 * Every failure mode of the import pipeline resolves to one of these, and
 * every one carries a `remedy`: the interface shows the remedy, not a stack
 * trace. An error that tells a risk manager "Unexpected token < in JSON at
 * position 0" has told them nothing they can act on.
 *
 * `detail` may quote the *structure* of an offending file -- a column name, a
 * row number, a value's length -- but never a field's contents. A register
 * contains sensitive business information and an error message is the easiest
 * place in a product for it to leak somewhere it was not meant to go.
 */

export type ImportErrorCode =
  | 'file-too-large'
  | 'file-empty'
  | 'too-many-rows'
  | 'too-many-columns'
  | 'no-header'
  | 'unterminated-quote'
  | 'not-json'
  | 'json-not-a-list'
  | 'json-row-not-an-object'
  | 'unsupported-format'
  | 'no-usable-rows'
  | 'mapping-incomplete'
  | 'scale-invalid'

export class ImportError extends Error {
  readonly code: ImportErrorCode
  readonly detail: string
  readonly remedy: string

  constructor(code: ImportErrorCode, message: string, detail: string, remedy: string) {
    super(message)
    this.name = 'ImportError'
    this.code = code
    this.detail = detail
    this.remedy = remedy
  }
}

export function importError(
  code: ImportErrorCode,
  message: string,
  detail: string,
  remedy: string,
): ImportError {
  return new ImportError(code, message, detail, remedy)
}

/** Narrows an unknown thrown value for the error views. */
export function asImportError(error: unknown): ImportError {
  if (error instanceof ImportError) return error
  return new ImportError(
    'unsupported-format',
    'The file could not be read.',
    error instanceof Error ? error.name : 'Unknown failure',
    'Check that the file is a CSV or JSON export of a risk register and try again. If it opens in a spreadsheet, re-export it as CSV.',
  )
}
