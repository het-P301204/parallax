/**
 * Quantification triage.
 *
 * The premise of the whole product is that quantifying an entire register is
 * neither necessary nor affordable, and that the useful move is to find the
 * handful of risks where a quantitative answer would *change a decision*. This
 * file is where that handful is chosen.
 *
 * The selection is deliberately not "the highest-scoring risks". A risk scored
 * 25 that everybody already agrees is intolerable and is already being funded
 * does not need a simulation: the decision is made. A risk scored 9 that sits
 * astride the appetite threshold, whose cell hides a fortyfold range, and
 * whose two assessors disagree by two levels — that one is worth a week.
 *
 * Six components, each normalised to [0, 1], each carrying a fixed published
 * weight, each shown to the reader with the raw quantity it came from. The
 * priority is their weighted sum and nothing else: no hidden term, no tuning
 * constant that is not in this file, and the interface renders the breakdown
 * rather than the total alone.
 *
 * The weights are a judgement, and they are stated as one. They are the
 * author's ranking of how often each factor turns out to matter, not an
 * empirical result, and the methodology page says so.
 */

import { annualLossBounds } from './intervals.ts'
import { money } from './compression.ts'
import { compareCells } from './ordinal.ts'
import { logScore, unit } from './stats.ts'
import { formatSpan } from './stats.ts'
import type {
  AnalysisState,
  AssessorCalibration,
  CompressionFinding,
  Matrix,
  QuantificationCandidate,
  QuantitativeModel,
  Risk,
  RiskRegister,
  TriageComponent,
} from './types.ts'

/** Published weights. They sum to 1 and the test asserts that they do. */
export const TRIAGE_WEIGHTS = {
  'decision-proximity': 0.25,
  'ordinal-indeterminacy': 0.2,
  'cell-compression': 0.2,
  'estimate-uncertainty': 0.15,
  'assessor-disagreement': 0.1,
  'treatment-consequence': 0.1,
} as const

/** A risk below this priority is not worth anybody's week. */
export const SHORTLIST_FLOOR = 0.34

/** The shortlist is at most this share of the analysed register. */
export const SHORTLIST_SHARE = 0.08
export const SHORTLIST_MIN = 5
export const SHORTLIST_MAX = 25

export interface TriageInput {
  readonly register: RiskRegister
  readonly matrix: Matrix
  readonly placeable: readonly Risk[]
  readonly models: ReadonlyMap<string, QuantitativeModel>
  readonly compression: readonly CompressionFinding[]
  readonly calibration: readonly AssessorCalibration[]
  readonly scoreById: ReadonlyMap<string, number>
  readonly rankById: ReadonlyMap<string, number>
  readonly estimatedIds: ReadonlySet<string>
  /** Risk ids that appear in at least one inversion finding. */
  readonly inversionIds: ReadonlySet<string>
}

export interface TriageResult {
  readonly candidates: readonly QuantificationCandidate[]
  /** Everything scored, for the analyst view and the exports. */
  readonly all: readonly QuantificationCandidate[]
  /** How many of the shortlist are outside the register's own top N. */
  readonly outsideTopByScore: number
}

