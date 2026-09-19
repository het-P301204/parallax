/**
 * Turning a row of a register into something that can be simulated.
 *
 * Every quantitative statement in PARALLAX comes from a `QuantitativeModel`,
 * and every `QuantitativeModel` comes from here. There are exactly two ways to
 * get one, and which one was used travels with the model for the rest of its
 * life:
 *
 *   register-estimate  The register supplied a frequency or loss interval for
 *                      this specific risk. This is real evidence about this
 *                      risk, and it is the only thing that can distinguish two
 *                      risks sharing a cell.
 *
 *   scale-anchor       The register supplied nothing, so the model falls back
 *                      to the band the risk's *level* denotes. This is not
 *                      evidence about the risk — it is evidence about the
 *                      cell, and every un-estimated risk in that cell gets an
 *                      identical model.
 *
 * The second point is worth dwelling on, because it is where most tools of
 * this kind quietly cheat. If two risks in the same cell have no estimates of
 * their own, there is nothing in the register that could possibly tell them
 * apart, and any tool that draws them as different distributions has invented
 * the difference. PARALLAX draws them identically and says so.
 */

import { anchorOf } from './scales.ts'
import { hasEstimate } from './validate.ts'
import type {
  EstimateSource,
  Interval,
  QuantitativeModel,
  Risk,
  RiskRegister,
  ScoringModel,
} from './types.ts'

/**
 * A frequency of exactly zero cannot be fitted with a lognormal, and a
 * register that records one is usually recording "we have never seen it"
 * rather than "it is impossible". The interval is clamped to this floor —
 * one occurrence every ten thousand years — and the clamp is listed as an
 * assumption on the model rather than applied silently.
 */
export const MIN_FREQUENCY = 1e-4

/** Likewise for a loss magnitude of zero. */
export const MIN_MAGNITUDE = 1

export function buildModel(register: RiskRegister, risk: Risk): QuantitativeModel | undefined {
  const { model } = register
  const own = hasEstimate(risk)

  const frequency = own && risk.frequency ? risk.frequency : anchorOf(model.likelihood, risk.likelihood)
  const magnitude = own && risk.magnitude ? risk.magnitude : anchorOf(model.impact, risk.impact)
  if (!frequency || !magnitude) return undefined

  const frequencySource: EstimateSource = own && risk.frequency ? 'register-estimate' : 'scale-anchor'
  const magnitudeSource: EstimateSource = own && risk.magnitude ? 'register-estimate' : 'scale-anchor'

  const clampedFrequency = clamp(frequency, MIN_FREQUENCY)
  const clampedMagnitude = clamp(magnitude, MIN_MAGNITUDE)

  return {
    riskId: risk.id,
    frequency: clampedFrequency,
    magnitude: clampedMagnitude,
    frequencySource,
    magnitudeSource,
    currency: model.currency,
    assumptions: assumptionsFor(
      model,
      risk,
      frequencySource,
      magnitudeSource,
      frequency,
      clampedFrequency,
      magnitude,
      clampedMagnitude,
    ),
  }
}

function clamp(interval: Interval, floor: number): Interval {
  const lo = Math.max(interval.lo, floor)
  const hi = Math.max(interval.hi, lo)
  return { lo, hi }
}

function assumptionsFor(
  model: ScoringModel,
  risk: Risk,
  frequencySource: EstimateSource,
  magnitudeSource: EstimateSource,
  frequency: Interval,
  clampedFrequency: Interval,
  magnitude: Interval,
  clampedMagnitude: Interval,
): string[] {
  const out: string[] = []

  out.push(
    frequencySource === 'register-estimate'
      ? 'The frequency range is the one the register supplied for this risk, read as a 90% interval.'
      : `The frequency range is the anchor for likelihood level ${risk.likelihood} — it describes the cell, not this risk. Every un-estimated risk in that cell has the same frequency model.`,
  )
  out.push(
    magnitudeSource === 'register-estimate'
      ? 'The loss range is the one the register supplied for this risk, read as a 90% interval for a single occurrence.'
      : `The loss range is the anchor for impact level ${risk.impact} — it describes the cell, not this risk.`,
  )
  out.push(
    'Occurrences within a year follow a Poisson process whose rate is itself uncertain, with the rate drawn from a lognormal fitted to the frequency interval.',
  )
  out.push(
    'Loss per occurrence is lognormal, fitted so that the supplied interval is its 5th to 95th percentile. Losses from separate occurrences are independent and are added.',
  )
  out.push(
    `No correlation with any other risk in the register is modelled. A simultaneous event affecting several risks at once would produce a heavier joint tail than the sum of these models.`,
  )
  if (clampedFrequency.lo !== frequency.lo) {
    out.push(
      `The lower frequency bound was raised from ${frequency.lo} to ${MIN_FREQUENCY} events/year, because a lognormal cannot be fitted to a bound of zero.`,
    )
  }
  if (clampedMagnitude.lo !== magnitude.lo) {
    out.push(
      `The lower loss bound was raised from ${magnitude.lo} to ${MIN_MAGNITUDE} ${model.currency}, for the same reason.`,
    )
  }
  return out
}

/**
 * The analytic annualised-loss interval: the widest range consistent with the
 * two input intervals, `[f.lo × m.lo, f.hi × m.hi]`.
 *
 * Used wherever a comparison has to be made across every risk at once — the
 * compression analysis, the first pass of the inversion analysis — because
 * simulating hundreds of risks to sort them would be slow and would add
 * sampling noise to a question that does not need it.
 *
 * It is deliberately *wider* than the simulated 90% interval: it is the
 * product of the extremes rather than a percentile of a distribution. Both are
 * shown in the interface, labelled, and never mixed in one comparison.
 */
export function annualLossBounds(model: QuantitativeModel): Interval {
  return { lo: model.frequency.lo * model.magnitude.lo, hi: model.frequency.hi * model.magnitude.hi }
}

/**
 * A single central figure, for ordering. The geometric mean of the analytic
 * bounds, which is the median of the lognormal they were fitted to — the
 * arithmetic mean of two bounds spanning three orders of magnitude is not a
 * central figure of anything.
 */
export function centralAnnualLoss(model: QuantitativeModel): number {
  const { lo, hi } = annualLossBounds(model)
  return Math.sqrt(Math.max(lo, Number.MIN_VALUE) * Math.max(hi, Number.MIN_VALUE))
}

/** Builds a model for every risk that can have one. */
export function buildModels(
  register: RiskRegister,
  risks: readonly Risk[],
): Map<string, QuantitativeModel> {
  const out = new Map<string, QuantitativeModel>()
  for (const risk of risks) {
    const model = buildModel(register, risk)
    if (model) out.set(risk.id, model)
  }
  return out
}

/** True when at least one side of the model came from the register itself. */
export function isEvidenceBacked(model: QuantitativeModel): boolean {
  return model.frequencySource === 'register-estimate' || model.magnitudeSource === 'register-estimate'
}

/** How much of the model is evidence rather than inherited from the cell. */
export function evidenceLabel(model: QuantitativeModel): string {
  const f = model.frequencySource === 'register-estimate'
  const m = model.magnitudeSource === 'register-estimate'
  if (f && m) return 'Estimated for this risk'
  if (f) return 'Frequency estimated; loss from the cell anchor'
  if (m) return 'Loss estimated; frequency from the cell anchor'
  return 'Inherited from the cell anchors'
}
