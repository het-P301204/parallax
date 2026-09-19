/**
 * Design tokens, as the class strings the components actually use.
 *
 * Centralised for one reason: a state has to mean the same thing in the
 * matrix cell, the badge, the table row, the interval bar and the graph node.
 * If a component picks its own amber, the interface stops being readable at a
 * glance, which is the only thing that makes a dense analytical table useful.
 *
 * The palette itself lives in `src/index.css` as CSS custom properties, so
 * light and dark are two specifications rather than one inverted.
 */

import type { AnalysisState, InversionStatus, RelationKind, Severity } from '../engine/index.ts'

/* -------------------------------------------------------------------------- */
/* Analysis states                                                            */
/* -------------------------------------------------------------------------- */

export interface StateStyle {
  /** Short label for a badge. */
  readonly label: string
  /** One sentence defining the state, shown on hover. Never omitted. */
  readonly meaning: string
  readonly text: string
  readonly fill: string
  readonly wash: string
  readonly border: string
  readonly rule: string
  /** SVG-friendly colour. */
  readonly rgb: string
  /**
   * A single mark that identifies the state without colour.
   *
   * This exists because of a constraint the palette cannot engineer its way
   * out of. Requiring every hue to clear WCAG AA against *both* a near-black
   * and a near-white surface stack confines all of them to a narrow band of
   * luminance — which is exactly the condition under which a reader with
   * deuteranopia sees green and amber as the same colour. `tokens.test.ts`
   * measures it: the closest pair is about 1.04:1, and no five-hue palette
   * meeting the contrast requirement does materially better.
   *
   * So colour is never the only channel. Wherever a state appears, one of
   * these is present too: the badge's text label, the pattern below, or this
   * glyph. The test asserts that any two states within 1.12:1 of each other
   * carry different glyphs.
   */
  readonly glyph: string
  /**
   * A non-colour treatment for the two states that would otherwise share a
   * hue: INSUFFICIENT DATA is hatched, INCONSISTENT is dotted.
   */
  readonly pattern?: 'hatch' | 'dotted'
}

export const STATE_STYLE: Readonly<Record<AnalysisState, StateStyle>> = {
  valid: {
    label: 'Valid',
    meaning: 'The operation is legitimate for the kind of scale the register declares.',
    text: 'text-supported',
    fill: 'bg-supported',
    wash: 'bg-supported/10',
    border: 'border-supported/35',
    rule: 'bg-supported',
    rgb: 'rgb(var(--state-supported))',
    glyph: "✓",
  },
  supported: {
    label: 'Supported',
    meaning: 'The measurement supports the conclusion being drawn from it.',
    text: 'text-supported',
    fill: 'bg-supported',
    wash: 'bg-supported/10',
    border: 'border-supported/35',
    rule: 'bg-supported',
    rgb: 'rgb(var(--state-supported))',
    glyph: "✓",
  },
  ambiguous: {
    label: 'Ambiguous',
    meaning: 'The numbers cannot separate these cases. The conclusion may hold; the register cannot show that it does.',
    text: 'text-ambiguous',
    fill: 'bg-ambiguous',
    wash: 'bg-ambiguous/10',
    border: 'border-ambiguous/35',
    rule: 'bg-ambiguous',
    rgb: 'rgb(var(--state-ambiguous))',
    glyph: "?",
  },
  inconsistent: {
    label: 'Inconsistent',
    meaning: 'Comparable inputs were scored differently. Not an error — a difference in how the scale is being read.',
    text: 'text-ambiguous',
    fill: 'bg-ambiguous',
    wash: 'bg-ambiguous/10',
    border: 'border-ambiguous/40',
    rule: 'bg-ambiguous',
    rgb: 'rgb(var(--state-ambiguous))',
    glyph: "≠",
    pattern: 'dotted',
  },
  distorted: {
    label: 'Distorted',
    meaning: 'The scale materially misrepresents a difference the register itself records.',
    text: 'text-distorted',
    fill: 'bg-distorted',
    wash: 'bg-distorted/10',
    border: 'border-distorted/35',
    rule: 'bg-distorted',
    rgb: 'rgb(var(--state-distorted))',
    glyph: "!",
  },
  'requires-quantification': {
    label: 'Quantify',
    meaning: 'Only a quantitative model can settle this. The qualitative score cannot answer the question being asked of it.',
    text: 'text-quantify',
    fill: 'bg-quantify',
    wash: 'bg-quantify/10',
    border: 'border-quantify/35',
    rule: 'bg-quantify',
    rgb: 'rgb(var(--state-quantify))',
    glyph: '∗',
  },
  'insufficient-data': {
    label: 'No data',
    meaning: 'The register does not contain enough to answer this. Reported rather than guessed.',
    text: 'text-insufficient',
    fill: 'bg-insufficient',
    wash: 'bg-insufficient/10',
    border: 'border-insufficient/30',
    rule: 'bg-insufficient',
    rgb: 'rgb(var(--state-insufficient))',
    glyph: '·',
    pattern: 'hatch',
  },
}

export const INVERSION_STATE: Readonly<Record<InversionStatus, AnalysisState>> = {
  'confirmed-under-model': 'distorted',
  candidate: 'ambiguous',
  'ordinally-indeterminate': 'ambiguous',
  'insufficient-information': 'insufficient-data',
}

export const INVERSION_LABEL: Readonly<Record<InversionStatus, string>> = {
  'confirmed-under-model': 'Confirmed under model',
  candidate: 'Candidate',
  'ordinally-indeterminate': 'Order not determined',
  'insufficient-information': 'Insufficient information',
}

