/**
 * The import flow.
 *
 * Five steps, and the third one is the reason the other four exist. Most tools
 * of this kind auto-detect a mapping and start analysing; the single most
 * expensive failure mode here is reading the wrong column as "likelihood" and
 * then producing twelve pages of confident analysis of it. So the mapping is
 * always shown, always with a live preview of the values each binding would
 * read, and the scale it will be interpreted against is configured on the same
 * screen — because "is 4 a legal level?" cannot be answered without it.
 *
 * Nothing is uploaded. The file is read with `FileReader` in this tab; there
 * is no request anywhere in this component and the page's Content Security
 * Policy forbids one.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  FIELDS,
  asImportError,
  buildRegister,
  defaultModel,
  detectMapping,
  impactPreset,
  likelihoodPreset,
  makeScale,
  mappingProblems,
  parseTable,
  validateScale,
} from '../engine/index.ts'
import type {
  Aggregation,
  BuildResult,
  ColumnMapping,
  CsvTable,
  FieldId,
  ScaleKind,
  ScoringModel,
} from '../engine/index.ts'
import { MAX_FILE_BYTES } from '../engine/index.ts'
import { CONTROL, SURFACE, TYPE } from '../ui/tokens.ts'
import { Button, ErrorState, StateBadge } from '../ui/primitives.tsx'
import { Tooltip } from '../ui/Tooltip.tsx'
import { money } from '../ui/format.ts'

type Step = 'upload' | 'map' | 'configure' | 'review'

const STEPS: readonly { id: Step; label: string }[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'map', label: 'Map columns' },
  { id: 'configure', label: 'Configure scales' },
  { id: 'review', label: 'Review' },
]

export interface ImportWizardProps {
  readonly onCancel: () => void
  readonly onAnalyse: (result: BuildResult) => void
  readonly onDemo: () => void
}

export function ImportWizard({ onCancel, onAnalyse, onDemo }: ImportWizardProps): React.JSX.Element {
  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState('')
  const [table, setTable] = useState<CsvTable | undefined>()
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [model, setModel] = useState<ScoringModel>(defaultModel(5))
  const [error, setError] = useState<{ title: string; detail: string; remedy: string } | undefined>()
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const accept = useCallback((name: string, text: string) => {
    try {
      const parsed = parseTable(name, text)
      setTable(parsed)
      setMapping(detectMapping(parsed.header))
      setFileName(name)
      setError(undefined)
      setStep('map')
    } catch (thrown) {
      const failure = asImportError(thrown)
      setError({ title: failure.message, detail: failure.detail, remedy: failure.remedy })
    }
  }, [])

  const readFile = useCallback(
    (file: File) => {
      if (file.size > MAX_FILE_BYTES) {
        setError({
          title: 'That file is larger than PARALLAX will read.',
          detail: `${Math.round(file.size / 1024 / 1024)} MB, limit ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
          remedy:
            'A register this size usually has attachments embedded in a column. Remove those columns and export again.',
        })
        return
      }
      const reader = new FileReader()
      reader.onerror = () =>
        setError({
          title: 'The file could not be read.',
          detail: 'The browser refused to open it.',
          remedy: 'Check that the file is not open in another program, then try again.',
        })
      reader.onload = () => accept(file.name, String(reader.result ?? ''))
      reader.readAsText(file)
    },
    [accept],
  )

  const build = useMemo((): { result?: BuildResult; failure?: string } => {
    if (!table || step !== 'review') return {}
    try {
      return { result: buildRegister(table, mapping, model, fileName, registerNameFrom(fileName)) }
    } catch (thrown) {
      return { failure: asImportError(thrown).message }
    }
  }, [table, mapping, model, fileName, step])

  const problems = table ? mappingProblems(mapping) : []
  const scaleProblems = [...validateScale(model.likelihood), ...validateScale(model.impact)]
  const canAdvance =
    step === 'map'
      ? problems.filter((p) => p.message.includes('required')).length === 0
      : step === 'configure'
        ? scaleProblems.length === 0
        : true

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-surface-0/95 backdrop-blur-sm">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line-1 px-5 py-4 sm:px-8">
        <div>
          <p className={`${TYPE.eyebrow} mb-1`}>Import a risk register</p>
          <h2 className="font-display text-lg font-medium tracking-tight text-ink-0">
            {fileName || 'Select a file'}
          </h2>
        </div>
        <Button onClick={onCancel} aria-label="Cancel import">
          Cancel
        </Button>
      </header>

      <StepRail step={step} />

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin px-5 py-6 sm:px-8">
        <div className="mx-auto max-w-4xl">
          {error ? (
            <ErrorState
              title={error.title}
              detail={error.detail}
              remedy={error.remedy}
              action={<Button onClick={() => setError(undefined)}>Try a different file</Button>}
            />
          ) : step === 'upload' ? (
            <UploadStep
              dragging={dragging}
              setDragging={setDragging}
              onPick={() => input.current?.click()}
              onFile={readFile}
              onPaste={accept}
              onDemo={onDemo}
              inputRef={input}
            />
          ) : step === 'map' && table ? (
            <MapStep table={table} mapping={mapping} onChange={setMapping} problems={problems} />
          ) : step === 'configure' ? (
            <ConfigureStep model={model} onChange={setModel} problems={scaleProblems} />
          ) : step === 'review' && table ? (
            <ReviewStep table={table} result={build.result} failure={build.failure} model={model} />
          ) : null}
        </div>
      </div>

      {!error && step !== 'upload' ? (
        <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-line-1 px-5 py-4 sm:px-8">
          <Button
            onClick={() => setStep(previousStep(step))}
            aria-label="Back to the previous step"
          >
            Back
          </Button>
          <div className="flex items-center gap-3">
            {!canAdvance ? (
              <span className="text-2xs text-ambiguous">
                Resolve the highlighted items before continuing.
              </span>
            ) : null}
            {step === 'review' ? (
              <Button
                variant="primary"
                disabled={!build.result}
                onClick={() => build.result && onAnalyse(build.result)}
              >
                Analyse {build.result?.register.risks.length ?? 0} rows
              </Button>
            ) : (
              <Button variant="primary" disabled={!canAdvance} onClick={() => setStep(nextStep(step))}>
                Continue
              </Button>
            )}
          </div>
        </footer>
      ) : null}
    </div>
  )
}

function previousStep(step: Step): Step {
  const index = STEPS.findIndex((s) => s.id === step)
  return STEPS[Math.max(0, index - 1)]?.id ?? 'upload'
}

function nextStep(step: Step): Step {
  const index = STEPS.findIndex((s) => s.id === step)
  return STEPS[Math.min(STEPS.length - 1, index + 1)]?.id ?? 'review'
}

function registerNameFrom(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
  return base.charAt(0).toUpperCase() + base.slice(1)
}

/* -------------------------------------------------------------------------- */

