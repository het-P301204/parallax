/**
 * Rank inversion: where the register's order and the modelled loss disagree.
 *
 * The claim being tested is narrow and stated that way everywhere it appears:
 * *under the configured model*, a risk the register ranks lower carries the
 * larger annualised loss. It is never "risk B is actually worse than risk A".
 * The model is an assumption, the anchors are an assumption, and independence
 * is an assumption; the finding inherits all three and says so.
 *
 * Two generators produce candidates, and they are worth separating because
 * they mean different things:
 *
 *   Structural.  Both risks fall back to their cells' anchors, and the cells'
 *                own anchor-implied losses contradict the cells' own scores.
 *                No estimate is involved: the matrix's anchor definitions and
 *                its scoring formula disagree with each other. This is a
 *                defect in the *design* of the measurement system, it affects
 *                every risk in both cells, and it can be fixed once.
 *
 *   Estimated.   At least one of the two risks carries its own estimate, and
 *                that estimate puts it above a higher-scored risk. This is a
 *                statement about those risks, and it is the kind of finding
 *                that changes what gets funded.
 *
 * Status is graded by how much the data can carry:
 *
 *   confirmed-under-model     The lower-ranked risk's whole annualised-loss
 *                             band sits above the higher-ranked risk's. There
 *                             is no reading of the configured intervals in
 *                             which the register's order holds.
 *   candidate                 The central figures invert but the bands
 *                             overlap. The order may be wrong; these inputs
 *                             cannot settle it.
 *   insufficient-information  One of the two has no model at all.
 */

import {
  EXCEEDANCE_DETAIL_LIMIT,
  MAX_INVERSION_COMPARISONS,
  MAX_INVERSION_FINDINGS,
} from './limits.ts'
import { annualLossBounds, centralAnnualLoss, isEvidenceBacked } from './intervals.ts'
import { money } from './compression.ts'
import { compareModels } from './simulate.ts'
import { compareCells } from './ordinal.ts'
import { formatSpan } from './stats.ts'
import type {
  Interval,
  InversionCandidate,
  InversionStatus,
  QuantitativeModel,
  Risk,
  RiskRegister,
} from './types.ts'

export interface InversionInput {
  readonly register: RiskRegister
  readonly placeable: readonly Risk[]
  readonly byId: ReadonlyMap<string, Risk>
  readonly models: ReadonlyMap<string, QuantitativeModel>
  readonly scoreById: ReadonlyMap<string, number>
  readonly estimatedIds: ReadonlySet<string>
}

interface Draft {
  readonly higher: Risk
  readonly lower: Risk
  readonly higherModel: QuantitativeModel
  readonly lowerModel: QuantitativeModel
  readonly status: InversionStatus
  readonly structural: boolean
  /** Ratio of the lower-ranked risk's central loss to the higher's. */
  readonly ratio: number
}

export interface InversionAnalysis {
  /** Findings kept, worst first. Capped at `MAX_INVERSION_FINDINGS`. */
  readonly candidates: readonly InversionCandidate[]
  /** Every pair found, including those the cap discarded. */
  readonly total: number
  readonly confirmed: number
  /** Whether the display cap discarded findings. */
  readonly truncated: boolean
  /**
   * Set when the comparison budget forced the pass to consider only the N
   * largest modelled exposures rather than every estimated risk.
   */
  readonly restrictedTo?: number
}