export const SEVERITY_STATE: Readonly<Record<Severity, AnalysisState>> = {
  blocking: 'distorted',
  degrading: 'ambiguous',
  note: 'insufficient-data',
}

export const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  blocking: 'Excluded from an analysis',
  degrading: 'Reduces what can be said',
  note: 'Recorded only',
}

export const RELATION_STYLE: Readonly<Record<RelationKind, { stroke: string; dash?: string }>> = {
  'same-cell': { stroke: 'rgb(var(--accent))' },
  'potential-inversion': { stroke: 'rgb(var(--state-distorted))' },
  'quantification-group': { stroke: 'rgb(var(--state-quantify))', dash: '3 3' },
  'same-category': { stroke: 'rgb(var(--line-3))', dash: '2 4' },
  'same-business-unit': { stroke: 'rgb(var(--line-3))', dash: '1 5' },
  'same-assessor': { stroke: 'rgb(var(--quant))', dash: '4 3' },
}

/* -------------------------------------------------------------------------- */
/* Surfaces, type and controls                                                */
/* -------------------------------------------------------------------------- */

export const SURFACE = {
  /** A major information surface: a panel with a hairline and no shadow. */
  panel: 'bg-surface-1 border border-line-1 rounded-lg',
  /** A nested well inside a panel: raw values, formulas, evidence. */
  well: 'bg-surface-inset border border-line-1 rounded-md',
  /** A row in a list. */
  row: 'border-b border-line-1 last:border-b-0',
  /** Anything that floats: drawer, palette, tooltip, modal. */
  float: 'bg-surface-1 border border-line-2 rounded-lg shadow-pop',
  /** A raised tile that responds to the pointer. */
  tile: 'bg-surface-2 border border-line-1 rounded-md transition-colors duration-140 ease-out hover:bg-surface-3 hover:border-line-2',
} as const

export const TYPE = {
  /** Section eyebrow: small, tracked, monospace, muted. */
  eyebrow: 'font-mono text-2xs uppercase tracking-[0.16em] text-ink-3',
  /** Panel title. */
  title: 'font-display text-lg font-medium tracking-tight text-ink-0',
  /** View heading. */
  heading: 'font-display text-2xl font-medium tracking-tight text-ink-0',
  /** The product wordmark and hero sizes. */
  display: 'font-display font-medium tracking-tight text-ink-0',
  /** Body copy inside a panel. */
  body: 'text-base text-ink-1',
  /** Small print that still has to be read. */
  note: 'text-xs text-ink-2 leading-relaxed',
  /** Identifiers, cells, formulas, raw values. */
  mono: 'font-mono text-xs text-ink-1',
  /** A number in a metric. */
  metric: 'font-display text-3xl font-medium tracking-tight tnum text-ink-0',
  /** A number in a dense table. */
  figure: 'font-mono text-xs tnum text-ink-0',
} as const

export const CONTROL = {
  button:
    'inline-flex items-center gap-2 h-8 px-3 rounded text-xs font-medium border border-line-2 bg-surface-2 text-ink-0 transition-colors duration-90 hover:bg-surface-3 hover:border-line-3 active:translate-y-px disabled:opacity-40 disabled:pointer-events-none',
  primary:
    'inline-flex items-center gap-2 h-9 px-4 rounded text-xs font-medium border border-accent/40 bg-accent/15 text-accent-strong transition-colors duration-90 hover:bg-accent/25 active:translate-y-px disabled:opacity-40 disabled:pointer-events-none',
  ghost:
    'inline-flex items-center gap-2 h-8 px-2.5 rounded text-xs text-ink-2 transition-colors duration-90 hover:bg-surface-2 hover:text-ink-0',
  icon: 'inline-flex items-center justify-center h-7 w-7 rounded border border-line-2 bg-surface-2 text-ink-1 transition-colors duration-90 hover:bg-surface-3 hover:text-ink-0',
  chip: 'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-2xs font-mono uppercase tracking-[0.08em] border border-line-2 text-ink-2 transition-all duration-140 ease-out hover:border-line-3 hover:text-ink-1',
  chipOn:
    'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-2xs font-mono uppercase tracking-[0.08em] border border-accent/50 bg-accent/15 text-accent-strong transition-all duration-140 ease-out',
  input:
    'h-8 w-full rounded border border-line-2 bg-surface-inset px-2.5 text-xs text-ink-0 placeholder:text-ink-3 transition-colors duration-90 focus:border-accent/60 focus:outline-none',
  select:
    'h-8 rounded border border-line-2 bg-surface-inset px-2 text-xs text-ink-0 transition-colors duration-90 focus:border-accent/60 focus:outline-none',
} as const

/**
 * Where an interval came from. Displayed next to every interval, because an
 * estimate the register supplied and a band inherited from a scale anchor
 * deserve very different amounts of trust.
 */
export const SOURCE_STYLE = {
  'register-estimate': { label: 'Estimated', text: 'text-quant', dot: 'bg-quant' },
  'scale-anchor': { label: 'From cell anchor', text: 'text-ink-3', dot: 'bg-ink-3' },
  none: { label: 'None', text: 'text-insufficient', dot: 'bg-insufficient' },
} as const

/** Treatment, shown as a quiet label rather than a colour. */
export const TREATMENT_LABEL: Readonly<Record<string, string>> = {
  mitigate: 'Mitigate',
  transfer: 'Transfer',
  avoid: 'Avoid',
  accept: 'Accept',
  unknown: 'Not recorded',
}