export function triage(input: TriageInput): TriageResult {
  const { register, placeable, scoreById, rankById } = input
  const indeterminacy = indeterminacyByCell(input.matrix)
  const compressionByCell = new Map(input.compression.map((c) => [c.cellKey, c]))
  const calibrationByAssessor = new Map(input.calibration.map((c) => [c.assessor, c]))

  const scored = placeable.map((risk) => {
    const components = componentsFor(
      input,
      risk,
      indeterminacy,
      compressionByCell,
      calibrationByAssessor,
    )
    const priority = components.reduce((total, c) => total + c.value * c.weight, 0)
    return { risk, components, priority }
  })

  scored.sort((a, b) => b.priority - a.priority || a.risk.id.localeCompare(b.risk.id))

  const cap = Math.max(
    SHORTLIST_MIN,
    Math.min(SHORTLIST_MAX, Math.ceil(placeable.length * SHORTLIST_SHARE)),
  )
  const shortlistSize = Math.min(
    cap,
    scored.filter((s) => s.priority >= SHORTLIST_FLOOR).length,
  )

  const all = scored.map((entry, index) => {
    const rank = index + 1
    const reasons = reasonsFor(entry.components)
    const state: AnalysisState =
      rank <= shortlistSize ? 'requires-quantification' : entry.priority >= SHORTLIST_FLOOR ? 'ambiguous' : 'supported'
    return {
      riskId: entry.risk.id,
      rank,
      priority: entry.priority,
      components: entry.components,
      reasons,
      qualitativeRank: rankById.get(entry.risk.id) ?? 0,
      qualitativeScore: scoreById.get(entry.risk.id) ?? 0,
      state,
      explanation: explanationFor(register, entry.risk, entry.components, entry.priority, rank, shortlistSize, reasons),
    } satisfies QuantificationCandidate
  })

  const candidates = all.slice(0, shortlistSize)

  // How much the shortlist differs from simply taking the top scores — the
  // number that shows the triage is doing something other than re-sorting.
  const topByScore = new Set(
    [...placeable]
      .sort(
        (a, b) =>
          (scoreById.get(b.id) ?? 0) - (scoreById.get(a.id) ?? 0) || a.id.localeCompare(b.id),
      )
      .slice(0, shortlistSize)
      .map((r) => r.id),
  )
  const outsideTopByScore = candidates.filter((c) => !topByScore.has(c.riskId)).length

  return { candidates, all, outsideTopByScore }
}

/* -------------------------------------------------------------------------- */
/* Components                                                                 */
/* -------------------------------------------------------------------------- */

