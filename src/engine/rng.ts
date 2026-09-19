/**
 * A seeded pseudo-random generator.
 *
 * Every number PARALLAX shows that came from a simulation has to be
 * reproducible, for two reasons that matter more here than in most products:
 *
 *   1. The output is used to argue that a risk register's ranking may be
 *      wrong. An argument that produces different percentiles on each run is
 *      not an argument anyone should accept.
 *   2. The exports and the CLI have to agree with the screen, and CI has to be
 *      able to assert that they do.
 *
 * `Math.random` is therefore banned in `src/engine` by an ESLint rule, and
 * this is the only source of randomness in the codebase.
 *
 * The algorithm is `sfc32` seeded through `splitmix32`: four 32-bit words of
 * state, no dependencies, and a period far beyond anything a Monte Carlo run
 * in a browser tab will reach. It is not cryptographic and is not used for
 * anything that needs to be.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
}

/** Mixes a single 32-bit seed into a well-distributed 32-bit word. */
function splitmix32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x9e3779b9) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad)
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97)
    return (t ^ (t >>> 15)) >>> 0
  }
}

/**
 * `sfc32`, seeded deterministically from one 32-bit integer.
 *
 * The first twelve outputs are discarded: with a low-entropy seed like `1`,
 * the early outputs of sfc32 are correlated, and a simulation seeded with `1`
 * is exactly what a test will do.
 */
export function createRng(seed: number): Rng {
  const mix = splitmix32(seed | 0)
  let a = mix()
  let b = mix()
  let c = mix()
  let d = mix()

  const next = (): number => {
    a >>>= 0
    b >>>= 0
    c >>>= 0
    d >>>= 0
    let t = (a + b) >>> 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) >>> 0
    c = (c << 21) | (c >>> 11)
    d = (d + 1) >>> 0
    t = (t + d) >>> 0
    c = (c + t) >>> 0
    return (t >>> 0) / 4294967296
  }

  for (let i = 0; i < 12; i += 1) next()
  return { next }
}

/**
 * A standard normal variate by the polar Box-Muller method.
 *
 * The polar form is used rather than the trigonometric one because it draws a
 * variable number of uniforms, which means a caller cannot accidentally rely
 * on a fixed stride into the stream -- and because it avoids `Math.log(0)`
 * without a special case.
 */
export function standardNormal(rng: Rng): number {
  let u: number
  let v: number
  let s: number
  do {
    u = rng.next() * 2 - 1
    v = rng.next() * 2 - 1
    s = u * u + v * v
  } while (s >= 1 || s === 0)
  return u * Math.sqrt((-2 * Math.log(s)) / s)
}

/**
 * A Poisson variate by Knuth's method.
 *
 * Knuth is O(lambda) and numerically hopeless above about 30, so larger rates
 * fall back to the normal approximation with a continuity correction -- which
 * is appropriate exactly where it is used, since a risk expected 30+ times a
 * year is one whose annual loss is dominated by the central limit theorem
 * rather than by the tail of the count.
 */
export function poisson(rng: Rng, lambda: number): number {
  if (!(lambda > 0)) return 0
  if (lambda < 30) {
    const limit = Math.exp(-lambda)
    let k = 0
    let p = 1
    do {
      k += 1
      p *= rng.next()
    } while (p > limit)
    return k - 1
  }
  const value = Math.round(lambda + Math.sqrt(lambda) * standardNormal(rng))
  return value < 0 ? 0 : value
}

/**
 * A lognormal variate whose 90% central interval is `[lo, hi]`.
 *
 * Fitting on the 5th and 95th percentiles rather than on a mean and a standard
 * deviation is deliberate: a subject-matter expert can state "I would be
 * surprised if it were below X or above Y" and be believed. A mean loss they
 * cannot.
 */
export function lognormalFrom90(rng: Rng, lo: number, hi: number): number {
  const { mu, sigma } = lognormalParams(lo, hi)
  return Math.exp(mu + sigma * standardNormal(rng))
}

/** The 1.6449 in the denominator is the standard normal 95th percentile. */
export const Z95 = 1.6448536269514722

export function lognormalParams(lo: number, hi: number): { mu: number; sigma: number } {
  const low = Math.max(lo, Number.MIN_VALUE)
  const high = Math.max(hi, low)
  const mu = (Math.log(low) + Math.log(high)) / 2
  const sigma = (Math.log(high) - Math.log(low)) / (2 * Z95)
  return { mu, sigma: sigma > 0 ? sigma : 0 }
}

/**
 * Derives a stable 32-bit seed from a string.
 *
 * Used so that "the seed for risk R-014" is the same number in the browser, in
 * the CLI and in a test, without anyone having to pass one around. FNV-1a,
 * because it is four lines and its avalanche is good enough for seeding.
 */
export function seedFrom(text: string, salt = 0): number {
  let h = 0x811c9dc5 ^ (salt | 0)
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
