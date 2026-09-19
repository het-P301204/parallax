/**
 * The relationship graph around one risk.
 *
 * Laid out radially with the focus risk at the centre and the neighbours
 * grouped into arcs by relationship kind — a deterministic layout rather than
 * a force simulation. Two reasons, both about usefulness rather than cost: a
 * force layout puts the same risk in a different place every time it is
 * opened, which makes it impossible to learn; and the grouping *is* the
 * information here, so spending it on repulsion forces would be a waste.
 *
 * Every edge kind is in the legend with its meaning. Selecting a kind isolates
 * it, which is how the graph answers "show me only the risks this one might
 * invert against" without becoming a second view.
 */

import { useMemo, useState } from 'react'
import type { RelationKind, Risk, RiskRelation } from '../engine/index.ts'
import { RELATION_LABEL, RELATION_MEANING } from '../engine/index.ts'
import { RELATION_STYLE, TYPE } from './tokens.ts'
import { clip } from './format.ts'

export interface RelationshipGraphProps {
  readonly focus: Risk
  readonly relations: readonly RiskRelation[]
  readonly risks: ReadonlyMap<string, Risk>
  readonly scoreById: ReadonlyMap<string, number>
  readonly onOpen: (riskId: string) => void
}

interface Node {
  readonly id: string
  readonly kind: RelationKind
  readonly x: number
  readonly y: number
  readonly title: string
  readonly score: number
  readonly note: string
}

const WIDTH = 640
const HEIGHT = 340

export function RelationshipGraph({
  focus,
  relations,
  risks,
  scoreById,
  onOpen,
}: RelationshipGraphProps): React.JSX.Element {
  const [isolated, setIsolated] = useState<RelationKind | undefined>()
  const [hovered, setHovered] = useState<string | undefined>()

  const kinds = useMemo(() => {
    const seen = new Map<RelationKind, RiskRelation[]>()
    for (const relation of relations) {
      const bucket = seen.get(relation.kind)
      if (bucket) bucket.push(relation)
      else seen.set(relation.kind, [relation])
    }
    return [...seen.entries()]
  }, [relations])

  const nodes = useMemo<Node[]>(() => {
    const out: Node[] = []
    const cx = WIDTH / 2
    const cy = HEIGHT / 2
    const total = kinds.length
    kinds.forEach(([kind, group], kindIndex) => {
      // Each kind gets a wedge of the circle; members are spread along it and
      // pushed out with a small alternating radius so labels do not collide.
      const wedge = (Math.PI * 2) / Math.max(1, total)
      const base = kindIndex * wedge - Math.PI / 2
      group.forEach((relation, memberIndex) => {
        const spread = group.length === 1 ? 0 : (memberIndex / (group.length - 1) - 0.5) * wedge * 0.82
        const angle = base + spread
        const radius = 108 + (memberIndex % 2) * 34
        out.push({
          id: relation.bId,
          kind,
          x: cx + Math.cos(angle) * radius * 1.5,
          y: cy + Math.sin(angle) * radius,
          title: risks.get(relation.bId)?.title ?? relation.bId,
          score: scoreById.get(relation.bId) ?? 0,
          note: relation.note,
        })
      })
    })
    return out
  }, [kinds, risks, scoreById])

  if (relations.length === 0) {
    return (
      <p className={`${TYPE.note} py-8 text-center`}>
        Nothing else in the register shares a cell, a category, a business unit, an assessor or an
        inversion with this risk.
      </p>
    )
  }

  const cx = WIDTH / 2
  const cy = HEIGHT / 2
  const visible = isolated ? nodes.filter((n) => n.kind === isolated) : nodes

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {kinds.map(([kind, group]) => {
          const active = isolated === kind
          return (
            <button
              key={kind}
              type="button"
              title={RELATION_MEANING[kind]}
              aria-pressed={active}
              onClick={() => setIsolated(active ? undefined : kind)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors duration-140 ${
                active
                  ? 'border-accent/50 bg-accent/15 text-accent-strong'
                  : 'border-line-2 text-ink-2 hover:border-line-3 hover:text-ink-1'
              }`}
            >
              <span
                aria-hidden
                className="h-px w-3.5"
                style={{
                  backgroundColor: RELATION_STYLE[kind].stroke,
                  backgroundImage: RELATION_STYLE[kind].dash
                    ? `repeating-linear-gradient(90deg, ${RELATION_STYLE[kind].stroke} 0 2px, transparent 2px 4px)`
                    : undefined,
                }}
              />
              {RELATION_LABEL[kind]} · {group.length}
            </button>
          )
        })}
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={`Risks related to ${focus.title}`}
      >
        {visible.map((node) => (
          <line
            key={`edge-${node.kind}-${node.id}`}
            x1={cx}
            y1={cy}
            x2={node.x}
            y2={node.y}
            stroke={RELATION_STYLE[node.kind].stroke}
            strokeWidth={hovered === node.id ? 1.8 : 1}
            strokeDasharray={RELATION_STYLE[node.kind].dash}
            opacity={hovered === undefined || hovered === node.id ? 0.7 : 0.18}
            pathLength={1}
            className="px-trace"
          />
        ))}

        {visible.map((node) => (
          <g
            key={`node-${node.kind}-${node.id}`}
            transform={`translate(${node.x} ${node.y})`}
            className="cursor-pointer"
            onMouseEnter={() => setHovered(node.id)}
            onMouseLeave={() => setHovered(undefined)}
            onClick={() => onOpen(node.id)}
            opacity={hovered === undefined || hovered === node.id ? 1 : 0.35}
          >
            <title>{`${node.title} — ${node.note}`}</title>
            <circle
              r="5"
              fill="rgb(var(--surface-2))"
              stroke={RELATION_STYLE[node.kind].stroke}
              strokeWidth="1.5"
            />
            <text
              x={node.x > cx ? 10 : -10}
              y="3.5"
              textAnchor={node.x > cx ? 'start' : 'end'}
              fontSize="10"
              className="fill-[rgb(var(--ink-1))]"
            >
              {clip(node.title, 34)}
            </text>
            <text
              x={node.x > cx ? 10 : -10}
              y="15"
              textAnchor={node.x > cx ? 'start' : 'end'}
              fontSize="9"
              className="fill-[rgb(var(--ink-3))] font-mono"
            >
              {node.id} · {node.score}
            </text>
          </g>
        ))}

        <g transform={`translate(${cx} ${cy})`}>
          <circle r="26" fill="rgb(var(--accent) / 0.14)" stroke="rgb(var(--accent))" strokeWidth="1.5" />
          <text textAnchor="middle" y="-2" fontSize="10" className="fill-[rgb(var(--ink-0))] font-mono">
            {focus.id}
          </text>
          <text textAnchor="middle" y="11" fontSize="9" className="fill-[rgb(var(--ink-2))] font-mono">
            L{focus.likelihood}I{focus.impact}
          </text>
        </g>
      </svg>

      <p className={`${TYPE.note} mt-1`}>
        {isolated
          ? RELATION_MEANING[isolated]
          : 'Each edge kind is capped at a few nearest neighbours so the picture stays readable. Select a kind to isolate it.'}
      </p>
    </div>
  )
}
