/**
 * The quantification shortlist.
 *
 * The most important claim this view makes is the one printed at the top: how
 * many of the shortlisted risks are *not* in the register's own top N by
 * score. If that number were zero, the whole triage would be an expensive way
 * to re-sort a column, and the reader deserves to know that at a glance.
 *
 * Every priority is shown as its six weighted components rather than as a
 * total. A total is a number somebody will quote; the components are the thing
 * they can argue with, and being arguable is the property that makes a triage
 * decision defensible in a steering committee.
 */

import { useState } from 'react'
import type { AuditReport, QuantificationCandidate } from '../engine/index.ts'
import { TRIAGE_WEIGHTS } from '../engine/index.ts'
import { Bar, ExplanationBlock, EmptyState, Panel, SectionHeading, StateBadge } from '../ui/primitives.tsx'
import { SURFACE, TYPE } from '../ui/tokens.ts'
import { Tooltip } from '../ui/Tooltip.tsx'
import { count } from '../ui/format.ts'
import type { Mode } from '../state.ts'

export function Quantify({
  report,
  mode,
  onOpenRisk,
  onSimulate,
}: {
  report: AuditReport
  mode: Mode
  onOpenRisk: (riskId: string) => void
  onSimulate: (riskId: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState<string | undefined>(report.quantification[0]?.riskId)
  const shortlist = report.quantification

  const topByScore = new Set(
    [...report.register.risks]
      .filter((r) => report.scoreById.has(r.id))
      .sort(
        (a, b) =>
          (report.scoreById.get(b.id) ?? 0) - (report.scoreById.get(a.id) ?? 0) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, shortlist.length)
      .map((r) => r.id),
  )
  const outside = shortlist.filter((c) => !topByScore.has(c.riskId)).length

  return (
    <div className="space-y-6">
      <SectionHeading
        step="Quantification triage"
        title="Which risks actually need quantification?"
        lead="Not the highest-scoring ones. The ones where a quantitative answer could change a decision — because the register cannot say which side of the appetite they fall on, because their ranking is not determined by the scales, or because somebody is about to spend money on the strength of the number."
      />

      {shortlist.length === 0 ? (
        <Panel>
          <EmptyState
            icon="clean"
            title="Nothing reached the shortlist"
            body="No risk scored above the triage floor. That usually means the register carries no quantitative anchors — in which case every component that needs one scored zero, and the honest answer is that triage cannot run rather than that nothing needs quantifying."
          />
        </Panel>
      ) : (
        <>
          <section className={`${SURFACE.panel} p-6`}>
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="max-w-xl">
                <p className={`${TYPE.eyebrow} mb-2`}>Quantify first</p>
                <p className="font-display text-xl font-medium leading-snug tracking-tight text-ink-0">
                  {count(shortlist.length)} of {count(report.summary.risksAnalysed)} risks.{' '}
                  {outside === shortlist.length ? (
                    <>
                      <span className="text-quantify">Not one of them</span> is in the
                      register&rsquo;s own top {shortlist.length} by score.
                    </>
                  ) : outside === 0 ? (
                    <>
                      <span className="text-ambiguous">All of them</span> are also the
                      register&rsquo;s own top {shortlist.length} by score.
                    </>
                  ) : (
                    <>
                      <span className="text-quantify">{count(outside)}</span> of them are not in the
                      register&rsquo;s own top {shortlist.length} by score.
                    </>
                  )}
                </p>
                <p className="mt-3 text-xs leading-relaxed text-ink-2">
                  If that second number were zero, this triage would be an expensive way to re-sort
                  a column. It is printed here so you can check.
                </p>
              </div>
              <ol className="min-w-[14rem] space-y-1.5">
                {shortlist.slice(0, 5).map((candidate) => (
                  <li key={candidate.riskId} className="flex items-baseline gap-2.5">
                    <span className="w-4 shrink-0 font-mono text-xs text-quantify tnum">
                      {candidate.rank}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenRisk(candidate.riskId)}
                      className="truncate-flex text-left text-xs text-ink-1 hover:text-ink-0"
                    >
                      {report.byId.get(candidate.riskId)?.title ?? candidate.riskId}
                      <span className="ml-1.5 font-mono text-[10px] text-ink-3">
                        {report.byId.get(candidate.riskId)?.businessUnit ?? ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <ul className="space-y-3">
            {shortlist.map((candidate) => (
              <li key={candidate.riskId}>
                <CandidateCard
                  report={report}
                  candidate={candidate}
                  open={open === candidate.riskId}
                  onToggle={() => setOpen(open === candidate.riskId ? undefined : candidate.riskId)}
                  onOpenRisk={onOpenRisk}
                  onSimulate={onSimulate}
                />
              </li>
            ))}
          </ul>

          {mode === 'analyst' ? (
            <Panel
              eyebrow="Selection logic"
              title="The six components and their weights"
            >
              <p className="mb-4 max-w-3xl text-xs leading-relaxed text-ink-2">
                The priority is the weighted sum of six values, each normalised to 0–1. There is no
                other term. The weights are a stated judgement about how often each factor changes a
                decision — not an empirical result — and they are the first thing to argue with if
                the shortlist looks wrong for your organisation.
              </p>
              <ul className="space-y-2.5">
                {Object.entries(TRIAGE_WEIGHTS).map(([id, weight]) => (
                  <li key={id} className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_3rem] items-center gap-3">
                    <span className="text-xs text-ink-1">{COMPONENT_TITLE[id] ?? id}</span>
                    <Bar value={weight} tone="accent" />
                    <span className="text-right font-mono text-xs text-ink-2 tnum">
                      {weight.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 border-t border-line-1 pt-3 text-2xs leading-relaxed text-ink-3">
                Deliberately absent: the risk score itself. A risk scored 25 that everyone already
                agrees is intolerable and is already funded does not need a simulation — the decision
                is made. Score enters only through the components that reference it.
              </p>
            </Panel>
          ) : null}
        </>
      )}
    </div>
  )
}

const COMPONENT_TITLE: Record<string, string> = {
  'decision-proximity': 'Sits near the appetite threshold',
  'ordinal-indeterminacy': 'Ranking not determined by the scales',
  'cell-compression': 'Its cell hides a wide range',
  'estimate-uncertainty': 'Wide modelled uncertainty',
  'assessor-disagreement': 'Assessors differ on comparable risks',
  'treatment-consequence': 'Money is being committed against it',
}

function CandidateCard({
  report,
  candidate,
  open,
  onToggle,
  onOpenRisk,
  onSimulate,
}: {
  report: AuditReport
  candidate: QuantificationCandidate
  open: boolean
  onToggle: () => void
  onOpenRisk: (riskId: string) => void
  onSimulate: (riskId: string) => void
}): React.JSX.Element {
  const risk = report.byId.get(candidate.riskId)
  if (!risk) return <div />

  return (
    <article className={`${SURFACE.panel} overflow-hidden`}>
      <div className="flex flex-wrap items-start gap-4 px-5 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-quantify/40 bg-quantify/10 font-display text-sm font-medium text-quantify tnum">
          {candidate.rank}
        </span>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpenRisk(candidate.riskId)}
            className="block text-left"
          >
            <span className="text-sm font-medium text-ink-0 hover:text-accent-strong">
              {risk.title}
            </span>
          </button>
          <p className="mt-0.5 font-mono text-[10px] text-ink-3">
            {candidate.riskId} · {risk.businessUnit ?? 'no unit'} · score{' '}
            {candidate.qualitativeScore} · qualitative rank {candidate.qualitativeRank}
          </p>
          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {candidate.reasons.map((reason) => (
              <li
                key={reason}
                className="rounded-full border border-line-2 px-2 py-0.5 text-[10px] text-ink-2"
              >
                {reason}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <StateBadge state={candidate.state} size="xs" />
          <button
            type="button"
            onClick={() => onSimulate(candidate.riskId)}
            className="rounded border border-quantify/40 bg-quantify/10 px-2.5 py-1.5 text-2xs text-quantify transition-colors duration-140 hover:bg-quantify/20"
          >
            Simulate →
          </button>
        </div>
      </div>

      <div className="border-t border-line-1 px-5 py-3.5">
        <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {candidate.components.map((component) => (
            <Tooltip key={component.id} title={component.label} body={component.detail} width={320}>
              <span className="block w-full cursor-help">
                <span className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="truncate-flex text-[11px] text-ink-2">{component.label}</span>
                  <span className="shrink-0 font-mono text-[10px] text-ink-3 tnum">
                    {component.value.toFixed(2)} × {component.weight}
                  </span>
                </span>
                <Bar value={component.value} tone={component.value > 0.66 ? 'quant' : 'accent'} height={3} />
              </span>
            </Tooltip>
          ))}
        </div>

        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="mt-3.5 text-2xs text-accent transition-colors duration-140 hover:text-accent-strong"
        >
          {open ? 'Hide the reasoning' : 'Why it was selected →'}
        </button>
        {open ? (
          <div className="animate-stage-in mt-3 border-t border-line-1 pt-4">
            <ExplanationBlock explanation={candidate.explanation} />
          </div>
        ) : null}
      </div>
    </article>
  )
}
