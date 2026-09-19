/**
 * The application shell.
 *
 * Holds the store, runs the analysis, and routes between views. It is the only
 * place in the interface that calls the engine to *produce* anything; every
 * view below it reads the report it produced.
 *
 * One piece of scheduling worth explaining. `analyse` is synchronous and takes
 * a few hundred milliseconds on a typical register — fast, but long enough
 * that running it in one tick would freeze the tab and show the progress view
 * only after it had finished. So the run is driven one stage at a time through
 * `requestAnimationFrame`, which costs about a frame per stage and lets each
 * one paint. The stage counts shown are the real ones the engine reports;
 * nothing is padded to make the sequence readable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEMO_REGISTER_CSV,
  DEMO_REGISTER_FILE,
  DEMO_REGISTER_NAME,
} from './demo-register.generated.ts'
import {
  analyse,
  asImportError,
  buildRegister,
  defaultModel,
  detectMapping,
  EXPORTS,
  parseTable,
} from './engine/index.ts'
import type { AuditReport, BuildResult, ExportId, StageProgress } from './engine/index.ts'
import { AppContext, EMPTY_FILTERS, THEME_KEY, VIEWS, viewsFor } from './state.ts'
import type { AppContextValue, Filters, Mode, Theme, ViewId } from './state.ts'
import { applyFilters, buildIndex } from './views/filter.ts'
import { AnalysisProgress } from './views/AnalysisProgress.tsx'
import { Calibration } from './views/Calibration.tsx'
import { CommandPalette } from './views/CommandPalette.tsx'
import { Compression } from './views/Compression.tsx'
import { Decision, downloadExport } from './views/Decision.tsx'
import { FilterBar } from './views/FilterBar.tsx'
import { Hero } from './views/Hero.tsx'
import { ImportWizard } from './views/ImportWizard.tsx'
import { MatrixView } from './views/MatrixView.tsx'
import { Measurement } from './views/Measurement.tsx'
import { Methodology } from './views/Methodology.tsx'
import { Overview } from './views/Overview.tsx'
import { Quantify } from './views/Quantify.tsx'
import { Ranking } from './views/Ranking.tsx'
import { RegisterTable } from './views/RegisterTable.tsx'
import { RiskDrawer } from './views/RiskDrawer.tsx'
import { Simulate } from './views/Simulate.tsx'
import { ErrorState, Kbd } from './ui/primitives.tsx'
import { CONTROL, TYPE } from './ui/tokens.ts'

type Screen = 'hero' | 'import' | 'analysing' | 'report'

export function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('hero')
  const [report, setReport] = useState<AuditReport | undefined>()
  const [view, setView] = useState<ViewId>('overview')
  const [mode, setMode] = useState<Mode>('analyst')
  const [theme, setThemeState] = useState<Theme>(readTheme)
  const [filters, setFiltersState] = useState<Filters>(EMPTY_FILTERS)
  const [selectedCell, setSelectedCell] = useState<string | undefined>()
  const [openRiskId, setOpenRiskId] = useState<string | undefined>()
  const [simulateRiskId, setSimulateRiskId] = useState<string | undefined>()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [progress, setProgress] = useState<StageProgress[]>([])
  const [failure, setFailure] = useState<string | undefined>()
  const [registerName, setRegisterName] = useState('')
  const main = useRef<HTMLElement>(null)

  /* ---- Theme ----------------------------------------------------------- */
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      /* Private mode, or storage disabled. The attribute still applies. */
    }
  }, [])

  const setFilters = useCallback((update: (current: Filters) => Filters) => {
    setFiltersState((current) => update(current))
  }, [])

  /* ---- Running the analysis -------------------------------------------- */
  const run = useCallback((built: BuildResult) => {
    setRegisterName(built.register.name)
    setProgress([])
    setFailure(undefined)
    setScreen('analysing')

    // The engine emits synchronously; the queue below replays those emissions
    // one animation frame apart so each stage gets a chance to paint. The run
    // itself is not slowed down — it has already finished by the time the
    // second frame arrives.
    const queue: StageProgress[] = []
    let produced: AuditReport | undefined
    try {
      produced = analyse(built.register, built.issues, (stage) => queue.push(stage))
    } catch (thrown) {
      setFailure(asImportError(thrown).message)
      setScreen('import')
      return
    }

    let index = 0
    const step = (): void => {
      if (index < queue.length) {
        const next = queue[index]
        index += 1
        if (next) setProgress((current) => [...current, next])
        requestAnimationFrame(step)
        return
      }
      setReport(produced)
      setFilters(() => EMPTY_FILTERS)
      setSelectedCell(undefined)
      setOpenRiskId(undefined)
      setSimulateRiskId(undefined)
      setView('overview')
      setScreen('report')
    }
    requestAnimationFrame(step)
  }, [setFilters])

  const loadDemo = useCallback(() => {
    try {
      const table = parseTable(DEMO_REGISTER_FILE, DEMO_REGISTER_CSV)
      const built = buildRegister(
        table,
        detectMapping(table.header),
        defaultModel(5),
        DEMO_REGISTER_FILE,
        DEMO_REGISTER_NAME,
      )
      run(built)
    } catch (thrown) {
      setFailure(asImportError(thrown).message)
      setScreen('hero')
    }
  }, [run])

  const reset = useCallback(() => {
    setReport(undefined)
    setScreen('hero')
    setProgress([])
    setFiltersState(EMPTY_FILTERS)
    setOpenRiskId(undefined)
    setSelectedCell(undefined)
  }, [])

  /* ---- Keyboard --------------------------------------------------------- */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  /* ---- Derived ---------------------------------------------------------- */
  const index = useMemo(() => (report ? buildIndex(report) : undefined), [report])
  const filtered = useMemo(
    () => (report && index ? applyFilters(report, filters, index) : []),
    [report, filters, index],
  )
  const highlight = useMemo(() => new Set(filtered.map((r) => r.id)), [filtered])
  const visibleViews = viewsFor(mode)

  // Executive mode hides views. If the reader is standing on one when they
  // switch, fall back to the first view the mode does show -- derived during
  // render rather than corrected afterwards by an effect, so there is never a
  // frame with nothing in it.
  const activeView: ViewId = visibleViews.some((v) => v.id === view)
    ? view
    : (visibleViews[0]?.id ?? 'overview')

  const openRisk = useCallback((riskId: string | undefined) => setOpenRiskId(riskId), [])

  const goSimulate = useCallback((riskId: string) => {
    setSimulateRiskId(riskId)
    setView('simulate')
    setOpenRiskId(undefined)
  }, [])

  const onExport = useCallback(
    (id: string) => {
      if (!report) return
      if (!EXPORTS.some((e) => e.id === id)) return
      downloadExport(report, id as ExportId)
    },
    [report],
  )

  const context = useMemo<AppContextValue>(
    () => ({
      report,
      view,
      mode,
      theme,
      filters,
      selectedCell,
      openRiskId,
      paletteOpen,
      importState: {
        stage: 'upload',
        model: defaultModel(5),
        notes: [],
        progress: [],
      },
      setView,
      setMode,
      setTheme,
      setFilters,
      selectCell: setSelectedCell,
      openRisk,
      setPaletteOpen,
      startImport: () => setScreen('import'),
      loadDemo,
      reset,
    }),
    [
      report,
      view,
      mode,
      theme,
      filters,
      selectedCell,
      openRiskId,
      paletteOpen,
      setTheme,
      setFilters,
      openRisk,
      loadDemo,
      reset,
    ],
  )

  /* ---- Screens ---------------------------------------------------------- */
  if (screen === 'hero') {
    return (
      <AppContext.Provider value={context}>
        {failure ? (
          <div className="mx-auto max-w-2xl px-6 py-24">
            <ErrorState
              title={failure}
              remedy="The sample register could not be read, which almost certainly means the build is broken rather than that you did anything wrong."
            />
          </div>
        ) : (
          <Hero
            onDemo={loadDemo}
            onImport={() => setScreen('import')}
            onMethodology={() => {
              setReport(undefined)
              setView('methodology')
              setScreen('report')
            }}
          />
        )}
        {paletteOpen ? (
          <CommandPalette
            mode={mode}
            onClose={() => setPaletteOpen(false)}
            onGo={setView}
            onOpenRisk={openRisk}
            onSetMode={setMode}
            onImport={() => setScreen('import')}
            onExport={onExport}
            onReset={reset}
          />
        ) : null}
      </AppContext.Provider>
    )
  }

  if (screen === 'import') {
    return (
      <AppContext.Provider value={context}>
        <ImportWizard
          onCancel={() => setScreen(report ? 'report' : 'hero')}
          onAnalyse={run}
          onDemo={loadDemo}
        />
      </AppContext.Provider>
    )
  }

  if (screen === 'analysing') {
    return (
      <AppContext.Provider value={context}>
        <AnalysisProgress completed={progress} registerName={registerName} />
      </AppContext.Provider>
    )
  }

  return (
    <AppContext.Provider value={context}>
      <div className="min-h-screen">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface-2 focus:px-3 focus:py-2 focus:text-xs focus:text-ink-0"
        >
          Skip to content
        </a>

        <header className="sticky top-0 z-20 border-b border-line-1 bg-surface-0/92 backdrop-blur">
          <div className="mx-auto flex max-w-[92rem] items-center gap-4 px-4 py-3 sm:px-6">
            <button
              type="button"
              onClick={reset}
              className="flex shrink-0 items-center gap-2"
              aria-label="PARALLAX — start over"
            >
              <Mark />
              <span className="hidden font-display text-xs font-medium tracking-[0.2em] text-ink-0 sm:inline">
                PARALLAX
              </span>
            </button>

            <nav
              aria-label="Views"
              className="min-w-0 flex-1 overflow-x-auto no-scrollbar"
            >
              <ul className="flex items-center gap-0.5">
                {visibleViews.map((descriptor) => (
                  <li key={descriptor.id}>
                    <button
                      type="button"
                      aria-current={activeView === descriptor.id ? 'page' : undefined}
                      title={descriptor.question}
                      onClick={() => {
                        setView(descriptor.id)
                        main.current?.scrollTo?.({ top: 0 })
                      }}
                      className={`whitespace-nowrap rounded px-2.5 py-1.5 text-xs transition-colors duration-140 ${
                        activeView === descriptor.id
                          ? 'bg-accent/12 text-accent-strong'
                          : 'text-ink-2 hover:bg-surface-2 hover:text-ink-0'
                      }`}
                    >
                      {descriptor.label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="flex shrink-0 items-center gap-1.5">
              <div
                role="group"
                aria-label="Detail mode"
                className="hidden rounded-full border border-line-2 p-0.5 sm:flex"
              >
                {(['executive', 'analyst'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={mode === option}
                    onClick={() => setMode(option)}
                    className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors duration-140 ${
                      mode === option ? 'bg-accent/15 text-accent-strong' : 'text-ink-3 hover:text-ink-1'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className={`${CONTROL.icon} hidden sm:inline-flex`}
                aria-label="Open the command palette"
                title="Command palette (⌘K)"
              >
                ⌕
              </button>

              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className={CONTROL.icon}
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              >
                {theme === 'dark' ? '☾' : '☀'}
              </button>
            </div>
          </div>

          {report && showsFilters(activeView) ? (
            <div className="border-t border-line-1 bg-surface-0/60">
              <div className="mx-auto max-w-[92rem] px-4 py-2.5 sm:px-6">
                <FilterBar
                  report={report}
                  filters={filters}
                  matched={filtered.length}
                  onChange={setFilters}
                />
              </div>
            </div>
          ) : null}
        </header>

        <main id="main" ref={main} className="mx-auto max-w-[92rem] px-4 py-8 sm:px-6 sm:py-10">
          {!report ? (
            <Methodology />
          ) : activeView === 'overview' ? (
            <Overview report={report} mode={mode} onGo={setView} />
          ) : activeView === 'measurement' ? (
            <Measurement report={report} mode={mode} onOpenRisk={openRisk} />
          ) : activeView === 'matrix' ? (
            <MatrixView
              report={report}
              selectedCell={selectedCell}
              onSelectCell={setSelectedCell}
              onOpenRisk={openRisk}
              highlight={filtersAreActive(filters) ? highlight : undefined}
            />
          ) : activeView === 'compression' ? (
            <Compression
              report={report}
              mode={mode}
              onOpenRisk={openRisk}
              onSelectCell={(key) => {
                setSelectedCell(key)
                setView('matrix')
              }}
            />
          ) : activeView === 'ranking' ? (
            <Ranking report={report} mode={mode} onOpenRisk={openRisk} />
          ) : activeView === 'calibration' ? (
            <Calibration
              report={report}
              mode={mode}
              onFilterAssessor={(assessor) => {
                setFilters((current) => ({ ...current, assessors: [assessor] }))
                setView('register')
              }}
            />
          ) : activeView === 'quantify' ? (
            <Quantify report={report} mode={mode} onOpenRisk={openRisk} onSimulate={goSimulate} />
          ) : activeView === 'simulate' ? (
            <Simulate
              report={report}
              riskId={simulateRiskId}
              onSelectRisk={setSimulateRiskId}
              onOpenRisk={openRisk}
            />
          ) : activeView === 'decision' ? (
            <Decision report={report} onGo={setView} onOpenRisk={openRisk} />
          ) : activeView === 'register' ? (
            <RegisterTable report={report} risks={filtered} onOpenRisk={openRisk} />
          ) : (
            <Methodology report={report} />
          )}
        </main>

        <footer className="border-t border-line-1">
          <div className="mx-auto flex max-w-[92rem] flex-wrap items-center justify-between gap-3 px-4 py-5 text-2xs text-ink-3 sm:px-6">
            <span>
              {report
                ? `${report.register.sourceName} · analysed in this tab · engine ${report.engineVersion}`
                : 'No register loaded'}
            </span>
            <span className="flex items-center gap-3">
              <button type="button" onClick={() => setView('methodology')} className="hover:text-ink-1">
                Methodology
              </button>
              <button type="button" onClick={() => setScreen('import')} className="hover:text-ink-1">
                Import another
              </button>
              <span className="flex items-center gap-1">
                <Kbd>⌘</Kbd>
                <Kbd>K</Kbd>
              </span>
            </span>
          </div>
        </footer>
      </div>

      {report && openRiskId ? (
        <RiskDrawer
          report={report}
          riskId={openRiskId}
          onClose={() => setOpenRiskId(undefined)}
          onOpenRisk={openRisk}
          onSimulate={goSimulate}
        />
      ) : null}

      {paletteOpen ? (
        <CommandPalette
          report={report}
          mode={mode}
          onClose={() => setPaletteOpen(false)}
          onGo={setView}
          onOpenRisk={openRisk}
          onSetMode={setMode}
          onImport={() => setScreen('import')}
          onExport={onExport}
          onReset={reset}
        />
      ) : null}
    </AppContext.Provider>
  )
}

/** The two views where filtering a set of rows is a meaningful thing to do. */
function showsFilters(view: ViewId): boolean {
  return view === 'register' || view === 'matrix'
}

function filtersAreActive(filters: Filters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.businessUnits.length > 0 ||
    filters.categories.length > 0 ||
    filters.assessors.length > 0 ||
    filters.treatments.length > 0 ||
    filters.estimatedOnly ||
    filters.shortlistOnly ||
    filters.inversionOnly
  )
}

function readTheme(): Theme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

function Mark(): React.JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden>
      <rect x="5.5" y="9.5" width="7" height="13" rx="1.6" fill="rgb(var(--accent) / 0.22)" />
      <rect
        x="5.5"
        y="9.5"
        width="7"
        height="13"
        rx="1.6"
        fill="none"
        stroke="rgb(var(--accent))"
        strokeWidth="1.3"
      />
      <rect x="15" y="10.4" width="12" height="2.6" rx="1.3" fill="rgb(var(--quant))" />
      <rect x="15" y="14.7" width="7" height="2.6" rx="1.3" fill="rgb(var(--quant))" opacity="0.66" />
      <rect x="15" y="19" width="10.5" height="2.6" rx="1.3" fill="rgb(var(--quant))" opacity="0.4" />
    </svg>
  )
}

export { TYPE, VIEWS }
