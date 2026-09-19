/**
 * The PARALLAX domain model.
 *
 * Read this file first. Every analysis in `src/engine` is a pure function from
 * the types below to the types below, and the UI in `src/views` renders these
 * shapes without doing arithmetic of its own.
 *
 * Two conventions run through the whole model and are worth stating once.
 *
 * 1. Nothing is asserted that the configured model does not establish. Where
 *    an answer depends on an assumption, the assumption travels with the
 *    answer -- every finding carries an `Explanation` whose `assumption` field
 *    says what had to be true for the finding to hold. Where the data cannot
 *    settle a question, the answer is the literal state `insufficient-data`
 *    rather than a confident-looking default.
 *
 * 2. A *level* is the number written in the register (1..5). A *quantity* is a
 *    frequency in events per year or a loss in currency. The two are never
 *    mixed in one field, and converting between them always goes through an
 *    anchor the user configured. `likelihood: 4` is never silently treated as
 *    "twice as likely as 2".
 */

/* -------------------------------------------------------------------------- */
/* Scales                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What the numbers on a scale are entitled to do.
 *
 *   ordinal   The levels are ranked labels. `4 > 3` is meaningful; `4 - 3`,
 *             `4 / 2` and `mean(2, 4) = 3` are not. Almost every corporate
 *             5x5 matrix is this, whatever its column headers imply.
 *   interval  Differences are meaningful, ratios are not (a temperature
 *             scale). Addition and averaging are defensible; multiplication
 *             of two such scales is not.
 *   ratio     There is a true zero and ratios are meaningful. A frequency in
 *             events per year, or a loss in currency, is this. Multiplication
 *             is defensible.
 *
 * The distinction is the whole point of the measurement audit: it decides
 * which of the register's own arithmetic survives contact with its own scale
 * definition.
 */
export type ScaleKind = 'ordinal' | 'interval' | 'ratio'

export const SCALE_KINDS: readonly ScaleKind[] = ['ordinal', 'interval', 'ratio']

/** A closed numeric range. Used for anchors and for estimate intervals. */
export interface Interval {
  readonly lo: number
  readonly hi: number
}

/**
 * One rung of a scale.
 *
 * `anchor` is the optional quantitative band the organisation attached to the
 * level -- "Likely means 0.3 to 1 occurrences per year", "Major means
 * £100k to £1M". It is what makes any quantitative statement in PARALLAX
 * possible; without it every quantitative view honestly reports
 * `insufficient-data` rather than inventing a number.
 *
 * An anchor does *not* upgrade the scale to ratio. It says what band the label
 * denotes; the level number itself stays a label.
 */
export interface ScaleLevel {
  readonly value: number
  readonly label: string
  readonly description?: string
  readonly anchor?: Interval
}

export type ScaleAxis = 'likelihood' | 'impact'

export interface Scale {
  readonly axis: ScaleAxis
  readonly name: string
  readonly kind: ScaleKind
  readonly levels: readonly ScaleLevel[]
  /** Unit the anchors are expressed in, for labelling only. */
  readonly anchorUnit: string
  /**
   * Free text from the organisation describing what the scale is meant to
   * mean. Shown beside the audit so the reader can judge the call themselves.
   */
  readonly definition?: string
}

/* -------------------------------------------------------------------------- */
/* Scoring model                                                              */
/* -------------------------------------------------------------------------- */

/**
 * How the register turns two levels into one number.
 *
 *   product  likelihood x impact -- the near-universal default, and the one
 *            that requires both scales to be ratio to mean anything.
 *   sum      likelihood + impact -- requires interval or better.
 *   max      max(likelihood, impact) -- ordinal-safe.
 *   lookup   an explicit matrix of scores, one per cell -- ordinal-safe if the
 *            table is only ever read as a ranking.
 */
export type Aggregation = 'product' | 'sum' | 'max' | 'lookup'

export const AGGREGATIONS: readonly Aggregation[] = ['product', 'sum', 'max', 'lookup']

/** A named band the register uses to describe a score range. */
export interface ScoreBand {
  readonly label: string
  readonly min: number
  readonly max: number
}

/**
 * The decision the register's numbers are being used to make.
 *
 * PARALLAX is about whether the numbers can support a *decision*, so it needs
 * to know what the decision is. This is the smallest useful statement of one:
 * a loss level above which the organisation has said it will act. Triage uses
 * it to decide which risks are genuinely decision-sensitive rather than merely
 * high-scoring.
 */
