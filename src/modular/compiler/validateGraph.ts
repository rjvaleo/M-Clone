import { compatibleSignals, type GraphDocument, type ModuleDescriptor, type PortDescriptor } from "../model/graph";
import type { ModuleRegistry } from "../registry/registry";

export type GraphDiagnostic = {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
  /**
   * Absent means the graph cannot be compiled. A `warning` is reported to the
   * user but still runs — a degenerate value that has been clamped, say.
   */
  severity?: "error" | "warning";
};

const portFor = (
  graph: GraphDocument,
  registry: ModuleRegistry,
  nodeId: string,
  portId: string,
): { module: ModuleDescriptor; port: PortDescriptor } | null => {
  const node = graph.nodes[nodeId];
  if (!node) return null;
  const module = registry.get(node.moduleType);
  if (!module) return null;
  const port = module.ports.find((candidate) => candidate.id === portId);
  return port ? { module, port } : null;
};

export function validateGraph(graph: GraphDocument, registry: ModuleRegistry): GraphDiagnostic[] {
  const diagnostics: GraphDiagnostic[] = [];
  for (const node of Object.values(graph.nodes)) {
    if (!registry.has(node.moduleType)) {
      diagnostics.push({ code: "unknown-module", message: `Unknown module: ${node.moduleType}`, nodeId: node.id });
    }
  }
  const occupiedInputs = new Map<string, string>();
  for (const edge of Object.values(graph.edges)) {
    const from = portFor(graph, registry, edge.from.nodeId, edge.from.portId);
    const to = portFor(graph, registry, edge.to.nodeId, edge.to.portId);
    if (!from || !to) {
      diagnostics.push({ code: "missing-endpoint", message: "Edge endpoint does not exist", edgeId: edge.id });
      continue;
    }
    if (from.port.direction !== "output" || to.port.direction !== "input") {
      diagnostics.push({ code: "wrong-direction", message: "Edges must connect output to input", edgeId: edge.id });
    }
    if (from.port.signal.kind === "telemetry" && to.port.signal.kind !== "telemetry") {
      diagnostics.push({
        code: "telemetry-route",
        message: "Telemetry outputs may only connect to telemetry inputs",
        edgeId: edge.id,
      });
      continue;
    }
    if (!compatibleSignals(from.port.signal, to.port.signal)) {
      diagnostics.push({ code: "incompatible-signal", message: `${from.port.label} cannot connect to ${to.port.label}`, edgeId: edge.id });
    }
    if (to.port.cardinality === "one") {
      const key = `${edge.to.nodeId}:${edge.to.portId}`;
      const previous = occupiedInputs.get(key);
      if (previous) diagnostics.push({ code: "input-cardinality", message: `Input already connected by ${previous}`, edgeId: edge.id });
      else occupiedInputs.set(key, edge.id);
    }
  }
  return diagnostics;
}
