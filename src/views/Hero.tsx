/**
 * The landing screen.
 *
 * It has five seconds to say what the product is and sixty to make somebody
 * want it, so it does three things and stops: names the problem in one
 * sentence, *shows* it with the signature diagram, and offers one button that
 * gets to the answer without a form.
 *
 * The diagram is the whole argument in one picture — a single matrix cell on
 * the left, and the four intervals it is covering on the right, two of which
 * sit on opposite sides of the appetite line. Nobody needs the text under it
 * explained after they have looked at it for three seconds, which is the test
 * a hero illustration has to pass.
 */

import { CONTROL, TYPE } from '../ui/tokens.ts'
import { Kbd } from '../ui/primitives.tsx'

export function Hero({
  onDemo,
  onImport,
  onMethodology,
}: {
  onDemo: () => void
  onImport: () => void
  onMethodology: () => void
}): React.JSX.Element {
  return (
    <div className="grid-field min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-5 sm:px-8">
        <header className="flex items-center justify-between py-6">
          <span className="flex items-center gap-2.5">
            <Mark />
            <span className="font-display text-sm font-medium tracking-[0.2em] text-ink-0">
              PARALLAX
            </span>
          </span>
          <span className="hidden items-center gap-2 text-2xs text-ink-3 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-supported" />
            Runs entirely in this tab
          </span>
        </header>

        <main className="flex flex-1 flex-col justify-center py-10">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            <div className="animate-rise-in">
              <p className={`${TYPE.eyebrow} mb-5`}>Risk register measurement auditor</p>
              <h1 className={`${TYPE.display} text-4xl leading-[1.05] sm:text-5xl`}>
                Find where your risk numbers
                <br />
                <span className="text-ink-2">cannot support</span> the decisions
                <br />
                built on them.
              </h1>
              <p className="mt-6 max-w-xl text-md leading-relaxed text-ink-2">
                PARALLAX does not tell you your register is wrong. It tells you which of its
                conclusions follow from the assessments and which follow from the notation — then
                picks the handful of risks where a quantitative answer would actually change a
                decision.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button type="button" onClick={onDemo} className={CONTROL.primary}>
                  Load the sample register
                  <span className="font-mono text-[10px] text-accent-strong/70">126 rows</span>
                </button>
                <button type="button" onClick={onImport} className={CONTROL.button}>
                  Import your own
                </button>
                <button type="button" onClick={onMethodology} className={CONTROL.ghost}>
                  How it works
                </button>
              </div>

              <dl className="mt-10 grid max-w-lg grid-cols-3 gap-6 border-t border-line-1 pt-6">
                <Claim term="Never leaves the tab" detail="No upload, no server, no telemetry. The page cannot make a network request." />
                <Claim term="Every finding explained" detail="What, why, on what assumption, from what evidence, and what to do next." />
                <Claim term="Reproducible" detail="Every simulated number comes from a named seed. The same file gives the same report." />
              </dl>
            </div>

            <div className="animate-rise-in [animation-delay:120ms]">
              <HeroDiagram />
            </div>
          </div>
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line-1 py-5 text-2xs text-ink-3">
          <span>
            A measurement audit and quantification triage tool. Not a replacement for FAIR or for
            your risk methodology.
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
            <span>anywhere</span>
          </span>
        </footer>
      </div>
    </div>
  )
}

function Claim({ term, detail }: { term: string; detail: string }): React.JSX.Element {
  return (
    <div>
      <dt className="text-xs font-medium text-ink-0">{term}</dt>
      <dd className="mt-1 text-2xs leading-relaxed text-ink-3">{detail}</dd>
    </div>
  )
}

