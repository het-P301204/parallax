/**
 * Application state.
 *
 * One store, held in `App`, published through a context. It holds what the
 * *reader* is doing — which view, which cell, which filters, which mode — and
 * exactly one piece of domain data: the `AuditReport` the engine produced.
 *
 * Nothing here computes a finding. When a filter changes, the views re-read
 * the same report through a pure predicate in `views/filter.ts`; the analysis
 * is never re-run, because re-running an analysis on a filter change would
 * mean the numbers on screen described the filter rather than the register.
 *
 * The register itself lives in memory and nowhere else. There is no
 * persistence of anything derived from an imported file — see `THEME_KEY`
 * below for the only thing that touches storage at all.
 */

import { createContext, useContext } from 'react'
import type { AuditReport, ColumnMapping, CsvTable, ScoringModel } from './engine/index.ts'

export type ViewId =
  | 'overview'
  | 'measurement'
  | 'matrix'
  | 'compression'
  | 'ranking'
  | 'calibration'
  | 'quantify'
  | 'simulate'
  | 'decision'
  | 'register'
  | 'methodology'

export interface ViewDescriptor {
  readonly id: ViewId
  readonly label: string
  /** The question this view answers, shown under the heading and in search. */
  readonly question: string
  /** Executive mode shows only the views marked true. */
  readonly executive: boolean
}

/**
 * The navigation *is* the product's argument, in order. A reader who walks it
 * top to bottom has been taken from "what is in this register" to "what should
 * I do about it" without a step that has to be taken on trust.
 */
export const VIEWS: readonly ViewDescriptor[] = [
  { id: 'overview', label: 'Overview', question: 'What is in this register, and how much of it can be checked?', executive: true },
  { id: 'measurement', label: 'Measurement', question: 'What kind of scale is this, and what is it entitled to do?', executive: false },
  { id: 'matrix', label: 'Matrix', question: 'What does a single cell hide?', executive: true },
  { id: 'compression', label: 'Compression', question: 'Where does the matrix lose information?', executive: false },
  { id: 'ranking', label: 'Ranking', question: 'Which rankings may be unreliable?', executive: false },
  { id: 'calibration', label: 'Calibration', question: 'Are comparable risks scored comparably?', executive: false },
  { id: 'quantify', label: 'Quantify', question: 'Which risks actually need quantification?', executive: true },
  { id: 'simulate', label: 'Simulate', question: 'What does the quantitative interval look like?', executive: false },
  { id: 'decision', label: 'Decision', question: 'What should I distrust?', executive: true },
  { id: 'register', label: 'Register', question: 'Every row, with what the audit found against it.', executive: false },
  { id: 'methodology', label: 'Methodology', question: 'How is every number on these pages computed?', executive: false },
]

export type Mode = 'executive' | 'analyst'
export type Theme = 'dark' | 'light'

/** The only key PARALLAX writes. It holds the string "dark" or "light". */
export const THEME_KEY = 'parallax.theme'

export type ImportStage = 'upload' | 'map' | 'validate' | 'analyse' | 'done'

export interface ImportState {
  readonly stage: ImportStage
  readonly fileName?: string
  readonly table?: CsvTable
  readonly mapping?: ColumnMapping
  readonly model: ScoringModel
  readonly notes: readonly string[]
  readonly error?: { title: string; detail: string; remedy: string }
  /** Completed analysis stages, for the progress view. */
  readonly progress: readonly { id: string; note: string; produced: number }[]
}

export interface Filters {
  readonly query: string
  readonly businessUnits: readonly string[]
  readonly categories: readonly string[]
  readonly assessors: readonly string[]
  readonly treatments: readonly string[]
  readonly cellKey?: string
  /** Only risks carrying their own quantitative estimate. */
  readonly estimatedOnly: boolean
  /** Only risks on the quantification shortlist. */
  readonly shortlistOnly: boolean
  /** Only risks appearing in an inversion finding. */
  readonly inversionOnly: boolean
}

export const EMPTY_FILTERS: Filters = {
  query: '',
  businessUnits: [],
  categories: [],
  assessors: [],
  treatments: [],
  cellKey: undefined,
  estimatedOnly: false,
  shortlistOnly: false,
  inversionOnly: false,
}

export function filtersActive(filters: Filters): number {
  return (
    (filters.query.trim() === '' ? 0 : 1) +
    filters.businessUnits.length +
    filters.categories.length +
    filters.assessors.length +
    filters.treatments.length +
    (filters.cellKey ? 1 : 0) +
    (filters.estimatedOnly ? 1 : 0) +
    (filters.shortlistOnly ? 1 : 0) +
    (filters.inversionOnly ? 1 : 0)
  )
}

export interface AppContextValue {
  readonly report?: AuditReport
  readonly view: ViewId
  readonly mode: Mode
  readonly theme: Theme
  readonly filters: Filters
  readonly selectedCell?: string
  readonly openRiskId?: string
  readonly paletteOpen: boolean
  readonly importState: ImportState
  readonly setView: (view: ViewId) => void
  readonly setMode: (mode: Mode) => void
  readonly setTheme: (theme: Theme) => void
  readonly setFilters: (update: (current: Filters) => Filters) => void
  readonly selectCell: (cellKey: string | undefined) => void
  readonly openRisk: (riskId: string | undefined) => void
  readonly setPaletteOpen: (open: boolean) => void
  readonly startImport: () => void
  readonly loadDemo: () => void
  readonly reset: () => void
}

export const AppContext = createContext<AppContextValue | undefined>(undefined)

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside the application provider')
  return value
}

/** Views a given mode is allowed to show. */
export function viewsFor(mode: Mode): readonly ViewDescriptor[] {
  return mode === 'executive' ? VIEWS.filter((v) => v.executive) : VIEWS
}
