/**
 * Range compression: how much a single cell throws away.
 *
 * Two independent measurements per cell, never added together, because they
 * answer different questions and have different evidential standing.
 *
 *   anchorSpan    What the *scale* cannot resolve. The ratio of the cell's own
 *                 upper annualised-loss bound to its own lower one, computed
 *                 from the configured anchors alone. It exists even for a cell
 *                 holding one risk, and it is a property of the matrix design
 *                 rather than of anybody's assessment. On a typical corporate
 *                 5x5 it is between ten and a hundred: two risks differing by
 *                 an order of magnitude are routinely scored identically, and
 *                 the matrix is incapable of noticing.
 *
 *   estimateSpan  What the *register itself* says the difference is. The ratio
 *                 between the largest and smallest modelled annualised loss
 *                 among the cell's risks that carry their own estimates. This
 *                 is evidence rather than design — and it is only available
 *                 for estimated risks, a count that travels with the finding.
 *
 * The distinction is the honesty of the analysis. Two un-estimated risks in a
 * cell are, as far as the register is concerned, the same risk. PARALLAX does
 * not draw them as different, and does not count them as compressed: it counts
 * them as indistinguishable, which is a different and more useful finding.
 *
 * A third signal, `straddlesAppetite`, is not a span at all. It asks whether
 * the organisation's own decision threshold falls *inside* the cell's band —
 * in which case the score genuinely cannot answer the question being asked of
 * it, regardless of how wide the band is.
 */

import { ANCHOR_SPAN_FLAG, ESTIMATE_SPAN_FLAG } from './limits.ts'
import { annualLossBounds, centralAnnualLoss } from './intervals.ts'
import { labelOf, spanOf, straddles } from './scales.ts'
import { formatSpan } from './stats.ts'
import type {
  AnalysisState,
  CompressionFinding,
  Matrix,
  QuantitativeModel,
  Risk,
  RiskCell,
  RiskRegister,
} from './types.ts'

export interface CompressionInput {
  readonly register: RiskRegister
  readonly matrix: Matrix
  readonly byId: ReadonlyMap<string, Risk>
  readonly models: ReadonlyMap<string, QuantitativeModel>
  /** Ids of risks whose model came from the register rather than the cell. */
  readonly estimatedIds: ReadonlySet<string>
}

export function analyseCompression(input: CompressionInput): CompressionFinding[] {
  const { register, matrix } = input
  const appetite = register.model.appetite?.annualLossThreshold

  const findings: CompressionFinding[] = []
  for (const cell of matrix.cells) {
    if (cell.riskIds.length === 0) continue
    findings.push(analyseCell(input, cell, appetite))
  }

  // Worst first: distorted cells before ambiguous ones, then by how much they
  // hide, then by how many risks are affected by it.
  const order: Record<AnalysisState, number> = {
    distorted: 0,
    'requires-quantification': 1,
    ambiguous: 2,
    inconsistent: 3,
    'insufficient-data': 4,
    supported: 5,
    valid: 6,
  }
  findings.sort(
    (a, b) =>
      order[a.state] - order[b.state] ||
      (b.estimateSpan ?? 0) - (a.estimateSpan ?? 0) ||
      (b.anchorSpan ?? 0) - (a.anchorSpan ?? 0) ||
      b.riskCount - a.riskCount,
  )
  return findings
}

