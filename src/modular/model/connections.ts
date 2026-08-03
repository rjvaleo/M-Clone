import type { GraphDocument, PortDescriptor, PortRef } from "./graph";
import { compatibleSignals } from "./graph";
import type { ModuleRegistry } from "../registry/registry";

const resolvePort = (
  graph: GraphDocument,
  registry: ModuleRegistry,
  ref: PortRef,
): PortDescriptor | null => {
  const node = graph.nodes[ref.nodeId];
  const descriptor = node ? registry.get(node.moduleType) : undefined;
  return descriptor?.ports.find((port) => port.id === ref.portId) ?? null;
};

export function connectionError(
  graph: GraphDocument,
  registry: ModuleRegistry,
  from: PortRef,
  to: PortRef,
): string | null {
  const output = resolvePort(graph, registry, from);
  const input = resolvePort(graph, registry, to);
  if (!output || !input) return "That port no longer exists";
  if (output.direction !== "output" || input.direction !== "input") {
    return "Connections must run from an output to an input";
  }
  if (from.nodeId === to.nodeId) return "A node cannot connect directly to itself";
  if (!compatibleSignals(output.signal, input.signal)) {
    return `${output.label} (${output.signal.kind}) cannot connect to ${input.label} (${input.signal.kind})`;
  }
  const duplicate = Object.values(graph.edges).some((edge) =>
    edge.from.nodeId === from.nodeId && edge.from.portId === from.portId
    && edge.to.nodeId === to.nodeId && edge.to.portId === to.portId);
  if (duplicate) return "Those ports are already connected";
  if (input.cardinality === "one") {
    const occupied = Object.values(graph.edges).some((edge) =>
      edge.to.nodeId === to.nodeId && edge.to.portId === to.portId);
    if (occupied) return `${input.label} accepts only one connection`;
  }
  return null;
}
