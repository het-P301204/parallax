/**
 * The last line of defence.
 *
 * A crash in a view must not leave a blank page, and — more importantly here —
 * must not leak the register. The boundary shows the error's *type* and the
 * component stack's first frame, never a value: a thrown error in a rendering
 * path very often carries the data that broke it, and that data is somebody's
 * unmitigated weaknesses with an owner's name attached.
 *
 * For the same reason nothing is reported anywhere. There is no telemetry in
 * this product, and the page's Content Security Policy would refuse the
 * request if there were.
 */

import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface State {
  readonly error?: { name: string; message: string; frame?: string }
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = {}

  static getDerivedStateFromError(error: unknown): State {
    const named = error instanceof Error ? error : new Error('Unknown error')
    return { error: { name: named.name, message: named.message } }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const frame = info.componentStack?.trim().split('\n')[0]?.trim()
    this.setState((current) =>
      current.error ? { error: { ...current.error, frame } } : current,
    )
    // Deliberately the console and nowhere else. See the note above.
    console.error('[parallax] render failed', error)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
        <p className="mb-2 font-mono text-2xs uppercase tracking-[0.16em] text-distorted">
          Something in the interface failed
        </p>
        <h1 className="font-display text-2xl font-medium tracking-tight text-ink-0">
          The analysis is intact; the page that was drawing it is not.
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-2">
          Nothing was sent anywhere — this page cannot make a network request, and the register you
          loaded only ever existed in this tab&rsquo;s memory. Reloading clears it entirely.
        </p>
        <pre className="mt-5 overflow-x-auto rounded-md border border-line-1 bg-surface-inset px-3 py-2.5 font-mono text-2xs text-ink-2">
          {error.name}: {error.message}
          {error.frame ? `\n${error.frame}` : ''}
        </pre>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-9 items-center rounded border border-accent/40 bg-accent/15 px-4 text-xs font-medium text-accent-strong"
          >
            Reload
          </button>
        </div>
        <p className="mt-6 text-2xs leading-relaxed text-ink-3">
          If it reproduces, the message above is enough to open an issue with. Please do not paste
          your register into one.
        </p>
      </div>
    )
  }
}
