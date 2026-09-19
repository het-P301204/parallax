/**
 * Turning somebody else's export into a `RiskRegister`.
 *
 * The import is deliberately in two halves. `parseTable` gets a file down to a
 * header and a grid of strings and nothing more; `buildRegister` applies a
 * `ColumnMapping` the user has seen and confirmed. Nothing is auto-imported
 * without the mapping step being shown, because the single most expensive
 * failure mode of a tool like this is silently reading the wrong column as
 * "likelihood" and then producing twelve pages of confident analysis of it.
 *
 * Coercion is conservative throughout. A value that cannot be read becomes
 * `null` and a data-quality finding, never a zero and never a guess.
 */

import { parseCsv, type CsvTable } from './csv.ts'
import { importError } from './errors.ts'
import { MAX_FILE_BYTES, MAX_ROWS } from './limits.ts'
import { labelOf, levelValues } from './scales.ts'
import type {
  DataQualityCode,
  Interval,
  Risk,
  RiskRegister,
  ScoringModel,
  TreatmentId,
} from './types.ts'

/* -------------------------------------------------------------------------- */
/* Fields                                                                     */
/* -------------------------------------------------------------------------- */

export type FieldId =
  | 'id'
  | 'title'
  | 'description'
  | 'likelihood'
  | 'impact'
  | 'score'
  | 'category'
  | 'owner'
  | 'businessUnit'
  | 'assessor'
  | 'assessedOn'
  | 'treatment'
  | 'controls'
  | 'frequencyMin'
  | 'frequencyMax'
  | 'magnitudeMin'
  | 'magnitudeMax'

export type FieldRequirement = 'required' | 'recommended' | 'optional'

export interface FieldDescriptor {
  readonly id: FieldId
  readonly label: string
  readonly requirement: FieldRequirement
  /** What the field is used for, shown in the mapper. */
  readonly purpose: string
  /**
   * Header names matched case- and punctuation-insensitively during
   * auto-detection. Order matters: earlier entries win.
   */
  readonly synonyms: readonly string[]
}

