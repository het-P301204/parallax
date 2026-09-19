# Changelog

Notable changes to PARALLAX. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] — first release

The first public version. Everything below is new.

### The audit

- **Ordinal validity audit.** Tests every ranking the register implies against
  all admissible relabellings of its scales, and constructs a **witness
  relabelling** for each ranking that does not survive — a legal renaming under
  which the register's own formula reverses the pair. Five operations are
  checked: the aggregation itself, ranking by the score, reading a score gap as
  a magnitude, arithmetic the configured formula cannot produce, and whether
  band thresholds separate what they claim to.
- **Range compression.** Two independent measurements per cell — the span the
  scale's own anchors cannot resolve, and the span the register's own estimates
  say its members actually differ by — plus whether the appetite threshold
  falls inside the cell's band.
- **Rank inversion.** Pairs where the register's order and the modelled
  annualised loss disagree, graded *confirmed under model* / *candidate*, with
  structural inversions (where the matrix's anchors contradict its own formula)
  separated from estimate-driven ones.
- **Assessor calibration.** Paired median offsets within peer groups, with a
  two-sided permutation test over 4,000 shuffles. Reported as *variation*,
  never as error.
- **Quantification triage.** Six published components with published weights.
  The score itself is deliberately not one of them.
- **Interval simulation.** Poisson frequency with an uncertain rate, lognormal
  magnitude fitted to a 90% interval, seeded and reproducible. Percentiles, a
  loss exceedance curve, and P(loss > appetite).
- **Data quality.** Thirteen codes, grouped by kind, each with the rows it
  affects and what it costs the analysis.

### The interface

- The **parallax separation**: selecting a matrix cell lifts its label away
  from a shared logarithmic loss axis and fans the intervals it was covering
  out behind it at their own depths, ordered by modelled loss.
- Eleven views following the product's argument from "what is in this
  register" to "what should I distrust".
- Executive and analyst modes, a command palette, filters, a risk workspace
  with a relationship graph, and seven exports.
- Dark and light themes, specified independently rather than inverted.

### Engineering

- **No network.** `connect-src 'none'` in the document head, a lint rule
  forbidding `fetch` in the engine, and a CI scan of the built bundle.
- **Deterministic.** Seeded simulation, no timestamps in any export,
  byte-identical output across runs.
- **194 tests**, including an exhaustive check that every witness relabelling
  is legal and order-reversing across all three arithmetic aggregations.
- **A dependency-light runtime**: React, React DOM, and three font families.
  The CSV parser, the Monte Carlo engine, every chart and all the motion are in
  this repository.
- A CLI with no dependencies at all, running the engine sources directly under
  Node's type stripping, with pipeline-usable exit codes.

---

## Defects found while building, and fixed

Written down because each one was found by a test or a review pass rather than
by noticing it on screen, and because the fixes are the interesting part.

### The format detector trusted the extension

`detectFormat` returned `csv` for any `.txt` file before looking at the
contents, so a JSON export saved as `.txt` was parsed as CSV — producing one
enormous column and a page of confident nonsense rather than an error. Now
`.json` and `.csv`/`.tsv` are taken at their word and everything else is
sniffed: an extension is a claim, the first byte is evidence.

*Found by: `import.test.ts`, written before the code was believed to be
finished.*

### The formula-injection escape corrupted real numbers

`escapeField` prefixed any value beginning `-` with an apostrophe, which is
correct for `-2+3` and wrong for `-2`. An assessor's likelihood offset of −2
exported as text, so the column could not be sorted, charted or summed. A
safety measure that quietly breaks the numbers it protects is not a safety
measure. Values that are entirely a number are now exempt, and nothing that
merely looks numeric is.

*Found by: the security review pass.*

### The palette could not carry five states by colour

`tokens.test.ts` measured green and amber at 1.02:1 apart in luminance — which
is what a reader with deuteranopia sees as one colour. Tuning did not fix it,
and the reason turned out to be structural: requiring every hue to clear WCAG
AA against *both* a near-black and a near-white surface stack confines all of
them to a narrow luminance band. No five-hue palette meeting the contrast
requirement does materially better.

So colour stopped being the only channel. Every state now carries a glyph
(`✓ ? ≠ ! ∗ ·`), rendered in the badge and in the matrix cell, and the test was
rewritten to assert the thing that can actually be guaranteed: *any two states
close in luminance must carry different glyphs*.

*Found by: `tokens.test.ts`.*

### Findings were formatted in the host's locale

`toLocaleString()` with no argument uses the machine's locale, so the same
register produced "6,261" on one machine and "6,26,1" on another. Those strings
are embedded in the findings, so they reached the exports — which meant the
"byte-identical" export claim was true only between machines with the same
locale. Number grouping in the engine is now pinned to `en-GB`.

*Found by: a performance run that happened to print a grouped count.*

### The inversion pass was quadratic in a fully estimated register

The pass compares every estimated risk against every risk. On a register where
everything carries an estimate that is O(n²) — 20,000 rows would have been 800
million comparisons and a locked tab. It now works to a stated comparison
budget, falling back to the largest modelled exposures (the ones an inversion
can involve) and reporting the restriction rather than quietly changing what
the count means.

*Found by: a scale test at 5,000 rows.*

### A tooltip wrapper collapsed the matrix

`Tooltip` wrapped its trigger in a second inline `span`, which shrink-wrapped
and silently collapsed any `w-full` child inside it. Every matrix cell rendered
as a three-pixel sliver, and the appetite marker on the parallax stage was
positioned relative to the tooltip instead of the axis. The trigger is now a
direct child.

*Found by: looking at it.*

### Two findings were counted twice in the triage

`cell-compression` was raised to a floor of 0.6 when a cell straddled the
appetite — which `decision-proximity` already scored at 1.0. The combination
weighted that one factor at 0.45 while the published table said 0.25. A
transparent score that double-counts is not transparent, so the floor was
removed.

*Found by: reading the shortlist output and asking why the top ten looked so
similar.*

### `describeIndeterminacy` was dead code

Exported, documented, never called. Deleted rather than wired up: the view it
was written for says the same thing better with the witness relabelling.

---

## Known limitations

Not defects — properties of the method, stated so they are not mistaken for
defects later.

- **The calibration permutation test has no power on degenerate peer groups.**
  If every risk in a group received the same level from each assessor, a
  permuted split lands on the same two medians about half the time however many
  rows there are. The product reports `ambiguous`, which is correct: a group
  with no internal variation contains no evidence that the difference is about
  the assessor rather than about the group.
- **A lognormal has a lighter tail** than real loss distributions, so the
  extreme percentiles are, if anything, optimistic.
- **No correlation between risks is modelled.**
- **Everything quantitative depends on the anchors.** A register whose scales
  carry none gets an honest `insufficient-data` rather than a guess.

[0.1.0]: https://github.com/het-P301204/parallax/releases/tag/v0.1.0
