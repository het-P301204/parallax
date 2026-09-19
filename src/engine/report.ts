/**
 * The analysis run.
 *
 * One function, eight stages, in the order the product's story tells them. The
 * stages are real: each one does the work its name claims and reports the
 * count it produced, and the progress view in the interface is driven by those
 * counts rather than by a timer. There is no synthetic delay anywhere in this
 * file, and the interface has no percentage that is not a ratio of two things
 * that were counted.
 *
 * Everything downstream of `analyse` is a pure read of the `AuditReport` it
 * returns. No view recomputes an analysis, and no view holds arithmetic of its
 * own beyond formatting.
 */

import { analyseCalibration } from './calibration.ts'
import { analyseCompression } from './compression.ts'
import { analyseInversions } from './inversion.ts'
import { auditOrdinal } from './ordinal.ts'
import { buildMatrix } from './matrix.ts'
import { buildModels } from './intervals.ts'
import { selectAnalysable, validateRegister } from './validate.ts'
import { counted } from './stats.ts'
import { triage } from './triage.ts'
import type { RowIssue } from './import.ts'
import type {
  AuditReport,
  MeasurementConfidence,
  RegisterSummary,
  Risk,
  RiskRegister,
  StageDescriptor,
  StageProgress,
} from './types.ts'

export const ENGINE_VERSION = '0.1.0'

/**
 * The stages, in execution order, with the sentence each one shows while it
 * runs. They are exported so the progress view and the CLI narrate the same
 * run rather than two different fictions of it.
 */
export const STAGES: readonly StageDescriptor[] = [
  {
    id: 'import',
    label: 'Reading the register',
    detail: 'Applying the column mapping and coercing every value, keeping what could not be read.',
  },
  {
    id: 'validate',
    label: 'Checking the data',
    detail: 'Deciding which rows each analysis is allowed to use, and why the rest are excluded.',
  },
  {
    id: 'matrix',
    label: 'Building the matrix',
    detail: 'Placing every usable risk in a cell and computing each cell\'s resolving power.',
  },
  {
    id: 'measurement',
    label: 'Auditing the measurement',
    detail: 'Testing every ranking against all admissible relabellings of the scales.',
  },
  {
    id: 'compression',
    label: 'Measuring compression',
    detail: 'Finding what each cell cannot distinguish, by design and by evidence.',
  },
  {
    id: 'rank',
    label: 'Checking rank order',
    detail: 'Comparing the register\'s order against modelled annualised loss.',
  },
  {
    id: 'calibration',
    label: 'Comparing assessors',
    detail: 'Testing whether comparable risks are scored comparably, by permutation.',
  },
  {
    id: 'triage',
    label: 'Selecting for quantification',
    detail: 'Scoring six published components to find where an answer would change a decision.',
  },
]

export type StageListener = (progress: StageProgress) => void

/**
 * Runs the whole audit.
 *
 * `onStage` is called synchronously as each stage finishes. The browser runs
 * this inside a scheduler that yields between stages so the progress view can
 * paint; the CLI ignores it. Neither adds time to the run.
 */