export const FIELDS: readonly FieldDescriptor[] = [
  {
    id: 'id',
    label: 'Risk ID',
    requirement: 'recommended',
    purpose: 'Identifies a row across exports. Rows without one get a positional id and a flag.',
    synonyms: ['id', 'riskid', 'riskref', 'ref', 'reference', 'risknumber', 'number', 'key'],
  },
  {
    id: 'title',
    label: 'Title',
    requirement: 'recommended',
    purpose: 'The name shown everywhere a risk appears.',
    synonyms: ['title', 'risk', 'riskname', 'name', 'risktitle', 'summary', 'event'],
  },
  {
    id: 'description',
    label: 'Description',
    requirement: 'optional',
    purpose: 'Shown in the risk workspace. Never used in any calculation.',
    synonyms: ['description', 'detail', 'details', 'riskdescription', 'scenario', 'narrative'],
  },
  {
    id: 'likelihood',
    label: 'Likelihood level',
    requirement: 'required',
    purpose: 'The level on the likelihood axis. Accepts the number or the level label.',
    synonyms: ['likelihood', 'likelihoodscore', 'likelihoodrating', 'probability', 'frequency', 'l', 'prob'],
  },
  {
    id: 'impact',
    label: 'Impact level',
    requirement: 'required',
    purpose: 'The level on the impact axis. Accepts the number or the level label.',
    synonyms: ['impact', 'impactscore', 'impactrating', 'consequence', 'severity', 'i'],
  },
  {
    id: 'score',
    label: 'Stated score',
    requirement: 'optional',
    purpose: "The register's own score. Compared with the configured formula; a disagreement is reported, never corrected.",
    synonyms: ['score', 'riskscore', 'rating', 'inherentscore', 'grossscore', 'total', 'rpn'],
  },
  {
    id: 'category',
    label: 'Category',
    requirement: 'recommended',
    purpose: 'Forms the peer groups the calibration analysis compares within.',
    synonyms: ['category', 'risktype', 'type', 'domain', 'theme', 'class', 'taxonomy'],
  },
  {
    id: 'owner',
    label: 'Owner',
    requirement: 'optional',
    purpose: 'Displayed only. Distinct from the assessor.',
    synonyms: ['owner', 'riskowner', 'accountable', 'responsible'],
  },
  {
    id: 'businessUnit',
    label: 'Business unit',
    requirement: 'recommended',
    purpose: 'A second grouping for calibration, and a filter everywhere.',
    synonyms: ['businessunit', 'bu', 'department', 'division', 'team', 'function', 'unit', 'org'],
  },
  {
    id: 'assessor',
    label: 'Assessor',
    requirement: 'recommended',
    purpose: 'Who scored the row. Without it the calibration analysis cannot run at all.',
    synonyms: ['assessor', 'assessedby', 'scoredby', 'analyst', 'reviewer', 'rater', 'author'],
  },
  {
    id: 'assessedOn',
    label: 'Assessed on',
    requirement: 'optional',
    purpose: 'Orders the assessment timeline. ISO dates are read exactly; slash dates are read day-first.',
    synonyms: ['assessedon', 'date', 'assessmentdate', 'reviewed', 'lastreview', 'updated', 'asof'],
  },
  {
    id: 'treatment',
    label: 'Treatment',
    requirement: 'recommended',
    purpose: 'Accept, mitigate, transfer or avoid. Feeds the decision-consequence component of triage.',
    synonyms: ['treatment', 'response', 'strategy', 'action', 'disposition', 'decision'],
  },
  {
    id: 'controls',
    label: 'Existing controls',
    requirement: 'optional',
    purpose: 'Displayed only.',
    synonyms: ['controls', 'existingcontrols', 'mitigations', 'countermeasures', 'safeguards'],
  },
  {
    id: 'frequencyMin',
    label: 'Frequency — low',
    requirement: 'optional',
    purpose: 'Lower bound of a 90% interval, events per year. Supplying this and its pair is what makes quantitative findings possible.',
    synonyms: ['frequencymin', 'freqmin', 'frequencylow', 'freqlo', 'minfrequency', 'eventsperyearmin', 'lambdamin'],
  },
  {
    id: 'frequencyMax',
    label: 'Frequency — high',
    requirement: 'optional',
    purpose: 'Upper bound of a 90% interval, events per year.',
    synonyms: ['frequencymax', 'freqmax', 'frequencyhigh', 'freqhi', 'maxfrequency', 'eventsperyearmax', 'lambdamax'],
  },
  {
    id: 'magnitudeMin',
    label: 'Loss magnitude — low',
    requirement: 'optional',
    purpose: 'Lower bound of a 90% interval for the loss from one occurrence.',
    synonyms: ['magnitudemin', 'lossmin', 'lossloworbound', 'losslow', 'minloss', 'impactmin', 'lowloss'],
  },
  {
    id: 'magnitudeMax',
    label: 'Loss magnitude — high',
    requirement: 'optional',
    purpose: 'Upper bound of a 90% interval for the loss from one occurrence.',
    synonyms: ['magnitudemax', 'lossmax', 'losshigh', 'maxloss', 'impactmax', 'highloss'],
  },
]

export const FIELD_BY_ID: ReadonlyMap<FieldId, FieldDescriptor> = new Map(
  FIELDS.map((f) => [f.id, f]),
)

/** `null` means "this field is not present in the file". */
export type ColumnMapping = Readonly<Partial<Record<FieldId, string | null>>>

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

export type SourceFormat = 'csv' | 'json'

/**
 * Chooses a reader.
 *
 * `.json` and `.csv`/`.tsv` are taken at their word. Everything else — `.txt`,
 * a name with no extension, a file dropped from a download folder — is
 * sniffed, because an extension is a claim and the first byte is evidence.
 * Reading a JSON export as CSV produces one enormous column and a page of
 * nonsense rather than an error, which is the worst of the available failures.
 */
export function detectFormat(fileName: string, text: string): SourceFormat {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.json')) return 'json'
  const head = text.slice(0, 512).trimStart()
  const looksJson = head.startsWith('[') || head.startsWith('{')
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return 'csv'
  return looksJson ? 'json' : 'csv'
}