export interface Appetite {
  readonly label: string
  /** Annualised loss, in `currency`, above which the organisation acts. */
  readonly annualLossThreshold: number
}

export interface ScoringModel {
  readonly likelihood: Scale
  readonly impact: Scale
  readonly aggregation: Aggregation
  /**
   * For `aggregation: 'lookup'`, `lookup[impact - 1][likelihood - 1]`.
   * Ignored otherwise.
   */
  readonly lookup?: readonly (readonly number[])[]
  readonly currency: string
  readonly bands: readonly ScoreBand[]
  readonly appetite?: Appetite
}

/* -------------------------------------------------------------------------- */
/* Risks                                                                      */
/* -------------------------------------------------------------------------- */

export type TreatmentId = 'accept' | 'mitigate' | 'transfer' | 'avoid' | 'unknown'

export const TREATMENTS: readonly TreatmentId[] = [
  'accept',
  'mitigate',
  'transfer',
  'avoid',
  'unknown',
]

/**
 * One row of the register, after import and coercion.
 *
 * `likelihood` and `impact` are levels, and are `null` when the row did not
 * carry a usable one -- a missing level is data the analysis must route around
 * rather than a zero.
 *
 * `statedScore` is what the register itself wrote in its score column, kept
 * separate from the score PARALLAX computes. A disagreement between the two is
 * a data-quality finding rather than something to silently correct.
 *
 * `frequency` and `magnitude` are per-risk quantitative estimates the register
 * supplied for itself, read as 90% intervals. They are the only source of
 * within-cell quantitative difference that is not an assumption: two risks in
 * the same cell with no estimates of their own are, by construction,
 * indistinguishable, and PARALLAX says exactly that rather than manufacturing
 * a difference.
 */
export interface Risk {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly likelihood: number | null
  readonly impact: number | null
  readonly statedScore: number | null
  readonly category?: string
  readonly owner?: string
  readonly businessUnit?: string
  readonly assessor?: string
  /** ISO `YYYY-MM-DD`, or undefined when absent or unparseable. */
  readonly assessedOn?: string
  readonly treatment: TreatmentId
  readonly controls?: string
  /** 90% interval, events per year. */
  readonly frequency?: Interval
  /** 90% interval, currency per event. */
  readonly magnitude?: Interval
  /** 1-based row in the source file, so a message can point at it. */
  readonly rowNumber: number
}

/** A register as imported: rows plus the model they were scored under. */
export interface RiskRegister {
  readonly name: string
  readonly risks: readonly Risk[]
  readonly model: ScoringModel
  /** Where it came from, for the provenance line. Never a full path. */
  readonly sourceName: string
  readonly importedRowCount: number
}

/* -------------------------------------------------------------------------- */
/* Matrix                                                                     */
/* -------------------------------------------------------------------------- */

/** One cell of the matrix, and everything that landed in it. */
export interface RiskCell {
  /** `L{likelihood}I{impact}`, stable and sortable. */
  readonly key: string
  readonly likelihood: number
  readonly impact: number
  /** The score the configured aggregation gives this cell. */
  readonly score: number
  /** The band label the score falls in, if the model defines bands. */
  readonly band?: string
  readonly riskIds: readonly string[]
  /**
   * The annualised loss band the cell's *own anchors* imply, before any
   * per-risk estimate is considered. Undefined when either axis lacks
   * anchors.
   */
  readonly anchoredAnnualLoss?: Interval
}

export interface Matrix {
  readonly likelihoodLevels: readonly number[]
  readonly impactLevels: readonly number[]
  readonly cells: readonly RiskCell[]
  /** Risks that could not be placed, with the reason. */
  readonly unplaced: readonly { readonly riskId: string; readonly reason: string }[]
  /** Distinct scores produced by the cells, ascending. */
  readonly distinctScores: readonly number[]
}

/* -------------------------------------------------------------------------- */
/* Findings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The seven states any finding, cell or risk can be in.
 *
 *   supported                the measurement supports the conclusion drawn
 *   valid                    the operation is legitimate for this scale kind
 *   ambiguous                the numbers cannot separate these cases
 *   distorted                the scale materially misrepresents a difference
 *   inconsistent             comparable inputs were scored differently
 *   requires-quantification  only a quantitative model can settle this
 *   insufficient-data        the register does not contain enough to say
 *
 * Every one of them has a one-line meaning in `src/ui/tokens.ts` that the UI
 * shows on hover, because a status nobody can define is a colour.
 */