function StepRail({ step }: { step: Step }): React.JSX.Element {
  const current = STEPS.findIndex((s) => s.id === step)
  return (
    <ol className="flex shrink-0 items-center gap-1 overflow-x-auto no-scrollbar border-b border-line-1 px-5 py-3 sm:px-8">
      {STEPS.map((entry, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'todo'
        return (
          <li key={entry.id} className="flex shrink-0 items-center gap-1">
            <span
              className={`flex items-center gap-2 rounded-full px-3 py-1 font-mono text-2xs uppercase tracking-[0.08em] transition-colors duration-220 ${
                state === 'current'
                  ? 'bg-accent/15 text-accent-strong'
                  : state === 'done'
                    ? 'text-supported'
                    : 'text-ink-3'
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full border text-[9px] ${
                  state === 'current'
                    ? 'border-accent text-accent-strong'
                    : state === 'done'
                      ? 'border-supported text-supported'
                      : 'border-line-2'
                }`}
              >
                {state === 'done' ? '✓' : index + 1}
              </span>
              {entry.label}
            </span>
            {index < STEPS.length - 1 ? (
              <span aria-hidden className="h-px w-5 bg-line-2 sm:w-8" />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

/* -------------------------------------------------------------------------- */

function UploadStep({
  dragging,
  setDragging,
  onPick,
  onFile,
  onPaste,
  onDemo,
  inputRef,
}: {
  dragging: boolean
  setDragging: (value: boolean) => void
  onPick: () => void
  onFile: (file: File) => void
  onPaste: (name: string, text: string) => void
  onDemo: () => void
  inputRef: React.RefObject<HTMLInputElement | null>
}): React.JSX.Element {
  const [pasted, setPasted] = useState('')
  return (
    <div className="space-y-6">
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const file = event.dataTransfer.files[0]
          if (file) onFile(file)
        }}
        className={`grid-field flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors duration-220 ${
          dragging ? 'border-accent bg-accent/[0.06]' : 'border-line-2'
        }`}
      >
        <p className="font-display text-lg font-medium tracking-tight text-ink-0">
          Drop a CSV or JSON register here
        </p>
        <p className="mt-2 max-w-md text-xs leading-relaxed text-ink-2">
          The file is read in this browser tab. Nothing is uploaded, and this page is not permitted
          to make a network request at all — the policy is in the document head, not just in the
          README.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <Button variant="primary" onClick={onPick}>
            Choose a file
          </Button>
          <Button onClick={onDemo}>Use the sample register</Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.json,.tsv,.txt,text/csv,application/json"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onFile(file)
            event.target.value = ''
          }}
        />
      </div>

      <details className={`${SURFACE.panel} px-5 py-4`}>
        <summary className="cursor-pointer text-xs text-ink-1">
          Paste the register instead
        </summary>
        <textarea
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
          rows={6}
          placeholder="Risk ID,Title,Likelihood,Impact&#10;R-001,Ransomware,2,5"
          className="mt-3 w-full rounded border border-line-2 bg-surface-inset p-3 font-mono text-2xs text-ink-0 placeholder:text-ink-3 focus:border-accent/60 focus:outline-none"
        />
        <Button
          className="mt-3"
          disabled={pasted.trim() === ''}
          onClick={() => onPaste('pasted-register.csv', pasted)}
        >
          Read pasted text
        </Button>
      </details>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function MapStep({
  table,
  mapping,
  onChange,
  problems,
}: {
  table: CsvTable
  mapping: ColumnMapping
  onChange: (mapping: ColumnMapping) => void
  problems: readonly { field: FieldId; message: string }[]
}): React.JSX.Element {
  const problemFields = new Set(problems.map((p) => p.field))
  const sample = table.rows.slice(0, 3)

  return (
    <div className="space-y-5">
      <div>
        <h3 className={TYPE.title}>Bind each field to a column</h3>
        <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-ink-2">
          {table.header.length} columns and {table.rows.length.toLocaleString()} rows were read. The
          bindings below were guessed from the header names; check them. The values beside each one
          are what that binding would actually read from the first rows of your file.
        </p>
      </div>

      {table.warnings.length > 0 ? (
        <div className={`${SURFACE.well} px-4 py-3`}>
          <p className={`${TYPE.eyebrow} mb-1.5`}>While parsing</p>
          <ul className="space-y-1">
            {table.warnings.map((warning) => (
              <li key={warning} className="text-xs text-ambiguous">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={`${SURFACE.panel} divide-y divide-line-1`}>
        {FIELDS.map((field) => {
          const column = mapping[field.id] ?? ''
          const columnIndex = table.header.indexOf(column)
          const flagged = problemFields.has(field.id)
          return (
            <div
              key={field.id}
              className={`grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center ${
                flagged ? 'bg-ambiguous/[0.06]' : ''
              }`}
            >
              <div className="min-w-0">
                <Tooltip title={field.label} body={field.purpose}>
                  <span className="cursor-help text-xs font-medium text-ink-0">{field.label}</span>
                </Tooltip>
                <span
                  className={`ml-2 font-mono text-[10px] uppercase tracking-[0.08em] ${
                    field.requirement === 'required'
                      ? 'text-distorted'
                      : field.requirement === 'recommended'
                        ? 'text-ink-2'
                        : 'text-ink-3'
                  }`}
                >
                  {field.requirement}
                </span>
              </div>

              <select
                value={column}
                aria-label={`Column for ${field.label}`}
                onChange={(event) =>
                  onChange({ ...mapping, [field.id]: event.target.value || null })
                }
                className={`${CONTROL.select} w-full`}
              >
                <option value="">— not present —</option>
                {table.header.map((name, index) => (
                  <option key={`${name}-${index}`} value={name}>
                    {name || `(column ${index + 1})`}
                  </option>
                ))}
              </select>

              <p className="truncate-flex font-mono text-[10px] text-ink-3">
                {columnIndex < 0
                  ? '—'
                  : sample
                      .map((row) => row[columnIndex])
                      .filter((v) => v !== undefined && v !== '')
                      .slice(0, 3)
                      .join(' · ') || '(blank in the first rows)'}
              </p>
            </div>
          )
        })}
      </div>

      {problems.length > 0 ? (
        <ul className="space-y-1.5">
          {problems.map((problem) => (
            <li key={`${problem.field}-${problem.message}`} className="flex items-start gap-2">
              <StateBadge
                state={problem.message.includes('required') ? 'distorted' : 'ambiguous'}
                size="xs"
              />
              <span className="text-xs text-ink-1">{problem.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function ConfigureStep({
  model,
  onChange,
  problems,
}: {
  model: ScoringModel
  onChange: (model: ScoringModel) => void
  problems: readonly { axis: string; message: string }[]
}): React.JSX.Element {
  const size = model.likelihood.levels.length

  const resize = (next: number): void => {
    onChange({
      ...model,
      likelihood: makeScale('likelihood', likelihoodPreset(next), { kind: model.likelihood.kind }),
      impact: makeScale('impact', impactPreset(next), { kind: model.impact.kind }),
      bands: defaultModel(next).bands,
    })
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className={TYPE.title}>What kind of scale is this?</h3>
        <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-ink-2">
          This is the single most consequential screen in the product. Whether the levels are
          ordinal or ratio decides which of your register&rsquo;s own arithmetic the audit will
          accept — so it is asked rather than assumed, and the answer is shown next to every finding
          that depends on it.
        </p>
      </div>

      <div className={`${SURFACE.panel} p-5`}>
        <div className="grid gap-5 sm:grid-cols-3">
          <label className="block">
            <span className={`${TYPE.eyebrow} mb-2 block`}>Matrix size</span>
            <select
              value={size}
              onChange={(event) => resize(Number(event.target.value))}
              className={`${CONTROL.select} w-full`}
            >
              {[3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} × {n}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={`${TYPE.eyebrow} mb-2 block`}>Scale kind</span>
            <select
              value={model.likelihood.kind}
              onChange={(event) => {
                const kind = event.target.value as ScaleKind
                onChange({
                  ...model,
                  likelihood: { ...model.likelihood, kind },
                  impact: { ...model.impact, kind },
                })
              }}
              className={`${CONTROL.select} w-full`}
            >
              <option value="ordinal">Ordinal — ranked labels</option>
              <option value="interval">Interval — equal steps</option>
              <option value="ratio">Ratio — true zero, real quantities</option>
            </select>
          </label>

          <label className="block">
            <span className={`${TYPE.eyebrow} mb-2 block`}>Score formula</span>
            <select
              value={model.aggregation}
              onChange={(event) =>
                onChange({ ...model, aggregation: event.target.value as Aggregation })
              }
              className={`${CONTROL.select} w-full`}
            >
              <option value="product">likelihood × impact</option>
              <option value="sum">likelihood + impact</option>
              <option value="max">max(likelihood, impact)</option>
            </select>
          </label>
        </div>

        <p className="mt-4 rounded-md border border-line-1 bg-surface-inset px-3 py-2.5 text-xs leading-relaxed text-ink-2">
          {model.likelihood.kind === 'ordinal'
            ? 'Ordinal is the honest default and describes almost every corporate matrix: the numbers name ranked descriptors. Choosing it does not make the register wrong — it decides which conclusions the audit will count as supported.'
            : model.likelihood.kind === 'interval'
              ? 'Interval claims that a one-level step means the same amount everywhere on the scale. Addition is then defensible; multiplication of two such scales still is not.'
              : 'Ratio claims the levels are quantities with a true zero — that a 4 really is twice a 2, on both axes. If your organisation can defend that, most of the measurement findings will disappear, which is the correct outcome.'}
        </p>
      </div>

      <div className={`${SURFACE.panel} p-5`}>
        <p className={`${TYPE.eyebrow} mb-3`}>Quantitative anchors</p>
        <p className="mb-4 max-w-2xl text-xs leading-relaxed text-ink-2">
          What each level means in events per year and in money. These are what make any
          quantitative finding possible; without them the compression, inversion and simulation
          views honestly report that they cannot say anything.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <AnchorTable title={model.likelihood.name} unit="events / year" scale={model.likelihood} format={(v) => String(v)} />
          <AnchorTable
            title={model.impact.name}
            unit={`${model.currency} per occurrence`}
            scale={model.impact}
            format={(v) => money(v, model.currency)}
          />
        </div>
      </div>

      <label className={`${SURFACE.panel} flex flex-wrap items-center gap-3 p-5`}>
        <span className="min-w-0 flex-1">
          <span className={`${TYPE.eyebrow} mb-1 block`}>Risk appetite</span>
          <span className="block text-xs leading-relaxed text-ink-2">
            Annualised loss above which the organisation has said it will act. Used to find the
            cells that cannot tell you which side of it a risk falls on.
          </span>
        </span>
        <input
          type="number"
          min={0}
          step={1000}
          value={model.appetite?.annualLossThreshold ?? 0}
          onChange={(event) =>
            onChange({
              ...model,
              appetite: {
                label: model.appetite?.label ?? 'Risk appetite',
                annualLossThreshold: Math.max(0, Number(event.target.value) || 0),
              },
            })
          }
          className={`${CONTROL.input} w-40 shrink-0 font-mono tnum`}
        />
      </label>

      {problems.length > 0 ? (
        <ul className="space-y-1.5">
          {problems.map((problem) => (
            <li key={problem.message} className="flex items-start gap-2">
              <StateBadge state="distorted" size="xs" />
              <span className="text-xs text-ink-1">{problem.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function AnchorTable({
  title,
  unit,
  scale,
  format,
}: {
  title: string
  unit: string
  scale: ScoringModel['likelihood']
  format: (value: number) => string
}): React.JSX.Element {
  return (
    <div className={`${SURFACE.well} overflow-hidden`}>
      <div className="flex items-baseline justify-between border-b border-line-1 px-3 py-2">
        <span className="text-xs font-medium text-ink-0">{title}</span>
        <span className="font-mono text-[10px] text-ink-3">{unit}</span>
      </div>
      <ul>
        {[...scale.levels]
          .sort((a, b) => b.value - a.value)
          .map((level) => (
            <li
              key={level.value}
              className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-xs"
            >
              <span className="truncate-flex text-ink-1">
                <span className="mr-2 font-mono text-ink-3 tnum">{level.value}</span>
                {level.label}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-ink-2 tnum">
                {level.anchor ? `${format(level.anchor.lo)}–${format(level.anchor.hi)}` : '—'}
              </span>
            </li>
          ))}
      </ul>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function ReviewStep({
  table,
  result,
  failure,
  model,
}: {
  table: CsvTable
  result?: BuildResult
  failure?: string
  model: ScoringModel
}): React.JSX.Element {
  if (failure || !result) {
    return <ErrorState title={failure ?? 'The register could not be built.'} />
  }

  const blocking = result.issues.filter(
    (i) =>
      i.code === 'missing-likelihood' ||
      i.code === 'missing-impact' ||
      i.code === 'level-out-of-range' ||
      i.code === 'level-not-a-number',
  )
  const usable = result.register.risks.length - new Set(blocking.map((i) => i.riskId)).size

  return (
    <div className="space-y-5">
      <div>
        <h3 className={TYPE.title}>What will be analysed</h3>
        <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-ink-2">
          Nothing is dropped silently. Rows that cannot be placed on the matrix stay in the register
          and appear in the table with a reason against them — the totals you see here are the
          totals the report will show.
        </p>
      </div>

      <div className={`${SURFACE.panel} grid gap-4 p-5 sm:grid-cols-4`}>
        <ReviewFigure label="Rows read" value={table.rows.length} />
        <ReviewFigure label="Placeable on the matrix" value={usable} tone="supported" />
        <ReviewFigure
          label="Cannot be placed"
          value={result.register.risks.length - usable}
          tone={result.register.risks.length - usable > 0 ? 'ambiguous' : undefined}
        />
        <ReviewFigure
          label="With their own estimate"
          value={result.register.risks.filter((r) => r.frequency && r.magnitude).length}
          tone="quant"
        />
      </div>

      {result.notes.length > 0 ? (
        <div className={`${SURFACE.well} px-4 py-3`}>
          <p className={`${TYPE.eyebrow} mb-1.5`}>Worth knowing before you read the findings</p>
          <ul className="space-y-1.5">
            {result.notes.map((note) => (
              <li key={note} className="text-xs leading-relaxed text-ink-1">
                {note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={`${SURFACE.panel} overflow-hidden`}>
        <p className={`${TYPE.eyebrow} border-b border-line-1 px-4 py-2.5`}>First rows, as read</p>
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line-1 text-ink-3">
                {['ID', 'Title', 'L', 'I', 'Score', 'Category', 'Assessor'].map((head) => (
                  <th key={head} className="whitespace-nowrap px-4 py-2 font-mono text-[10px] font-normal uppercase tracking-[0.08em]">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.register.risks.slice(0, 6).map((risk) => (
                <tr key={risk.id} className="border-b border-line-1 last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-ink-2">{risk.id}</td>
                  <td className="max-w-xs truncate px-4 py-2 text-ink-0">{risk.title}</td>
                  <td className="px-4 py-2 font-mono tnum text-ink-1">{risk.likelihood ?? '—'}</td>
                  <td className="px-4 py-2 font-mono tnum text-ink-1">{risk.impact ?? '—'}</td>
                  <td className="px-4 py-2 font-mono tnum text-ink-1">{risk.statedScore ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-ink-2">{risk.category ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-ink-2">{risk.assessor ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-2xs leading-relaxed text-ink-3">
        Will be analysed as a {model.likelihood.levels.length} × {model.impact.levels.length}{' '}
        {model.likelihood.kind} matrix scored by {model.aggregation === 'product' ? 'multiplication' : model.aggregation}
        {model.appetite ? `, against an appetite of ${money(model.appetite.annualLossThreshold, model.currency)} a year` : ''}.
      </p>
    </div>
  )
}

function ReviewFigure({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'supported' | 'ambiguous' | 'quant'
}): React.JSX.Element {
  const colour =
    tone === 'supported'
      ? 'text-supported'
      : tone === 'ambiguous'
        ? 'text-ambiguous'
        : tone === 'quant'
          ? 'text-quant'
          : 'text-ink-0'
  return (
    <div>
      <p className={`${TYPE.eyebrow} mb-1.5`}>{label}</p>
      <p className={`font-display text-2xl font-medium tracking-tight tnum ${colour}`}>
        {value.toLocaleString()}
      </p>
    </div>
  )
}
