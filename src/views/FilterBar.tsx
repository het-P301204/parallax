/**
 * Filters.
 *
 * On a wide screen a bar; on a narrow one a sheet that slides up from the
 * bottom, because a row of facet dropdowns on a phone is a row of nothing.
 * The count of matched rows is always visible, and the active filter count
 * sits on the trigger, so a reader can never be looking at a filtered view
 * without knowing it — which is the single commonest way an analyst reaches a
 * wrong conclusion in a tool like this.
 */

import { useEffect, useMemo, useState } from 'react'
import type { AuditReport } from '../engine/index.ts'
import { TREATMENTS } from '../engine/index.ts'
import { EMPTY_FILTERS, filtersActive } from '../state.ts'
import type { Filters } from '../state.ts'
import { facetValues, toggle } from './filter.ts'
import { CONTROL, SURFACE, TREATMENT_LABEL, TYPE } from '../ui/tokens.ts'
import { Chip } from '../ui/primitives.tsx'
import { cellPretty, count } from '../ui/format.ts'

export function FilterBar({
  report,
  filters,
  matched,
  onChange,
}: {
  report: AuditReport
  filters: Filters
  matched: number
  onChange: (update: (current: Filters) => Filters) => void
}): React.JSX.Element {
  const [sheet, setSheet] = useState(false)
  const active = filtersActive(filters)

  const facets = useMemo(
    () => ({
      businessUnits: facetValues(report.register.risks, 'businessUnit'),
      categories: facetValues(report.register.risks, 'category'),
      assessors: facetValues(report.register.risks, 'assessor'),
    }),
    [report.register.risks],
  )

  useEffect(() => {
    if (!sheet) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSheet(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sheet])

  const body = (
    <div className="space-y-4">
      <Facet
        label="Business unit"
        values={facets.businessUnits}
        selected={filters.businessUnits}
        onToggle={(value) =>
          onChange((current) => ({ ...current, businessUnits: toggle(current.businessUnits, value) }))
        }
      />
      <Facet
        label="Category"
        values={facets.categories}
        selected={filters.categories}
        onToggle={(value) =>
          onChange((current) => ({ ...current, categories: toggle(current.categories, value) }))
        }
      />
      <Facet
        label="Assessor"
        values={facets.assessors}
        selected={filters.assessors}
        onToggle={(value) =>
          onChange((current) => ({ ...current, assessors: toggle(current.assessors, value) }))
        }
      />
      <Facet
        label="Treatment"
        values={[...TREATMENTS]}
        labels={TREATMENT_LABEL}
        selected={filters.treatments}
        onToggle={(value) =>
          onChange((current) => ({ ...current, treatments: toggle(current.treatments, value) }))
        }
      />
      <div>
        <p className={`${TYPE.eyebrow} mb-2`}>Finding type</p>
        <div className="flex flex-wrap gap-1.5">
          <Chip
            active={filters.shortlistOnly}
            onClick={() =>
              onChange((current) => ({ ...current, shortlistOnly: !current.shortlistOnly }))
            }
          >
            Shortlisted
          </Chip>
          <Chip
            active={filters.inversionOnly}
            onClick={() =>
              onChange((current) => ({ ...current, inversionOnly: !current.inversionOnly }))
            }
          >
            In an inversion
          </Chip>
          <Chip
            active={filters.estimatedOnly}
            onClick={() =>
              onChange((current) => ({ ...current, estimatedOnly: !current.estimatedOnly }))
            }
          >
            Has its own estimate
          </Chip>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="relative min-w-0 flex-1 sm:max-w-xs">
          <span className="sr-only">Search risks</span>
          <input
            value={filters.query}
            onChange={(event) =>
              onChange((current) => ({ ...current, query: event.target.value }))
            }
            placeholder="Search id, title, owner, category, unit…"
            className={CONTROL.input}
          />
        </label>

        <button
          type="button"
          onClick={() => setSheet(true)}
          aria-expanded={sheet}
          className={`${active > 0 ? CONTROL.chipOn : CONTROL.chip} h-8`}
        >
          Filters
          {active > 0 ? <span className="font-mono tnum">{active}</span> : null}
        </button>

        {filters.cellKey ? (
          <Chip active onClick={() => onChange((current) => ({ ...current, cellKey: undefined }))}>
            Cell {cellPretty(filters.cellKey)} ✕
          </Chip>
        ) : null}

        {active > 0 ? (
          <button
            type="button"
            onClick={() => onChange(() => EMPTY_FILTERS)}
            className="text-2xs text-ink-3 transition-colors duration-140 hover:text-ink-1"
          >
            Clear all
          </button>
        ) : null}

        <span className="ml-auto shrink-0 font-mono text-2xs text-ink-3 tnum">
          {count(matched)} / {count(report.register.risks.length)} rows
        </span>
      </div>

      {sheet ? (
        <div className="fixed inset-0 z-40 flex items-end sm:items-start sm:justify-end">
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setSheet(false)}
            className="absolute inset-0 animate-fade-in bg-surface-0/70 backdrop-blur-[2px]"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Filters"
            className={`${SURFACE.float} relative max-h-[80vh] w-full animate-sheet-in overflow-y-auto scroll-thin rounded-b-none p-5 sm:m-6 sm:max-w-sm sm:animate-pop-in sm:rounded-lg`}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-base font-medium tracking-tight text-ink-0">
                Filters
              </h2>
              <button
                type="button"
                onClick={() => setSheet(false)}
                className="text-2xs text-ink-2 hover:text-ink-0"
              >
                Done
              </button>
            </div>
            {body}
            <div className="mt-5 flex items-center justify-between border-t border-line-1 pt-4">
              <button
                type="button"
                onClick={() => onChange(() => EMPTY_FILTERS)}
                className="text-2xs text-ink-3 hover:text-ink-1"
              >
                Clear all
              </button>
              <span className="font-mono text-2xs text-ink-2 tnum">
                {count(matched)} rows match
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function Facet({
  label,
  values,
  selected,
  labels,
  onToggle,
}: {
  label: string
  values: readonly string[]
  selected: readonly string[]
  labels?: Readonly<Record<string, string>>
  onToggle: (value: string) => void
}): React.JSX.Element | null {
  if (values.length === 0) return null
  return (
    <div>
      <p className={`${TYPE.eyebrow} mb-2`}>{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <Chip key={value} active={selected.includes(value)} onClick={() => onToggle(value)}>
            {labels?.[value] ?? value}
          </Chip>
        ))}
      </div>
    </div>
  )
}
