/**
 * The shared components every view is assembled from.
 *
 * Kept small and unopinionated about layout: a `Panel` decides what a panel
 * looks like, not what goes in one. The rule that matters is that nothing here
 * calculates anything — a `Metric` renders a number it was handed, and a
 * `StateBadge` renders a state the engine decided. Arithmetic in a component
 * is arithmetic no test can reach.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AnalysisState, Explanation } from '../engine/index.ts'
import { STATE_STYLE, SURFACE, TYPE, CONTROL } from './tokens.ts'
import { Tooltip } from './Tooltip.tsx'

/* -------------------------------------------------------------------------- */
/* Structure                                                                  */
/* -------------------------------------------------------------------------- */

export function Panel({
  title,
  eyebrow,
  actions,
  children,
  className = '',
  dense = false,
}: {
  title?: ReactNode
  eyebrow?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  dense?: boolean
}): React.JSX.Element {
  return (
    <section className={`${SURFACE.panel} ${className}`}>
      {title || eyebrow || actions ? (
        <header className="flex items-start justify-between gap-4 border-b border-line-1 px-5 py-4">
          <div className="min-w-0">
            {eyebrow ? <p className={`${TYPE.eyebrow} mb-1.5`}>{eyebrow}</p> : null}
            {title ? <h2 className={TYPE.title}>{title}</h2> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={dense ? '' : 'p-5'}>{children}</div>
    </section>
  )
}

export function SectionHeading({
  step,
  title,
  lead,
  actions,
}: {
  step?: string
  title: string
  lead?: ReactNode
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        {step ? <p className={`${TYPE.eyebrow} mb-2`}>{step}</p> : null}
        <h1 className={TYPE.heading}>{title}</h1>
        {lead ? <p className="mt-2 text-base leading-relaxed text-ink-2">{lead}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  )
}

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A state badge.
 *
 * Every one carries the state's definition on hover. The pattern classes are
 * not decoration: `insufficient-data` is hatched and `inconsistent` is dotted
 * so the two amber states and the grey one remain distinguishable without
 * colour.
 */
export function StateBadge({
  state,
  label,
  size = 'sm',
}: {
  state: AnalysisState
  label?: string
  size?: 'sm' | 'xs'
}): React.JSX.Element {
  const style = STATE_STYLE[state]
  return (
    <Tooltip title={style.label} body={style.meaning}>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border ${style.border} ${style.wash} ${style.text} ${
          size === 'sm' ? 'h-6 px-2.5 text-2xs' : 'h-5 px-2 text-[10px]'
        } font-mono uppercase tracking-[0.08em]`}
      >
        <span aria-hidden className="shrink-0 font-mono leading-none opacity-90">
          {style.glyph}
        </span>
        {label ?? style.label}
      </span>
    </Tooltip>
  )
}

/** A thin coloured rule that carries a state at the left edge of a row. */
export function StateRule({ state }: { state: AnalysisState }): React.JSX.Element {
  const style = STATE_STYLE[state]
  return (
    <span
      aria-hidden
      className={`absolute inset-y-0 left-0 w-0.5 ${style.rule} ${
        style.pattern === 'dotted' ? 'rule-dotted' : ''
      } ${style.pattern === 'hatch' ? 'hatch' : ''}`}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Numbers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A headline number.
 *
 * `of` renders the denominator, because a count with no denominator is the
 * commonest way a dashboard misleads: "18 ambiguous pairs" means nothing until
 * it sits next to "of 6,261".
 */
export function Metric({
  label,
  value,
  of,
  hint,
  state,
  animate = true,
}: {
  label: string
  value: number | string
  of?: string
  hint?: string
  state?: AnalysisState
  animate?: boolean
}): React.JSX.Element {
  const numeric = typeof value === 'number' ? value : undefined
  const shown = useCountUp(numeric ?? 0, animate && numeric !== undefined)

  const body = (
    <div className="min-w-0">
      <p className={`${TYPE.eyebrow} mb-2 truncate-flex`}>{label}</p>
      <p className="flex items-baseline gap-1.5">
        <span className={`${TYPE.metric} ${state ? STATE_STYLE[state].text : ''}`}>
          {numeric === undefined ? value : shown.toLocaleString('en-GB')}
        </span>
        {of ? <span className="font-mono text-xs text-ink-3 tnum">{of}</span> : null}
      </p>
    </div>
  )

  return hint ? (
    <Tooltip title={label} body={hint} className="w-full">
      <span className="block w-full cursor-help">{body}</span>
    </Tooltip>
  ) : (
    body
  )
}

/** True when the reader has asked the platform for less motion. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Counts a number up on first render.
 *
 * Honest about what it is: the value is already known, and the animation is
 * decoration on the *arrival* of a panel, not a simulation of work. It runs
 * once, for under half a second.
 *
 * When it is not animating — reduced motion, or `enabled: false` — the target
 * is returned directly rather than being pushed into state from an effect.
 * That is not only tidier: a number that ticks is a number that is hard to
 * read, and a reader who asked for less motion should get the final value on
 * the first paint rather than one render later.
 */
export function useCountUp(target: number, enabled = true): number {
  const animate = enabled && !prefersReducedMotion()
  const [value, setValue] = useState(animate ? 0 : target)
  const frame = useRef(0)

  useEffect(() => {
    if (!animate) return undefined
    const start = performance.now()
    const duration = 460
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 3
      setValue(Math.round(target * eased))
      if (t < 1) frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [target, animate])

  return animate ? value : target
}

/* -------------------------------------------------------------------------- */
/* Explanations                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The five-question explanation block.
 *
 * Every finding in PARALLAX carries one, and this is the only component that
 * renders it, so a finding cannot reach the screen with three of the five
 * answered. `Assumption` is given its own treatment rather than being a fourth
 * paragraph: it is the field that decides how much the reader should believe
 * the rest.
 */
export function ExplanationBlock({
  explanation,
  compact = false,
}: {
  explanation: Explanation
  compact?: boolean
}): React.JSX.Element {
  return (
    <div className={compact ? 'space-y-2.5' : 'space-y-3.5'}>
      <Field label="What">{explanation.what}</Field>
      <Field label="Why">{explanation.why}</Field>
      <div className={`${SURFACE.well} px-3 py-2.5`}>
        <p className={`${TYPE.eyebrow} mb-1`}>Assumption</p>
        <p className="text-xs leading-relaxed text-ink-1">{explanation.assumption}</p>
      </div>
      <Field label="Evidence" mono>
        {explanation.evidence}
      </Field>
      <Field label="What to do next">{explanation.next}</Field>
    </div>
  )
}

export function Field({
  label,
  children,
  mono = false,
}: {
  label: string
  children: ReactNode
  mono?: boolean
}): React.JSX.Element {
  return (
    <div>
      <p className={`${TYPE.eyebrow} mb-1`}>{label}</p>
      <p className={mono ? 'font-mono text-2xs leading-relaxed text-ink-2' : 'text-xs leading-relaxed text-ink-1'}>
        {children}
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                   */
/* -------------------------------------------------------------------------- */

export function Button({
  variant = 'default',
  children,
  ...rest
}: { variant?: 'default' | 'primary' | 'ghost' } & React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  const className =
    variant === 'primary' ? CONTROL.primary : variant === 'ghost' ? CONTROL.ghost : CONTROL.button
  return (
    <button type="button" {...rest} className={`${className} ${rest.className ?? ''}`}>
      {children}
    </button>
  )
}

export function Chip({
  active,
  children,
  ...rest
}: { active?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      {...rest}
      className={`${active ? CONTROL.chipOn : CONTROL.chip} ${rest.className ?? ''}`}
    >
      {children}
    </button>
  )
}

/** A copy button that confirms in place rather than with a toast. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }): React.JSX.Element {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return undefined
    const timer = setTimeout(() => setDone(false), 1400)
    return () => clearTimeout(timer)
  }, [done])

  return (
    <Button
      variant="ghost"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => setDone(true),
          () => setDone(false),
        )
      }}
      aria-live="polite"
    >
      {done ? '✓ Copied' : label}
    </Button>
  )
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  title,
  body,
  action,
  icon = 'empty',
}: {
  title: string
  body: ReactNode
  action?: ReactNode
  icon?: 'empty' | 'search' | 'clean'
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <EmptyGlyph kind={icon} />
      <h3 className="mt-5 font-display text-lg font-medium tracking-tight text-ink-0">{title}</h3>
      <p className="mt-2 max-w-md text-xs leading-relaxed text-ink-2">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

function EmptyGlyph({ kind }: { kind: 'empty' | 'search' | 'clean' }): React.JSX.Element {
  const stroke = kind === 'clean' ? 'rgb(var(--state-supported))' : 'rgb(var(--line-3))'
  return (
    <svg width="56" height="40" viewBox="0 0 56 40" fill="none" aria-hidden>
      <rect x="1" y="9" width="18" height="22" rx="3" stroke={stroke} strokeWidth="1.25" />
      <path d="M25 14h30M25 20h20M25 26h26" stroke={stroke} strokeWidth="1.25" strokeLinecap="round" opacity="0.6" />
      {kind === 'clean' ? (
        <path d="M6 20l3.5 3.5L15 16" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
    </svg>
  )
}

export function ErrorState({
  title,
  detail,
  remedy,
  action,
}: {
  title: string
  detail?: string
  remedy?: string
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="px-6 py-12">
      <div className="mx-auto max-w-lg">
        <StateBadge state="distorted" label="Could not continue" />
        <h3 className="mt-3 font-display text-lg font-medium tracking-tight text-ink-0">{title}</h3>
        {detail ? (
          <p className={`${SURFACE.well} mt-3 px-3 py-2 font-mono text-2xs leading-relaxed text-ink-2`}>
            {detail}
          </p>
        ) : null}
        {remedy ? <p className="mt-3 text-xs leading-relaxed text-ink-1">{remedy}</p> : null}
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Small parts                                                                */
/* -------------------------------------------------------------------------- */

/** A labelled key-value line, aligned so a column of them reads as a table. */
export function DataRow({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}): React.JSX.Element {
  const content = (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="shrink-0 text-xs text-ink-3">{label}</span>
      <span className="min-w-0 text-right text-xs text-ink-0">{children}</span>
    </div>
  )
  return hint ? (
    <Tooltip title={label} body={hint} className="w-full">
      <span className="block w-full cursor-help">{content}</span>
    </Tooltip>
  ) : (
    content
  )
}

/** A proportion bar. Used for triage components and confidence, never for risk. */
export function Bar({
  value,
  tone = 'accent',
  height = 4,
}: {
  value: number
  tone?: 'accent' | 'quant' | AnalysisState
  height?: number
}): React.JSX.Element {
  const fill =
    tone === 'accent' ? 'bg-accent' : tone === 'quant' ? 'bg-quant' : STATE_STYLE[tone].fill
  return (
    <span className="block w-full overflow-hidden rounded-full bg-surface-3" style={{ height }}>
      <span
        className={`block h-full rounded-full ${fill} transition-[width] duration-560 ease-out`}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </span>
  )
}

/** Keyboard hint, used in the palette and the header. */
export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <kbd className="rounded border border-line-2 bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-2">
      {children}
    </kbd>
  )
}

/** Renders children only once they scroll into view. Used for heavy charts. */
export function Reveal({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  // Where there is no observer — an old browser, a test renderer — the content
  // is shown from the first render rather than revealed by an effect, so the
  // fallback costs nothing and never flashes empty.
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (shown) return undefined
    const node = ref.current
    if (!node) return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true)
          observer.disconnect()
        }
      },
      { rootMargin: '120px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [shown])

  return (
    <div ref={ref} className={className}>
      {shown ? children : null}
    </div>
  )
}