function Mark(): React.JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
      <rect x="5.5" y="9.5" width="7" height="13" rx="1.6" fill="rgb(var(--accent) / 0.22)" />
      <rect
        x="5.5"
        y="9.5"
        width="7"
        height="13"
        rx="1.6"
        fill="none"
        stroke="rgb(var(--accent))"
        strokeWidth="1.2"
      />
      <rect x="15" y="10.4" width="12" height="2.6" rx="1.3" fill="rgb(var(--quant))" />
      <rect x="15" y="14.7" width="7" height="2.6" rx="1.3" fill="rgb(var(--quant))" opacity="0.66" />
      <rect x="15" y="19" width="10.5" height="2.6" rx="1.3" fill="rgb(var(--quant))" opacity="0.4" />
    </svg>
  )
}

/**
 * The hero diagram.
 *
 * Hand-built SVG rather than a live render of the demo data, because the
 * landing page must work before anything is loaded — and because the point
 * being made is structural rather than about any particular register. The
 * numbers on it are illustrative and the caption says so.
 */
function HeroDiagram(): React.JSX.Element {
  const bars = [
    { label: 'Regulatory penalty', left: 2, width: 18, estimated: true },
    { label: 'Supplier breach', left: 24, width: 32, estimated: true },
    { label: 'Bucket exposure', left: 12, width: 60, estimated: true },
    { label: 'Two with no estimate', left: 6, width: 84, estimated: false },
  ]

  return (
    <figure className="m-0 rounded-xl border border-line-1 bg-surface-1/80 p-5 shadow-pop backdrop-blur-sm sm:p-7">
      <figcaption className={`${TYPE.eyebrow} mb-5`}>One cell, several realities</figcaption>

      <div className="flex items-stretch gap-5">
        <div className="flex w-24 shrink-0 flex-col justify-center">
          <div className="relative rounded-md border border-accent/50 bg-accent/12 px-2 py-5 text-center shadow-plate">
            <p className="font-display text-2xl font-medium text-ink-0">16</p>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-accent-strong">
              High × High
            </p>
            <p className="mt-2 font-mono text-[10px] text-ink-3">5 risks</p>
          </div>
          <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
            the score
          </p>
        </div>

        <div className="min-w-0 flex-1">
          <ul className="space-y-2.5">
            {bars.map((bar, index) => (
              <li
                key={bar.label}
                className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-center gap-3"
                style={{
                  ['--depth' as string]: String(index - 1.5),
                  animation: `parallax-split 760ms cubic-bezier(0.16,1,0.3,1) ${300 + index * 90}ms both`,
                }}
              >
                <span className="truncate-flex text-[11px] text-ink-2">{bar.label}</span>
                <span className="relative block h-6">
                  <span
                    aria-hidden
                    className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-1"
                  />
                  <span
                    className={`absolute inset-y-[0.45rem] rounded-full ${
                      bar.estimated ? 'bg-quant' : 'bg-insufficient hatch'
                    }`}
                    style={{
                      left: `${bar.left}%`,
                      width: `${bar.width}%`,
                      opacity: 1 - index * 0.12,
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>

          <div className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-3">
            <span />
            <div className="relative mt-2 h-7 border-t border-line-2">
              {['£10k', '£100k', '£1M', '£10M'].map((tick, index) => (
                <span
                  key={tick}
                  className="absolute top-2 font-mono text-[10px] text-ink-3"
                  style={{ left: `${index * 31}%`, transform: 'translateX(-50%)' }}
                >
                  {tick}
                </span>
              ))}
              <span
                aria-hidden
                className="absolute -top-[7.9rem] bottom-2 w-px bg-quantify/70"
                style={{ left: '46%' }}
              />
              <span
                className="absolute -top-[9.2rem] -translate-x-1/2 whitespace-nowrap rounded bg-quantify/15 px-1.5 py-0.5 font-mono text-[10px] text-quantify"
                style={{ left: '46%' }}
              >
                appetite
              </span>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-6 border-t border-line-1 pt-4 text-xs leading-relaxed text-ink-2">
        Five risks, one score. Two of them fall on opposite sides of the organisation&rsquo;s own
        appetite threshold, and two carry no estimate at all — so nothing in the register
        distinguishes them from each other.{' '}
        <span className="text-ink-3">Illustrative. Load the sample to see it on real analysis.</span>
      </p>
    </figure>
  )
}