export type AnalysisState =
  | 'valid'
  | 'supported'
  | 'ambiguous'
  | 'distorted'
  | 'inconsistent'
  | 'requires-quantification'
  | 'insufficient-data'

export const ANALYSIS_STATES: readonly AnalysisState[] = [
  'valid',
  'supported',
  'ambiguous',
  'distorted',
  'inconsistent',
  'requires-quantification',
  'insufficient-data',
]

/**
 * The five questions every finding in PARALLAX has to answer before it is
 * allowed on screen. An unexplained mathematical flag is noise.
 */
export interface Explanation {
  /** What was found, in one sentence, in the reader's terms. */
  readonly what: string
  /** Why it follows from the data and the model. */
  readonly why: string
  /** What had to be true. Stated even when the answer is "nothing". */
  readonly assumption: string
  /** Which rows, columns or values the finding was computed from. */
  readonly evidence: string
  /** What the reader should do next. Never "fix your register". */
  readonly next: string
}

/* ---------------------------- Data quality -------------------------------- */

export type DataQualityCode =
  | 'missing-likelihood'
  | 'missing-impact'
  | 'level-out-of-range'
  | 'level-not-a-number'
  | 'duplicate-id'
  | 'missing-id'
  | 'score-disagrees'
  | 'missing-assessor'
  | 'missing-title'
  | 'unparseable-date'
  | 'interval-inverted'
  | 'interval-incomplete'
  | 'negative-quantity'

export type Severity = 'blocking' | 'degrading' | 'note'

/**
 * A problem with the input, found before any analysis runs.
 *
 * `blocking` rows are excluded from the analyses that need the missing field
 * and counted openly, so a register with 126 rows and 4 unusable ones never
 * silently becomes a register of 122.
 */
export interface DataQualityFinding {
  readonly code: DataQualityCode
  readonly severity: Severity
  readonly riskIds: readonly string[]
  readonly rows: readonly number[]
  readonly field?: string
  readonly explanation: Explanation
}

/* ------------------------- Ordinal validity ------------------------------- */

/** An operation the register performs on its levels. */
export type OrdinalOperationId =
  | 'aggregate'
  | 'rank-by-score'
  | 'score-difference'
  | 'average-levels'
  | 'band-threshold'

/**
 * One line of the measurement audit: an operation the register performs, and
 * whether the declared scale kind entitles it to.
 */
export interface OrdinalOperationFinding {
  readonly id: OrdinalOperationId
  readonly title: string
  /** What the register does, quoted in its own terms. */
  readonly registerDoes: string
  /** What the scale definition actually says the numbers are. */
  readonly scaleMeans: string
  /** The minimum scale kind the operation needs to be defensible. */
  readonly requires: ScaleKind
  readonly state: AnalysisState
  readonly explanation: Explanation
  /** How many risks or pairs the operation is applied to, for weight. */
  readonly affected: number
}

/**
 * A pair of risks whose order is not preserved by every admissible
 * re-labelling of the scales.
 *
 * An ordinal scale is defined only up to a strictly increasing transform: if
 * the levels 1..5 are labels for "Rare".."Almost certain", then relabelling
 * them 1, 2, 3, 4, 100 is exactly as faithful to the definition. A ranking
 * claim therefore only survives the scale's own definition if it holds under
 * *every* such relabelling.
 *
 * For a monotone aggregation, that is equivalent to Pareto dominance: A
 * outranks B under all admissible relabellings precisely when A's likelihood
 * and impact are both >= B's, with at least one strict. When the register's
 * score says A > B but neither dominates, the order is an artefact of the
 * particular numbers chosen for the labels -- and `witness` exhibits one
 * legal relabelling that reverses it.
 */
export interface IndeterminatePair {
  readonly aId: string
  readonly bId: string
  /** Score of A and B under the configured aggregation. */
  readonly aScore: number
  readonly bScore: number
  readonly aCell: string
  readonly bCell: string
  /**
   * A strictly increasing relabelling of the levels under which the order
   * reverses, proving the original order was not ordinally determined.
   */
  readonly witness: {
    readonly likelihood: readonly number[]
    readonly impact: readonly number[]
    readonly aScore: number
    readonly bScore: number
  }
}

