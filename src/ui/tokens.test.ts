/**
 * The palette, checked arithmetically.
 *
 * The contrast numbers in `src/index.css` are this file's output rather than
 * an estimate, and a change that drops a tier below AA fails the build instead
 * of being noticed by somebody squinting at a screenshot six weeks later.
 *
 * Every tier is measured against the *lightest* surface it can sit on in dark
 * mode and the darkest in light mode — `--surface-3`, the hovered row — rather
 * than against the page, because a row that fails contrast on hover fails
 * while it is being read.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ANALYSIS_STATES } from '../engine/types.ts'
import type { AnalysisState } from '../engine/types.ts'
import { STATE_STYLE } from './tokens.ts'

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'index.css'),
  'utf8',
)

type Triplet = readonly [number, number, number]

/** Reads the custom properties out of one theme block. */
function theme(selector: string): Map<string, Triplet> {
  const start = css.indexOf(selector)
  expect(start, `${selector} block missing`).toBeGreaterThan(-1)
  const open = css.indexOf('{', start)
  const close = css.indexOf('\n}', open)
  const block = css.slice(open, close)
  const out = new Map<string, Triplet>()
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+);/g)) {
    out.set(match[1] as string, [Number(match[2]), Number(match[3]), Number(match[4])])
  }
  return out
}

function channel(value: number): number {
  const v = value / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function luminance([r, g, b]: Triplet): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: Triplet, b: Triplet): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [light, dark] = la > lb ? [la, lb] : [lb, la]
  return (light + 0.05) / (dark + 0.05)
}

const DARK = theme('[data-theme=\'dark\']')
const LIGHT = theme('[data-theme=\'light\']')

const FOREGROUNDS = [
  'ink-0',
  'ink-1',
  'ink-2',
  'ink-3',
  'accent',
  'accent-strong',
  'quant',
  'quant-strong',
  'state-supported',
  'state-ambiguous',
  'state-distorted',
  'state-quantify',
  'state-insufficient',
] as const