export function analyseInversions(input: InversionInput): InversionAnalysis {
  const { placeable, models, scoreById, estimatedIds } = input

  const central = new Map<string, number>()
  const bounds = new Map<string, Interval>()
  for (const risk of placeable) {
    const model = models.get(risk.id)
    if (!model) continue
    central.set(risk.id, centralAnnualLoss(model))
    bounds.set(risk.id, annualLossBounds(model))
  }

  const drafts = new Map<string, Draft>()

  /*
   * Pass one restricts the quadratic comparison to risks that could possibly
   * produce a finding: one side must carry its own estimate, or the pair must
   * be a structural anchor contradiction. In a register where nothing is
   * estimated, that leaves only the cell-level contradictions, of which there
   * are at most one per pair of cells.
   *
   * Where even that is too many -- a very large register in which everything
   * is estimated -- the set is cut to the largest modelled exposures, which
   * are the ones an inversion can involve, and the cut is reported.
   */
  const estimatedRisks = placeable.filter((r) => estimatedIds.has(r.id) && models.has(r.id))
  const budget =
    placeable.length === 0 ? 0 : Math.floor(MAX_INVERSION_COMPARISONS / (2 * placeable.length))
  let restrictedTo: number | undefined
  let interesting = estimatedRisks
  if (estimatedRisks.length > budget && budget > 0) {
    interesting = [...estimatedRisks]
      .sort((a, b) => (central.get(b.id) ?? 0) - (central.get(a.id) ?? 0) || a.id.localeCompare(b.id))
      .slice(0, budget)
    restrictedTo = budget
  }

  for (const candidate of interesting) {
    for (const other of placeable) {
      if (other.id === candidate.id) continue
      consider(input, drafts, other, candidate, central, bounds, false)
      consider(input, drafts, candidate, other, central, bounds, false)
    }
  }

  /*
   * Pass two is over cells rather than rows: when neither risk is estimated,
   * the comparison depends only on the two cells, so it is computed once per
   * cell pair and then expanded to a representative risk pair.
   */
  const byCell = new Map<string, Risk[]>()
  for (const risk of placeable) {
    if (estimatedIds.has(risk.id)) continue
    const key = `L${risk.likelihood}I${risk.impact}`
    const bucket = byCell.get(key)
    if (bucket) bucket.push(risk)
    else byCell.set(key, [risk])
  }
  const cellKeys = [...byCell.keys()]
  for (const aKey of cellKeys) {
    for (const bKey of cellKeys) {
      if (aKey === bKey) continue
      const aRisks = byCell.get(aKey) as Risk[]
      const bRisks = byCell.get(bKey) as Risk[]
      const a = aRisks[0] as Risk
      const b = bRisks[0] as Risk
      const scoreA = scoreById.get(a.id) ?? 0
      const scoreB = scoreById.get(b.id) ?? 0
      if (!(scoreA > scoreB)) continue
      consider(input, drafts, a, b, central, bounds, true)
    }
  }

  const ranked = [...drafts.values()].sort(
    (x, y) =>
      statusRank(x.status) - statusRank(y.status) ||
      Number(y.structural) - Number(x.structural) ||
      y.ratio - x.ratio,
  )
  const kept = ranked.slice(0, MAX_INVERSION_FINDINGS)

  return {
    candidates: kept.map((draft, index) =>
      materialise(input, draft, index < EXCEEDANCE_DETAIL_LIMIT, central, bounds),
    ),
    total: ranked.length,
    confirmed: ranked.filter((d) => d.status === 'confirmed-under-model').length,
    truncated: ranked.length > kept.length,
    restrictedTo,
  }
}

function statusRank(status: InversionStatus): number {
  switch (status) {
    case 'confirmed-under-model':
      return 0
    case 'candidate':
      return 1
    case 'ordinally-indeterminate':
      return 2
    case 'insufficient-information':
      return 3
  }
}

/**
 * Tests one ordered pair and records it if the lower-ranked risk's modelled
 * loss exceeds the higher-ranked one's.
 */
function consider(
  input: InversionInput,
  drafts: Map<string, Draft>,
  higher: Risk,
  lower: Risk,
  central: ReadonlyMap<string, number>,
  bounds: ReadonlyMap<string, Interval>,
  structural: boolean,
): void {
  const { models, scoreById } = input
  const higherScore = scoreById.get(higher.id)
  const lowerScore = scoreById.get(lower.id)
  if (higherScore === undefined || lowerScore === undefined) return
  if (!(higherScore > lowerScore)) return

  const key = `${higher.id}>${lower.id}`
  if (drafts.has(key)) return

  const higherModel = models.get(higher.id)
  const lowerModel = models.get(lower.id)
  if (!higherModel || !lowerModel) return

  const higherCentral = central.get(higher.id)
  const lowerCentral = central.get(lower.id)
  if (higherCentral === undefined || lowerCentral === undefined) return
  if (!(lowerCentral > higherCentral)) return

  const higherBounds = bounds.get(higher.id) as Interval
  const lowerBounds = bounds.get(lower.id) as Interval
  const status: InversionStatus =
    lowerBounds.lo > higherBounds.hi ? 'confirmed-under-model' : 'candidate'

  drafts.set(key, {
    higher,
    lower,
    higherModel,
    lowerModel,
    status,
    structural,
    ratio: lowerCentral / Math.max(higherCentral, Number.MIN_VALUE),
  })
}

