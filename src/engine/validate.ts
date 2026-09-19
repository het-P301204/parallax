/**
 * Data quality.
 *
 * This runs before any analysis and decides which rows the analyses are
 * allowed to touch. The principle is stated once and then enforced: a register
 * with 126 rows and 4 unusable ones is never silently a register of 122. The
 * overview shows both numbers, every finding says which rows it could not see,
 * and a risk excluded from the matrix still appears in the table with a reason
 * against it.
 *
 * Findings are grouped by *code* rather than by row, because "9 rows have no
 * assessor" is a conversation and nine separate identical warnings are noise.
 */

import type {
  DataQualityCode,
  DataQualityFinding,
  Explanation,
  Risk,
  RiskRegister,
  Severity,
} from './types.ts'
import type { RowIssue } from './import.ts'
import { labelOf, levelValues, scoreFor } from './scales.ts'

/** Whether a risk can be placed on the matrix at all. */
export function isPlaceable(risk: Risk): boolean {
  return risk.likelihood !== null && risk.impact !== null
}

/** Whether a risk carries its own quantitative estimate. */
export function hasEstimate(risk: Risk): boolean {
  return (
    risk.frequency !== undefined &&
    risk.magnitude !== undefined &&
    risk.frequency.lo >= 0 &&
    risk.frequency.hi >= risk.frequency.lo &&
    risk.magnitude.lo >= 0 &&
    risk.magnitude.hi >= risk.magnitude.lo
  )
}

interface CodeSpec {
  readonly severity: Severity
  readonly title: (count: number) => string
  readonly why: string
  readonly assumption: string
  readonly next: string
}

/**
 * One entry per code. Severity is about *what the analysis can still do*, not
 * about how annoyed anyone should be:
 *
 *   blocking   the row is dropped from at least one analysis
 *   degrading  an analysis runs with less power, or on fewer rows
 *   note       recorded so it is not a surprise later; nothing is affected
 */
