# Methodology

Every number PARALLAX shows, defined. The definitions here match the comment
above the function that implements it; where they differ, the code is right and
this document is a bug.

A tool that audits somebody else's arithmetic while hiding its own has not
earned the right to be believed.

---

## 0. The claim

PARALLAX evaluates the **validity of a measurement method**. It does not
determine the true risk, and it is not able to: nothing in a risk register can
establish what a risk actually is.

What it can establish is narrower and more useful — **which of the conclusions
being drawn from the register follow from the assessments, and which follow
from the notation the assessments were written in.**

---

## 1. Scale kinds

| Kind | Meaningful | Not meaningful |
|---|---|---|
| **Ordinal** | `4 > 3` | `4 − 3`, `4 ÷ 2`, `mean(2, 4)` |
| **Interval** | `4 > 3`, `4 − 3` | `4 ÷ 2` |
| **Ratio** | all of the above | — |

Almost every corporate 5×5 matrix is ordinal, whatever its column headers
imply. The user declares the kind during import, and the declaration decides
which of the register's own arithmetic the audit accepts.

An **anchor** — "Likely means 0.4 to 1.2 occurrences per year" — does not
upgrade a scale. It says what band the label denotes; the level number stays a
label. Anchors are what make any quantitative statement possible, and without
them every quantitative view reports `insufficient-data`.

### Which aggregations need which kind

| Aggregation | Requires | Why |
|---|---|---|
| `likelihood × impact` | ratio | A product is a quantity only if both factors have a true zero and meaningful ratios |
| `likelihood + impact` | interval | Addition needs a one-level step to mean the same amount everywhere |
| `max(likelihood, impact)` | ordinal | Uses only order |
| lookup table | ordinal | A table is a ranking device if it is only ever read as one |

---

## 2. Ordinal indeterminacy

**Definition.** An ordinal scale is determined only up to a strictly increasing
transformation. A conclusion is supported by the scale only if it survives
every such relabelling.

**Theorem used.** For an aggregation non-decreasing in both axes:

> A outranks B under every admissible relabelling
> ⟺ A.likelihood ≥ B.likelihood **and** A.impact ≥ B.impact, with at least one
> strict.

That is Pareto dominance. All four configurable aggregations are non-decreasing
in both axes.

**Witness construction.** When the score ranks A above B but neither dominates,
exactly one axis has B above A. Take the identity relabelling on the other
axis, and on this one replace B's rung and everything above it with a run
starting at a target `t`, keeping the sequence strictly increasing:

| Aggregation | Target |
|---|---|
| product | `t > score(A) ÷ B's other level` |
| sum | `t > score(A) − B's other level` |
| max | `t > max(A's levels)` |

Solved directly rather than searched, so the witness is exact. Rungs below the
change keep their original names, so the reader can see that only one band was
renamed and that its position in the order is untouched.

`ordinal.test.ts` verifies exhaustively, for every crossing cell pair on a 5×5
under all three arithmetic aggregations, that the produced relabelling is
strictly increasing on both axes, has the same number of rungs, and reverses
the pair under the register's own formula.

**Counting.** Over *cells*, not rows. Every risk in a cell has identical
levels, so dominance and score comparison are properties of the cell pair; the
risk-pair counts come from multiplying occupancies. A 5×5 matrix has 300
unordered cell pairs however many thousand risks are in it, which is why the
counts are exact rather than sampled.

---

## 3. Range compression

**Cell annualised-loss band.**

```
[ frequency.lo × magnitude.lo , frequency.hi × magnitude.hi ]
```

The product of the extremes — the widest reading, and therefore the one that
does not understate what the cell hides. It is deliberately not narrowed by
assuming independence or a central tendency, because the cell genuinely cannot
say where inside it a risk sits.

**Anchor span** = `hi ÷ lo`. The cell's *resolution*: the factor by which two
risks can differ while receiving the same score. A property of the matrix
design, present even in a cell holding one risk.

**Estimate span** = the ratio between the largest and smallest modelled central
annualised loss among the cell's members **that carry their own estimates**.
Evidence from the register rather than from the scale. Available only for
estimated risks, and the count travels with the finding.

The two are never added. They answer different questions and have different
evidential standing.

**States.**

| Condition | State |
|---|---|
| estimate span ≥ 4× | `distorted` — the members provably differ |
| appetite falls inside the band | `requires-quantification` — the score cannot answer the question |
| anchor span ≥ 10× | `ambiguous` — the cell is capable of hiding a difference |
| otherwise | `supported` |
| no anchors | `insufficient-data` |

