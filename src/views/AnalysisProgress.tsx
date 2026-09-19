/**
 * The analysis run, shown as it happens.
 *
 * There is no fake percentage here and no synthetic delay. The engine calls
 * back as each real stage finishes, with the count that stage actually
 * produced, and this renders those counts. On a 126-row register the whole run
 * takes a few hundred milliseconds and the stages tick past almost too fast to
 * read — which is the truth, and is a better thing to show than a progress bar
 * engineered to take three seconds.
 *
 * The one piece of stagecraft is a `requestAnimationFrame` yield between
 * stages, so the browser gets a chance to paint each one. It adds roughly one
 * frame per stage and makes the difference between a readable sequence and a
 * flash.
 */

import { STAGES } from '../engine/index.ts'
import type { StageProgress } from '../engine/index.ts'
import { TYPE } from '../ui/tokens.ts'

export function AnalysisProgress({
  completed,
  registerName,
}: {
  completed: readonly StageProgress[]
  registerName: string
}): React.JSX.Element {
  const done = new Map(completed.map((c) => [c.id, c]))
  const currentIndex = completed.length

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-surface-0/95 px-5 backdrop-blur-sm">
      <div className="w-full max-w-lg">
        <p className={`${TYPE.eyebrow} mb-2`}>Analysing</p>
        <h2 className="mb-1 font-display text-xl font-medium tracking-tight text-ink-0">
          {registerName}
        </h2>
        <p className="mb-7 text-xs text-ink-2">
          Every stage below is real work on your data. Nothing is uploaded and nothing is waiting on
          a network.
        </p>

        <ol className="space-y-0">
          {STAGES.map((stage, index) => {
            const result = done.get(stage.id)
            const state = result ? 'done' : index === currentIndex ? 'running' : 'todo'
            return (
              <li key={stage.id} className="relative flex gap-3 pb-5 last:pb-0">
                {index < STAGES.length - 1 ? (
                  <span
                    aria-hidden
                    className={`absolute left-[7px] top-5 h-full w-px transition-colors duration-220 ${
                      state === 'done' ? 'bg-supported/45' : 'bg-line-2'
                    }`}
                  />
                ) : null}

                <span
                  aria-hidden
                  className={`relative mt-0.5 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border transition-colors duration-220 ${
                    state === 'done'
                      ? 'border-supported bg-supported/20'
                      : state === 'running'
                        ? 'border-accent bg-accent/20'
                        : 'border-line-2'
                  }`}
                >
                  {state === 'done' ? (
                    <span className="text-[9px] leading-none text-supported">✓</span>
                  ) : state === 'running' ? (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  ) : null}
                </span>

                <div className="min-w-0 flex-1">
                  <p
                    className={`text-xs font-medium transition-colors duration-220 ${
                      state === 'todo' ? 'text-ink-3' : 'text-ink-0'
                    }`}
                  >
                    {stage.label}
                  </p>
                  <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">
                    {result ? result.note : stage.detail}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>

        <div className="mt-7 h-0.5 overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-320 ease-out"
            style={{ width: `${(completed.length / STAGES.length) * 100}%` }}
          />
        </div>
        <p className="mt-2 text-right font-mono text-[10px] text-ink-3 tnum">
          {completed.length} / {STAGES.length} stages
        </p>
      </div>
    </div>
  )
}
