/**
 * The engine's public surface.
 *
 * Everything the interface and the CLI are allowed to use is re-exported here.
 * Nothing in `src/views` imports from a module inside `src/engine` directly:
 * the boundary is what keeps the mathematics testable in a Node process with
 * no DOM, and what makes it possible to say honestly that the CLI and the
 * browser compute the same numbers — they call the same functions.
 */

export * from './types.ts'

export { parseCsv, toCsv, escapeField } from './csv.ts'
export type { CsvTable } from './csv.ts'

export {
  FIELDS,
  FIELD_BY_ID,
  buildRegister,
  detectFormat,
  detectMapping,
  describeLevel,
  importRegister,
  mappingProblems,
  parseDate,
  parseLevel,
  parseNumber,
  parseTable,
  parseTreatment,
} from './import.ts'
export type {
  BuildResult,
  ColumnMapping,
  FieldDescriptor,
  FieldId,
  FieldRequirement,
  MappingProblem,
  RowIssue,
  SourceFormat,
} from './import.ts'

export { ImportError, asImportError, importError } from './errors.ts'
export type { ImportErrorCode } from './errors.ts'

export {
  BANDS_5x5,
  DEFAULT_APPETITE,
  aggregationFormula,
  aggregationRequires,
  anchorOf,
  bandFor,
  cellAnnualLoss,
  defaultModel,
  hasAnchors,
  impactPreset,
  kindSatisfies,
  labelOf,
  levelOf,
  levelValues,
  likelihoodPreset,
  makeScale,
  scoreFor,
  spanOf,
  straddles,
  validateScale,
  weakerKind,
} from './scales.ts'
export type { ScaleProblem } from './scales.ts'

export {
  buildMatrix,
  cellKey,
  cellMap,
  occupiedCells,
  parseCellKey,
  rankByScore,
  scoreCollisions,
} from './matrix.ts'
export type { MatrixBuild } from './matrix.ts'

export { cellLabel, hasEstimate, isPlaceable, selectAnalysable, validateRegister } from './validate.ts'
export type { AnalysableSet } from './validate.ts'

export { auditOrdinal, compareCells, resolutionOf, witnessRelabelling } from './ordinal.ts'
export type { Dominance, Relabelling } from './ordinal.ts'

export { analyseCompression, money } from './compression.ts'
export { analyseInversions, pairExceedance } from './inversion.ts'
export { analyseCalibration } from './calibration.ts'
export { SHORTLIST_FLOOR, TRIAGE_WEIGHTS, triage } from './triage.ts'
export type { TriageResult } from './triage.ts'

export {
  MIN_FREQUENCY,
  MIN_MAGNITUDE,
  annualLossBounds,
  buildModel,
  buildModels,
  centralAnnualLoss,
  evidenceLabel,
  isEvidenceBacked,
} from './intervals.ts'

export { compareModels, defaultSeed, exceedanceAt, simulate, summaryInterval } from './simulate.ts'
export type { SimulateOptions } from './simulate.ts'

export { RELATION_LABEL, RELATION_LIMITS, RELATION_MEANING, relatedIds, relationsFor } from './relations.ts'

export { ENGINE_VERSION, STAGES, analyse } from './report.ts'
export type { StageListener } from './report.ts'

export { EXPORTS, exportReport } from './export.ts'
export type { ExportDescriptor, ExportId } from './export.ts'

export {
  ANCHOR_SPAN_FLAG,
  DEFAULT_ITERATIONS,
  ESTIMATE_SPAN_FLAG,
  MAX_FILE_BYTES,
  MAX_ITERATIONS,
  MAX_ROWS,
  MIN_PERMUTATION_OBSERVATIONS,
  PERMUTATION_DRAWS,
} from './limits.ts'

export { createRng, seedFrom } from './rng.ts'
export { formatSpan, groupBy, distinct, median, quantile } from './stats.ts'