export interface OrdinalAudit {
  readonly scaleKinds: { readonly likelihood: ScaleKind; readonly impact: ScaleKind }
  readonly aggregation: Aggregation
  readonly operations: readonly OrdinalOperationFinding[]
  /**
   * Materialised examples, worst first. Capped at `MAX_PAIR_FINDINGS`: the
   * exact total is `indeterminateCount`, which is computed from cell
   * occupancies and is never truncated.
   */
  readonly indeterminatePairs: readonly IndeterminatePair[]
  /** Exact number of crossing ordered pairs, whatever was materialised. */
  readonly indeterminateCount: number
  /**
   * Ordered pairs where the aggregation ranks A above B although B dominates A
   * on both axes. Impossible for the arithmetic aggregations; reachable for a
   * hand-written lookup table, where it is a defect of the table.
   */
  readonly contradictingCount: number
  /** Whether `indeterminatePairs` stopped short of the full set. */
  readonly truncated: boolean
  /** Comparable ordered pairs considered, i.e. the denominator. */
  readonly comparedPairs: number
  /** Pairs whose order holds under every admissible relabelling. */
  readonly determinatePairs: number
  /** Distinct (likelihood, impact) cells that share a score with another. */
  readonly collidingCells: readonly (readonly string[])[]
  readonly state: AnalysisState
  readonly explanation: Explanation
}

/* --------------------------- Compression ---------------------------------- */

/**
 * How much information a single cell throws away.
 *
 * Two independent quantities, never added together:
 *
 *   `anchorSpan`   The ratio of the cell's own upper annualised-loss bound to
 *                  its own lower one, from the scale anchors alone. This is
 *                  inherent to the matrix: any two risks inside the cell can
 *                  differ by this factor and still be scored identically. It
 *                  exists even if the cell holds one risk.
 *
 *   `estimateSpan` The ratio between the widest and narrowest modelled
 *                  annualised loss among the cell's risks that carry their own
 *                  estimates. This is evidence from the register rather than
 *                  from the scale -- and it is only available for the risks
 *                  that were estimated, a count the finding always carries.
 *
 * `state` is `distorted` only when `estimateSpan` is large enough that the
 * cell's members provably differ, `ambiguous` when only the inherent
 * `anchorSpan` is large, and `insufficient-data` when neither can be computed.
 */
export interface CompressionFinding {
  readonly cellKey: string
  readonly likelihood: number
  readonly impact: number
  readonly score: number
  readonly riskCount: number
  readonly estimatedCount: number
  readonly anchorSpan?: number
  readonly anchoredAnnualLoss?: Interval
  readonly estimateSpan?: number
  readonly estimateRange?: Interval
  /**
   * Whether the configured risk appetite threshold falls strictly inside the
   * cell's own annualised-loss band. When it does, the score cannot answer
   * "is this inside appetite?" for anything in the cell — which is usually
   * the only question the score was being asked.
   */
  readonly straddlesAppetite: boolean
  /** Risk ids ordered by modelled annualised loss, widest first. */
  readonly orderedRiskIds: readonly string[]
  readonly state: AnalysisState
  readonly explanation: Explanation
}

/* ---------------------------- Inversion ----------------------------------- */

/**
 * How firmly an inversion is established.
 *
 *   confirmed-under-model  B's modelled annualised loss interval lies entirely
 *                          above A's, while A ranks above B qualitatively.
 *                          True *under the configured assumptions*, which is
 *                          the strongest claim a model is entitled to make.
 *   candidate              B's median exceeds A's, but the intervals overlap.
 *                          The register's rank may be wrong; the data cannot
 *                          settle it.
 *   ordinally-indeterminate The qualitative rank itself is not preserved under
 *                          admissible relabelling. No quantitative claim is
 *                          needed to doubt it.
 *   insufficient-information Not enough estimates or anchors to compare.
 */
export type InversionStatus =
  | 'confirmed-under-model'
  | 'candidate'
  | 'ordinally-indeterminate'
  | 'insufficient-information'

export interface InversionCandidate {
  /** The risk the register ranks higher. */
  readonly higherId: string
  /** The risk the register ranks lower. */
  readonly lowerId: string
  readonly higherScore: number
  readonly lowerScore: number
  readonly higherCell: string
  readonly lowerCell: string
  readonly status: InversionStatus
  /** Modelled annualised loss for each, when available. */
  readonly higherLoss?: LossSummary
  readonly lowerLoss?: LossSummary
  /**
   * P(lower's annualised loss > higher's), estimated from paired draws of the
   * two models under a shared seed. Undefined when either lacks a model.
   */
  readonly exceedanceProbability?: number
  readonly explanation: Explanation
}

/* --------------------------- Calibration ---------------------------------- */

