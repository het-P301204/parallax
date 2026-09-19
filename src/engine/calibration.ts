/**
 * Assessor calibration.
 *
 * The question is not "who is wrong". Nothing in a risk register can answer
 * that, because there is no ground truth in it to be wrong about. The question
 * is narrower and answerable: *do comparable risks receive comparable levels
 * regardless of who scored them?* If they do not, then a score carries
 * information about its author as well as about its subject, and a ranking
 * built from scores by different authors is mixing two signals.
 *
 * Every word in the output is chosen with that in mind. The finding is
 * "calibration variation", the state is `inconsistent`, and the recommended
 * next step is a conversation rather than a correction.
 *
 * Method
 * ------
 * Risks are grouped into *peer groups* — by category, by default — on the
 * argument that two risks in the same category are similar enough that a
 * systematic difference in how they are scored is worth noticing.
 *
 * Within each group, an assessor's offset is the difference between the median
 * level of the risks *they* scored and the median level of the risks scored by
 * *everyone else in that group*. The exclusion is what makes the comparison
 * paired: an assessor who happens to own the genuinely frightening systems
 * would otherwise look miscalibrated for agreeing with everybody about them.
 *
 * An assessor's overall offset is the median of their per-group offsets. A
 * median rather than a mean throughout: these are ordinal levels, and the
 * whole product is an argument against averaging ordinal levels.
 *
 * Significance is a two-sided permutation test. Under the null hypothesis that
 * assessor identity carries no information, the assessor labels within a group
 * are exchangeable; shuffling them and recomputing the statistic gives its null
 * distribution directly, with no distributional assumption at all. The p-value
 * is the share of shuffles whose statistic is at least as extreme as the
 * observed one. It is reported only when there are enough paired observations
 * for the test to have any power, and it is never the only thing shown — the
 * offset and the sample size sit next to it.
 *
 * One limitation worth knowing, because it is a property of the statistic
 * rather than a bug. The median is a threshold: if every risk in a peer group
 * received the *same* level from each assessor — all 5s from one, all 3s from
 * the other — then a permuted split lands on those same two medians roughly
 * half the time no matter how many rows there are, so the test cannot reach
 * significance however much such data it is given. It reports `ambiguous`,
 * which is the correct answer: a group with no internal variation contains no
 * evidence that the difference is about the assessor rather than about the
 * group itself. Real registers have spread, and with spread the test converges
 * quickly. `analysis.test.ts` pins both behaviours.
 */

import { MIN_PERMUTATION_OBSERVATIONS, PERMUTATION_DRAWS } from './limits.ts'
import { createRng, seedFrom } from './rng.ts'
import { labelOf } from './scales.ts'
import { counted, distinct, mad, median, range } from './stats.ts'
import type {
  AnalysisState,
  AssessorCalibration,
  CalibrationAnalysis,
  PeerGroup,
  Risk,
  RiskRegister,
  ScaleAxis,
} from './types.ts'

/** A group needs this many risks before its dispersion means anything. */
const MIN_GROUP_SIZE = 3

/** And this many distinct assessors before a comparison is possible. */
const MIN_GROUP_ASSESSORS = 2

/** Levels apart before a group's internal dispersion is reported. */
const DISPERSION_FLAG = 2

/** Offset, in levels, at which a systematic difference is worth a finding. */
const OFFSET_FLAG = 1

export interface CalibrationInput {
  readonly register: RiskRegister
  readonly placeable: readonly Risk[]
  /** How risks are grouped into peers. Category by default. */
  readonly groupBy?: 'category' | 'businessUnit'
}

interface Observation {
  readonly assessor: string
  readonly likelihood: number
  readonly impact: number
}

interface Group {
  readonly key: string
  readonly label: string
  readonly riskIds: string[]
  readonly observations: Observation[]
}

