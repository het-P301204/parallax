/**
 * A tooltip that can hold a paragraph.
 *
 * PARALLAX has a lot to explain and very little room to do it in, so the
 * tooltip is a real surface rather than a one-line hint: it holds a title, a
 * body, and optionally the assumption a finding rests on. Every status badge
 * in the product has one, because a status nobody can define is a colour.
 *
 * It is a portal-free, absolutely positioned element inside a `relative`
 * wrapper, flipped by measuring against the viewport after mount. That keeps
 * it inside React's tree — no document-level listeners, no focus stealing —
 * and it is dismissible with Escape, which matters for a keyboard reader who
 * has tabbed onto the trigger.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface TooltipProps {
  readonly title?: string
  readonly body: ReactNode
  readonly children: ReactNode
  /** Preferred side. Flipped automatically if it would leave the viewport. */
  readonly side?: 'top' | 'bottom'
  readonly width?: number
  readonly className?: string
}

export function Tooltip({
  title,
  body,
  children,
  side = 'top',
  width = 288,
  className = '',
}: TooltipProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<'top' | 'bottom'>(side)
  const [shift, setShift] = useState(0)
  const wrapper = useRef<HTMLSpanElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  const id = useId()

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  // Measured after paint rather than guessed, so a tooltip on a cell at the
  // right edge of the matrix does not disappear off screen.
  useLayoutEffect(() => {
    if (!open || !wrapper.current || !bubble.current) return
    const anchor = wrapper.current.getBoundingClientRect()
    const box = bubble.current.getBoundingClientRect()
    setPlacement(side === 'top' && anchor.top < box.height + 16 ? 'bottom' : side)
    const centre = anchor.left + anchor.width / 2
    const half = width / 2
    const margin = 12
    let offset = 0
    if (centre - half < margin) offset = margin - (centre - half)
    else if (centre + half > window.innerWidth - margin) {
      offset = window.innerWidth - margin - (centre + half)
    }
    setShift(offset)
  }, [open, side, width])

  return (
    <span
      ref={wrapper}
      // The trigger is rendered as a direct child rather than inside a second
      // wrapper span. An inline wrapper shrink-wraps, which silently collapses
      // any `w-full` child inside it -- the reason a tooltipped matrix cell
      // used to render as a sliver instead of a cell.
      className={`relative inline-flex ${className}`}
      aria-describedby={open ? id : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={close}
      onFocus={() => setOpen(true)}
      onBlur={close}
    >
      {children}
      {open ? (
        <span
          ref={bubble}
          id={id}
          role="tooltip"
          style={{ width, transform: `translateX(calc(-50% + ${shift}px))` }}
          className={`pointer-events-none absolute left-1/2 z-50 animate-pop-in rounded-md border border-line-2 bg-surface-1 p-3 text-left shadow-pop ${
            placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          {title ? (
            <span className="mb-1 block font-mono text-2xs uppercase tracking-[0.12em] text-ink-3">
              {title}
            </span>
          ) : null}
          <span className="block text-xs leading-relaxed text-ink-1">{body}</span>
        </span>
      ) : null}
    </span>
  )
}