**Resolution floor.** The narrowest band any cell on the grid has. The matrix's
resolving power: the smallest difference in annualised loss the scoring system
is capable of noticing *anywhere*. On a typical corporate 5×5 it is over an
order of magnitude.

---

## 4. Quantitative model

Per risk, in this order of preference:

1. the register's own frequency and magnitude intervals — **evidence about this
   risk**;
2. the anchors of the risk's likelihood and impact levels — **evidence about
   the cell**, identical for every un-estimated risk in it;
3. no model, reported as such.

Which was used travels with the model and is displayed beside every interval.

**Two un-estimated risks in one cell get identical models.** Nothing in the
register distinguishes them, so nothing in the output does. This is the point
at which most tools of this kind quietly invent a difference.

Bounds of zero are clamped (frequency to 1e-4/yr, magnitude to 1 currency
unit), because a lognormal cannot be fitted to a bound of zero. The clamp is
listed as an assumption on the model, never applied silently.

**Analytic bounds** `[f.lo × m.lo, f.hi × m.hi]`, with the **geometric mean** as
the central figure — the median of the lognormal they were fitted to. The
arithmetic mean of two bounds spanning three orders of magnitude is not a
central figure of anything.

---

## 5. Simulation

Each iteration is one year:

```
λ    ~ Lognormal fitted so the frequency interval is its 5th–95th percentile
N    ~ Poisson(λ)
loss = Σ(i=1..N) Lognormal fitted to the magnitude interval
```

**Lognormal fit from a 90% interval:**

```
μ = (ln lo + ln hi) / 2
σ = (ln hi − ln lo) / (2 × 1.6448536269514722)
```

where 1.6449 is the standard normal 95th percentile.

**Why the rate is uncertain.** Fixing λ at the interval's midpoint would
discard the largest source of uncertainty in most cyber risks — nobody knows
the rate — and would produce a distribution far narrower than the analyst's
actual state of knowledge. A narrow distribution is the failure mode this
product exists to object to.

**Why lognormal.** Positive, right-skewed, and fitted uniquely by two
percentiles — which is the only form of input a subject-matter expert can give
honestly. Its tail is *lighter* than loss distributions seen in practice, so
the extreme percentiles are, if anything, optimistic.

**Generator.** `sfc32` seeded through `splitmix32`, first twelve outputs
discarded. Normals by polar Box–Muller. Poisson by Knuth below λ = 30, normal
approximation above — appropriate exactly where it is used, since a risk
expected 30+ times a year has an annual loss dominated by the central limit
theorem rather than by the tail of the count.

`Math.random` is banned in the engine by a lint rule.

**Exceedance curve.** A grid log-spaced in *probability* rather than in loss,
so the detail sits where decisions are made — the far tail — instead of in the
crowded body. The lowest probability is bounded below by 5 ÷ iterations: a
point estimated from fewer than five simulated years is noise with a line drawn
through it.

**Histogram.** Log-spaced buckets from the smallest non-zero loss to the 99.5th
percentile, so one freak iteration cannot stretch the axis until the shape
disappears. The tail beyond it is visible on the exceedance curve, which is the
chart built for it.

---

## 6. Rank inversion

For an ordered pair where the register scores A above B:

| Condition | Status |
|---|---|
| `B.bounds.lo > A.bounds.hi` | **confirmed under model** |
| `B.central > A.central`, intervals overlap | **candidate** |
| either lacks a model | **insufficient information** |
| otherwise | not a finding |

**Structural inversions** are those where *both* risks inherit their models
from their cells. The matrix's own anchors and its own scoring formula then
disagree with each other — a defect in the design of the measurement system
that affects every risk in both cells and can be fixed once.

**Exceedance probability** P(B's annual loss > A's) is estimated by **paired
sampling** from independent streams, not by comparing percentiles. `p90(B) >
p90(A)` says nothing about `P(B > A)`, and conflating them is a common way a
risk comparison goes wrong.

A consequence worth knowing when reading one: P(B > A) is bounded above by the
probability that B happens at all. 68% is not a weak result for a risk that
only occurs in 72% of years.

---

## 7. Assessor calibration

**Peer groups** are categories, by default. A group is usable with at least 3
risks and at least 2 distinct assessors.