export function analyseCalibration(input: CalibrationInput): CalibrationAnalysis {
  const { register, placeable } = input
  const dimension = input.groupBy ?? 'category'

  const groups = buildGroups(placeable, dimension)
  const usable = groups.filter(
    (g) =>
      g.riskIds.length >= MIN_GROUP_SIZE &&
      distinct(g.observations.map((o) => o.assessor)).length >= MIN_GROUP_ASSESSORS,
  )

  const peerGroups: PeerGroup[] = groups.map((g) => ({
    key: g.key,
    label: g.label,
    riskIds: g.riskIds,
    assessors: distinct(g.observations.map((o) => o.assessor)).sort(),
    likelihoodRange: range(g.observations.map((o) => o.likelihood)),
    impactRange: range(g.observations.map((o) => o.impact)),
    likelihoodMad: mad(g.observations.map((o) => o.likelihood)),
    impactMad: mad(g.observations.map((o) => o.impact)),
  }))

  const assessors = analyseAssessors(register, usable)
  const dispersedGroups = analyseDispersion(register, peerGroups, usable)

  const withAssessor = placeable.filter((r) => r.assessor !== undefined).length
  const flagged = assessors.filter((a) => a.state === 'inconsistent').length

  const state: AnalysisState =
    usable.length === 0
      ? 'insufficient-data'
      : flagged > 0
        ? 'inconsistent'
        : dispersedGroups.some((d) => d.state === 'inconsistent')
          ? 'ambiguous'
          : 'supported'

  return {
    groups: peerGroups,
    assessors,
    dispersedGroups,
    state,
    explanation: {
      what:
        usable.length === 0
          ? 'Calibration could not be analysed.'
          : flagged > 0
            ? `${flagged} assessor${flagged === 1 ? ' scores' : 's score'} comparable risks systematically differently from their peers.`
            : `No assessor differs systematically from their peers by a full level, across ${usable.length} comparable groups.`,
      why:
        usable.length === 0
          ? `A comparison needs groups of at least ${MIN_GROUP_SIZE} comparable risks scored by at least ${MIN_GROUP_ASSESSORS} different people. ${withAssessor} of ${placeable.length} analysed rows name an assessor, and ${usable.length} of ${groups.length} ${dimension === 'category' ? 'categories' : 'business units'} met the threshold.`
          : `Each assessor's offset is the median, across the groups they share with others, of their median level minus the median level of everyone else in that group. The comparison is paired inside each group, so it is not affected by which risks an assessor happened to be given.`,
      assumption: `That risks in the same ${dimension === 'category' ? 'category' : 'business unit'} are comparable enough that a systematic difference in scoring is about the scorer. Where a category mixes genuinely different exposures, that assumption is weak and the finding should be read as a prompt rather than a result.`,
      evidence: `${usable.length} usable groups of ${groups.length}; ${distinct(placeable.map((r) => r.assessor ?? '')).filter((a) => a !== '').length} named assessors; ${withAssessor} of ${placeable.length} rows carry one.`,
      next:
        flagged > 0
          ? 'Put the flagged assessor and one peer in a room with five risks from a shared group and ask each to score them independently. Thirty minutes settles whether it is a difference in judgement or a difference in reading the scale.'
          : 'Nothing here needs action. The scale definitions appear to be read consistently.',
    },
  }
}

/* -------------------------------------------------------------------------- */

