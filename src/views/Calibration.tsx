/**
 * Assessor calibration.
 *
 * Every word on this page is chosen to avoid an accusation. There is no ground
 * truth in a risk register to be wrong about, so the finding is "these two
 * people read the scale differently", the state is `inconsistent`, and the
 * recommended action is a thirty-minute joint scoring exercise rather than a
 * correction.
 *
 * The chart is a deviation plot rather than a bar chart of raw averages,
 * because the raw average of an assessor's levels says more about which risks
 * they were given than about how they score. Zero is the centre, each
 * assessor's marker is their median paired offset from their peers, and the
 * sample size is printed next to it so a dramatic-looking offset resting on
 * four observations can be seen for what it is.
 */

import { useState } from 'react'
import type { AuditReport } from '../engine/index.ts'
import { MIN_PERMUTATION_OBSERVATIONS } from '../engine/index.ts'
import { ExplanationBlock, EmptyState, Panel, SectionHeading, StateBadge } from '../ui/primitives.tsx'
import { STATE_STYLE, SURFACE, TYPE } from '../ui/tokens.ts'
import { count, pValue, signedLevels } from '../ui/format.ts'
import type { Mode } from '../state.ts'

export function Calibration({
  report,
  mode,
  onFilterAssessor,
}: {
  report: AuditReport
  mode: Mode
  onFilterAssessor: (assessor: string) => void
}): React.JSX.Element {
  const { calibration } = report
  const [open, setOpen] = useState<string | undefined>(
    calibration.assessors.find((a) => a.state === 'inconsistent')?.assessor,
  )

  if (calibration.assessors.length === 0) {
    return (
      <div className="space-y-6">
        <SectionHeading
          step="Calibration"
          title="Are comparable risks scored comparably?"
          lead={calibration.explanation.what}
        />
        <Panel>
          <EmptyState
            title="Calibration cannot be analysed"
            body={calibration.explanation.why}
          />
        </Panel>
      </div>
    )
  }

  const maxOffset = Math.max(
    1,
    ...calibration.assessors.map((a) => Math.abs(a.likelihoodOffset ?? 0)),
    ...calibration.assessors.map((a) => Math.abs(a.impactOffset ?? 0)),
  )

  return (
    <div className="space-y-6">
      <SectionHeading
        step="Calibration"
        title="Are comparable risks scored comparably?"
        lead={calibration.explanation.what}
      />

      <Panel
        eyebrow="Deviation from peers, within shared categories"
        title="Calibration variation"
        actions={<StateBadge state={calibration.state} />}
      >
        <p className="mb-6 max-w-3xl text-xs leading-relaxed text-ink-2">
          Each marker is the median of (that assessor&rsquo;s median level − the median level of
          everyone else scoring the same category), across every category they share with somebody.
          The pairing matters: it means an assessor who owns the genuinely frightening systems does
          not look miscalibrated for agreeing with everyone about them.
        </p>

        <div className="space-y-1">
          {calibration.assessors.map((assessor) => (
            <div key={assessor.assessor}>
              <button
                type="button"
                aria-expanded={open === assessor.assessor}
                onClick={() =>
                  setOpen(open === assessor.assessor ? undefined : assessor.assessor)
                }
                className="grid w-full grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-3 rounded px-1 py-2 text-left transition-colors duration-140 hover:bg-surface-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,11rem)]"
              >
                <span className="min-w-0">
                  <span className="truncate-flex block text-xs text-ink-0">
                    {assessor.assessor}
                  </span>
                  <span className="font-mono text-[10px] text-ink-3 tnum">
                    {count(assessor.riskCount)} rows · {assessor.sharedGroups} shared groups
                  </span>
                </span>

                <DeviationTrack
                  likelihood={assessor.likelihoodOffset}
                  impact={assessor.impactOffset}
                  max={maxOffset}
                  state={assessor.state}
                />

                <span className="flex shrink-0 items-center justify-end gap-2">
                  <span className="font-mono text-[10px] text-ink-2 tnum">
                    {assessor.observations < MIN_PERMUTATION_OBSERVATIONS
                      ? `n=${assessor.observations}`
                      : pValue(assessor.pValue)}
                  </span>
                  <StateBadge state={assessor.state} size="xs" />
                </span>
              </button>

              {open === assessor.assessor ? (
                <div className="animate-stage-in mb-3 ml-1 rounded-md border border-line-1 bg-surface-inset px-4 py-4">
                  <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Figure label="Likelihood offset" value={signedLevels(assessor.likelihoodOffset)} />
                    <Figure label="Impact offset" value={signedLevels(assessor.impactOffset)} />
                    <Figure label="Paired observations" value={String(assessor.observations)} />
                    <Figure
                      label="Permutation test"
                      value={
                        assessor.observations < MIN_PERMUTATION_OBSERVATIONS
                          ? 'not run'
                          : pValue(assessor.pValue)
                      }
                    />
                  </div>
                  <ExplanationBlock explanation={assessor.explanation} compact />
                  <button
                    type="button"
                    onClick={() => onFilterAssessor(assessor.assessor)}
                    className="mt-4 rounded border border-line-2 px-2.5 py-1.5 text-2xs text-ink-2 transition-colors duration-140 hover:border-accent/50 hover:text-accent-strong"
                  >
                    Show only this assessor&rsquo;s rows →
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line-1 pt-4 text-2xs text-ink-3">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-accent" />
            likelihood
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-quant" />
            impact
          </span>
          <span>
            A p-value is only quoted above {MIN_PERMUTATION_OBSERVATIONS} paired observations. Below
            that the test has no power and quoting one would be worse than saying nothing.
          </span>
        </div>
      </Panel>

      {mode === 'analyst' && calibration.dispersedGroups.length > 0 ? (
        <Panel
          eyebrow="Peer groups with wide internal spread"
          title={`${calibration.dispersedGroups.length} group–axis combinations`}
          dense
        >
          <ul className="divide-y divide-line-1">
            {calibration.dispersedGroups.map((group) => (
              <li key={`${group.groupKey}-${group.axis}`} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="min-w-0 text-xs text-ink-1">{group.explanation.what}</p>
                  <StateBadge state={group.state} size="xs" />
                </div>
                <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">{group.explanation.next}</p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {mode === 'analyst' ? (
        <Panel eyebrow="Peer groups" title={`${calibration.groups.length} groups formed by category`} dense>
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line-1 text-ink-3">
                  {['Group', 'Risks', 'Assessors', 'L range', 'L MAD', 'I range', 'I MAD'].map((head) => (
                    <th
                      key={head}
                      className="whitespace-nowrap px-5 py-2 font-mono text-[10px] font-normal uppercase tracking-[0.08em]"
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calibration.groups.map((group) => (
                  <tr key={group.key} className="border-b border-line-1 last:border-b-0">
                    <td className="px-5 py-2 text-ink-0">{group.label}</td>
                    <td className="px-5 py-2 font-mono tnum text-ink-1">{group.riskIds.length}</td>
                    <td className="max-w-xs truncate px-5 py-2 text-ink-2">
                      {group.assessors.join(', ') || '—'}
                    </td>
                    <td className="px-5 py-2 font-mono tnum text-ink-1">{group.likelihoodRange}</td>
                    <td className="px-5 py-2 font-mono tnum text-ink-2">
                      {group.likelihoodMad.toFixed(1)}
                    </td>
                    <td className="px-5 py-2 font-mono tnum text-ink-1">{group.impactRange}</td>
                    <td className="px-5 py-2 font-mono tnum text-ink-2">
                      {group.impactMad.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </div>
  )
}

function DeviationTrack({
  likelihood,
  impact,
  max,
  state,
}: {
  likelihood?: number
  impact?: number
  max: number
  state: Parameters<typeof StateBadge>[0]['state']
}): React.JSX.Element {
  const position = (value: number): number => 50 + (value / (max * 1.15)) * 50
  return (
    <span className={`${SURFACE.well} relative block h-7 w-full`}>
      <span aria-hidden className="absolute inset-y-1 left-1/2 w-px bg-line-3" />
      {likelihood !== undefined ? (
        <span
          className={`absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-560 ease-out ${
            state === 'inconsistent' ? STATE_STYLE.inconsistent.fill : 'bg-accent'
          }`}
          style={{ left: `${position(likelihood)}%` }}
          title={`Likelihood ${signedLevels(likelihood)} levels`}
        />
      ) : null}
      {impact !== undefined ? (
        <span
          className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-quant transition-[left] duration-560 ease-out"
          style={{ left: `${position(impact)}%` }}
          title={`Impact ${signedLevels(impact)} levels`}
        />
      ) : null}
      <span className="absolute -bottom-0.5 left-1 font-mono text-[9px] text-ink-3">−{max}</span>
      <span className="absolute -bottom-0.5 right-1 font-mono text-[9px] text-ink-3">+{max}</span>
    </span>
  )
}

function Figure({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <p className={`${TYPE.eyebrow} mb-1`}>{label}</p>
      <p className="font-mono text-sm text-ink-0 tnum">{value}</p>
    </div>
  )
}