function componentsFor(
  input: TriageInput,
  risk: Risk,
  indeterminacy: ReadonlyMap<string, number>,
  compressionByCell: ReadonlyMap<string, CompressionFinding>,
  calibrationByAssessor: ReadonlyMap<string, AssessorCalibration>,
): TriageComponent[] {
  const { register, models, estimatedIds, inversionIds } = input
  const cellKey = `L${risk.likelihood}I${risk.impact}`
  const model = models.get(risk.id)
  const compression = compressionByCell.get(cellKey)
  const appetite = register.model.appetite

  /* 1. Decision proximity. ------------------------------------------------ */
  let proximity = 0
  let proximityDetail = 'No risk appetite threshold is configured, so decision proximity cannot be measured.'
  if (appetite && model) {
    const bounds = annualLossBounds(model)
    const threshold = appetite.annualLossThreshold
    if (bounds.lo < threshold && bounds.hi > threshold) {
      proximity = 1
      proximityDetail = `Modelled at ${money(bounds.lo, register.model.currency)}–${money(bounds.hi, register.model.currency)} a year, which straddles the ${money(threshold, register.model.currency)} appetite. The register cannot say which side of it this risk falls.`
    } else {
      // Distance from the threshold, in orders of magnitude, on whichever side.
      const nearest = bounds.hi <= threshold ? bounds.hi : bounds.lo
      const decades = Math.abs(Math.log10(Math.max(nearest, 1) / Math.max(threshold, 1)))
      proximity = unit(1 - decades)
      proximityDetail = `Modelled at ${money(bounds.lo, register.model.currency)}–${money(bounds.hi, register.model.currency)}, entirely ${bounds.hi <= threshold ? 'below' : 'above'} the ${money(threshold, register.model.currency)} appetite — ${decades.toFixed(1)} orders of magnitude away.`
    }
  } else if (appetite && !model) {
    proximityDetail = 'No quantitative model: neither an estimate nor an anchor is available for this risk.'
  }

  /* 2. Ordinal indeterminacy. --------------------------------------------- */
  const share = indeterminacy.get(cellKey) ?? 0
  const indeterminacyDetail =
    share === 0
      ? 'Every ranking involving this risk is determined by dominance.'
      : `${(share * 100).toFixed(0)}% of the orderings between this risk and the rest of the register are not determined by the scales — they depend on the numbers chosen to name the levels.`

  /* 3. Cell compression. --------------------------------------------------- */
  const anchorSpan = compression?.anchorSpan
  const estimateSpan = compression?.estimateSpan
  // Deliberately *not* raised for a cell that straddles the appetite: the
  // decision-proximity component already scores exactly that, and counting it
  // in two components would weight it 0.45 while the published table says
  // 0.25. A transparent score that double-counts is not transparent.
  const compressionValue = Math.max(
    anchorSpan === undefined ? 0 : logScore(anchorSpan, 100),
    estimateSpan === undefined ? 0 : logScore(estimateSpan, 40),
  )
  const compressionDetail = compression
    ? [
        anchorSpan === undefined ? null : `Cell ${cellKey} resolves annualised loss no finer than ${formatSpan(anchorSpan)}.`,
        estimateSpan === undefined
          ? null
          : `Estimated risks in the cell differ by ${formatSpan(estimateSpan)}.`,
        compression.straddlesAppetite ? 'The cell straddles the appetite threshold.' : null,
      ]
        .filter((s): s is string => s !== null)
        .join(' ')
    : 'No compression finding for this cell.'

  /* 4. Estimate uncertainty. ---------------------------------------------- */
  let uncertainty = 0
  let uncertaintyDetail = 'No quantitative model, so the width of the uncertainty is unknown.'
  if (model) {
    const bounds = annualLossBounds(model)
    const width = bounds.lo > 0 ? bounds.hi / bounds.lo : Infinity
    uncertainty = logScore(width, 1000)
    uncertaintyDetail = estimatedIds.has(risk.id)
      ? `The register's own estimate spans ${formatSpan(width)} of annualised loss.`
      : `Inherited from the cell anchors, which span ${formatSpan(width)} of annualised loss. Narrowing this needs an estimate for the risk itself.`
  }
  if (inversionIds.has(risk.id)) {
    uncertainty = Math.max(uncertainty, 0.7)
    uncertaintyDetail += ' It also appears in at least one rank-inversion finding.'
  }

  /* 5. Assessor disagreement. --------------------------------------------- */
  const calibration = risk.assessor ? calibrationByAssessor.get(risk.assessor) : undefined
  const offset = Math.abs(calibration?.likelihoodOffset ?? 0)
  const disagreement = unit(offset / 2)
  const disagreementDetail = !risk.assessor
    ? 'No assessor recorded, so no calibration comparison is possible.'
    : calibration === undefined || calibration.state === 'insufficient-data'
      ? `${risk.assessor} shares too few peer groups for a calibration comparison.`
      : offset === 0
        ? `${risk.assessor} is level with their peers on comparable risks.`
        : `${risk.assessor} scores likelihood ${offset.toFixed(1)} levels ${(calibration.likelihoodOffset ?? 0) > 0 ? 'above' : 'below'} their peers on comparable risks.`

  /* 6. Treatment consequence. --------------------------------------------- */
  const consequence = TREATMENT_CONSEQUENCE[risk.treatment]
  const consequenceDetail = TREATMENT_DETAIL[risk.treatment]

  return [
    component('decision-proximity', 'Decision proximity', proximity, proximityDetail),
    component('ordinal-indeterminacy', 'Ranking not determined', unit(share), indeterminacyDetail),
    component('cell-compression', 'Cell compression', compressionValue, compressionDetail),
    component('estimate-uncertainty', 'Uncertainty width', uncertainty, uncertaintyDetail),
    component('assessor-disagreement', 'Assessor variation', disagreement, disagreementDetail),
    component('treatment-consequence', 'Money at stake', consequence, consequenceDetail),
  ]
}

const TREATMENT_CONSEQUENCE: Record<Risk['treatment'], number> = {
  mitigate: 1,
  transfer: 0.9,
  avoid: 0.8,
  accept: 0.4,
  unknown: 0.3,
}

const TREATMENT_DETAIL: Record<Risk['treatment'], string> = {
  mitigate: 'Marked for mitigation: money is being committed against this number.',
  transfer: 'Marked for transfer: a premium or a contract is being priced against this number.',
  avoid: 'Marked for avoidance: a capability is being given up on the strength of this number.',
  accept: 'Marked as accepted: the decision has been taken, so quantifying it would revisit rather than inform it.',
  unknown: 'No treatment recorded, so it is not clear what decision this number is feeding.',
}