const SPECS: Readonly<Record<DataQualityCode, CodeSpec>> = {
  'missing-likelihood': {
    severity: 'blocking',
    title: (n) => `${n} row${n === 1 ? ' has' : 's have'} no likelihood level`,
    why: 'A risk with no likelihood cannot be placed in a cell, so it takes no part in the matrix, the compression analysis or the ranking.',
    assumption: 'None. The cell was blank.',
    next: 'These rows are listed with their row numbers. Either score them or remove them from the export — leaving them in makes the register look larger than the part of it that was actually assessed.',
  },
  'missing-impact': {
    severity: 'blocking',
    title: (n) => `${n} row${n === 1 ? ' has' : 's have'} no impact level`,
    why: 'A risk with no impact cannot be placed in a cell, so it takes no part in the matrix, the compression analysis or the ranking.',
    assumption: 'None. The cell was blank.',
    next: 'Score them, or accept that the matrix describes a smaller register than the file does.',
  },
  'level-out-of-range': {
    severity: 'blocking',
    title: (n) => `${n} level${n === 1 ? ' is' : 's are'} outside the configured scale`,
    why: 'The value is a number, but not one of the levels the configured scale defines. Rounding it to the nearest legal level would invent an assessment nobody made.',
    assumption: 'That the scale configured in the previous step is the one the register was scored under.',
    next: 'Check the scale configuration first — a register scored 0–4 read against a 1–5 scale produces exactly this. If the scale is right, the rows need re-scoring.',
  },
  'level-not-a-number': {
    severity: 'blocking',
    title: (n) => `${n} level${n === 1 ? '' : 's'} could not be read`,
    why: 'The cell held text that is neither a number nor one of the configured level labels — commonly "N/A", "TBC" or a range like "3-4".',
    assumption: 'None.',
    next: 'A level recorded as a range is itself worth noticing: it means the assessor did not believe the scale could separate the two options.',
  },
  'duplicate-id': {
    severity: 'degrading',
    title: (n) => `${n} risk ID${n === 1 ? ' is' : 's are'} used more than once`,
    why: 'Two rows sharing an identifier cannot be told apart by anything downstream of the register — including the next export, a treatment tracker, or this analysis.',
    assumption: 'None.',
    next: 'PARALLAX has suffixed the repeats (#2, #3) so both rows can be addressed, but the underlying register still cannot distinguish them.',
  },
  'missing-id': {
    severity: 'degrading',
    title: (n) => `${n} row${n === 1 ? ' has' : 's have'} no identifier`,
    why: 'Rows without an id were given a positional one, which changes if the register is re-sorted or re-exported.',
    assumption: 'None.',
    next: 'Findings about these rows cannot be matched against a future export. If you intend to track remediation, give them stable ids first.',
  },
  'score-disagrees': {
    severity: 'degrading',
    title: (n) => `${n} stated score${n === 1 ? ' does' : 's do'} not match the configured formula`,
    why: "The register carries a score column, and for these rows its value differs from what the configured aggregation produces from the same two levels.",
    assumption: 'That the configured aggregation is the one the register used.',
    next: 'Either the formula configured here is not the register\'s, or the score column was edited by hand after the levels were. Both are worth knowing before anything is ranked by that column.',
  },
  'missing-assessor': {
    severity: 'degrading',
    title: (n) => `${n} row${n === 1 ? ' has' : 's have'} no assessor`,
    why: 'Calibration compares how different people scored comparable risks. Rows with no assessor cannot take part in that comparison.',
    assumption: 'None.',
    next: 'If most rows lack an assessor, the calibration findings describe only the minority that have one, and the analysis says so where it is shown.',
  },
  'missing-title': {
    severity: 'note',
    title: (n) => `${n} row${n === 1 ? ' has' : 's have'} no title`,
    why: 'Nothing in the analysis needs a title; everything that displays one does.',
    assumption: 'None.',
    next: 'These appear as "Untitled risk" with their row number.',
  },
  'unparseable-date': {
    severity: 'note',
    title: (n) => `${n} assessment date${n === 1 ? '' : 's'} could not be read`,
    why: 'The value was not an ISO date or a recognisable slash date, so the row has no position on the assessment timeline.',
    assumption: 'None.',
    next: 'Only the timeline is affected. Every other analysis ignores dates.',
  },
  'interval-inverted': {
    severity: 'blocking',
    title: (n) => `${n} quantitative interval${n === 1 ? ' has' : 's have'} its bounds reversed`,
    why: 'The low column holds a value above the high column. This is almost always the two columns mapped the wrong way round.',
    assumption: 'None.',
    next: 'Swapping them silently would hide a mapping error that affects every quantitative result, so these estimates are ignored until the mapping is corrected.',
  },
  'interval-incomplete': {
    severity: 'degrading',
    title: (n) => `${n} quantitative estimate${n === 1 ? ' is' : 's are'} missing one bound`,
    why: 'An interval needs both ends. One number on its own is a point estimate, and reading it as an interval would understate the uncertainty by exactly the amount that matters.',
    assumption: 'None.',
    next: 'These rows fall back to their cell\'s scale anchors, which is stated wherever their modelled loss is shown.',
  },
  'negative-quantity': {
    severity: 'blocking',
    title: (n) => `${n} quantitative estimate${n === 1 ? ' is' : 's are'} negative`,
    why: 'A frequency below zero and a loss below zero are both outside the model: the simulation multiplies them and takes logarithms of them.',
    assumption: 'None.',
    next: 'Check whether a spreadsheet formula produced these. They are excluded from every quantitative view.',
  },
}

/**
 * Builds the data-quality findings for an imported register.
 *
 * `issues` comes from the importer, which saw the raw text; this adds the
 * checks that need the scoring model — currently just the score comparison.
 */