/**
 * Reads a JSON register into the same header-and-grid shape as a CSV.
 *
 * Accepts a bare array of objects, or an object with the array under `risks`,
 * `items`, `data` or `rows` -- the four wrappers every GRC export in the wild
 * seems to choose between. The header is the union of the keys, in
 * first-appearance order, so a row that omits an optional field does not
 * shift every later column.
 *
 * Nested objects and arrays are flattened to JSON text rather than dropped:
 * the value is then visible in the preview, where a human can decide it is
 * not the likelihood column.
 */
export function parseJsonTable(text: string): CsvTable {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch (error) {
    throw importError(
      'not-json',
      'The file is not valid JSON.',
      error instanceof Error ? error.message.slice(0, 160) : 'Parse failed.',
      'If this is a CSV, rename it with a .csv extension or pick CSV explicitly. If it is JSON, run it through a validator — a trailing comma is the usual cause.',
    )
  }

  let list: unknown = parsed
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const holder = parsed as Record<string, unknown>
    list = holder.risks ?? holder.items ?? holder.data ?? holder.rows ?? holder.register
  }

  if (!Array.isArray(list)) {
    throw importError(
      'json-not-a-list',
      'The JSON does not contain a list of risks.',
      'Expected an array at the top level, or an object with one under "risks", "items", "data", "rows" or "register".',
      'Wrap the rows in an array, or export as CSV instead.',
    )
  }
  if (list.length === 0) {
    throw importError(
      'file-empty',
      'The JSON list is empty.',
      'Zero rows.',
      'Check that the export completed and that any filter applied to it left rows behind.',
    )
  }
  if (list.length > MAX_ROWS) {
    throw importError(
      'too-many-rows',
      'The register is larger than PARALLAX will analyse.',
      `${list.length} rows, limit ${MAX_ROWS}.`,
      'Split the register by business unit and audit each part separately.',
    )
  }

  const header: string[] = []
  const seen = new Set<string>()
  for (const row of list) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue
    for (const key of Object.keys(row as Record<string, unknown>)) {
      if (!seen.has(key)) {
        seen.add(key)
        header.push(key)
      }
    }
  }
  if (header.length === 0) {
    throw importError(
      'json-row-not-an-object',
      'The JSON list does not contain objects.',
      'No row had any keys to read as columns.',
      'Each element of the array should be an object whose keys are the column names.',
    )
  }

  const warnings: string[] = []
  let skipped = 0
  const rows: string[][] = []
  for (const row of list) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      skipped += 1
      continue
    }
    const record = row as Record<string, unknown>
    rows.push(header.map((key) => jsonCell(record[key])))
  }
  if (skipped > 0) {
    warnings.push(`${skipped} element${skipped === 1 ? ' was' : 's were'} not an object and could not be read as a row.`)
  }

  return { header, rows, warnings }
}

function jsonCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** Reads a file of either format into a header and a grid of strings. */
export function parseTable(fileName: string, text: string): CsvTable {
  if (text.length === 0) {
    throw importError(
      'file-empty',
      'The file is empty.',
      '0 bytes.',
      'Check that the export completed before you selected the file.',
    )
  }
  // Characters, not bytes — and therefore *permissive*: a file of multi-byte
  // text passes this check at a larger byte size than the limit names. It is a
  // backstop rather than the real guard. The browser checks `File.size` in
  // bytes before reading, and the row and column limits below are what
  // actually bound the work.
  if (text.length > MAX_FILE_BYTES) {
    throw importError(
      'file-too-large',
      'The file is larger than PARALLAX will read.',
      `About ${Math.round(text.length / 1024 / 1024)} MB, limit ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
      'A register this size is usually an export with embedded documents in a column. Remove the attachment columns and export again.',
    )
  }
  return detectFormat(fileName, text) === 'json' ? parseJsonTable(text) : parseCsv(text)
}

/* -------------------------------------------------------------------------- */
/* Mapping                                                                    */
/* -------------------------------------------------------------------------- */

/** Lowercases and strips everything that is not a letter or a digit. */
function normaliseHeader(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Guesses a mapping from the header row.
 *
 * Exact synonym matches first, across all fields, so that a header containing
 * both `impact` and `impact_min` binds `impact` to the right one regardless of
 * column order. Prefix matches run afterwards and only claim columns nothing
 * else wanted.
 *
 * The guess is always shown to the user before anything is analysed. It is a
 * convenience, not an authority.
 */
export function detectMapping(header: readonly string[]): ColumnMapping {
  const normalised = header.map((h) => ({ raw: h, key: normaliseHeader(h) }))
  const taken = new Set<string>()
  const mapping: Partial<Record<FieldId, string | null>> = {}

  for (const field of FIELDS) {
    for (const synonym of field.synonyms) {
      const hit = normalised.find((h) => h.key === synonym && !taken.has(h.raw))
      if (hit) {
        mapping[field.id] = hit.raw
        taken.add(hit.raw)
        break
      }
    }
  }

  for (const field of FIELDS) {
    if (mapping[field.id] !== undefined) continue
    for (const synonym of field.synonyms) {
      if (synonym.length < 4) continue
      const hit = normalised.find(
        (h) => !taken.has(h.raw) && (h.key.startsWith(synonym) || h.key.endsWith(synonym)),
      )
      if (hit) {
        mapping[field.id] = hit.raw
        taken.add(hit.raw)
        break
      }
    }
  }

  for (const field of FIELDS) {
    if (mapping[field.id] === undefined) mapping[field.id] = null
  }
  return mapping
}

export interface MappingProblem {
  readonly field: FieldId
  readonly message: string
}

/** Fields that must be bound before analysis can start. */
export function mappingProblems(mapping: ColumnMapping): MappingProblem[] {
  const problems: MappingProblem[] = []
  for (const field of FIELDS) {
    if (field.requirement === 'required' && !mapping[field.id]) {
      problems.push({
        field: field.id,
        message: `${field.label} is required: without it a risk cannot be placed on the matrix.`,
      })
    }
  }
  const pairs: readonly (readonly [FieldId, FieldId, string])[] = [
    ['frequencyMin', 'frequencyMax', 'frequency'],
    ['magnitudeMin', 'magnitudeMax', 'loss magnitude'],
  ]
  for (const [lo, hi, label] of pairs) {
    const hasLo = Boolean(mapping[lo])
    const hasHi = Boolean(mapping[hi])
    if (hasLo !== hasHi) {
      problems.push({
        field: hasLo ? hi : lo,
        message: `Only one end of the ${label} interval is mapped. An interval needs both bounds, so this column will be ignored.`,
      })
    }
  }
  return problems
}

/* -------------------------------------------------------------------------- */
/* Coercion                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Reads a number from a spreadsheet cell.
 *
 * Handles what real exports contain: thousands separators, currency symbols,
 * a trailing `%`, parenthesised negatives, non-breaking spaces. Returns `null`
 * rather than `NaN` so that "could not read this" is a value the type system
 * makes the caller handle.
 */
export function parseNumber(raw: string): number | null {
  // A hard length bound before any regex touches the value. The numeric
  // pattern below has adjacent quantifiers, which on a long non-matching
  // string backtracks quadratically; a field is allowed to be 4,000
  // characters, and no number anybody writes is longer than this.
  if (raw.length > 64) return null
  const text = raw.replace(/\u00a0/g, ' ').trim()
  if (text === '') return null

  const negated = /^\(.*\)$/.test(text)
  let body = negated ? text.slice(1, -1) : text

  const percent = body.endsWith('%')
  if (percent) body = body.slice(0, -1)

  // Strip currency symbols, spaces and thousands separators, but keep one
  // decimal point, a leading sign, and exponent notation.
  body = body.replace(/[£$€¥₹\s,]/g, '')
  if (body === '' || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(body)) return null

  const value = Number(body)
  if (!Number.isFinite(value)) return null
  const scaled = percent ? value / 100 : value
  return negated ? -scaled : scaled
}

export interface LevelReading {
  readonly value: number | null
  readonly reason?: 'blank' | 'not-a-number' | 'out-of-range'
}

/**
 * Reads a level, accepting either the number or the level's own label.
 *
 * Accepting the label matters: plenty of registers store "High" in the
 * likelihood column and the number nowhere, and refusing them would mean the
 * audit could not run on exactly the registers that most need it. A label is
 * matched case-insensitively and by prefix, so "Almost Certain" and "almost
 * certain (5)" both land on 5.
 */
export function parseLevel(raw: string, allowed: readonly number[], labels: readonly string[]): LevelReading {
  const text = raw.trim()
  if (text === '') return { value: null, reason: 'blank' }

  const numeric = parseNumber(text)
  if (numeric !== null) {
    const rounded = Math.round(numeric)
    if (Math.abs(numeric - rounded) > 1e-9) return { value: null, reason: 'out-of-range' }
    return allowed.includes(rounded)
      ? { value: rounded }
      : { value: null, reason: 'out-of-range' }
  }

  const lower = text.toLowerCase()
  for (let i = 0; i < labels.length; i += 1) {
    const label = (labels[i] as string).toLowerCase()
    if (label !== '' && (lower === label || lower.startsWith(`${label} `) || lower.startsWith(`${label}(`))) {
      return { value: allowed[i] as number }
    }
  }
  return { value: null, reason: 'not-a-number' }
}

const TREATMENT_SYNONYMS: readonly (readonly [TreatmentId, readonly string[]])[] = [
  ['mitigate', ['mitigate', 'mitigation', 'reduce', 'treat', 'remediate', 'control']],
  ['transfer', ['transfer', 'insure', 'insurance', 'share', 'outsource']],
  ['avoid', ['avoid', 'terminate', 'eliminate', 'exit', 'stop']],
  ['accept', ['accept', 'tolerate', 'retain', 'monitor', 'no action', 'none']],
]

export function parseTreatment(raw: string): TreatmentId {
  const text = raw.trim().toLowerCase()
  if (text === '') return 'unknown'
  for (const [id, words] of TREATMENT_SYNONYMS) {
    if (words.some((w) => text === w || text.startsWith(w))) return id
  }
  return 'unknown'
}

/**
 * Reads a date to ISO `YYYY-MM-DD`.
 *
 * ISO input is read exactly. A slash or dot date is read **day first**, which
 * is a real decision with a real failure mode: `03/04/2025` is read as 3 April
 * and a register exported from a US tool means 4 March. The importer states
 * this in the validation step rather than guessing from the data, because
 * guessing from the data gives a different answer for different registers and
 * nobody can tell which one they got.
 */
export function parseDate(raw: string): string | null {
  const text = raw.trim()
  if (text === '') return null

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text)
  if (iso) return isoOrNull(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(text)
  if (slash) {
    let day = Number(slash[1])
    let month = Number(slash[2])
    // Unambiguously month-first when the first component cannot be a day.
    if (day > 12 && month <= 12) {
      /* day-first, as assumed */
    } else if (month > 12 && day <= 12) {
      const swap = day
      day = month
      month = swap
    }
    const yearRaw = Number(slash[3])
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw
    return isoOrNull(year, month, day)
  }

  return null
}

function isoOrNull(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  if (year < 1900 || year > 2200) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/* -------------------------------------------------------------------------- */
/* Building the register                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One thing that was wrong with one row, recorded at the moment the raw text
 * was read.
 *
 * It has to be captured here rather than rediscovered later: by the time a
 * `Risk` exists, a likelihood of `null` no longer remembers whether the cell
 * was blank, held "n/a", or held a 7 on a five-point scale -- and those are
 * three different conversations with whoever maintains the register.
 */
export interface RowIssue {
  readonly code: DataQualityCode
  readonly rowNumber: number
  readonly riskId: string
  readonly field?: string
}

export interface BuildResult {
  readonly register: RiskRegister
  /** Non-fatal observations about the import itself. */
  readonly notes: readonly string[]
  /** Per-row problems, in row order. Turned into findings by `validate.ts`. */
  readonly issues: readonly RowIssue[]
}

interface Reader {
  (row: readonly string[], field: FieldId): string
}

function makeReader(header: readonly string[], mapping: ColumnMapping): Reader {
  const index = new Map<FieldId, number>()
  for (const field of FIELDS) {
    const column = mapping[field.id]
    if (!column) continue
    const at = header.indexOf(column)
    if (at >= 0) index.set(field.id, at)
  }
  return (row, field) => {
    const at = index.get(field)
    if (at === undefined) return ''
    return row[at] ?? ''
  }
}

/**
 * Applies a mapping to a parsed table.
 *
 * The result always has one `Risk` per input row -- including rows whose
 * levels could not be read. Dropping them here would mean the totals shown on
 * the overview silently disagreed with the file the user selected, which is
 * the sort of quiet subtraction that makes a measurement tool untrustworthy.
 * `validate.ts` reports them and the analyses route around them.
 */
export function buildRegister(
  table: CsvTable,
  mapping: ColumnMapping,
  model: ScoringModel,
  sourceName: string,
  registerName = 'Imported register',
): BuildResult {
  const problems = mappingProblems(mapping)
  const blocking = problems.filter((p) => p.message.includes('required'))
  if (blocking.length > 0) {
    throw importError(
      'mapping-incomplete',
      'The required columns are not mapped.',
      blocking.map((p) => p.message).join(' '),
      'Pick the column holding each required field in the mapping step. If the register genuinely has no impact column, PARALLAX cannot audit its matrix.',
    )
  }

  const read = makeReader(table.header, mapping)
  const notes: string[] = [...table.warnings]

  const lValues = levelValues(model.likelihood)
  const iValues = levelValues(model.impact)
  const lLabels = [...model.likelihood.levels].sort((a, b) => a.value - b.value).map((l) => l.label)
  const iLabels = [...model.impact.levels].sort((a, b) => a.value - b.value).map((l) => l.label)

  const seenIds = new Set<string>()
  const risks: Risk[] = []
  const issues: RowIssue[] = []
  let generatedIds = 0
  let labelReads = 0

  table.rows.forEach((row, offset) => {
    const rowNumber = offset + 2 // 1-based, and the header is row 1.

    const rawId = read(row, 'id').trim()
    let id = rawId
    if (id === '') {
      id = `ROW-${String(rowNumber).padStart(4, '0')}`
      generatedIds += 1
    }
    // A duplicate id would make every id-keyed lookup in the engine ambiguous.
    // It is reported as a finding and made unique here, so the analysis can
    // still address both rows rather than losing one of them.
    let unique = id
    let suffix = 2
    while (seenIds.has(unique)) {
      unique = `${id}#${suffix}`
      suffix += 1
    }
    seenIds.add(unique)
    if (rawId === '') issues.push({ code: 'missing-id', rowNumber, riskId: unique, field: 'id' })
    else if (unique !== id) issues.push({ code: 'duplicate-id', rowNumber, riskId: unique, field: 'id' })

    const rawLikelihood = read(row, 'likelihood')
    const rawImpact = read(row, 'impact')
    const likelihood = parseLevel(rawLikelihood, lValues, lLabels)
    const impact = parseLevel(rawImpact, iValues, iLabels)
    if (likelihood.value !== null && parseNumber(rawLikelihood) === null) labelReads += 1
    if (impact.value !== null && parseNumber(rawImpact) === null) labelReads += 1
    recordLevelIssue(issues, rowNumber, unique, 'likelihood', likelihood)
    recordLevelIssue(issues, rowNumber, unique, 'impact', impact)

    const title = read(row, 'title').trim()
    if (title === '') issues.push({ code: 'missing-title', rowNumber, riskId: unique, field: 'title' })
    if (read(row, 'assessor').trim() === '') {
      issues.push({ code: 'missing-assessor', rowNumber, riskId: unique, field: 'assessor' })
    }
    const rawDate = read(row, 'assessedOn').trim()
    if (rawDate !== '' && parseDate(rawDate) === null) {
      issues.push({ code: 'unparseable-date', rowNumber, riskId: unique, field: 'assessedOn' })
    }

    const frequency = readInterval(read(row, 'frequencyMin'), read(row, 'frequencyMax'))
    const magnitude = readInterval(read(row, 'magnitudeMin'), read(row, 'magnitudeMax'))
    recordIntervalIssue(issues, rowNumber, unique, 'frequency', read(row, 'frequencyMin'), read(row, 'frequencyMax'), frequency)
    recordIntervalIssue(issues, rowNumber, unique, 'magnitude', read(row, 'magnitudeMin'), read(row, 'magnitudeMax'), magnitude)

    risks.push({
      id: unique,
      title: title === '' ? `Untitled risk (row ${rowNumber})` : title,
      description: optional(read(row, 'description')),
      likelihood: likelihood.value,
      impact: impact.value,
      statedScore: parseNumber(read(row, 'score')),
      category: optional(read(row, 'category')),
      owner: optional(read(row, 'owner')),
      businessUnit: optional(read(row, 'businessUnit')),
      assessor: optional(read(row, 'assessor')),
      assessedOn: parseDate(read(row, 'assessedOn')) ?? undefined,
      treatment: parseTreatment(read(row, 'treatment')),
      controls: optional(read(row, 'controls')),
      frequency,
      magnitude,
      rowNumber,
    })
  })

  if (risks.length === 0) {
    throw importError(
      'no-usable-rows',
      'The file has a header but no rows beneath it.',
      `${table.header.length} columns, 0 rows.`,
      'Check the export range. A register exported from a filtered view sometimes contains only the header.',
    )
  }

  if (generatedIds > 0) {
    notes.push(
      `${generatedIds} row${generatedIds === 1 ? '' : 's'} had no identifier and were given a positional one. They cannot be matched against a later export of the same register.`,
    )
  }
  if (labelReads > 0) {
    notes.push(
      `${labelReads} level${labelReads === 1 ? ' was' : 's were'} read from a text label such as "${lLabels[lLabels.length - 1] ?? 'High'}" rather than a number, using the configured scale labels.`,
    )
  }
  if (mapping.assessedOn) {
    notes.push(
      'Dates written with slashes are read day-first (03/04/2025 is 3 April). ISO dates are read exactly.',
    )
  }

  return {
    register: {
      name: registerName,
      risks,
      model,
      sourceName,
      importedRowCount: table.rows.length,
    },
    notes,
    issues,
  }
}