function analyseCell(
  input: CompressionInput,
  cell: RiskCell,
  appetite: number | undefined,
): CompressionFinding {
  const { register, models, estimatedIds } = input
  const { model } = register

  const anchorSpan = spanOf(cell.anchoredAnnualLoss)
  const straddlesAppetite = appetite !== undefined && straddles(cell.anchoredAnnualLoss, appetite)

  const estimatedMembers = cell.riskIds
    .filter((id) => estimatedIds.has(id))
    .map((id) => ({ id, model: models.get(id) }))
    .filter((m): m is { id: string; model: QuantitativeModel } => m.model !== undefined)

  let estimateSpan: number | undefined
  let estimateRange: { lo: number; hi: number } | undefined
  if (estimatedMembers.length >= 2) {
    const centres = estimatedMembers.map((m) => centralAnnualLoss(m.model))
    const lo = Math.min(...centres)
    const hi = Math.max(...centres)
    if (lo > 0 && Number.isFinite(hi)) {
      estimateSpan = hi / lo
      const bounds = estimatedMembers.map((m) => annualLossBounds(m.model))
      estimateRange = {
        lo: Math.min(...bounds.map((b) => b.lo)),
        hi: Math.max(...bounds.map((b) => b.hi)),
      }
    }
  }

  const ordered = [...cell.riskIds].sort((a, b) => {
    const ma = models.get(a)
    const mb = models.get(b)
    const va = ma ? centralAnnualLoss(ma) : -1
    const vb = mb ? centralAnnualLoss(mb) : -1
    return vb - va || a.localeCompare(b)
  })

  const state = stateFor(anchorSpan, estimateSpan, straddlesAppetite)
  const cellName = `${labelOf(model.likelihood, cell.likelihood)} × ${labelOf(model.impact, cell.impact)}`
  const unestimated = cell.riskIds.length - estimatedMembers.length

  return {
    cellKey: cell.key,
    likelihood: cell.likelihood,
    impact: cell.impact,
    score: cell.score,
    riskCount: cell.riskIds.length,
    estimatedCount: estimatedMembers.length,
    anchorSpan,
    anchoredAnnualLoss: cell.anchoredAnnualLoss,
    estimateSpan,
    estimateRange,
    straddlesAppetite,
    orderedRiskIds: ordered,
    state,
    explanation: {
      what: whatFor(cellName, cell, anchorSpan, estimateSpan, straddlesAppetite),
      why: whyFor(input, cell, anchorSpan, estimateSpan, estimatedMembers.length, unestimated),
      assumption:
        anchorSpan === undefined
          ? 'None — no anchors are configured, so nothing quantitative was assumed.'
          : `That the configured anchors describe what levels ${cell.likelihood} and ${cell.impact} mean. The band is the product of the two anchor ranges at their extremes, which is the widest reading and therefore the one that does not understate what the cell hides.`,
      evidence: evidenceFor(cell, estimatedMembers.length, unestimated, anchorSpan),
      next: nextFor(state, straddlesAppetite, estimatedMembers.length, cell.riskIds.length),
    },
  }
}

function stateFor(
  anchorSpan: number | undefined,
  estimateSpan: number | undefined,
  straddlesAppetite: boolean,
): AnalysisState {
  if (estimateSpan !== undefined && estimateSpan >= ESTIMATE_SPAN_FLAG) return 'distorted'
  if (anchorSpan === undefined) return 'insufficient-data'
  if (straddlesAppetite) return 'requires-quantification'
  if (anchorSpan >= ANCHOR_SPAN_FLAG) return 'ambiguous'
  return 'supported'
}

function whatFor(
  cellName: string,
  cell: RiskCell,
  anchorSpan: number | undefined,
  estimateSpan: number | undefined,
  straddlesAppetite: boolean,
): string {
  if (estimateSpan !== undefined && estimateSpan >= ESTIMATE_SPAN_FLAG) {
    return `${cellName} holds risks whose own estimates differ by ${formatSpan(estimateSpan)}, all scored ${cell.score}.`
  }
  if (straddlesAppetite) {
    return `${cellName} spans the risk appetite threshold, so its score cannot say whether these risks are inside it.`
  }
  if (anchorSpan === undefined) {
    return `${cellName} cannot be assessed quantitatively: the scales carry no anchors.`
  }
  if (anchorSpan >= ANCHOR_SPAN_FLAG) {
    return `${cellName} covers a ${formatSpan(anchorSpan)} range of annualised loss.`
  }
  return `${cellName} resolves annualised loss to within ${formatSpan(anchorSpan)}.`
}