export function validateRegister(
  register: RiskRegister,
  issues: readonly RowIssue[],
): readonly DataQualityFinding[] {
  const all: RowIssue[] = [...issues, ...scoreDisagreements(register)]

  const byCode = new Map<DataQualityCode, RowIssue[]>()
  for (const issue of all) {
    const bucket = byCode.get(issue.code)
    if (bucket) bucket.push(issue)
    else byCode.set(issue.code, [issue])
  }

  const findings: DataQualityFinding[] = []
  for (const [code, group] of byCode) {
    const spec = SPECS[code]
    const rows = group.map((g) => g.rowNumber).sort((a, b) => a - b)
    const riskIds = group.map((g) => g.riskId)
    const field = group[0]?.field
    const explanation: Explanation = {
      what: spec.title(group.length),
      why: spec.why,
      assumption: spec.assumption,
      evidence: describeRows(rows, field),
      next: spec.next,
    }
    findings.push({ code, severity: spec.severity, riskIds, rows, field, explanation })
  }

  const order: Record<Severity, number> = { blocking: 0, degrading: 1, note: 2 }
  findings.sort((a, b) => order[a.severity] - order[b.severity] || b.rows.length - a.rows.length)
  return findings
}

/**
 * Rows whose stated score differs from the configured formula.
 *
 * The comparison is exact, and only runs where the register supplied a score
 * and both levels were readable. A tolerance would be the wrong kindness here:
 * a score column is either computed by the same rule as the matrix or it is
 * not, and "within 1" is not a category anybody wants.
 */
function scoreDisagreements(register: RiskRegister): RowIssue[] {
  const out: RowIssue[] = []
  for (const risk of register.risks) {
    if (risk.statedScore === null || !isPlaceable(risk)) continue
    const computed = scoreFor(register.model, risk.likelihood as number, risk.impact as number)
    if (risk.statedScore !== computed) {
      out.push({ code: 'score-disagrees', rowNumber: risk.rowNumber, riskId: risk.id, field: 'score' })
    }
  }
  return out
}

/** "rows 14, 22, 31 and 48 more" — never the contents of those rows. */
function describeRows(rows: readonly number[], field?: string): string {
  const head = rows.slice(0, 8).join(', ')
  const rest = rows.length - 8
  const where = field ? ` in the ${field} column` : ''
  if (rest > 0) return `Source row${rows.length === 1 ? '' : 's'} ${head} and ${rest} more${where}.`
  return `Source row${rows.length === 1 ? '' : 's'} ${head}${where}.`
}

/**
 * The risks each analysis is allowed to use.
 *
 * Kept as one function so that "analysed" means the same thing on the overview
 * counter, in the matrix, and in every export.
 */
export interface AnalysableSet {
  readonly placeable: readonly Risk[]
  readonly excluded: readonly { readonly riskId: string; readonly reason: string }[]
  readonly estimated: readonly Risk[]
}

export function selectAnalysable(register: RiskRegister): AnalysableSet {
  const placeable: Risk[] = []
  const excluded: { riskId: string; reason: string }[] = []
  const estimated: Risk[] = []
  const lValues = levelValues(register.model.likelihood)
  const iValues = levelValues(register.model.impact)

  for (const risk of register.risks) {
    if (risk.likelihood === null || risk.impact === null) {
      excluded.push({
        riskId: risk.id,
        reason:
          risk.likelihood === null && risk.impact === null
            ? 'Neither level could be read.'
            : risk.likelihood === null
              ? 'No likelihood level.'
              : 'No impact level.',
      })
      continue
    }
    if (!lValues.includes(risk.likelihood) || !iValues.includes(risk.impact)) {
      excluded.push({
        riskId: risk.id,
        reason: `Level ${risk.likelihood}/${risk.impact} is outside the configured ${lValues.length}×${iValues.length} scale.`,
      })
      continue
    }
    placeable.push(risk)
    if (hasEstimate(risk)) estimated.push(risk)
  }

  return { placeable, excluded, estimated }
}

/** A one-line description of a risk's cell, used in evidence strings. */
export function cellLabel(register: RiskRegister, risk: Risk): string {
  if (!isPlaceable(risk)) return 'unplaced'
  return `${labelOf(register.model.likelihood, risk.likelihood)} × ${labelOf(register.model.impact, risk.impact)}`
}
