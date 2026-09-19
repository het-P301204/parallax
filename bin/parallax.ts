#!/usr/bin/env node
/**
 * The PARALLAX command line.
 *
 * It runs the engine's TypeScript sources directly under Node's native type
 * stripping: no build step, no dependencies, and therefore the same arithmetic
 * in a terminal as in a browser tab. CI asserts that by running it from a
 * clean checkout.
 *
 * Exit codes are the point of having a CLI at all:
 *
 *   0  the audit ran and nothing reached the failure threshold
 *   2  the audit ran and something did
 *   1  the audit could not run
 *
 * A measurement audit that cannot fail a pipeline is one nobody runs twice.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import {
  EXPORTS,
  ENGINE_VERSION,
  analyse,
  asImportError,
  buildRegister,
  defaultModel,
  detectMapping,
  exportReport,
  money,
  parseTable,
} from '../src/engine/index.ts'
import type { AuditReport, ExportId, ScoringModel } from '../src/engine/index.ts'

const USAGE = `PARALLAX ${ENGINE_VERSION} — risk register measurement auditor

  parallax audit <file>            the whole audit, as a summary
  parallax measurement <file>      the ordinal validity audit
  parallax compression <file>      what each cell cannot resolve
  parallax inversions <file>       where the order and the model disagree
  parallax calibration <file>      how consistently assessors score
  parallax shortlist <file>        the risks worth quantifying
  parallax export <file> <report>  write one export to stdout or --out
  parallax version

Options
  --size N             matrix dimension (3, 4 or 5). Default 5.
  --kind K             ordinal | interval | ratio. Default ordinal.
  --aggregation A      product | sum | max. Default product.
  --appetite N         annualised loss threshold. Default 250000.
  --currency C         ISO code for display. Default GBP.
  --fail-on LEVEL      none | inversions | any. Default inversions.
  --out PATH           write to a file instead of stdout.
  --json               machine-readable output.
  --quiet              suppress the human summary.

Reports for \`export\`: ${EXPORTS.map((e) => e.id).join(', ')}

Nothing is uploaded. The register is read, analysed and discarded in this
process; no network call is made by any code path.`

interface Options {
  readonly command: string
  readonly file?: string
  readonly report?: string
  readonly model: ScoringModel
  readonly failOn: 'none' | 'inversions' | 'any'
  readonly out?: string
  readonly json: boolean
  readonly quiet: boolean
}

function parseArgs(argv: readonly string[]): Options {
  const positional: string[] = []
  const flags = new Map<string, string>()

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const name = token.slice(2)
    if (name === 'json' || name === 'quiet') {
      flags.set(name, 'true')
      continue
    }
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      fail(`--${name} needs a value.`)
    }
    flags.set(name, next as string)
    i += 1
  }

  const size = Number(flags.get('size') ?? 5)
  if (![3, 4, 5].includes(size)) fail('--size must be 3, 4 or 5.')

  const base = defaultModel(size)
  const kind = flags.get('kind') ?? 'ordinal'
  if (!['ordinal', 'interval', 'ratio'].includes(kind)) {
    fail('--kind must be ordinal, interval or ratio.')
  }
  const aggregation = flags.get('aggregation') ?? 'product'
  if (!['product', 'sum', 'max'].includes(aggregation)) {
    fail('--aggregation must be product, sum or max.')
  }
  const appetite = flags.has('appetite') ? Number(flags.get('appetite')) : 250_000
  if (!Number.isFinite(appetite) || appetite < 0) fail('--appetite must be a non-negative number.')

  const failOn = flags.get('fail-on') ?? 'inversions'
  if (!['none', 'inversions', 'any'].includes(failOn)) {
    fail('--fail-on must be none, inversions or any.')
  }

  return {
    command: positional[0] ?? 'help',
    file: positional[1],
    report: positional[2],
    model: {
      ...base,
      likelihood: { ...base.likelihood, kind: kind as ScoringModel['likelihood']['kind'] },
      impact: { ...base.impact, kind: kind as ScoringModel['impact']['kind'] },
      aggregation: aggregation as ScoringModel['aggregation'],
      currency: flags.get('currency') ?? base.currency,
      appetite: appetite > 0 ? { label: 'Risk appetite', annualLossThreshold: appetite } : undefined,
    },
    failOn: failOn as Options['failOn'],
    out: flags.get('out'),
    json: flags.get('json') === 'true',
    quiet: flags.get('quiet') === 'true',
  }
}

function fail(message: string): never {
  process.stderr.write(`parallax: ${message}\n`)
  process.exit(1)
}

function load(options: Options): AuditReport {
  if (!options.file) fail('A register file is required. Try: parallax audit register.csv')
  let text: string
  try {
    text = readFileSync(options.file, 'utf8')
  } catch {
    fail(`Could not read ${basename(options.file)}.`)
  }
  try {
    const table = parseTable(options.file, text)
    const built = buildRegister(
      table,
      detectMapping(table.header),
      options.model,
      basename(options.file),
      basename(options.file),
    )
    return analyse(built.register, built.issues)
  } catch (error) {
    const failure = asImportError(error)
    process.stderr.write(`parallax: ${failure.message}\n`)
    process.stderr.write(`  ${failure.detail}\n`)
    process.stderr.write(`  ${failure.remedy}\n`)
    process.exit(1)
  }
}

function write(options: Options, text: string): void {
  if (options.out) {
    writeFileSync(options.out, text, 'utf8')
    if (!options.quiet) process.stderr.write(`wrote ${options.out}\n`)
    return
  }
  process.stdout.write(text)
}

function exitCode(report: AuditReport, failOn: Options['failOn']): number {
  if (failOn === 'none') return 0
  if (failOn === 'inversions') return report.summary.confirmedInversions > 0 ? 2 : 0
  const anything =
    report.summary.confirmedInversions > 0 ||
    report.summary.compressedCells > 0 ||
    report.summary.indeterminatePairs > 0 ||
    report.calibration.assessors.some((a) => a.state === 'inconsistent')
  return anything ? 2 : 0
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

const pad = (text: string, width: number): string => text.padEnd(width)
const num = (value: number): string => value.toLocaleString('en-GB')

function summary(report: AuditReport): string {
  const s = report.summary
  const c = report.confidence
  const currency = report.register.model.currency
  const lines: string[] = []

  lines.push(`PARALLAX ${ENGINE_VERSION} — ${report.register.name}`)
  lines.push('')
  lines.push(`  ${pad('Rows imported', 30)}${num(s.risksImported)}`)
  lines.push(`  ${pad('Analysed', 30)}${num(s.risksAnalysed)}  (${num(s.risksExcluded)} could not be placed)`)
  lines.push(`  ${pad('Cells occupied', 30)}${s.occupiedCells} of ${s.totalCells}`)
  lines.push(`  ${pad('Largest tie group', 30)}${s.largestTieGroup} risks share one score`)
  if (s.resolutionFloor !== undefined) {
    lines.push(
      `  ${pad('Matrix resolving power', 30)}${s.resolutionFloor.toFixed(1)}x  (narrowest cell: ${s.resolutionFloorCell})`,
    )
  }
  lines.push('')
  lines.push(`  ${pad('Ambiguous pairs', 30)}${num(s.indeterminatePairs)} of ${num(s.comparedPairs)}`)
  lines.push(`  ${pad('Inversion candidates', 30)}${num(s.inversionCandidates)}  (${num(s.confirmedInversions)} confirmed under the model)`)
  lines.push(`  ${pad('Compressed cells', 30)}${s.compressedCells} of ${s.occupiedCells}`)
  lines.push(`  ${pad('Calibration findings', 30)}${s.calibrationFindings}`)
  lines.push(`  ${pad('Quantification shortlist', 30)}${s.quantificationShortlist}`)
  lines.push(`  ${pad('Data quality findings', 30)}${s.dataQualityFindings}`)
  lines.push('')
  lines.push('  Measurement confidence — three numbers, deliberately not averaged')
  lines.push(`    ${pad('Order determinacy', 28)}${(c.orderDeterminacy * 100).toFixed(0)}%`)
  lines.push(`    ${pad('Estimate coverage', 28)}${(c.estimateCoverage * 100).toFixed(0)}%`)
  lines.push(`    ${pad('Data completeness', 28)}${(c.dataCompleteness * 100).toFixed(0)}%`)
  lines.push(`    Limiting factor: ${c.limitingFactor}.`)
  lines.push('')
  lines.push(`  ${report.ordinal.explanation.what}`)
  if (report.quantification.length > 0) {
    lines.push('')
    lines.push('  Quantify first:')
    for (const candidate of report.quantification.slice(0, 5)) {
      const risk = report.byId.get(candidate.riskId)
      const model = report.models.get(candidate.riskId)
      const loss = model
        ? `  ${money(model.frequency.lo * model.magnitude.lo, currency)}–${money(model.frequency.hi * model.magnitude.hi, currency)}/yr`
        : ''
      lines.push(`    ${candidate.rank}. ${risk?.title ?? candidate.riskId}${loss}`)
      lines.push(`       ${candidate.reasons.join('; ')}`)
    }
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

function findings(report: AuditReport, command: string): string {
  const lines: string[] = []
  const rule = '  ' + '-'.repeat(74)

  switch (command) {
    case 'measurement':
      for (const operation of report.ordinal.operations) {
        lines.push(`  [${operation.state.toUpperCase()}] ${operation.title}`)
        lines.push(`    does      ${operation.registerDoes}`)
        lines.push(`    scale     ${operation.scaleMeans}`)
        lines.push(`    why       ${operation.explanation.why}`)
        lines.push(`    assume    ${operation.explanation.assumption}`)
        lines.push(`    next      ${operation.explanation.next}`)
        lines.push(rule)
      }
      break

    case 'compression':
      for (const finding of report.compression.slice(0, 20)) {
        lines.push(`  [${finding.state.toUpperCase()}] ${finding.cellKey} score ${finding.score} — ${finding.riskCount} risks`)
        lines.push(`    ${finding.explanation.what}`)
        lines.push(`    ${finding.explanation.evidence}`)
        lines.push(rule)
      }
      break

    case 'inversions':
      for (const finding of report.inversions.slice(0, 20)) {
        lines.push(`  [${finding.status}] ${finding.higherId} (${finding.higherScore}) over ${finding.lowerId} (${finding.lowerScore})`)
        lines.push(`    ${finding.explanation.what}`)
        lines.push(rule)
      }
      break

    case 'calibration':
      for (const assessor of report.calibration.assessors) {
        lines.push(`  [${assessor.state.toUpperCase()}] ${assessor.assessor}`)
        lines.push(`    ${assessor.explanation.what}`)
        lines.push(`    ${assessor.explanation.evidence}`)
        lines.push(rule)
      }
      break

    case 'shortlist':
      for (const candidate of report.quantification) {
        const risk = report.byId.get(candidate.riskId)
        lines.push(`  ${candidate.rank}. ${risk?.title ?? candidate.riskId}  [${candidate.riskId}]`)
        lines.push(`     priority ${candidate.priority.toFixed(3)} · qualitative score ${candidate.qualitativeScore}`)
        for (const component of candidate.components) {
          lines.push(`       ${pad(component.label, 26)} ${component.value.toFixed(2)} x ${component.weight}`)
        }
        lines.push(rule)
      }
      break
  }

  if (lines.length === 0) lines.push('  Nothing to report.')
  return `${lines.join('\n')}\n`
}

/* -------------------------------------------------------------------------- */
/* Entry                                                                      */
/* -------------------------------------------------------------------------- */