function buildGroups(
  risks: readonly Risk[],
  dimension: 'category' | 'businessUnit',
): Group[] {
  const map = new Map<string, Group>()
  for (const risk of risks) {
    const raw = dimension === 'category' ? risk.category : risk.businessUnit
    const key = raw ?? '(unclassified)'
    let group = map.get(key)
    if (!group) {
      group = { key, label: raw ?? 'Unclassified', riskIds: [], observations: [] }
      map.set(key, group)
    }
    group.riskIds.push(risk.id)
    if (risk.assessor !== undefined && risk.likelihood !== null && risk.impact !== null) {
      group.observations.push({
        assessor: risk.assessor,
        likelihood: risk.likelihood,
        impact: risk.impact,
      })
    }
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/* -------------------------------------------------------------------------- */
/* Offsets and the permutation test                                           */
/* -------------------------------------------------------------------------- */

interface OffsetResult {
  readonly offset: number | undefined
  readonly observations: number
}

/**
 * One assessor's offset within one group: their median level minus the median
 * level of every *other* assessor's risks in that group.
 */
function groupOffset(
  observations: readonly Observation[],
  assessor: string,
  axis: ScaleAxis,
): number | undefined {
  const mine: number[] = []
  const theirs: number[] = []
  for (const o of observations) {
    const value = axis === 'likelihood' ? o.likelihood : o.impact
    if (o.assessor === assessor) mine.push(value)
    else theirs.push(value)
  }
  if (mine.length === 0 || theirs.length === 0) return undefined
  return median(mine) - median(theirs)
}

function offsetAcrossGroups(
  groups: readonly Group[],
  assessor: string,
  axis: ScaleAxis,
): OffsetResult {
  const offsets: number[] = []
  let observations = 0
  for (const group of groups) {
    const offset = groupOffset(group.observations, assessor, axis)
    if (offset === undefined) continue
    offsets.push(offset)
    observations += group.observations.filter((o) => o.assessor === assessor).length
  }
  return { offset: offsets.length === 0 ? undefined : median(offsets), observations }
}

/**
 * Two-sided permutation p-values for every assessor at once.
 *
 * One pass of shuffles serves all assessors, which keeps the whole analysis
 * well under a frame even on a large register: each draw permutes the assessor
 * labels inside every group once, then reads off each assessor's statistic
 * from the permuted labelling.
 */
function permutationPValues(
  groups: readonly Group[],
  assessors: readonly string[],
  axis: ScaleAxis,
  observed: ReadonlyMap<string, number>,
): Map<string, number> {
  const rng = createRng(seedFrom(`calibration:${axis}`, 0x70726d74))
  const atLeastAsExtreme = new Map<string, number>(assessors.map((a) => [a, 0]))

  // Working copies so the shuffle does not disturb the real observations.
  const shuffled = groups.map((g) => ({
    labels: g.observations.map((o) => o.assessor),
    values: g.observations.map((o) => (axis === 'likelihood' ? o.likelihood : o.impact)),
  }))

  for (let draw = 0; draw < PERMUTATION_DRAWS; draw += 1) {
    for (const group of shuffled) {
      for (let i = group.labels.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng.next() * (i + 1))
        const swap = group.labels[i] as string
        group.labels[i] = group.labels[j] as string
        group.labels[j] = swap
      }
    }

    for (const assessor of assessors) {
      const target = observed.get(assessor)
      if (target === undefined) continue
      const offsets: number[] = []
      for (const group of shuffled) {
        const mine: number[] = []
        const theirs: number[] = []
        for (let i = 0; i < group.labels.length; i += 1) {
          const value = group.values[i] as number
          if (group.labels[i] === assessor) mine.push(value)
          else theirs.push(value)
        }
        if (mine.length === 0 || theirs.length === 0) continue
        offsets.push(median(mine) - median(theirs))
      }
      if (offsets.length === 0) continue
      const statistic = median(offsets)
      if (Math.abs(statistic) >= Math.abs(target) - 1e-9) {
        atLeastAsExtreme.set(assessor, (atLeastAsExtreme.get(assessor) as number) + 1)
      }
    }
  }

  const out = new Map<string, number>()
  for (const assessor of assessors) {
    // The +1 in both places is the standard correction: a permutation p-value
    // of exactly zero is not a thing that 4,000 draws can establish.
    out.set(assessor, ((atLeastAsExtreme.get(assessor) as number) + 1) / (PERMUTATION_DRAWS + 1))
  }
  return out
}

function analyseAssessors(register: RiskRegister, groups: readonly Group[]): AssessorCalibration[] {
  const names = distinct(groups.flatMap((g) => g.observations.map((o) => o.assessor))).sort()
  if (names.length === 0) return []

  const likelihood = new Map<string, OffsetResult>()
  const impact = new Map<string, OffsetResult>()
  for (const name of names) {
    likelihood.set(name, offsetAcrossGroups(groups, name, 'likelihood'))
    impact.set(name, offsetAcrossGroups(groups, name, 'impact'))
  }

  const testable = names.filter(
    (n) => (likelihood.get(n)?.observations ?? 0) >= MIN_PERMUTATION_OBSERVATIONS,
  )
  const observedL = new Map(
    testable.map((n) => [n, likelihood.get(n)?.offset ?? 0] as const),
  )
  const pValues = testable.length > 0 ? permutationPValues(groups, testable, 'likelihood', observedL) : new Map()

  return names
    .map((name) => {
      const l = likelihood.get(name) as OffsetResult
      const i = impact.get(name) as OffsetResult
      const shared = groups.filter(
        (g) => groupOffset(g.observations, name, 'likelihood') !== undefined,
      ).length
      const riskCount = groups.reduce(
        (total, g) => total + g.observations.filter((o) => o.assessor === name).length,
        0,
      )
      const pValue = pValues.get(name) as number | undefined
      const state = assessorState(l.offset, i.offset, l.observations, shared, pValue)

      return {
        assessor: name,
        riskCount,
        sharedGroups: shared,
        observations: l.observations,
        likelihoodOffset: l.offset,
        impactOffset: i.offset,
        pValue,
        state,
        explanation: assessorExplanation(register, name, l, i, shared, pValue, state),
      }
    })
    .sort(
      (a, b) =>
        Math.abs(b.likelihoodOffset ?? 0) - Math.abs(a.likelihoodOffset ?? 0) ||
        a.assessor.localeCompare(b.assessor),
    )
}

function assessorState(
  likelihoodOffset: number | undefined,
  impactOffset: number | undefined,
  observations: number,
  sharedGroups: number,
  pValue: number | undefined,
): AnalysisState {
  if (likelihoodOffset === undefined || sharedGroups < 2) return 'insufficient-data'
  const biggest = Math.max(Math.abs(likelihoodOffset), Math.abs(impactOffset ?? 0))
  if (biggest < OFFSET_FLAG) return 'supported'
  if (observations < MIN_PERMUTATION_OBSERVATIONS || pValue === undefined) return 'ambiguous'
  return pValue < 0.05 ? 'inconsistent' : 'ambiguous'
}

function assessorExplanation(
  register: RiskRegister,
  name: string,
  likelihood: OffsetResult,
  impact: OffsetResult,
  sharedGroups: number,
  pValue: number | undefined,
  state: AnalysisState,
): AssessorCalibration['explanation'] {
  const direction = (offset: number | undefined): string =>
    offset === undefined
      ? 'no comparable observations'
      : offset > 0
        ? `${fmtOffset(offset)} above their peers`
        : offset < 0
          ? `${fmtOffset(-offset)} below their peers`
          : 'level with their peers'

  const scale = register.model.likelihood
  const exemplar =
    likelihood.offset !== undefined && Math.abs(likelihood.offset) >= 1
      ? ` In practice that is the difference between calling something "${labelOf(scale, 3)}" and "${labelOf(scale, likelihood.offset > 0 ? 4 : 2)}".`
      : ''

  return {
    what:
      state === 'insufficient-data'
        ? `${name} cannot be compared: they share too few peer groups with other assessors.`
        : `${name} scores likelihood ${direction(likelihood.offset)} and impact ${direction(impact.offset)} on comparable risks.`,
    why:
      state === 'insufficient-data'
        ? `A paired comparison needs at least two groups in which ${name} and someone else both scored risks. They have ${sharedGroups}.`
        : `Across ${sharedGroups} shared peer groups and ${likelihood.observations} of their assessments, the median of (their median level − the median level of everyone else in the group) is ${fmtSigned(likelihood.offset)} for likelihood and ${fmtSigned(impact.offset)} for impact.${exemplar}`,
    assumption:
      'That risks in a peer group are comparable. The test makes no distributional assumption: significance comes from shuffling the assessor labels within each group and recomputing the statistic.',
    evidence:
      pValue === undefined
        ? `${likelihood.observations} paired observations across ${sharedGroups} groups. Below the ${MIN_PERMUTATION_OBSERVATIONS}-observation threshold for a permutation test, so no p-value is quoted.`
        : `${likelihood.observations} paired observations across ${sharedGroups} groups; permutation p = ${pValue.toFixed(3)} over ${counted(PERMUTATION_DRAWS)} shuffles.`,
    next:
      state === 'inconsistent'
        ? `This is calibration variation, not error — there is no ground truth here to be wrong about. The useful next step is a short joint scoring exercise: give ${name} and a peer the same five risks and compare, which usually reveals that one of them reads a scale label differently from the other.`
        : state === 'ambiguous'
          ? 'The difference is a level or more but the data cannot separate it from chance. Worth watching rather than acting on.'
          : 'Consistent with their peers. Nothing to do.',
  }
}

function fmtOffset(value: number): string {
  const rounded = Math.round(Math.abs(value) * 10) / 10
  return `${rounded} level${rounded === 1 ? '' : 's'}`
}

function fmtSigned(value: number | undefined): string {
  if (value === undefined) return '—'
  const rounded = Math.round(value * 10) / 10
  return rounded > 0 ? `+${rounded}` : String(rounded)
}

/* -------------------------------------------------------------------------- */
/* Group dispersion                                                           */
/* -------------------------------------------------------------------------- */

function analyseDispersion(
  register: RiskRegister,
  peerGroups: readonly PeerGroup[],
  usable: readonly Group[],
): CalibrationAnalysis['dispersedGroups'] {
  const usableKeys = new Set(usable.map((g) => g.key))
  const out: CalibrationAnalysis['dispersedGroups'][number][] = []

  for (const group of peerGroups) {
    if (!usableKeys.has(group.key)) continue
    for (const axis of ['likelihood', 'impact'] as const) {
      const spread = axis === 'likelihood' ? group.likelihoodRange : group.impactRange
      const dispersion = axis === 'likelihood' ? group.likelihoodMad : group.impactMad
      if (spread < DISPERSION_FLAG) continue
      const scale = axis === 'likelihood' ? register.model.likelihood : register.model.impact
      out.push({
        groupKey: group.key,
        axis,
        range: spread,
        mad: dispersion,
        state: dispersion >= 1 ? 'inconsistent' : 'ambiguous',
        explanation: {
          what: `Risks in "${group.label}" were given ${axis} levels spanning ${spread} rungs.`,
          why: `${group.riskIds.length} risks, scored by ${group.assessors.length} assessor${group.assessors.length === 1 ? '' : 's'}, span ${spread} levels of ${scale.name.toLowerCase()} with a median absolute deviation of ${dispersion.toFixed(1)}. A wide spread is not itself a problem — a category can genuinely contain both small and large exposures — but combined with several assessors it is where a scale is being read differently.`,
          assumption: `That "${group.label}" groups risks that are comparable. If it is a catch-all category, the spread says more about the taxonomy than about the scoring.`,
          evidence: `Group "${group.key}": ${group.riskIds.length} risks, assessors ${group.assessors.join(', ')}, ${axis} range ${spread}, MAD ${dispersion.toFixed(2)}.`,
          next: 'Open the group and look at the extremes together. Either they are genuinely different risks that share a label, or the label is being applied to two different things.',
        },
      })
    }
  }

  return out.sort((a, b) => b.range - a.range || b.mad - a.mad)
}
