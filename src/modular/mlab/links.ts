/**
 * Position links: M Variables writes each variable's current position into
 * the M modules that hold it. No cables — the app applies these updates to
 * the document and to the live runtime whenever M Variables or its targets
 * change, and `resolveTargets` only ever returns what actually differs, so
 * applying them settles at once.
 */

import type { GraphDocument, NodeInstance } from "../model/graph";
import type { MorphPolicy } from "../runtime/parameters";
import { M_LAB_TYPES } from "../registry/mLabModules";
import { defaultVariables, resolveTargets, type MTarget, type MUpdate, type VariablesState } from "./variables";

/** M Variables' parameters as its model state, defaults filling any gap. */
export function variablesStateOf(node: NodeInstance): VariablesState {
  const base = defaultVariables();
  const read = <K extends keyof VariablesState>(key: K): VariablesState[K] =>
    (node.parameters[key] as unknown as VariablesState[K] | undefined) ?? base[key];
  return {
    tables: read("tables"),
    active: { ...base.active, ...read("active") },
    arrows: { ...base.arrows, ...read("arrows") },
    marks: { ...base.marks, ...read("marks") },
    snapshots: read("snapshots"),
  };
}

const KINDS: Record<string, MTarget["kind"]> = {
  [M_LAB_TYPES.noteSeq]: "noteSeq",
  [M_LAB_TYPES.timeWarp]: "timeWarp",
  [M_LAB_TYPES.orchestra]: "orchestra",
};

export function variableLinkUpdates(graph: GraphDocument): MUpdate[] {
  const variables = Object.values(graph.nodes).find((node) => node.moduleType === M_LAB_TYPES.variables);
  if (!variables) return [];
  const targets: MTarget[] = Object.values(graph.nodes)
    .filter((node) => node.moduleType in KINDS && node.enabled)
    .map((node) => ({ kind: KINDS[node.moduleType], nodeId: node.id, parameters: node.parameters }));
  return resolveTargets(variablesStateOf(variables), targets);
}

export function quantizeMorph(quantize: unknown): MorphPolicy {
  if (quantize === "beat") return "next-beat";
  if (quantize === "bar") return "next-bar";
  return "immediate";
}