function main(): void {
  const options = parseArgs(process.argv.slice(2))

  if (options.command === 'version') {
    process.stdout.write(`parallax ${ENGINE_VERSION}\n`)
    return
  }
  if (options.command === 'help' || options.command === '--help') {
    process.stdout.write(`${USAGE}\n`)
    return
  }

  const known = ['audit', 'measurement', 'compression', 'inversions', 'calibration', 'shortlist', 'export']
  if (!known.includes(options.command)) {
    process.stderr.write(`parallax: unknown command "${options.command}".\n\n${USAGE}\n`)
    process.exit(1)
  }

  const report = load(options)

  if (options.command === 'export') {
    const id = options.report
    if (!id || !EXPORTS.some((e) => e.id === id)) {
      fail(`export needs a report id. One of: ${EXPORTS.map((e) => e.id).join(', ')}`)
    }
    write(options, exportReport(report, id as ExportId))
    process.exit(exitCode(report, options.failOn))
  }

  if (options.json) {
    write(options, `${JSON.stringify({ summary: report.summary, confidence: report.confidence }, null, 2)}\n`)
  } else if (!options.quiet) {
    write(options, options.command === 'audit' ? summary(report) : findings(report, options.command))
  }

  process.exit(exitCode(report, options.failOn))
}

main()
