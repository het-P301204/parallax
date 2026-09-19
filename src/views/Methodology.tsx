/**
 * The methodology page.
 *
 * Every number the product shows is defined here, in the same words as the
 * code comment that implements it. This page exists because the product's
 * whole claim is that a measurement should be checkable, and a tool that
 * audits somebody else's arithmetic while hiding its own has not earned the
 * right to make that claim.
 *
 * It reads from the loaded report where it can — the actual weights, the
 * actual limits, the actual scale configuration — so it cannot drift from what
 * was computed.
 */

import type { AuditReport } from '../engine/index.ts'
import {
  ANCHOR_SPAN_FLAG,
  DEFAULT_ITERATIONS,
  ESTIMATE_SPAN_FLAG,
  MIN_PERMUTATION_OBSERVATIONS,
  PERMUTATION_DRAWS,
  SHORTLIST_FLOOR,
  TRIAGE_WEIGHTS,
  aggregationFormula,
} from '../engine/index.ts'
import { Panel, SectionHeading } from '../ui/primitives.tsx'
import { SURFACE, TYPE } from '../ui/tokens.ts'
import { count, money } from '../ui/format.ts'

export function Methodology({ report }: { report?: AuditReport }): React.JSX.Element {
  const model = report?.register.model

  return (
    <div className="space-y-6">
      <SectionHeading
        step="Methodology"
        title="How every number on these pages is computed"
        lead="A tool that audits someone else's arithmetic while hiding its own has not earned the right to be believed. Every definition below matches the comment above the function that implements it."
      />

      <Entry
        title="Ordinal indeterminacy"
        formula="A outranks B under every admissible relabelling ⟺ A.likelihood ≥ B.likelihood and A.impact ≥ B.impact, one strictly"
      >
        <p>
          An ordinal scale is determined only up to a strictly increasing transformation: if 1–5 is
          a faithful labelling of five ranked descriptors, so is 1, 2, 3, 4, 100. A ranking claim is
          supported by the scale only if it survives every such relabelling.
        </p>
        <p>
          For an aggregation that is non-decreasing in both axes — which all four configurable
          aggregations are — that is exactly Pareto dominance. When the score ranks A above B but
          neither dominates, PARALLAX constructs a witness: a relabelling that preserves every
          rung&rsquo;s position and reverses the pair. The witness is shown, so the finding is a
          counterexample rather than an assertion.
        </p>
        <p className="text-ink-3">
          Counted over cells rather than rows. Every risk in a cell has the same levels, so a pair
          of cells contributes |A|×|B| ordered risk pairs of identical character — which is why the
          pair counts are exact even on a register of thousands.
        </p>
      </Entry>

      <Entry
        title="Cell resolution and range compression"
        formula="anchorSpan = (frequency.hi × magnitude.hi) ÷ (frequency.lo × magnitude.lo)"
      >
        <p>
          A cell&rsquo;s annualised-loss band is the product of its two anchors at their extremes:
          the widest reading, and therefore the one that does not understate what the cell hides.
          The ratio of its endpoints is the cell&rsquo;s <em>resolution</em> — the factor by which
          two risks can differ while receiving the same score.
        </p>
        <p>
          A second, independent measurement is taken from the register itself:{' '}
          <span className="font-mono text-2xs text-ink-2">estimateSpan</span>, the ratio between the
          largest and smallest modelled annualised loss among the cell&rsquo;s risks that carry
          their own estimates. The two are never added. A cell is reported as{' '}
          <em>distorted</em> when estimateSpan ≥ {ESTIMATE_SPAN_FLAG}× (evidence that its members
          differ), as <em>requires quantification</em> when the appetite threshold falls inside its
          band, and as <em>ambiguous</em> when only the inherent span exceeds {ANCHOR_SPAN_FLAG}×.
        </p>
        <p className="text-ink-3">
          Two risks in one cell with no estimates of their own are drawn identically, because
          nothing in the register distinguishes them. Drawing them as different would be the same
          error this product exists to find.
        </p>
      </Entry>

      <Entry
        title="Quantitative model"
        formula="λ ~ Lognormal fitted to the frequency 90% interval; N ~ Poisson(λ); loss = Σ Lognormal(magnitude 90% interval)"
      >
        <p>
          Intervals are read as 5th-to-95th percentiles — the range a subject-matter expert can
          state honestly. The rate is itself uncertain, drawn per iteration rather than fixed at a
          midpoint: nobody knows how often these events happen, and a simulation that pretends
          otherwise produces a distribution far narrower than the analyst&rsquo;s actual state of
          knowledge.
        </p>
        <p>
          Lognormal has a lighter tail than the loss distributions seen in practice, so the extreme
          percentiles are, if anything, optimistic. No correlation between risks is modelled.
        </p>
        <p className="text-ink-3">
          Default {count(DEFAULT_ITERATIONS)} iterations. Every result comes from a seed derived
          from the risk identifier, so the same register produces the same percentiles in the
          browser, in the CLI, and in the test suite — and the test suite asserts it.
        </p>
      </Entry>

      <Entry
        title="Rank inversion"
        formula="confirmed ⟺ lower.annualLoss.lo > higher.annualLoss.hi"
      >
        <p>
          A pair is <em>confirmed under the model</em> when the lower-ranked risk&rsquo;s entire
          annualised-loss band sits above the higher-ranked one&rsquo;s — there is no reading of the
          configured intervals in which the register&rsquo;s order holds. It is a{' '}
          <em>candidate</em> when the central figures invert but the bands overlap.
        </p>
        <p>
          Where both risks inherit their models from their cells, the inversion is structural: the
          matrix&rsquo;s own anchors and its own scoring formula disagree with each other. That is a
          defect in the design of the measurement system, it affects every risk in both cells, and
          it can be fixed once.
        </p>
        <p className="text-ink-3">
          The exceedance probability is estimated by paired sampling rather than by comparing
          percentiles: p90(B) &gt; p90(A) says nothing about P(B &gt; A), and conflating the two is
          a common way a risk comparison goes wrong.
        </p>
      </Entry>

      <Entry
        title="Assessor calibration"
        formula="offset = median over shared groups of ( median(their levels) − median(everyone else's levels) )"
      >
        <p>
          Risks are grouped into peer groups by category. Within each group an assessor&rsquo;s
          offset excludes their own rows from the comparison, which makes it paired: an assessor who
          happens to own the frightening systems does not look miscalibrated for agreeing with
          everyone about them.
        </p>
        <p>
          Medians throughout, never means — these are ordinal levels, and the whole product is an
          argument against averaging ordinal levels.
        </p>
        <p>
          Significance is a two-sided permutation test: under the null that assessor identity
          carries no information, the labels within a group are exchangeable, so shuffling them{' '}
          {count(PERMUTATION_DRAWS)} times gives the statistic&rsquo;s null distribution with no
          distributional assumption at all. A p-value is quoted only above{' '}
          {MIN_PERMUTATION_OBSERVATIONS} paired observations.
        </p>
        <p className="text-ink-3">
          The finding is calibration <em>variation</em>. There is no ground truth in a risk register
          to be wrong about, and the product never says an assessor is wrong.
        </p>
      </Entry>

      <Entry title="Quantification triage" formula="priority = Σ (componentᵢ × weightᵢ)">
        <p>
          Six components, each normalised to 0–1, each with a published weight. There is no other
          term, no tuning constant that is not in{' '}
          <span className="font-mono text-2xs">src/engine/triage.ts</span>, and the interface renders
          the breakdown rather than the total.
        </p>
        <ul className="mt-3 space-y-1.5">
          {Object.entries(TRIAGE_WEIGHTS).map(([id, weight]) => (
            <li key={id} className="flex items-baseline justify-between gap-4">
              <span className="text-ink-1">{id}</span>
              <span className="font-mono text-2xs text-ink-2 tnum">{weight.toFixed(2)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3">
          A risk reaches the shortlist above a priority of {SHORTLIST_FLOOR}, capped at 8% of the
          analysed register. The score itself is deliberately absent as a component: a risk scored
          25 that everyone agrees is intolerable and is already funded does not need a simulation,
          because the decision is made.
        </p>
        <p className="text-ink-3">
          The weights are a stated judgement about how often each factor changes a decision, not an
          empirical result. They are the first thing to argue with if the shortlist looks wrong for
          your organisation.
        </p>
      </Entry>

      <Entry title="What PARALLAX does not do" formula="">
        <ul className="space-y-2">
          <li>
            It does not determine the true risk. It determines whether the measurement can support
            the conclusion being drawn from it.
          </li>
          <li>
            It is not a replacement for FAIR or for any organisation&rsquo;s risk methodology. It is
            a measurement audit and a quantification triage — deliberately a much smaller thing.
          </li>
          <li>
            It does not model correlation between risks, tail dependence, control effectiveness over
            time, or the cost of treatment.
          </li>
          <li>
            It cannot tell you whether a level was assessed well. Nothing in a register can.
          </li>
        </ul>
      </Entry>

      {model ? (
        <Panel eyebrow="This register" title="The configuration these findings were computed under">
          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            <Row label="Matrix">
              {model.likelihood.levels.length} × {model.impact.levels.length}
            </Row>
            <Row label="Scale kind">
              {model.likelihood.kind} / {model.impact.kind}
            </Row>
            <Row label="Score formula">{aggregationFormula(model.aggregation)}</Row>
            <Row label="Currency">{model.currency}</Row>
            <Row label="Appetite">
              {model.appetite ? money(model.appetite.annualLossThreshold, model.currency) : 'not set'}
            </Row>
            <Row label="Engine version">{report?.engineVersion}</Row>
          </dl>
        </Panel>
      ) : null}
    </div>
  )
}

function Entry({
  title,
  formula,
  children,
}: {
  title: string
  formula: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Panel title={title}>
      {formula ? (
        <p className={`${SURFACE.well} mb-4 overflow-x-auto px-3 py-2.5 font-mono text-2xs text-quant`}>
          {formula}
        </p>
      ) : null}
      <div className="max-w-3xl space-y-3 text-xs leading-relaxed text-ink-1">{children}</div>
    </Panel>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line-1 py-2 last:border-b-0">
      <dt className={TYPE.eyebrow}>{label}</dt>
      <dd className="font-mono text-xs text-ink-0">{children}</dd>
    </div>
  )
}