function recordLevelIssue(
  issues: RowIssue[],
  rowNumber: number,
  riskId: string,
  field: 'likelihood' | 'impact',
  reading: LevelReading,
): void {
  if (reading.value !== null) return
  const code: DataQualityCode =
    reading.reason === 'blank'
      ? field === 'likelihood'
        ? 'missing-likelihood'
        : 'missing-impact'
      : reading.reason === 'out-of-range'
        ? 'level-out-of-range'
        : 'level-not-a-number'
  issues.push({ code, rowNumber, riskId, field })
}

function recordIntervalIssue(
  issues: RowIssue[],
  rowNumber: number,
  riskId: string,
  field: 'frequency' | 'magnitude',
  rawLo: string,
  rawHi: string,
  interval: Interval | undefined,
): void {
  const loPresent = rawLo.trim() !== ''
  const hiPresent = rawHi.trim() !== ''
  if (!loPresent && !hiPresent) return
  if (!interval) {
    issues.push({ code: 'interval-incomplete', rowNumber, riskId, field })
    return
  }
  if (interval.lo < 0 || interval.hi < 0) {
    issues.push({ code: 'negative-quantity', rowNumber, riskId, field })
    return
  }
  if (interval.hi < interval.lo) {
    issues.push({ code: 'interval-inverted', rowNumber, riskId, field })
  }
}

