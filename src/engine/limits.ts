/**
 * Hard limits on untrusted input.
 *
 * A risk register arrives as a file a human was given by another human. It may
 * be malformed, enormous, or deliberately hostile, and PARALLAX parses it in
 * the same process that renders the interface. Every limit here exists so that
 * a bad file produces a readable error instead of a frozen tab.
 *
 * The limits are generous for real registers -- the largest corporate register
 * the author has seen had about 1,800 rows -- and cheap to raise from one
 * place if a real one ever exceeds them.
 */

/** 16 MB. A 20,000-row register with long descriptions is about 6 MB. */
export const MAX_FILE_BYTES = 16 * 1024 * 1024

/** Rows. Past this, the pairwise analyses stop being interactive. */
export const MAX_ROWS = 20_000

/** Columns in the header. A register with 300 columns is a spreadsheet dump. */
export const MAX_COLUMNS = 256

/** Characters in a single field. Longer is truncated, with a flag. */
export const MAX_FIELD_CHARS = 4_000

/**
 * The pairwise analyses are O(n^2). At 20,000 rows that is 200 million ordered
 * pairs, which is neither fast nor useful: nobody reads 200 million findings.
 *
 * Rather than silently sampling -- which would make the output depend on an
 * invisible choice -- the pairwise passes restrict themselves to pairs that
 * could possibly be findings (see `ordinal.ts` and `inversion.ts` for the
 * exact restriction, which is stated in the UI) and stop collecting after this
 * many, reporting the truncation openly.
 */
export const MAX_PAIR_FINDINGS = 5_000

/**
 * Inversion findings kept. Unlike the indeterminate pairs, an inversion cannot
 * be counted without being computed, so this bounds the work rather than only
 * the output. Findings are generated worst-first, so the cut falls on the
 * least severe.
 */
export const MAX_INVERSION_FINDINGS = 400

/**
 * How many inversion findings get a paired-sampling exceedance probability
 * during the analysis run. It costs a small simulation per pair, so the rest
 * are computed on demand when the reader opens them.
 */
export const EXCEEDANCE_DETAIL_LIMIT = 40

/**
 * Ceiling on the ordered comparisons the inversion pass will perform.
 *
 * The pass is `estimated risks x all risks`, which on a register where
 * everything is estimated is quadratic: 20,000 rows would be 800 million
 * comparisons and a locked tab. Past this ceiling the pass restricts itself to
 * the estimated risks with the largest modelled annualised loss — the ones an
 * inversion can actually involve — and the interface reports the restriction
 * rather than quietly changing what the count means.
 *
 * Four million comparisons is roughly a quarter-second of arithmetic, and is
 * not reached by any register under about 3,000 fully estimated rows.
 */
export const MAX_INVERSION_COMPARISONS = 4_000_000

/** Default Monte Carlo iterations. Raisable per run in the simulation view. */
export const DEFAULT_ITERATIONS = 20_000

/** Upper bound on iterations, so a slider cannot lock the tab. */
export const MAX_ITERATIONS = 200_000

/** Points on a loss exceedance curve. Enough to look smooth at any width. */
export const EXCEEDANCE_POINTS = 120

/** Buckets in the simulated loss histogram, log-spaced. */
export const HISTOGRAM_BUCKETS = 48

/**
 * Minimum paired observations before a permutation test is reported for an
 * assessor. Below this the test has no power and quoting a p-value would be
 * worse than saying nothing.
 */
export const MIN_PERMUTATION_OBSERVATIONS = 6

/** Permutation draws. Fixed, seeded, and therefore reproducible. */
export const PERMUTATION_DRAWS = 4_000

/**
 * A cell whose own anchors span at least this factor of annualised loss is
 * reported as compressing its contents, even if only one risk sits in it. The
 * value is not arbitrary: a factor of 10 means the cell cannot distinguish an
 * amount from ten times that amount, which is larger than most of the
 * differences a treatment budget is allocated on.
 */
export const ANCHOR_SPAN_FLAG = 10

/**
 * A cell whose *estimated* members differ by at least this factor is reported
 * as distorted rather than merely wide, because the difference is evidence
 * from the register rather than a property of the scale.
 */
export const ESTIMATE_SPAN_FLAG = 4
