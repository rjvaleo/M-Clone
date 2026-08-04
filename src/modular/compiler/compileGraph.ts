// Turning an edited graph into something the runtime can execute.
//
// The compiler is where a user-authored patch stops being arbitrary. Classic
// only ever ran one fixed topology, so it could assume evaluation order,
// assume termination, and assume a bounded number of events per window. None
// of those hold once the user wires the graph, so each is checked here rather
// than discovered as a frozen tab.
//
// What the compiled plan guarantees the runtime:
//
//   - a deterministic evaluation order, or a diagnostic saying why there isn't
//     one (with the exact cycle named);
//   - every cycle broken by a module that genuinely advances time;
//   - a per-node event budget, so one runaway generator degrades itself
//     instead of freezing everything;
//   - stable per-node random seeds derived from the project seed and node id,
//     so moving a node on the canvas cannot change its music;
//   - a generation number, so the scheduling wake compares one integer instead
//     of re-deriving what changed.

import type { EdgeId, GraphDocument, NodeId, SignalType } from "../model/graph";
import { materializeStreamCompounds } from "../model/stream";
import { materializePatternEditors } from "../model/patternEditor";
import type { ModuleRegistry } from "../registry/registry";
import { streamKey } from "../runtime/rng";
import { DEFAULT_SCHEDULING_CONFIG } from "../runtime/scheduling";
import { validateGraph, type GraphDiagnostic } from "./validateGraph";

export type CompiledPlan = {
  /** Increments on every accepted plan; the runtime compares this alone. */
  generation: number;
  /** Deterministic evaluation order for event and control processors. */
  order: readonly NodeId[];
  /** Stable per-node random seed. */
  seeds: Readonly<Record<NodeId, number>>;
  /** Edges that legally close a cycle, and the module that breaks each one. */
  feedbackEdges: readonly { edgeId: EdgeId; breakerNodeId: NodeId }[];
  /** Events one node may emit in one scheduling window. */
  eventBudgetPerNode: number;
  /** Non-fatal findings worth showing the user. */
  warnings: readonly GraphDiagnostic[];
};

export type CompileResult =
  | { ok: true; plan: CompiledPlan }
  | { ok: false; diagnostics: readonly GraphDiagnostic[] };

export type CompileOptions = {
  /** Project seed. Same graph plus same seed is the same performance. */
  seed?: number;
  generation?: number;
  eventBudgetPerNode?: number;
};

/** Signals that carry discrete events and therefore constrain evaluation order. */
const isEventSignal = (signal: SignalType): boolean =>
  signal.kind !== "audio" && signal.kind !== "telemetry";

/**
 * Compile a graph, or explain why it cannot run.
 *
 * Structural validation is delegated to `validateGraph`; this adds the whole-
 * graph properties that only make sense once every edge is known.
 */
export function compileGraph(
  graph: GraphDocument,
  registry: ModuleRegistry,
  options: CompileOptions = {},
): CompileResult {
  // Compounds expand before anything else looks at the graph, so every check
  // below — order, cycles, required inputs — runs against the real nodes.
  const runtimeGraph = materializePatternEditors(materializeStreamCompounds(graph));
  const diagnostics: GraphDiagnostic[] = [...validateGraph(runtimeGraph, registry)];
  const warnings: GraphDiagnostic[] = [];

  const activeNodes = Object.values(runtimeGraph.nodes).filter((node) => node.enabled);
  const activeIds = new Set(activeNodes.map((node) => node.id));

  // A disabled node is a legitimate way to silence part of a patch, but an
  // edge left dangling into one is worth saying out loud.
  const activeEdges = Object.values(runtimeGraph.edges).filter((edge) => {
    if (!edge.enabled) return false;
    if (activeIds.has(edge.from.nodeId) && activeIds.has(edge.to.nodeId)) return true;
    warnings.push({
      code: "edge-to-disabled-node",
      message: "Connection is inactive because a node it touches is disabled",
      edgeId: edge.id,
      severity: "warning",
    });
    return false;
  });

  for (const node of activeNodes) {
    const descriptor = registry.get(node.moduleType);
    if (!descriptor) continue; // already reported as unknown-module
    for (const port of descriptor.ports) {
      if (port.direction !== "input" || !port.required) continue;
      const connected = activeEdges.some(
        (edge) => edge.to.nodeId === node.id && edge.to.portId === port.id,
      );
      if (!connected) {
        diagnostics.push({
          code: "missing-required-input",
          message: `${descriptor.label} needs ${port.label} connected`,
          nodeId: node.id,
        });
      }
    }
  }

  // Only event-domain edges constrain processor order. An audio edge is a
  // topology fact for the audio adapter, not an evaluation dependency.
  const orderingEdges = activeEdges.filter((edge) => {
    const fromDescriptor = registry.get(runtimeGraph.nodes[edge.from.nodeId]?.moduleType ?? "");
    const port = fromDescriptor?.ports.find((candidate) => candidate.id === edge.from.portId);
    return port !== undefined && isEventSignal(port.signal);
  });

  const feedbackEdges: { edgeId: EdgeId; breakerNodeId: NodeId }[] = [];
  const dependencyEdges = orderingEdges.filter((edge) => {
    // An edge arriving at a module that breaks feedback does not constrain
    // order: the breaker delivers what it received in an earlier window, so it
    // can be evaluated before its own upstream.
    const descriptor = registry.get(runtimeGraph.nodes[edge.to.nodeId]?.moduleType ?? "");
    if (!descriptor?.feedbackBreak) return true;
    feedbackEdges.push({ edgeId: edge.id, breakerNodeId: edge.to.nodeId });
    return false;
  });

  const sorted = topologicalOrder(
    [...activeIds].sort(),
    dependencyEdges.map((edge) => ({ from: edge.from.nodeId, to: edge.to.nodeId })),
  );
  if (sorted.cycle) {
    diagnostics.push({
      code: "unbroken-cycle",
      message:
        `Connections form a loop with no delay to break it: ${sorted.cycle.join(" -> ")}. ` +
        "Insert a module that delays by at least one tick.",
      nodeId: sorted.cycle[0],
    });
  }

  const fatal = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  if (fatal.length > 0) return { ok: false, diagnostics: fatal };

  const seed = options.seed ?? 0;
  const seeds: Record<NodeId, number> = {};
  for (const nodeId of sorted.order) seeds[nodeId] = streamKey(seed, nodeId, "node");

  return {
    ok: true,
    plan: {
      generation: options.generation ?? 1,
      order: sorted.order,
      seeds,
      feedbackEdges,
      eventBudgetPerNode:
        options.eventBudgetPerNode ?? DEFAULT_SCHEDULING_CONFIG.eventBudgetPerWindow,
      warnings: [...warnings, ...diagnostics.filter((item) => item.severity === "warning")],
    },
  };
}