**Offset within a group** = median(that assessor's levels) − median(everyone
*else's* levels in that group). The exclusion makes the comparison paired: an
assessor who owns the genuinely frightening systems does not look
miscalibrated for agreeing with everybody about them.

**Overall offset** = median of the per-group offsets.

Medians throughout, never means — these are ordinal levels, and the whole
product is an argument against averaging ordinal levels. There is no function
in `stats.ts` that takes the mean of a set of levels.

**Significance** is a two-sided permutation test. Under the null that assessor
identity carries no information, the labels within a group are exchangeable;
shuffling them 4,000 times gives the statistic's null distribution with no
distributional assumption at all. The p-value is the share of shuffles at least
as extreme as the observed statistic, with the standard +1 correction in both
numerator and denominator.

Quoted only above 6 paired observations. Below that the test has no power and
quoting a p-value would be worse than saying nothing.

**Known limitation.** The median is a threshold statistic. If every risk in a
group received the *same* level from each assessor, a permuted split lands on
those same two medians roughly half the time however many rows there are, so
the test cannot reach significance. It reports `ambiguous` — the correct
answer, because a group with no internal variation contains no evidence that
the difference is about the assessor rather than about the group.

**Language.** The finding is calibration *variation*. There is no ground truth
in a register to be wrong about, and the product never says an assessor is.

---

## 8. Quantification triage

```
priority = Σ (componentᵢ × weightᵢ)
```

There is no other term.

| Component | Weight | Measures |
|---|---|---|
| Decision proximity | 0.25 | 1.0 if the modelled band straddles the appetite; otherwise falls off with distance in orders of magnitude |
| Ordinal indeterminacy | 0.20 | Share of this cell's comparisons not determined by dominance |
| Cell compression | 0.20 | `max(log-scaled anchor span, log-scaled estimate span)` |
| Estimate uncertainty | 0.15 | Log-scaled width of the modelled band; floored at 0.7 if the risk appears in an inversion |
| Assessor disagreement | 0.10 | `|offset| ÷ 2`, clamped |
| Treatment consequence | 0.10 | mitigate 1.0, transfer 0.9, avoid 0.8, accept 0.4, unrecorded 0.3 |

**Deliberately absent: the score itself.** A risk scored 25 that everyone
agrees is intolerable and is already funded does not need a simulation; the
decision is made. Score enters only through the components that reference it.

Cell compression is deliberately **not** raised when a cell straddles the
appetite, because decision proximity already scores exactly that. Counting it
twice would weight one factor at 0.45 while this table says 0.25.

**Shortlist** = priority ≥ 0.34, capped at 8% of the analysed register (minimum
5, maximum 25).

**The weights are a stated judgement** about how often each factor changes a
decision. They are not an empirical result, and they are the first thing to
argue with if the shortlist looks wrong for your organisation.

The interface prints how many of the shortlist are *not* in the register's own
top N by score. If that number were zero the triage would be an expensive way
to re-sort a column, and the reader deserves to be able to check.

---

## 9. Measurement confidence

Three numbers, **never averaged**:

| | Definition |
|---|---|
| Order determinacy | determinate pairs ÷ compared pairs |
| Estimate coverage | risks with their own estimate ÷ risks analysed |
| Data completeness | rows placeable on the matrix ÷ rows imported |

Reducing them to one score would be the exact operation this product spends
eight views objecting to: three incommensurable quantities combined by
arithmetic that none of them supports. The weakest is named instead.

---

## 10. Limits

Stated in `src/engine/limits.ts` and reported wherever they bind.

| Limit | Value |
|---|---|
| File size | 16 MB |
| Rows | 20,000 |
| Columns | 256 |
| Field length | 4,000 characters |
| Materialised indeterminate pairs | 5,000 (the *count* is exact regardless) |
| Inversion findings kept | 400 |
| Inversion comparisons | 4,000,000 |
| Simulation iterations | 200,000 |
| Permutation draws | 4,000 |

Where a limit binds, the interface says so alongside the exact total. A
truncation that silently changes what a number means is worse than a limit.

---

## 11. What is not modelled

- Correlation or tail dependence between risks. A simultaneous event affecting
  several at once would produce a heavier joint tail than the sum of these
  models.
- Control effectiveness, or its decay over time.
- The cost of treatment, or any return on it.
- Secondary loss — reputational, regulatory follow-on, opportunity cost — except
  insofar as it is already inside a supplied magnitude interval.
- Whether a level was assessed well. Nothing can measure that.
