/**
 * PARALLAX design system.
 *
 * Every colour is stored as a space-separated RGB triplet on a CSS custom
 * property, so Tailwind's `/opacity` modifier keeps working and the light
 * theme is a genuine re-specification rather than an inversion. The triplets
 * live in `src/index.css`; nothing in this file hardcodes a colour.
 *
 * The palette is small on purpose. Graphite carries structure, one blue
 * carries analysis, one cyan carries quantitative information, and four
 * semantic hues carry a finding's *state* and nothing else:
 *
 *   supported     green    the measurement supports the conclusion drawn
 *   ambiguous     amber    the numbers cannot separate these cases
 *   distorted     red      the scale materially misrepresents the difference
 *   quantify      violet   only a quantitative model can settle this
 *   insufficient  slate    not enough data to say -- rendered hatched, never
 *                          by colour alone
 *
 * A fifth state, INCONSISTENT, shares amber with AMBIGUOUS and is separated
 * by treatment (a dotted rule) rather than by a sixth hue, because six
 * saturated hues in one table stop being a signal.
 */

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          0: 'rgb(var(--surface-0) / <alpha-value>)',
          1: 'rgb(var(--surface-1) / <alpha-value>)',
          2: 'rgb(var(--surface-2) / <alpha-value>)',
          3: 'rgb(var(--surface-3) / <alpha-value>)',
          inset: 'rgb(var(--surface-inset) / <alpha-value>)',
        },
        line: {
          1: 'rgb(var(--line-1) / <alpha-value>)',
          2: 'rgb(var(--line-2) / <alpha-value>)',
          3: 'rgb(var(--line-3) / <alpha-value>)',
        },
        ink: {
          0: 'rgb(var(--ink-0) / <alpha-value>)',
          1: 'rgb(var(--ink-1) / <alpha-value>)',
          2: 'rgb(var(--ink-2) / <alpha-value>)',
          3: 'rgb(var(--ink-3) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          strong: 'rgb(var(--accent-strong) / <alpha-value>)',
          dim: 'rgb(var(--accent-dim) / <alpha-value>)',
        },
        quant: {
          DEFAULT: 'rgb(var(--quant) / <alpha-value>)',
          strong: 'rgb(var(--quant-strong) / <alpha-value>)',
        },
        supported: 'rgb(var(--state-supported) / <alpha-value>)',
        ambiguous: 'rgb(var(--state-ambiguous) / <alpha-value>)',
        distorted: 'rgb(var(--state-distorted) / <alpha-value>)',
        quantify: 'rgb(var(--state-quantify) / <alpha-value>)',
        insufficient: 'rgb(var(--state-insufficient) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['"Space Grotesk Variable"', '"Space Grotesk"', '"Inter Variable"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // A tight, deliberate scale. Line heights are set for dense technical
        // reading: generous under 14px where scanning happens, tighter above.
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.04em' }],
        xs: ['0.75rem', { lineHeight: '1.125rem', letterSpacing: '0.01em' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.4375rem' }],
        md: ['0.9375rem', { lineHeight: '1.5rem' }],
        lg: ['1.0625rem', { lineHeight: '1.6rem' }],
        xl: ['1.375rem', { lineHeight: '1.75rem', letterSpacing: '-0.014em' }],
        '2xl': ['1.75rem', { lineHeight: '2.125rem', letterSpacing: '-0.02em' }],
        '3xl': ['2.25rem', { lineHeight: '2.5rem', letterSpacing: '-0.025em' }],
        '4xl': ['3rem', { lineHeight: '3.125rem', letterSpacing: '-0.03em' }],
        '5xl': ['4.25rem', { lineHeight: '4.25rem', letterSpacing: '-0.04em' }],
      },
      spacing: {
        // 8px rhythm, with the half-steps dense instrument UI actually needs.
        1: '0.25rem',
        2: '0.5rem',
        3: '0.75rem',
        4: '1rem',
        5: '1.25rem',
        6: '1.5rem',
        8: '2rem',
        10: '2.5rem',
        12: '3rem',
        16: '4rem',
        20: '5rem',
        24: '6rem',
        32: '8rem',
      },
      borderRadius: {
        sm: '3px',
        DEFAULT: '5px',
        md: '7px',
        lg: '10px',
        xl: '14px',
        '2xl': '20px',
      },
      boxShadow: {
        hair: '0 1px 0 0 rgb(var(--line-1) / 1)',
        raise: '0 1px 2px rgb(0 0 0 / var(--shadow-alpha-1)), 0 0 0 1px rgb(var(--line-1) / 1)',
        lift: '0 8px 24px -12px rgb(0 0 0 / var(--shadow-alpha-2)), 0 0 0 1px rgb(var(--line-2) / 1)',
        pop: '0 16px 48px -16px rgb(0 0 0 / var(--shadow-alpha-2)), 0 0 0 1px rgb(var(--line-2) / 1)',
        drawer: '-24px 0 64px -24px rgb(0 0 0 / var(--shadow-alpha-2))',
        // The lifted matrix cell during the parallax separation. Two shadows:
        // one tight and one long, so the tile reads as physically above the
        // grid rather than merely brighter than it.
        plate:
          '0 2px 4px -2px rgb(0 0 0 / var(--shadow-alpha-2)), 0 24px 56px -20px rgb(0 0 0 / var(--shadow-alpha-2))',
      },
      transitionTimingFunction: {
        // `out` is the workhorse: fast start, long settle, nothing overshoots.
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
        inout: 'cubic-bezier(0.65, 0, 0.35, 1)',
        // Used only where something separates into layers, which is the one
        // place a little anticipation reads as depth rather than as bounce.
        depth: 'cubic-bezier(0.34, 1.26, 0.44, 1)',
      },
      transitionDuration: {
        90: '90ms',
        140: '140ms',
        220: '220ms',
        320: '320ms',
        380: '380ms',
        560: '560ms',
        720: '720ms',
      },
      keyframes: {
        'stage-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(14px) scale(0.985)' },
          to: { opacity: '1', transform: 'none' },
        },
        'drawer-in': {
          from: { opacity: '0', transform: 'translateX(20px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'sheet-in': {
          from: { opacity: '0', transform: 'translateY(100%)' },
          to: { opacity: '1', transform: 'none' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': {
          from: { opacity: '0', transform: 'scale(0.97) translateY(-4px)' },
          to: { opacity: '1', transform: 'none' },
        },
        // An interval bar arriving on the continuous axis: it grows from its
        // own centre, because the centre is the point estimate and the growth
        // *is* the uncertainty being revealed.
        'span-in': {
          from: { opacity: '0', transform: 'scaleX(0.04)' },
          to: { opacity: '1', transform: 'none' },
        },
        // The signature: a plane of the separated cell sliding back to its
        // depth. Distance is set per-layer by `--depth`, so one keyframe
        // serves every plane and the stagger comes from the data.
        'parallax-split': {
          from: { opacity: '0', transform: 'translateX(calc(var(--depth) * -1px)) scale(0.94)' },
          to: { opacity: '1', transform: 'none' },
        },
        'plate-lift': {
          from: { transform: 'none', boxShadow: '0 0 0 0 rgb(0 0 0 / 0)' },
          to: { transform: 'translateY(-3px) scale(1.04)' },
        },
        'pulse-once': {
          '0%': { boxShadow: '0 0 0 0 rgb(var(--accent) / 0.45)' },
          '100%': { boxShadow: '0 0 0 12px rgb(var(--accent) / 0)' },
        },
        'draw-in': { to: { strokeDashoffset: '0' } },
        'flow-dash': { to: { strokeDashoffset: '-24' } },
        sweep: { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(300%)' } },
        // Simulation: a histogram column arriving as its bucket fills.
        'column-in': {
          from: { transform: 'scaleY(0.02)', opacity: '0.2' },
          to: { transform: 'none', opacity: '1' },
        },
        'tick-in': {
          from: { opacity: '0', transform: 'translateY(-3px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        'stage-in': 'stage-in 380ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'rise-in': 'rise-in 560ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'drawer-in': 'drawer-in 260ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'sheet-in': 'sheet-in 280ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in': 'fade-in 140ms linear both',
        'pop-in': 'pop-in 140ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'span-in': 'span-in 560ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'parallax-split': 'parallax-split 720ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'pulse-once': 'pulse-once 900ms cubic-bezier(0.16, 1, 0.3, 1) 1',
        'draw-in': 'draw-in 720ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'flow-dash': 'flow-dash 1.1s linear infinite',
        sweep: 'sweep 1.5s cubic-bezier(0.65, 0, 0.35, 1) infinite',
        'column-in': 'column-in 320ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'tick-in': 'tick-in 220ms cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
}