/**
 * A group of risks that are comparable enough for a scoring difference between
 * them to mean something -- same category, by default.
 */
export interface PeerGroup {
  readonly key: string
  readonly label: string
  readonly riskIds: readonly string[]
  readonly assessors: readonly string[]
  /** Dispersion of likelihood levels inside the group. */
  readonly likelihoodRange: number
  readonly impactRange: number
  readonly likelihoodMad: number
  readonly impactMad: number
}

/**
 * One assessor's systematic offset from their peers.
 *
 * Computed *paired*: within each peer group the assessor shares with at least
 * one other assessor, take the difference between their median level and the
 * group median excluding them, then take the median of those differences. The
 * pairing matters -- an assessor who only ever reviews the scary systems would
 * otherwise look miscalibrated for agreeing with everyone about them.
 *
 * `pValue` is a two-sided permutation test over group labels under a fixed
 * seed, reported only when `observations >= MIN_PERMUTATION_OBSERVATIONS`. It
 * is a description of dispersion, not a verdict on a person.
 */
export interface AssessorCalibration {
  readonly assessor: string
  readonly riskCount: number
  /** Peer groups where this assessor overlaps at least one other. */
  readonly sharedGroups: number
  readonly observations: number
  readonly likelihoodOffset?: number
  readonly impactOffset?: number
  readonly pValue?: number
  readonly state: AnalysisState
  readonly explanation: Explanation
}

export interface CalibrationAnalysis {
  readonly groups: readonly PeerGroup[]
  readonly assessors: readonly AssessorCalibration[]
  /** Groups whose internal dispersion is wide enough to flag, worst first. */
  readonly dispersedGroups: readonly {
    readonly groupKey: string
    readonly axis: ScaleAxis
    readonly range: number
    readonly mad: number
    readonly state: AnalysisState
    readonly explanation: Explanation
  }[]
  readonly state: AnalysisState
  readonly explanation: Explanation
}

/* -------------------------- Quantification -------------------------------- */

/** One transparent component of the triage score, in [0, 1]. */
export interface TriageComponent {
  readonly id:
    | 'decision-proximity'
    | 'ordinal-indeterminacy'
    | 'cell-compression'
    | 'estimate-uncertainty'
    | 'assessor-disagreement'
    | 'treatment-consequence'
  readonly label: string
  readonly value: number
  readonly weight: number
  /** The raw quantity the value was normalised from, for the analyst view. */
  readonly detail: string
}

export interface QuantificationCandidate {
  readonly riskId: string
  readonly rank: number
  readonly priority: number
  readonly components: readonly TriageComponent[]
  /** Short reasons, ordered by contribution. Shown as chips. */
  readonly reasons: readonly string[]
  readonly qualitativeRank: number
  readonly qualitativeScore: number
  readonly state: AnalysisState
  readonly explanation: Explanation
}

/* ------------------------- Quantitative model ----------------------------- */

/**
 * Where an interval came from. Displayed everywhere an interval is, because
 * an interval the user supplied and an interval derived from a scale anchor
 * deserve very different amounts of trust.
 */
export type EstimateSource = 'register-estimate' | 'scale-anchor' | 'none'

export interface QuantitativeModel {
  readonly riskId: string
  /** 90% interval, events per year. */
  readonly frequency: Interval
  /** 90% interval, currency per event. */
  readonly magnitude: Interval
  readonly frequencySource: EstimateSource
  readonly magnitudeSource: EstimateSource
  readonly currency: string
  /** Plain-language statement of every assumption baked into the above. */
  readonly assumptions: readonly string[]
}

/** The summary statistics of a simulated annualised loss distribution. */
export interface LossSummary {
  readonly mean: number
  readonly p10: number
  readonly p50: number
  readonly p90: number
  readonly p95: number
  readonly p99: number
  readonly max: number
  /** Share of iterations with no loss at all. */
  readonly zeroShare: number
}

/** One point of a loss exceedance curve: P(annual loss > `loss`). */
export interface ExceedancePoint {
  readonly loss: number
  readonly probability: number
}

export interface SimulationResult {
  readonly riskId: string
  readonly iterations: number
  readonly seed: number
  readonly summary: LossSummary
  readonly exceedance: readonly ExceedancePoint[]
  /** Histogram of non-zero annual losses, on a log-spaced grid. */
  readonly histogram: readonly { readonly lo: number; readonly hi: number; readonly count: number }[]
  /** P(annual loss > appetite threshold), when an appetite is configured. */
  readonly probabilityOverAppetite?: number
  readonly model: QuantitativeModel
}

