/**
 * Exports.
 *
 * Three rules, all of them checked by `export.test.ts`.
 *
 * *Deterministic.* Nothing carries a timestamp, a run id, or an iteration
 * order that depends on a hash seed. Two audits of the same file produce
 * byte-identical exports, which is what makes a diff between last quarter's
 * export and this one a diff of the register rather than a diff of the clock.
 *
 * *Injection-safe.* Every field goes through `escapeField`, which neutralises
 * the leading characters that turn a spreadsheet cell into a formula. A risk
 * register can contain arbitrary text written by arbitrary people, and this is
 * the one place in the product where that text is handed to another program.
 *
 * *Self-describing.* Every export carries the assumption column. A compression
 * finding without the anchors it was computed from is a number somebody will
 * quote in a steering committee with no way back to what it meant.
 */

import { toCsv } from './csv.ts'
import { annualLossBounds, centralAnnualLoss, evidenceLabel } from './intervals.ts'
import { ENGINE_VERSION } from './report.ts'
import type { AuditReport } from './types.ts'

export type ExportId =
  | 'measurement-audit'
  | 'compression'
  | 'inversions'
  | 'calibration'
  | 'shortlist'
  | 'register'
  | 'full-report'

export interface ExportDescriptor {
  readonly id: ExportId
  readonly label: string
  readonly description: string
  readonly format: 'csv' | 'json'
  readonly fileName: string
}

export const EXPORTS: readonly ExportDescriptor[] = [
  {
    id: 'measurement-audit',
    label: 'Measurement audit',
    description: 'One row per operation the register performs on its scales, with the verdict and the reason.',
    format: 'csv',
    fileName: 'parallax-measurement-audit.csv',
  },
  {
    id: 'compression',
    label: 'Compression findings',
    description: 'One row per occupied cell: what it cannot resolve, by design and by evidence.',
    format: 'csv',
    fileName: 'parallax-compression.csv',
  },
  {
    id: 'inversions',
    label: 'Inversion candidates',
    description: 'Pairs where the register\'s order and the modelled loss disagree, with the status of each.',
    format: 'csv',
    fileName: 'parallax-inversions.csv',
  },
  {
    id: 'calibration',
    label: 'Calibration analysis',
    description: 'Per-assessor offsets with sample sizes and permutation p-values.',
    format: 'csv',
    fileName: 'parallax-calibration.csv',
  },
  {
    id: 'shortlist',
    label: 'Quantification shortlist',
    description: 'The triage result with every component score and weight, ranked.',
    format: 'csv',
    fileName: 'parallax-shortlist.csv',
  },
  {
    id: 'register',
    label: 'Annotated register',
    description: 'The imported register with the cell, score, rank, modelled loss and findings against each row.',
    format: 'csv',
    fileName: 'parallax-register-annotated.csv',
  },
  {
    id: 'full-report',
    label: 'Full report',
    description: 'Everything above as one JSON document, including every explanation.',
    format: 'json',
    fileName: 'parallax-report.json',
  },
]

export function exportReport(report: AuditReport, id: ExportId): string {
  switch (id) {
    case 'measurement-audit':
      return measurementAuditCsv(report)
    case 'compression':
      return compressionCsv(report)
    case 'inversions':
      return inversionsCsv(report)
    case 'calibration':
      return calibrationCsv(report)
    case 'shortlist':
      return shortlistCsv(report)
    case 'register':
      return registerCsv(report)
    case 'full-report':
      return fullReportJson(report)
  }
}

/* -------------------------------------------------------------------------- */

function measurementAuditCsv(report: AuditReport): string {
  const header = [
    'operation',
    'title',
    'state',
    'requires_scale_kind',
    'affected',
    'register_does',
    'scale_means',
    'what',
    'why',
    'assumption',
    'evidence',
    'next',
  ]
  const rows = report.ordinal.operations.map((op) => [
    op.id,
    op.title,
    op.state,
    op.requires,
    op.affected,
    op.registerDoes,
    op.scaleMeans,
    op.explanation.what,
    op.explanation.why,
    op.explanation.assumption,
    op.explanation.evidence,
    op.explanation.next,
  ])
  return toCsv(header, rows)
}

function compressionCsv(report: AuditReport): string {
  const header = [
    'cell',
    'likelihood',
    'impact',
    'score',
    'state',
    'risks',
    'risks_with_estimates',
    'anchor_span',
    'anchored_loss_low',
    'anchored_loss_high',
    'estimate_span',
    'straddles_appetite',
    'what',
    'why',
    'assumption',
    'evidence',
    'next',
  ]
  const rows = report.compression.map((c) => [
    c.cellKey,
    c.likelihood,
    c.impact,
    c.score,
    c.state,
    c.riskCount,
    c.estimatedCount,
    round(c.anchorSpan),
    round(c.anchoredAnnualLoss?.lo),
    round(c.anchoredAnnualLoss?.hi),
    round(c.estimateSpan),
    c.straddlesAppetite,
    c.explanation.what,
    c.explanation.why,
    c.explanation.assumption,
    c.explanation.evidence,
    c.explanation.next,
  ])
  return toCsv(header, rows)
}