export function analyse(
  register: RiskRegister,
  issues: readonly RowIssue[] = [],
  onStage?: StageListener,
): AuditReport {
  const emit = (id: StageProgress['id'], produced: number, note: string): void => {
    onStage?.({ id, produced, note })
  }

  /* 1. Import ------------------------------------------------------------- */
  const byId = new Map<string, Risk>(register.risks.map((r) => [r.id, r]))
  emit('import', register.risks.length, `${register.risks.length} rows read`)

  /* 2. Validate ----------------------------------------------------------- */
  const dataQuality = validateRegister(register, issues)
  const { placeable, excluded, estimated } = selectAnalysable(register)
  const estimatedIds = new Set(estimated.map((r) => r.id))
  emit(
    'validate',
    dataQuality.length,
    `${placeable.length} analysable, ${excluded.length} excluded, ${dataQuality.length} findings`,
  )

  /* 3. Matrix ------------------------------------------------------------- */
  const built = buildMatrix(register, placeable)
  const occupied = built.matrix.cells.filter((c) => c.riskIds.length > 0)
  emit('matrix', occupied.length, `${occupied.length} of ${built.matrix.cells.length} cells occupied`)

  /* 4. Measurement -------------------------------------------------------- */
  const ordinal = auditOrdinal({
    register,
    matrix: built.matrix,
    placeable,
    scoreById: built.scoreById,
  })
  emit(
    'measurement',
    ordinal.indeterminateCount,
    `${counted(ordinal.comparedPairs)} pairs compared, ${counted(ordinal.indeterminateCount)} not determined`,
  )

  /* 5. Compression -------------------------------------------------------- */
  const models = buildModels(register, placeable)
  const compression = analyseCompression({
    register,
    matrix: built.matrix,
    byId,
    models,
    estimatedIds,
  })
  const compressed = compression.filter(
    (c) => c.state === 'distorted' || c.state === 'requires-quantification',
  ).length
  emit('compression', compressed, `${compressed} of ${compression.length} occupied cells flagged`)

  /* 6. Rank --------------------------------------------------------------- */
  const inversionAnalysis = analyseInversions({
    register,
    placeable,
    byId,
    models,
    scoreById: built.scoreById,
    estimatedIds,
  })
  const inversions = inversionAnalysis.candidates
  emit(
    'rank',
    inversionAnalysis.total,
    `${inversionAnalysis.total} candidates, ${inversionAnalysis.confirmed} confirmed under the model`,
  )

  /* 7. Calibration -------------------------------------------------------- */
  const calibration = analyseCalibration({ register, placeable })
  const calibrationFindings =
    calibration.assessors.filter((a) => a.state === 'inconsistent' || a.state === 'ambiguous').length +
    calibration.dispersedGroups.length
  emit(
    'calibration',
    calibrationFindings,
    `${calibration.assessors.length} assessors across ${calibration.groups.length} peer groups`,
  )

  /* 8. Triage ------------------------------------------------------------- */
  const inversionIds = new Set<string>()
  for (const inversion of inversions) {
    inversionIds.add(inversion.higherId)
    inversionIds.add(inversion.lowerId)
  }
  const triaged = triage({
    register,
    matrix: built.matrix,
    placeable,
    models,
    compression,
    calibration: calibration.assessors,
    scoreById: built.scoreById,
    rankById: built.rankById,
    estimatedIds,
    inversionIds,
  })
  emit(
    'triage',
    triaged.candidates.length,
    `${triaged.candidates.length} shortlisted, ${triaged.outsideTopByScore} of them outside the top ${triaged.candidates.length} by score`,
  )

  /* Assemble -------------------------------------------------------------- */
  const largestTieGroup = Math.max(
    0,
    ...[...groupSizes(built.scoreById)].map((size) => size),
  )

  const summary: RegisterSummary = {
    risksAnalysed: placeable.length,
    risksImported: register.risks.length,
    risksExcluded: excluded.length,
    occupiedCells: occupied.length,
    totalCells: built.matrix.cells.length,
    indeterminatePairs: ordinal.indeterminateCount,
    comparedPairs: ordinal.comparedPairs,
    inversionCandidates: inversionAnalysis.total,
    confirmedInversions: inversionAnalysis.confirmed,
    inversionsShown: inversions.length,
    compressedCells: compressed,
    calibrationFindings,
    quantificationShortlist: triaged.candidates.length,
    dataQualityFindings: dataQuality.length,
    risksWithEstimates: estimated.length,
    resolutionFloor: built.resolutionFloor,
    resolutionFloorCell: built.resolutionFloorCell,
    largestTieGroup,
  }

  return {
    register,
    matrix: built.matrix,
    summary,
    confidence: measureConfidence(register, summary, ordinal, dataQuality.length, placeable.length),
    dataQuality,
    ordinal,
    compression,
    inversions,
    calibration,
    quantification: triaged.candidates,
    triaged: triaged.all,
    models,
    inversionIds,
    byId,
    scoreById: built.scoreById,
    rankById: built.rankById,
    engineVersion: ENGINE_VERSION,
  }
}

function* groupSizes(scoreById: ReadonlyMap<string, number>): Generator<number> {
  const counts = new Map<number, number>()
  for (const score of scoreById.values()) counts.set(score, (counts.get(score) ?? 0) + 1)
  for (const size of counts.values()) yield size
}

/**
 * Three separate numbers, never averaged into one.
 *
 * Reducing "how much of this register can be trusted" to a single percentage
 * would be the exact operation the product spends eight views objecting to:
 * three incommensurable quantities combined by arithmetic that none of them
 * supports. They are reported side by side with the weakest one named.
 */
function measureConfidence(
  register: RiskRegister,
  summary: RegisterSummary,
  ordinal: AuditReport['ordinal'],
  dataQualityFindings: number,
  analysed: number,
): MeasurementConfidence {
  const orderDeterminacy =
    ordinal.comparedPairs === 0 ? 0 : ordinal.determinatePairs / ordinal.comparedPairs
  const estimateCoverage = analysed === 0 ? 0 : summary.risksWithEstimates / analysed
  const flaggedRows = new Set<string>()
  void dataQualityFindings
  for (const risk of register.risks) {
    if (risk.likelihood === null || risk.impact === null) flaggedRows.add(risk.id)
  }
  const dataCompleteness =
    register.risks.length === 0 ? 0 : 1 - flaggedRows.size / register.risks.length

  const weakest = [
    { label: 'the order of the register is largely not determined by its own scales', value: orderDeterminacy },
    { label: 'almost nothing in the register carries a quantitative estimate', value: estimateCoverage },
    { label: 'a material share of rows could not be placed on the matrix', value: dataCompleteness },
  ].sort((a, b) => a.value - b.value)[0]

  return {
    orderDeterminacy,
    estimateCoverage,
    dataCompleteness,
    limitingFactor: weakest ? weakest.label : 'nothing could be measured',
  }
}
