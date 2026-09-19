/**
 * Formatting.
 *
 * All of it, in one place, because a number that appears as "£1.2M" in a
 * tooltip and "1,200,000" in the table next to it reads as two different
 * numbers. None of these functions do arithmetic that changes a value's
 * meaning — rounding for display is the only liberty taken, and the exports
 * carry four significant figures rather than these.
 */

const SYMBOLS: Readonly<Record<string, string>> = {
  GBP: '£',
  USD: '$',
  EUR: '€',
  JPY: '¥',
  INR: '₹',
  AUD: 'A$',
  CAD: 'C$',
  CHF: 'CHF ',
}

export function currencySymbol(currency: string): string {
  return SYMBOLS[currency] ?? ''
}

/**
 * Compact money: `£1.2M`, `£840k`, `£26`.
 *
 * Two significant figures below ten of a unit and none above, because the
 * inputs are 90% intervals and `£1.24M` implies a precision they do not have.
 */
export function money(value: number, currency = 'GBP'): string {
  if (!Number.isFinite(value)) return '—'
  const symbol = currencySymbol(currency)
  const sign = value < 0 ? '−' : ''
  const abs = Math.abs(value)
  const body =
    abs >= 1e9
      ? `${trim(abs / 1e9)}bn`
      : abs >= 1e6
        ? `${trim(abs / 1e6)}M`
        : abs >= 1e3
          ? `${trim(abs / 1e3)}k`
          : String(Math.round(abs))
  return symbol ? `${sign}${symbol}${body}` : `${sign}${body} ${currency}`
}

function trim(value: number): string {
  if (value >= 100) return String(Math.round(value))
  if (value >= 10) return String(Math.round(value * 10) / 10)
  return String(Math.round(value * 100) / 100)
}

/** `£12k–£3.4M`. An en dash, because it is a range rather than a subtraction. */
export function moneyRange(lo: number, hi: number, currency = 'GBP'): string {
  return `${money(lo, currency)}–${money(hi, currency)}`
}

/** Events per year, at the precision the number deserves. */
export function rate(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value >= 10) return String(Math.round(value))
  if (value >= 1) return String(Math.round(value * 10) / 10)
  if (value >= 0.01) return String(Number(value.toPrecision(2)))
  return value.toExponential(1)
}

export function rateRange(lo: number, hi: number): string {
  return `${rate(lo)}–${rate(hi)}`
}

/** `23×`, `1.8×`. The multiplication sign, not the letter x. */
export function span(ratio: number | undefined): string {
  if (ratio === undefined || !Number.isFinite(ratio)) return '—'
  if (ratio < 10) return `${(Math.round(ratio * 10) / 10).toFixed(1)}×`
  return `${Math.round(ratio).toLocaleString()}×`
}

/** `46%`, `4.6%`, `<0.1%`. */
export function percent(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—'
  const scaled = value * 100
  if (scaled > 0 && scaled < 0.1) return '<0.1%'
  if (scaled < 100 && scaled > 99.9 && scaled < 100) return '>99.9%'
  return `${scaled.toFixed(digits)}%`
}

export function count(value: number): string {
  return value.toLocaleString('en-GB')
}

/** A signed level offset: `+1.0`, `−2.0`, `0`. */
export function signedLevels(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const rounded = Math.round(value * 10) / 10
  if (rounded === 0) return '0'
  return rounded > 0 ? `+${rounded.toFixed(1)}` : `−${Math.abs(rounded).toFixed(1)}`
}

/** A p-value, with the floor the test can actually resolve. */
export function pValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  if (value < 0.001) return 'p < 0.001'
  return `p = ${value.toFixed(3)}`
}

/** `3 Apr 2025`. Never a locale-dependent numeric date. */
export function date(iso: string | undefined): string {
  if (!iso) return '—'
  const parts = iso.split('-')
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return iso
  return `${day} ${names[month - 1] ?? '?'} ${year}`
}

/** Positions a value on a log axis, returning a 0–1 fraction. */
export function logPosition(value: number, lo: number, hi: number): number {
  if (!(value > 0) || !(lo > 0) || !(hi > lo)) return 0
  const t = (Math.log(value) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))
  return Math.max(0, Math.min(1, t))
}

/**
 * Ticks covering a log range: 1k, 10k, 100k…
 *
 * Decades first. When fewer than three of them land inside the range — which
 * happens whenever a distribution is narrow, and a simulated annual loss often
 * is — it subdivides into a 1-2-5 sequence rather than leaving the axis with a
 * single label on it. An axis with one tick is an axis a reader cannot use to
 * estimate anything.
 *
 * Returned as values rather than labels, so the caller decides whether they
 * are money, a rate, or a ratio.
 */
export function decadeTicks(lo: number, hi: number, max = 7): number[] {
  if (!(lo > 0) || !(hi > lo)) return []

  const build = (multipliers: readonly number[]): number[] => {
    const first = Math.floor(Math.log10(lo))
    const last = Math.ceil(Math.log10(hi))
    const all: number[] = []
    for (let exponent = first; exponent <= last; exponent += 1) {
      for (const multiplier of multipliers) all.push(multiplier * 10 ** exponent)
    }
    return all.filter((v) => v >= lo && v <= hi).sort((a, b) => a - b)
  }

  let ticks = build([1])
  if (ticks.length < 3) ticks = build([1, 2, 5])
  if (ticks.length < 3) ticks = build([1, 1.5, 2, 3, 5, 7])

  if (ticks.length <= max) return ticks
  const stride = Math.ceil(ticks.length / max)
  return ticks.filter((_, index) => index % stride === 0)
}

/** Truncates a sentence for a compact row without cutting mid-word. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${cut.slice(0, space > max * 0.6 ? space : max)}…`
}

/** `L4I3` → `4 × 3`, for a reader who has not memorised the key format. */
export function cellPretty(key: string): string {
  const match = /^L(\d+)I(\d+)$/.exec(key)
  return match ? `${match[1]} × ${match[2]}` : key
}