function inversionsCsv(report: AuditReport): string {
  const header = [
    'status',
    'higher_id',
    'higher_title',
    'higher_cell',
    'higher_score',
    'higher_modelled_low',
    'higher_modelled_high',
    'lower_id',
    'lower_title',
    'lower_cell',
    'lower_score',
    'lower_modelled_low',
    'lower_modelled_high',
    'p_lower_exceeds_higher',
    'what',
    'why',
    'assumption',
    'evidence',
    'next',
  ]
  const rows = report.inversions.map((i) => {
    const higher = report.models.get(i.higherId)
    const lower = report.models.get(i.lowerId)
    const hb = higher ? annualLossBounds(higher) : undefined
    const lb = lower ? annualLossBounds(lower) : undefined
    return [
      i.status,
      i.higherId,
      report.byId.get(i.higherId)?.title ?? '',
      i.higherCell,
      i.higherScore,
      round(hb?.lo),
      round(hb?.hi),
      i.lowerId,
      report.byId.get(i.lowerId)?.title ?? '',
      i.lowerCell,
      i.lowerScore,
      round(lb?.lo),
      round(lb?.hi),
      i.exceedanceProbability === undefined ? '' : i.exceedanceProbability.toFixed(4),
      i.explanation.what,
      i.explanation.why,
      i.explanation.assumption,
      i.explanation.evidence,
      i.explanation.next,
    ]
  })
  return toCsv(header, rows)
}

function calibrationCsv(report: AuditReport): string {
  const header = [
    'assessor',
    'state',
    'risks_scored',
    'shared_peer_groups',
    'paired_observations',
    'likelihood_offset_levels',
    'impact_offset_levels',
    'permutation_p',
    'what',
    'why',
    'assumption',
    'evidence',
    'next',
  ]
  const rows = report.calibration.assessors.map((a) => [
    a.assessor,
    a.state,
    a.riskCount,
    a.sharedGroups,
    a.observations,
    round(a.likelihoodOffset),
    round(a.impactOffset),
    a.pValue === undefined ? '' : a.pValue.toFixed(4),
    a.explanation.what,
    a.explanation.why,
    a.explanation.assumption,
    a.explanation.evidence,
    a.explanation.next,
  ])
  return toCsv(header, rows)
}

function shortlistCsv(report: AuditReport): string {
  const componentIds = report.triaged[0]?.components.map((c) => c.id) ?? []
  const header = [
    'triage_rank',
    'risk_id',
    'title',
    'shortlisted',
    'priority',
    'qualitative_rank',
    'qualitative_score',
    'reasons',
    ...componentIds.flatMap((id) => [`${id}_value`, `${id}_weight`]),
    'what',
    'why',
    'assumption',
    'evidence',
    'next',
  ]
  const shortlisted = new Set(report.quantification.map((q) => q.riskId))
  const rows = report.triaged.map((q) => [
    q.rank,
    q.riskId,
    report.byId.get(q.riskId)?.title ?? '',
    shortlisted.has(q.riskId),
    q.priority.toFixed(4),
    q.qualitativeRank,
    q.qualitativeScore,
    q.reasons.join(' | '),
    ...q.components.flatMap((c) => [c.value.toFixed(4), c.weight]),
    q.explanation.what,
    q.explanation.why,
    q.explanation.assumption,
    q.explanation.evidence,
    q.explanation.next,
  ])
  return toCsv(header, rows)
}

function registerCsv(report: AuditReport): string {
  const header = [
    'risk_id',
    'title',
    'category',
    'business_unit',
    'owner',
    'assessor',
    'assessed_on',
    'treatment',
    'likelihood',
    'impact',
    'cell',
    'computed_score',
    'stated_score',
    'rank',
    'modelled_loss_low',
    'modelled_loss_central',
    'modelled_loss_high',
    'model_basis',
    'in_shortlist',
    'in_inversion',
    'excluded_reason',
  ]
  const shortlisted = new Set(report.quantification.map((q) => q.riskId))
  const unplaced = new Map(report.matrix.unplaced.map((u) => [u.riskId, u.reason]))

  const rows = report.register.risks.map((risk) => {
    const model = report.models.get(risk.id)
    const bounds = model ? annualLossBounds(model) : undefined
    return [
      risk.id,
      risk.title,
      risk.category ?? '',
      risk.businessUnit ?? '',
      risk.owner ?? '',
      risk.assessor ?? '',
      risk.assessedOn ?? '',
      risk.treatment,
      risk.likelihood ?? '',
      risk.impact ?? '',
      risk.likelihood !== null && risk.impact !== null ? `L${risk.likelihood}I${risk.impact}` : '',
      report.scoreById.get(risk.id) ?? '',
      risk.statedScore ?? '',
      report.rankById.get(risk.id) ?? '',
      round(bounds?.lo),
      model ? round(centralAnnualLoss(model)) : '',
      round(bounds?.hi),
      model ? evidenceLabel(model) : '',
      shortlisted.has(risk.id),
      report.inversionIds.has(risk.id),
      unplaced.get(risk.id) ?? '',
    ]
  })
  return toCsv(header, rows)
}

/**
 * The whole report as JSON.
 *
 * Maps and Sets are serialised as sorted arrays so the output is stable: an
 * insertion-ordered Map would make the export depend on the order rows
 * happened to arrive in, which would defeat the determinism the other exports
 * are written to preserve.
 */
function fullReportJson(report: AuditReport): string {
  const payload = {
    engineVersion: ENGINE_VERSION,
    register: {
      name: report.register.name,
      sourceName: report.register.sourceName,
      importedRowCount: report.register.importedRowCount,
      model: report.register.model,
    },
    summary: report.summary,
    confidence: report.confidence,
    dataQuality: report.dataQuality,
    measurement: report.ordinal,
    compression: report.compression,
    inversions: report.inversions,
    calibration: report.calibration,
    quantification: report.quantification,
    triage: report.triaged,
    models: [...report.models.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, model]) => model),
    risks: report.register.risks.map((risk) => ({
      ...risk,
      computedScore: report.scoreById.get(risk.id) ?? null,
      rank: report.rankById.get(risk.id) ?? null,
    })),
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

/** Four significant figures, or an empty cell. Never `NaN` in an export. */
function round(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return ''
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1000) return String(Math.round(value))
  return String(Number(value.toPrecision(4)))
}