function component(
  id: TriageComponent['id'],
  label: string,
  value: number,
  detail: string,
): TriageComponent {
  return { id, label, value: unit(value), weight: TRIAGE_WEIGHTS[id], detail }
}

/**
 * For each cell, the share of its ordered comparisons with other occupied
 * cells that are not determined by dominance.
 *
 * Computed per cell rather than per risk because every risk in a cell has the
 * same answer, and because it keeps the whole triage linear in the number of
 * risks.
 */
function indeterminacyByCell(matrix: Matrix): Map<string, number> {
  const occupied = matrix.cells.filter((c) => c.riskIds.length > 0)
  const out = new Map<string, number>()
  for (const cell of occupied) {
    let compared = 0
    let crossing = 0
    for (const other of occupied) {
      if (other.key === cell.key) continue
      if (cell.score === other.score) continue
      const weight = other.riskIds.length
      compared += weight
      if (
        compareCells(cell.likelihood, cell.impact, other.likelihood, other.impact) ===
        'incomparable'
      ) {
        crossing += weight
      }
    }
    out.set(cell.key, compared === 0 ? 0 : crossing / compared)
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* Explanation                                                                */
/* -------------------------------------------------------------------------- */

const REASON_TEXT: Record<TriageComponent['id'], string> = {
  'decision-proximity': 'Sits on the appetite threshold',
  'ordinal-indeterminacy': 'Ranking not determined by the scales',
  'cell-compression': 'Cell hides a wide range',
  'estimate-uncertainty': 'Very wide uncertainty',
  'assessor-disagreement': 'Assessors disagree on comparable risks',
  'treatment-consequence': 'Money is being committed against it',
}

/** The components that actually drove the score, biggest contribution first. */
function reasonsFor(components: readonly TriageComponent[]): string[] {
  return [...components]
    .filter((c) => c.value * c.weight >= 0.06)
    .sort((a, b) => b.value * b.weight - a.value * a.weight)
    .slice(0, 3)
    .map((c) => REASON_TEXT[c.id])
}

function explanationFor(
  register: RiskRegister,
  risk: Risk,
  components: readonly TriageComponent[],
  priority: number,
  rank: number,
  shortlistSize: number,
  reasons: readonly string[],
): QuantificationCandidate['explanation'] {
  const leading = [...components].sort((a, b) => b.value * b.weight - a.value * a.weight)
  const top = leading[0] as TriageComponent
  const second = leading[1] as TriageComponent
  const onList = rank <= shortlistSize

  return {
    what: onList
      ? `"${risk.title}" is ${ordinal(rank)} on the quantification shortlist.`
      : `"${risk.title}" is ranked ${rank} for quantification and is below the shortlist cut.`,
    why: reasons.length === 0
      ? 'Nothing about this risk suggests a quantitative model would change a decision about it.'
      : `Mainly ${top.label.toLowerCase()} (${(top.value * 100).toFixed(0)}% of that component, weighted ${top.weight}) and ${second.label.toLowerCase()} (${(second.value * 100).toFixed(0)}%, weighted ${second.weight}). ${top.detail}`,
    assumption:
      'That the six published weights reflect how often each factor changes a decision. They are a stated judgement, not an empirical result, and they are listed in full on the methodology page.',
    evidence: components
      .map((c) => `${c.label} ${c.value.toFixed(2)}×${c.weight}`)
      .join('; ')
      .concat(`; total ${priority.toFixed(3)}.`),
    next: onList
      ? `Give it frequency and loss ranges as 90% intervals — "I would be surprised below X and surprised above Y" — and run the simulation. If the result lands on the same side of ${register.model.appetite ? money(register.model.appetite.annualLossThreshold, register.model.currency) : 'your appetite'} as the current score implies, the score was good enough and you have learned that cheaply.`
      : 'Nothing for now. It stays in the register and is re-triaged whenever the register is re-imported.',
  }
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${suffix}`
}