/**
 * Kahn's algorithm with a sorted ready set, so the order depends only on the
 * graph and never on object-key iteration order — a golden trace must not
 * change because a node was created in a different session.
 */
function topologicalOrder(
  nodeIds: readonly NodeId[],
  edges: readonly { from: NodeId; to: NodeId }[],
): { order: NodeId[]; cycle: NodeId[] | null } {
  const incoming = new Map<NodeId, number>();
  const outgoing = new Map<NodeId, NodeId[]>();
  for (const id of nodeIds) {
    incoming.set(id, 0);
    outgoing.set(id, []);
  }
  for (const edge of edges) {
    if (!incoming.has(edge.to) || !outgoing.has(edge.from)) continue;
    // Parallel edges between the same pair are one dependency, not two.
    const targets = outgoing.get(edge.from) as NodeId[];
    if (targets.includes(edge.to)) continue;
    targets.push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) as number) + 1);
  }

  const ready = nodeIds.filter((id) => incoming.get(id) === 0).sort();
  const order: NodeId[] = [];
  while (ready.length > 0) {
    const id = ready.shift() as NodeId;
    order.push(id);
    for (const target of outgoing.get(id) as NodeId[]) {
      const remaining = (incoming.get(target) as number) - 1;
      incoming.set(target, remaining);
      if (remaining === 0) {
        ready.push(target);
        ready.sort();
      }
    }
  }

  if (order.length === nodeIds.length) return { order, cycle: null };
  const stuck = nodeIds.filter((id) => (incoming.get(id) as number) > 0);
  return { order, cycle: findCycle(stuck, outgoing) };
}

/** Name one concrete loop, so the message can point at real nodes. */
function findCycle(
  candidates: readonly NodeId[],
  outgoing: ReadonlyMap<NodeId, NodeId[]>,
): NodeId[] {
  const remaining = new Set(candidates);
  const path: NodeId[] = [];
  const onPath = new Set<NodeId>();
  const visited = new Set<NodeId>();

  const walk = (id: NodeId): NodeId[] | null => {
    if (onPath.has(id)) return [...path.slice(path.indexOf(id)), id];
    if (visited.has(id)) return null;
    visited.add(id);
    onPath.add(id);
    path.push(id);
    for (const next of (outgoing.get(id) ?? []).filter((target) => remaining.has(target))) {
      const found = walk(next);
      if (found) return found;
    }
    path.pop();
    onPath.delete(id);
    return null;
  };

  for (const id of [...remaining].sort()) {
    const found = walk(id);
    if (found) return found;
  }
  return [...remaining].sort();
}

/**
 * Holds the running plan.
 *
 * An edit that fails to compile must not stop the music: the last plan that
 * did compile keeps running while the canvas shows what is wrong. This is the
 * difference between a patch you can edit live and one where a mistyped
 * connection silences the performance.
 */
export class PlanPublisher {
  private good: CompiledPlan | null = null;
  private lastDiagnostics: readonly GraphDiagnostic[] = [];
  private generation = 0;
  private failed = false;

  /** The plan the runtime is executing, if any. */
  get current(): CompiledPlan | null {
    return this.good;
  }

  /**
   * True when the edited graph does not compile. Warnings alone do not make a
   * graph invalid — the plan they came from is running.
   */
  get invalid(): boolean {
    return this.failed;
  }

  get diagnostics(): readonly GraphDiagnostic[] {
    return this.lastDiagnostics;
  }

  /** Compile and publish, keeping the last good plan on failure. */
  publish(
    graph: GraphDocument,
    registry: ModuleRegistry,
    options: CompileOptions = {},
  ): CompileResult {
    const result = compileGraph(graph, registry, {
      ...options,
      generation: this.generation + 1,
    });
    if (result.ok) {
      this.generation += 1;
      this.good = result.plan;
      this.failed = false;
      this.lastDiagnostics = result.plan.warnings;
    } else {
      this.failed = true;
      this.lastDiagnostics = result.diagnostics;
    }
    return result;
  }

  reset(): void {
    this.good = null;
    this.lastDiagnostics = [];
    this.generation = 0;
    this.failed = false;
  }
}
