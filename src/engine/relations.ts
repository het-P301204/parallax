/**
 * The relationship graph around one risk.
 *
 * Built on demand rather than globally, for a reason that is as much about
 * usefulness as about cost: a register of a thousand risks has hundreds of
 * thousands of "same business unit" edges, and a picture of all of them is a
 * grey disc. The graph that helps is the one centred on the risk somebody is
 * looking at, with each relationship kind capped at a handful of the most
 * relevant neighbours.
 *
 * The caps are not cosmetic trimming. Each kind selects its neighbours by a
 * stated rule — the nearest in modelled loss, the strongest inversion, the
 * closest in the cell ordering — so a capped graph is a *sample with a
 * criterion* rather than an arbitrary prefix, and the criterion is shown.
 */

import { centralAnnualLoss } from './intervals.ts'
import type {
  AuditReport,
  RelationKind,
  Risk,
  RiskRelation,
} from './types.ts'

/** Per-kind caps. Tuned so the whole graph stays under about 20 nodes. */
export const RELATION_LIMITS: Readonly<Record<RelationKind, number>> = {
  'same-cell': 6,
  'potential-inversion': 5,
  'quantification-group': 4,
  'same-category': 4,
  'same-business-unit': 3,
  'same-assessor': 3,
}

export const RELATION_LABEL: Readonly<Record<RelationKind, string>> = {
  'same-cell': 'Same cell',
  'potential-inversion': 'Possible inversion',
  'quantification-group': 'Shortlisted together',
  'same-category': 'Same category',
  'same-business-unit': 'Same business unit',
  'same-assessor': 'Same assessor',
}

/**
 * Why each kind is drawn at all. Shown in the graph's legend, because an edge
 * whose meaning is not stated is decoration.
 */
export const RELATION_MEANING: Readonly<Record<RelationKind, string>> = {
  'same-cell':
    'Scored identically. Anything that distinguishes these risks is invisible to the matrix.',
  'potential-inversion':
    'The register ranks one above the other; the modelled loss disagrees.',
  'quantification-group':
    'Both are on the quantification shortlist, so both are awaiting the same kind of answer.',
  'same-category': 'In the same peer group, so their scores are compared during calibration.',
  'same-business-unit': 'Scored inside the same unit, which is a second calibration grouping.',
  'same-assessor': 'Scored by the same person, so they share any calibration offset that person has.',
}

export function relationsFor(report: AuditReport, riskId: string): RiskRelation[] {
  const focus = report.byId.get(riskId)
  if (!focus) return []

  const out: RiskRelation[] = []
  const seen = new Set<string>()
  const push = (kind: RelationKind, otherId: string, note: string): void => {
    if (otherId === riskId) return
    const key = `${kind}:${otherId}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ kind, aId: riskId, bId: otherId, note })
  }

  /* Same cell: nearest neighbours by modelled loss, so the reader sees the
     risks the cell is most and least able to justify grouping. */
  const cellKey = `L${focus.likelihood}I${focus.impact}`
  const cell = report.matrix.cells.find((c) => c.key === cellKey)
  if (cell) {
    const focusLoss = lossOf(report, riskId)
    const neighbours = cell.riskIds
      .filter((id) => id !== riskId)
      .map((id) => ({ id, loss: lossOf(report, id) }))
      .sort((a, b) => Math.abs((b.loss ?? 0) - (focusLoss ?? 0)) - Math.abs((a.loss ?? 0) - (focusLoss ?? 0)))
      .slice(0, RELATION_LIMITS['same-cell'])
    for (const neighbour of neighbours) {
      const ratio =
        focusLoss && neighbour.loss ? Math.max(focusLoss, neighbour.loss) / Math.min(focusLoss, neighbour.loss) : undefined
      push(
        'same-cell',
        neighbour.id,
        ratio === undefined
          ? `Both scored ${cell.score}. Neither carries an estimate, so nothing separates them.`
          : `Both scored ${cell.score}; modelled losses differ by ${ratio.toFixed(1)}×.`,
      )
    }
  }

  /* Inversions involving this risk, strongest first. */
  const inversions = report.inversions
    .filter((i) => i.higherId === riskId || i.lowerId === riskId)
    .slice(0, RELATION_LIMITS['potential-inversion'])
  for (const inversion of inversions) {
    const other = inversion.higherId === riskId ? inversion.lowerId : inversion.higherId
    push(
      'potential-inversion',
      other,
      inversion.status === 'confirmed-under-model'
        ? 'Confirmed under the configured model.'
        : 'Candidate: the intervals overlap.',
    )
  }

  /* Shortlist companions. */
  const onShortlist = new Set(report.quantification.map((q) => q.riskId))
  if (onShortlist.has(riskId)) {
    for (const candidate of report.quantification.slice(0, RELATION_LIMITS['quantification-group'] + 1)) {
      push('quantification-group', candidate.riskId, `Shortlist rank ${candidate.rank}.`)
    }
  }

  /* Peer groupings, nearest by score so the comparison is a fair one. */
  pushGroup(report, focus, 'same-category', (r) => r.category, push)
  pushGroup(report, focus, 'same-business-unit', (r) => r.businessUnit, push)
  pushGroup(report, focus, 'same-assessor', (r) => r.assessor, push)

  return out
}

function pushGroup(
  report: AuditReport,
  focus: Risk,
  kind: RelationKind,
  key: (risk: Risk) => string | undefined,
  push: (kind: RelationKind, otherId: string, note: string) => void,
): void {
  const value = key(focus)
  if (!value) return
  const focusScore = report.scoreById.get(focus.id) ?? 0
  const peers = [...report.byId.values()]
    .filter((r) => r.id !== focus.id && key(r) === value)
    .sort(
      (a, b) =>
        Math.abs((report.scoreById.get(a.id) ?? 0) - focusScore) -
        Math.abs((report.scoreById.get(b.id) ?? 0) - focusScore),
    )
    .slice(0, RELATION_LIMITS[kind])
  for (const peer of peers) {
    push(kind, peer.id, `${value} · scored ${report.scoreById.get(peer.id) ?? '—'}.`)
  }
}

function lossOf(report: AuditReport, riskId: string): number | undefined {
  const model = report.models.get(riskId)
  return model ? centralAnnualLoss(model) : undefined
}

/** Every risk id the graph around `riskId` touches, including the centre. */
export function relatedIds(relations: readonly RiskRelation[], riskId: string): string[] {
  const ids = new Set<string>([riskId])
  for (const relation of relations) {
    ids.add(relation.aId)
    ids.add(relation.bId)
  }
  return [...ids]
}