describe('palette', () => {
  for (const [name, tokens] of [
    ['dark', DARK],
    ['light', LIGHT],
  ] as const) {
    describe(name, () => {
      it('defines every token the components use', () => {
        for (const key of [...FOREGROUNDS, 'surface-0', 'surface-1', 'surface-2', 'surface-3', 'line-1', 'line-2', 'line-3']) {
          expect(tokens.get(key), `${name}/${key}`).toBeDefined()
        }
      })

      it('meets WCAG AA against the busiest surface', () => {
        const surface = tokens.get('surface-3') as Triplet
        for (const key of FOREGROUNDS) {
          const ratio = contrast(tokens.get(key) as Triplet, surface)
          expect(ratio, `${name}/${key} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
        }
      })

      it('meets AA against the page and the panels too', () => {
        for (const surfaceKey of ['surface-0', 'surface-1', 'surface-2', 'surface-inset']) {
          const surface = tokens.get(surfaceKey)
          if (!surface) continue
          for (const key of FOREGROUNDS) {
            const ratio = contrast(tokens.get(key) as Triplet, surface)
            expect(ratio, `${name}/${key} on ${surfaceKey}`).toBeGreaterThanOrEqual(4.5)
          }
        }
      })

      it('keeps the ink ramp monotonic, so the tiers are a hierarchy', () => {
        const surface = tokens.get('surface-3') as Triplet
        const ratios = (['ink-0', 'ink-1', 'ink-2', 'ink-3'] as const).map((key) =>
          contrast(tokens.get(key) as Triplet, surface),
        )
        for (let i = 1; i < ratios.length; i += 1) {
          expect(ratios[i], `${name}/ink-${i}`).toBeLessThan(ratios[i - 1] as number)
        }
      })

      /**
       * The constraint, stated as a test.
       *
       * Requiring every hue to clear AA against both a near-black and a
       * near-white surface stack pins all five into a narrow luminance band,
       * and two colours close in luminance are what a reader with a colour
       * vision deficiency sees as one colour. The palette cannot escape this,
       * so the assertion is not "spread them out" — it is *every pair that is
       * close in luminance must be separated by something that is not colour*.
       */
      it('separates any luminance-close pair of states by a non-colour mark', () => {
        const pairs = [
          ['state-supported', 'supported'],
          ['state-ambiguous', 'ambiguous'],
          ['state-distorted', 'distorted'],
          ['state-quantify', 'requires-quantification'],
          ['state-insufficient', 'insufficient-data'],
        ] as const

        let closest = Infinity
        for (let i = 0; i < pairs.length; i += 1) {
          for (let j = i + 1; j < pairs.length; j += 1) {
            const a = pairs[i] as readonly [string, AnalysisState]
            const b = pairs[j] as readonly [string, AnalysisState]
            const ratio = contrast(tokens.get(a[0]) as Triplet, tokens.get(b[0]) as Triplet)
            closest = Math.min(closest, ratio)
            if (ratio >= 1.12) continue
            expect(
              STATE_STYLE[a[1]].glyph,
              `${name}: ${a[1]} and ${b[1]} are ${ratio.toFixed(3)}:1 apart and share a glyph`,
            ).not.toBe(STATE_STYLE[b[1]].glyph)
          }
        }
        // Documented, so a regression that makes the palette *worse* is still
        // visible even though it cannot be made much better.
        expect(closest).toBeGreaterThan(1.01)
      })

      it('makes the surface stack strictly ordered', () => {
        const stack = (['surface-0', 'surface-1', 'surface-2', 'surface-3'] as const).map((key) =>
          luminance(tokens.get(key) as Triplet),
        )
        // Dark rises, light is specified independently and need not; both must
        // have four distinguishable steps.
        const unique = new Set(stack.map((l) => l.toFixed(5)))
        expect(unique.size).toBe(4)
      })
    })
  }

  it('specifies light independently rather than inverting dark', () => {
    // If light were an inversion, the accents would be identical triplets.
    expect(LIGHT.get('accent')).not.toEqual(DARK.get('accent'))
    expect(LIGHT.get('state-supported')).not.toEqual(DARK.get('state-supported'))
  })
})

describe('STATE_STYLE', () => {
  it('covers every analysis state', () => {
    for (const state of ANALYSIS_STATES) {
      expect(STATE_STYLE[state], state).toBeDefined()
    }
  })

  it('gives every state a definition a reader can act on', () => {
    for (const state of ANALYSIS_STATES) {
      const style = STATE_STYLE[state]
      expect(style.label.length, state).toBeGreaterThan(2)
      expect(style.meaning.length, state).toBeGreaterThan(30)
      expect(style.meaning.endsWith('.'), state).toBe(true)
    }
  })

  it('gives every state a glyph, and every distinct meaning a distinct one', () => {
    const glyphs = new Map<string, AnalysisState[]>()
    for (const state of ANALYSIS_STATES) {
      const glyph = STATE_STYLE[state].glyph
      expect(glyph.length, state).toBeGreaterThan(0)
      glyphs.set(glyph, [...(glyphs.get(glyph) ?? []), state])
    }
    for (const [glyph, states] of glyphs) {
      // `valid` and `supported` are the same verdict in two contexts and may
      // share a mark. Nothing else may.
      if (states.length === 1) continue
      expect(new Set(states), `glyph ${glyph} is shared`).toEqual(
        new Set(['valid', 'supported'] as AnalysisState[]),
      )
    }
  })

  it('carries a non-colour treatment for the two states colour cannot separate', () => {
    // `inconsistent` shares amber with `ambiguous`; `insufficient-data` is the
    // one state that must never be carried by colour alone.
    expect(STATE_STYLE['insufficient-data'].pattern).toBe('hatch')
    expect(STATE_STYLE.inconsistent.pattern).toBe('dotted')
    expect(STATE_STYLE.inconsistent.text).toBe(STATE_STYLE.ambiguous.text)
  })

  it('uses an rgb() reference rather than a literal colour, so themes apply', () => {
    for (const state of ANALYSIS_STATES) {
      expect(STATE_STYLE[state].rgb, state).toMatch(/^rgb\(var\(--/)
    }
  })
})

describe('reduced motion', () => {
  it('is honoured by a media query rather than only by a preference check', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(css).toMatch(/animation-duration: 0\.01ms !important/)
  })
})