function materialise(
  input: InversionInput,
  draft: Draft,
  withExceedance: boolean,
  central: ReadonlyMap<string, number>,
  bounds: ReadonlyMap<string, Interval>,
): InversionCandidate {
  const { register, scoreById } = input
  const { currency } = register.model
  const { higher, lower, higherModel, lowerModel } = draft

  const higherCell = `L${higher.likelihood}I${higher.impact}`
  const lowerCell = `L${lower.likelihood}I${lower.impact}`
  const higherBounds = bounds.get(higher.id) as Interval
  const lowerBounds = bounds.get(lower.id) as Interval

  const crossing =
    compareCells(
      higher.likelihood as number,
      higher.impact as number,
      lower.likelihood as number,
      lower.impact as number,
    ) === 'incomparable'

  const exceedanceProbability = withExceedance
    ? compareModels(higherModel, lowerModel)
    : undefined

  const evidenceSide = isEvidenceBacked(lowerModel) || isEvidenceBacked(higherModel)

  return {
    higherId: higher.id,
    lowerId: lower.id,
    higherScore: scoreById.get(higher.id) ?? 0,
    lowerScore: scoreById.get(lower.id) ?? 0,
    higherCell,
    lowerCell,
    status: draft.status,
    exceedanceProbability,
    explanation: {
      what:
        draft.status === 'confirmed-under-model'
          ? `Under the configured model, "${lower.title}" (score ${scoreById.get(lower.id)}) carries a larger annualised loss than "${higher.title}" (score ${scoreById.get(higher.id)}) across the whole of both intervals.`
          : `Under the configured model, "${lower.title}" (score ${scoreById.get(lower.id)}) has a higher central annualised loss than "${higher.title}" (score ${scoreById.get(higher.id)}), though the intervals overlap.`,
      why: [
        `${higher.id} is modelled at ${money(higherBounds.lo, currency)}–${money(higherBounds.hi, currency)} a year, centred on ${money(central.get(higher.id) ?? 0, currency)}.`,
        `${lower.id} is modelled at ${money(lowerBounds.lo, currency)}–${money(lowerBounds.hi, currency)}, centred on ${money(central.get(lower.id) ?? 0, currency)} — ${formatSpan(draft.ratio)} higher.`,
        draft.structural
          ? `Neither risk carries its own estimate, so both models come from their cells' anchors. The inversion is therefore a property of the scale: cell ${lowerCell} is anchored to a larger annualised loss than cell ${higherCell}, while the scoring formula ranks ${higherCell} above it. The matrix's anchors and its formula disagree.`
          : `At least one of the two carries its own estimate, so the comparison is between what the register says about these risks and what its own scoring formula says.`,
        crossing
          ? 'The pair also crosses on the two axes, so its qualitative order was never determined by the scales in the first place.'
          : `${higher.id} dominates ${lower.id} on both axes, so the qualitative order is ordinally sound — it is the quantitative reading that disagrees with it.`,
      ].join(' '),
      assumption:
        'That the configured intervals describe these risks; that occurrences are Poisson with an uncertain rate and losses lognormal; and that the two risks are independent. Correlated events would change the joint picture but not this pairwise comparison.',
      evidence: `${higher.id} ${higherCell} score ${scoreById.get(higher.id)}; ${lower.id} ${lowerCell} score ${scoreById.get(lower.id)}. Models: ${evidenceSide ? 'at least one register estimate' : 'both from cell anchors'}.${exceedanceProbability === undefined ? '' : ` Paired sampling puts P(${lower.id} exceeds ${higher.id} in a year) at ${(exceedanceProbability * 100).toFixed(0)}%.`}`,
      next:
        draft.status === 'confirmed-under-model'
          ? 'If anything is allocated by rank — attention, budget, a remediation queue — this pair is a place where the ranking is sending it the wrong way. Check the intervals first; they are the assumption doing the work.'
          : 'Not settled. If the decision between these two matters, quantifying them properly is the way to settle it; the shortlist already includes the ones where it would change an answer.',
    },
  }
}

/** Computes the exceedance probability for a pair on demand, for the drawer. */
export function pairExceedance(
  models: ReadonlyMap<string, QuantitativeModel>,
  higherId: string,
  lowerId: string,
): number | undefined {
  const a = models.get(higherId)
  const b = models.get(lowerId)
  if (!a || !b) return undefined
  return compareModels(a, b)
}
