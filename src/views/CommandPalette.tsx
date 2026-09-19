/**
 * The command palette.
 *
 * ⌘K / Ctrl-K. Risks are searchable by identifier, title, owner, category and
 * business unit; every view is reachable by the *question it answers* rather
 * than only by its name, because "which rankings might be wrong" is what
 * somebody is actually looking for and "Ranking" is what it happens to be
 * called.
 *
 * Implemented as a real listbox: `role="combobox"` on the input, `aria-
 * activedescendant` following the arrow keys, and focus returned on close.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AuditReport } from '../engine/index.ts'
import { EXPORTS } from '../engine/index.ts'
import { VIEWS } from '../state.ts'
import type { Mode, ViewId } from '../state.ts'
import { SURFACE, TYPE } from '../ui/tokens.ts'
import { Kbd } from '../ui/primitives.tsx'
import { clip } from '../ui/format.ts'

export interface Command {
  readonly id: string
  readonly label: string
  readonly hint?: string
  readonly group: 'Go to' | 'Risks' | 'Mode' | 'Export' | 'Register'
  readonly run: () => void
}

export function CommandPalette({
  report,
  mode,
  onClose,
  onGo,
  onOpenRisk,
  onSetMode,
  onImport,
  onExport,
  onReset,
}: {
  report?: AuditReport
  mode: Mode
  onClose: () => void
  onGo: (view: ViewId) => void
  onOpenRisk: (riskId: string) => void
  onSetMode: (mode: Mode) => void
  onImport: () => void
  onExport: (id: Parameters<typeof EXPORTS.find>[0] extends never ? never : string) => void
  onReset: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [])

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = []

    for (const view of VIEWS) {
      if (mode === 'executive' && !view.executive) continue
      out.push({
        id: `view:${view.id}`,
        label: view.label,
        hint: view.question,
        group: 'Go to',
        run: () => onGo(view.id),
      })
    }

    out.push({
      id: 'mode:toggle',
      label: mode === 'analyst' ? 'Switch to executive mode' : 'Switch to analyst mode',
      hint:
        mode === 'analyst'
          ? 'Fewer views, no statistical detail, the four questions a board asks.'
          : 'Every view, every assumption, the model parameters and the working.',
      group: 'Mode',
      run: () => onSetMode(mode === 'analyst' ? 'executive' : 'analyst'),
    })

    out.push({
      id: 'register:import',
      label: 'Import a register',
      hint: 'CSV or JSON, read in this tab.',
      group: 'Register',
      run: onImport,
    })
    if (report) {
      out.push({
        id: 'register:reset',
        label: 'Close this register',
        hint: 'Clears the analysis from memory and returns to the start.',
        group: 'Register',
        run: onReset,
      })
      for (const descriptor of EXPORTS) {
        out.push({
          id: `export:${descriptor.id}`,
          label: `Export — ${descriptor.label}`,
          hint: descriptor.description,
          group: 'Export',
          run: () => onExport(descriptor.id),
        })
      }
    }

    if (report && query.trim().length >= 2) {
      const needle = query.trim().toLowerCase()
      for (const risk of report.register.risks) {
        const haystack = [risk.id, risk.title, risk.owner, risk.category, risk.businessUnit]
          .filter((v): v is string => typeof v === 'string')
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(needle)) continue
        out.push({
          id: `risk:${risk.id}`,
          label: risk.title,
          hint: `${risk.id} · ${risk.businessUnit ?? 'no unit'} · score ${report.scoreById.get(risk.id) ?? '—'}`,
          group: 'Risks',
          run: () => onOpenRisk(risk.id),
        })
        if (out.length > 60) break
      }
    }

    return out
  }, [report, mode, query, onGo, onOpenRisk, onSetMode, onImport, onExport, onReset])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return commands.filter((c) => c.group !== 'Risks')
    return commands.filter((command) =>
      `${command.label} ${command.hint ?? ''} ${command.group}`.toLowerCase().includes(needle),
    )
  }, [commands, query])

  useEffect(() => {
    const node = list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const groups = useMemo(() => {
    const map = new Map<Command['group'], Command[]>()
    for (const command of filtered) {
      const bucket = map.get(command.group)
      if (bucket) bucket.push(command)
      else map.set(command.group, [command])
    }
    return [...map.entries()]
  }, [filtered])

  let cursor = -1

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close command palette"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-surface-0/75 backdrop-blur-sm"
      />

      <div className={`${SURFACE.float} relative w-full max-w-xl animate-pop-in overflow-hidden`}>
        <div className="flex items-center gap-3 border-b border-line-1 px-4 py-3">
          <span aria-hidden className="text-ink-3">
            ⌕
          </span>
          <input
            ref={input}
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={`palette-option-${active}`}
            aria-label="Search risks and commands"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              // Reset the highlight here rather than in an effect on `query`:
              // the selection belongs to the keystroke that changed the list.
              setActive(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((current) => Math.min(filtered.length - 1, current + 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((current) => Math.max(0, current - 1))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                const command = filtered[active]
                if (command) {
                  command.run()
                  onClose()
                }
              } else if (event.key === 'Escape') {
                onClose()
              }
            }}
            placeholder="Search risks, views and exports…"
            className="w-full bg-transparent text-sm text-ink-0 placeholder:text-ink-3 focus:outline-none"
          />
          <Kbd>esc</Kbd>
        </div>

        <ul
          ref={list}
          id="palette-list"
          role="listbox"
          aria-label="Results"
          className="max-h-[52vh] overflow-y-auto scroll-thin py-1.5"
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-center text-xs text-ink-2">
              Nothing matches. Risks are searched by identifier, title, owner, category and business
              unit.
            </li>
          ) : (
            groups.map(([group, items]) => (
              <li key={group}>
                <p className={`${TYPE.eyebrow} px-4 py-1.5`}>{group}</p>
                <ul>
                  {items.map((command) => {
                    cursor += 1
                    const index = cursor
                    return (
                      <li key={command.id}>
                        <button
                          type="button"
                          id={`palette-option-${index}`}
                          data-index={index}
                          role="option"
                          aria-selected={index === active}
                          onMouseEnter={() => setActive(index)}
                          onClick={() => {
                            command.run()
                            onClose()
                          }}
                          className={`flex w-full items-baseline gap-3 px-4 py-2 text-left transition-colors duration-90 ${
                            index === active ? 'bg-accent/12' : ''
                          }`}
                        >
                          <span
                            className={`shrink-0 text-xs ${index === active ? 'text-accent-strong' : 'text-ink-0'}`}
                          >
                            {clip(command.label, 46)}
                          </span>
                          {command.hint ? (
                            <span className="truncate-flex text-2xs text-ink-3">{command.hint}</span>
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))
          )}
        </ul>

        <footer className="flex items-center gap-3 border-t border-line-1 px-4 py-2 text-2xs text-ink-3">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> open
          </span>
          <span className="ml-auto">{filtered.length} results</span>
        </footer>
      </div>
    </div>
  )
}
