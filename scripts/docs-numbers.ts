/**
 * Keeps the numbers in the documentation honest.
 *
 * Every figure the README quotes about the demo register is recomputed here
 * from the engine and compared against the committed text. A README that
 * drifts from the product is a README that teaches people wrong things about
 * it, and the drift is always silent.
 *
 *   node scripts/docs-numbers.ts          print what the engine says
 *   node scripts/docs-numbers.ts --check  fail if the README disagrees
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_REGISTER_CSV, DEMO_REGISTER_FILE, DEMO_REGISTER_ROWS } from '../src/demo-register.generated.ts'
import { analyse, defaultModel, importRegister } from '../src/engine/index.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const built = importRegister(DEMO_REGISTER_FILE, DEMO_REGISTER_CSV, defaultModel(5))
const report = analyse(built.register, built.issues)
const s = report.summary

/**
 * The claims, as `<!-- n:key -->value<!-- /n -->` markers in the markdown.
 *
 * Markers rather than a loose text search, because a loose search for "126"
 * matches a row number, a port and a percentage, and a check that matches
 * anything checks nothing.
 */
const CLAIMS: Readonly<Record<string, string>> = {
  rows: String(DEMO_REGISTER_ROWS),
  analysed: String(s.risksAnalysed),
  excluded: String(s.risksExcluded),
  cells: `${s.occupiedCells} of ${s.totalCells}`,
  'tie-group': String(s.largestTieGroup),
  resolution: s.resolutionFloor === undefined ? '—' : `${s.resolutionFloor.toFixed(1)}×`,
  'resolution-cell': s.resolutionFloorCell ?? '—',
  'compared-pairs': s.comparedPairs.toLocaleString('en-GB'),
  'ambiguous-pairs': s.indeterminatePairs.toLocaleString('en-GB'),
  'ambiguous-share': `${((s.indeterminatePairs / Math.max(1, s.comparedPairs)) * 100).toFixed(1)}%`,
  inversions: s.inversionCandidates.toLocaleString('en-GB'),
  'inversions-confirmed': String(s.confirmedInversions),
  'compressed-cells': String(s.compressedCells),
  shortlist: String(s.quantificationShortlist),
  'data-quality': String(s.dataQualityFindings),
  estimates: String(s.risksWithEstimates),
  'order-determinacy': `${Math.round(report.confidence.orderDeterminacy * 100)}%`,
  'estimate-coverage': `${Math.round(report.confidence.estimateCoverage * 100)}%`,
  'data-completeness': `${Math.round(report.confidence.dataCompleteness * 100)}%`,
  assessors: String(report.calibration.assessors.length),
  'peer-groups': String(report.calibration.groups.length),
  tests: 'see npm test',
}

const FILES = ['README.md', 'docs/methodology.md']

function main(): void {
  const check = process.argv.includes('--check')

  if (!check) {
    for (const [key, value] of Object.entries(CLAIMS)) {
      console.log(`${key.padEnd(22)}${value}`)
    }
    return
  }

  let failed = false
  let checked = 0

  for (const file of FILES) {
    let text: string
    try {
      text = readFileSync(join(root, file), 'utf8')
    } catch {
      continue
    }
    for (const match of text.matchAll(/<!-- n:([a-z-]+) -->(.*?)<!-- \/n -->/gs)) {
      const key = match[1] as string
      const actual = (match[2] as string).trim()
      const expected = CLAIMS[key]
      checked += 1
      if (expected === undefined) {
        console.error(`${file}: unknown claim "${key}"`)
        failed = true
        continue
      }
      if (actual !== expected) {
        console.error(`${file}: "${key}" says ${JSON.stringify(actual)}, engine says ${JSON.stringify(expected)}`)
        failed = true
      }
    }
  }

  if (checked === 0) {
    console.error('No claim markers found. The documentation numbers are unchecked.')
    process.exit(1)
  }
  if (failed) {
    console.error('\nRun: node scripts/docs-numbers.ts  to see every current value.')
    process.exit(1)
  }
  console.log(`documentation numbers agree with the engine (${checked} claims)`)
}

main()