function whyFor(
  input: CompressionInput,
  cell: RiskCell,
  anchorSpan: number | undefined,
  estimateSpan: number | undefined,
  estimated: number,
  unestimated: number,
): string {
  const { model } = input.register
  const parts: string[] = []

  if (anchorSpan !== undefined && cell.anchoredAnnualLoss) {
    parts.push(
      `Likelihood level ${cell.likelihood} is anchored at ${fmtRange(model.likelihood.levels.find((l) => l.value === cell.likelihood)?.anchor)} events/year and impact level ${cell.impact} at ${fmtMoney(model.impact.levels.find((l) => l.value === cell.impact)?.anchor, model.currency)} per occurrence. Multiplying the extremes gives an annualised loss anywhere from ${money(cell.anchoredAnnualLoss.lo, model.currency)} to ${money(cell.anchoredAnnualLoss.hi, model.currency)} — a factor of ${formatSpan(anchorSpan)} that the score ${cell.score} cannot distinguish within.`,
    )
  }
  if (estimateSpan !== undefined) {
    parts.push(
      `${estimated} of the ${cell.riskIds.length} risks here carry their own estimates, and those estimates place their central annualised losses ${formatSpan(estimateSpan)} apart. That difference is in the register, not in the model.`,
    )
  }
  if (unestimated > 1) {
    parts.push(
      `The remaining ${unestimated} have no estimates of their own, so nothing in the register distinguishes them from each other at all.`,
    )
  }
  return parts.join(' ')
}

function evidenceFor(
  cell: RiskCell,
  estimated: number,
  unestimated: number,
  anchorSpan: number | undefined,
): string {
  const bits = [`${cell.riskIds.length} risks in ${cell.key} (score ${cell.score})`]
  bits.push(`${estimated} with register estimates, ${unestimated} without`)
  if (anchorSpan !== undefined) bits.push(`cell resolution ${formatSpan(anchorSpan)}`)
  return `${bits.join('; ')}.`
}

function nextFor(
  state: AnalysisState,
  straddlesAppetite: boolean,
  estimated: number,
  total: number,
): string {
  if (state === 'distorted') {
    return 'Open the cell in the matrix view and compare the intervals side by side. Where the difference changes what you would fund, the risks involved belong on the quantification shortlist.'
  }
  if (straddlesAppetite) {
    return 'This is the most useful kind of cell to quantify: the answer to "are we inside appetite?" is currently determined by which side of the band a risk happens to fall on, and nothing records which side that is.'
  }
  if (state === 'insufficient-data') {
    return 'Attach frequency and loss anchors to the scale levels. Until then no cell in the matrix can be assessed for compression.'
  }
  if (estimated < total && total > 1) {
    return `Estimating even two of these ${total} risks would show whether the cell is hiding a real difference. Until then it is only known to be capable of hiding one.`
  }
  return 'Nothing. This cell is not where the register is losing information.'
}

/* ----------------------------- formatting --------------------------------- */

function fmtRange(interval: { lo: number; hi: number } | undefined): string {
  if (!interval) return '—'
  return `${trim(interval.lo)}–${trim(interval.hi)}`
}

function fmtMoney(interval: { lo: number; hi: number } | undefined, currency: string): string {
  if (!interval) return '—'
  return `${money(interval.lo, currency)}–${money(interval.hi, currency)}`
}

function trim(value: number): string {
  if (value >= 1) return String(Math.round(value * 100) / 100)
  return String(Number(value.toPrecision(2)))
}

/** Compact currency for prose. The UI has its own richer formatter. */
export function money(value: number, currency: string): string {
  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : ''
  const abs = Math.abs(value)
  const unitised =
    abs >= 1e9
      ? `${round(value / 1e9)}bn`
      : abs >= 1e6
        ? `${round(value / 1e6)}M`
        : abs >= 1e3
          ? `${round(value / 1e3)}k`
          : String(Math.round(value))
  return symbol ? `${symbol}${unitised}` : `${unitised} ${currency}`
}

function round(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 100) return String(Math.round(value))
  if (abs >= 10) return String(Math.round(value * 10) / 10)
  return String(Math.round(value * 100) / 100)
}