function optional(value: string): string | undefined {
  const text = value.trim()
  return text === '' ? undefined : text
}

/**
 * Reads an interval from two cells.
 *
 * Returns `undefined` unless both ends are present and non-negative. An
 * inverted interval is returned as written rather than silently swapped, so
 * `validate.ts` can report it -- a register where the "min" column holds the
 * larger number usually has the two columns mapped the wrong way round, and
 * quietly fixing it would hide that.
 */
function readInterval(lo: string, hi: string): Interval | undefined {
  const low = parseNumber(lo)
  const high = parseNumber(hi)
  if (low === null || high === null) return undefined
  return { lo: low, hi: high }
}

/** Convenience for the CLI and the tests: file text straight to a register. */
export function importRegister(
  fileName: string,
  text: string,
  model: ScoringModel,
  mapping?: ColumnMapping,
): BuildResult {
  const table = parseTable(fileName, text)
  return buildRegister(table, mapping ?? detectMapping(table.header), model, fileName)
}

/** A short, human description of a level for the preview and the exports. */
export function describeLevel(model: ScoringModel, axis: 'likelihood' | 'impact', value: number | null): string {
  const scale = axis === 'likelihood' ? model.likelihood : model.impact
  return value === null ? '—' : `${value} · ${labelOf(scale, value)}`
}