/* --------------------------- Relationships -------------------------------- */

export type RelationKind =
  | 'same-cell'
  | 'potential-inversion'
  | 'same-assessor'
  | 'same-business-unit'
  | 'same-category'
  | 'quantification-group'

export interface RiskRelation {
  readonly kind: RelationKind
  readonly aId: string
  readonly bId: string
  /** Why these two are linked, in one phrase. */
  readonly note: string
}

/* ----------------------------- Report ------------------------------------- */

/** The headline counts on the overview. Every one is a length, not a guess. */
export interface RegisterSummary {
  readonly risksAnalysed: number
  readonly risksImported: number
  readonly risksExcluded: number
  readonly occupiedCells: number
  readonly totalCells: number
  readonly indeterminatePairs: number
  readonly comparedPairs: number
  /** Every inversion found, including any the display cap discarded. */
  readonly inversionCandidates: number
  readonly confirmedInversions: number
  /** How many of them `report.inversions` actually carries. */
  readonly inversionsShown: number
  readonly compressedCells: number
  readonly calibrationFindings: number
  readonly quantificationShortlist: number
  readonly dataQualityFindings: number
  readonly risksWithEstimates: number
  /**
   * The narrowest annualised-loss band any cell of the matrix has, as a ratio.
   * The matrix's resolving power: the smallest difference in annualised loss
   * the scoring system is capable of noticing anywhere on the grid.
   */
  readonly resolutionFloor?: number
  readonly resolutionFloorCell?: string
  /** Largest number of risks sharing one score, i.e. the biggest tie group. */
  readonly largestTieGroup: number
}

/**
 * How much of the register's own conclusions PARALLAX could check, and how
 * much of what it checked held. Deliberately *not* a single trust score: the
 * three numbers measure different things and averaging them would be exactly
 * the kind of arithmetic this product exists to object to.
 */
export interface MeasurementConfidence {
  /** Share of compared pairs whose order survives admissible relabelling. */
  readonly orderDeterminacy: number
  /** Share of analysed risks carrying their own quantitative estimate. */
  readonly estimateCoverage: number
  /** Share of analysed rows with no blocking or degrading data-quality flag. */
  readonly dataCompleteness: number
  /** The limiting factor, named. */
  readonly limitingFactor: string
}

export interface AuditReport {
  readonly register: RiskRegister
  readonly matrix: Matrix
  readonly summary: RegisterSummary
  readonly confidence: MeasurementConfidence
  readonly dataQuality: readonly DataQualityFinding[]
  readonly ordinal: OrdinalAudit
  readonly compression: readonly CompressionFinding[]
  readonly inversions: readonly InversionCandidate[]
  readonly calibration: CalibrationAnalysis
  readonly quantification: readonly QuantificationCandidate[]
  /**
   * Every risk that scored above the shortlist floor, ranked. The shortlist is
   * the head of this list; the tail is what the analyst view shows when asked
   * "why is X not on it?".
   */
  readonly triaged: readonly QuantificationCandidate[]
  readonly models: ReadonlyMap<string, QuantitativeModel>
  /**
   * Ids that appear in at least one inversion finding, for badging. The
   * relationship *graph* is derived per risk by `relationsFor`, because a
   * global edge list on a 1,000-row register is neither drawable nor useful.
   */
  readonly inversionIds: ReadonlySet<string>
  /** Analysed risks, by id, for O(1) lookup from any view. */
  readonly byId: ReadonlyMap<string, Risk>
  /** Computed score per risk id, under the configured aggregation. */
  readonly scoreById: ReadonlyMap<string, number>
  /** 1-based rank by computed score, ties sharing the lower rank. */
  readonly rankById: ReadonlyMap<string, number>
  /** Version of the analysis, so an export can be matched to the code. */
  readonly engineVersion: string
}

/* ----------------------------- Progress ----------------------------------- */

/** The real stages of an analysis run, in the order they execute. */
export type StageId =
  | 'import'
  | 'validate'
  | 'matrix'
  | 'measurement'
  | 'compression'
  | 'rank'
  | 'calibration'
  | 'triage'

export interface StageDescriptor {
  readonly id: StageId
  readonly label: string
  readonly detail: string
}

/** Emitted as each stage completes, with the count that stage produced. */
export interface StageProgress {
  readonly id: StageId
  readonly produced: number
  readonly note: string
}
