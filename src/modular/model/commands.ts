import type {
  Edge,
  EdgeId,
  GraphDocument,
  GraphPoint,
  JsonValue,
  NodeId,
  NodeInstance,
  ParameterId,
} from "./graph";

export type GraphCommand =
  | { type: "add-node"; node: NodeInstance }
  | { type: "remove-nodes"; nodeIds: NodeId[] }
  | { type: "restore-subgraph"; nodes: NodeInstance[]; edges: Edge[] }
  | { type: "move-nodes"; positions: Record<NodeId, GraphPoint> }
  | { type: "set-parameter"; nodeId: NodeId; parameterId: ParameterId; value: JsonValue }
  | { type: "set-parameters"; nodeId: NodeId; values: Record<ParameterId, JsonValue> }
  | { type: "add-edge"; edge: Edge }
  | { type: "remove-edge"; edgeId: EdgeId };

export type CommandResult = { graph: GraphDocument; inverse: GraphCommand };

const cloneGraph = (graph: GraphDocument): GraphDocument => ({
  nodes: { ...graph.nodes },
  edges: { ...graph.edges },
});

const requireNode = (graph: GraphDocument, nodeId: NodeId): NodeInstance => {
  const node = graph.nodes[nodeId];
  if (!node) throw new Error(`Unknown node: ${nodeId}`);
  return node;
};

export function executeGraphCommand(graph: GraphDocument, command: GraphCommand): CommandResult {
  const next = cloneGraph(graph);
  switch (command.type) {
    case "add-node": {
      if (next.nodes[command.node.id]) throw new Error(`Duplicate node: ${command.node.id}`);
      next.nodes[command.node.id] = structuredClone(command.node);
      return { graph: next, inverse: { type: "remove-nodes", nodeIds: [command.node.id] } };
    }
    case "remove-nodes": {
      const ids = new Set(command.nodeIds);
      const nodes = command.nodeIds.map((id) => structuredClone(requireNode(graph, id)));
      const edges = Object.values(graph.edges)
        .filter((edge) => ids.has(edge.from.nodeId) || ids.has(edge.to.nodeId))
        .map((edge) => structuredClone(edge));
      for (const id of ids) delete next.nodes[id];
      for (const edge of edges) delete next.edges[edge.id];
      return { graph: next, inverse: { type: "restore-subgraph", nodes, edges } };
    }
    case "restore-subgraph": {
      for (const node of command.nodes) {
        if (next.nodes[node.id]) throw new Error(`Duplicate node: ${node.id}`);
        next.nodes[node.id] = structuredClone(node);
      }
      for (const edge of command.edges) next.edges[edge.id] = structuredClone(edge);
      return {
        graph: next,
        inverse: { type: "remove-nodes", nodeIds: command.nodes.map((node) => node.id) },
      };
    }
    case "move-nodes": {
      const previous: Record<NodeId, GraphPoint> = {};
      for (const [id, position] of Object.entries(command.positions)) {
        const node = requireNode(graph, id);
        previous[id] = { ...node.position };
        next.nodes[id] = { ...node, position: { ...position } };
      }
      return { graph: next, inverse: { type: "move-nodes", positions: previous } };
    }
    case "set-parameter": {
      const node = requireNode(graph, command.nodeId);
      if (!(command.parameterId in node.parameters)) {
        throw new Error(`Unknown parameter: ${command.nodeId}:${command.parameterId}`);
      }
      const previous = structuredClone(node.parameters[command.parameterId]);
      next.nodes[command.nodeId] = {
        ...node,
        parameters: { ...node.parameters, [command.parameterId]: structuredClone(command.value) },
      };
      return {
        graph: next,
        inverse: {
          type: "set-parameter",
          nodeId: command.nodeId,
          parameterId: command.parameterId,
          value: previous,
        },
      };
    }
    case "set-parameters": {
      const node = requireNode(graph, command.nodeId);
      const previous: Record<ParameterId, JsonValue> = {};
      const parameters = { ...node.parameters };
      for (const [parameterId, value] of Object.entries(command.values)) {
        if (!(parameterId in node.parameters)) {
          throw new Error(`Unknown parameter: ${command.nodeId}:${parameterId}`);
        }
        previous[parameterId] = structuredClone(node.parameters[parameterId]);
        parameters[parameterId] = structuredClone(value);
      }
      next.nodes[command.nodeId] = { ...node, parameters };
      return {
        graph: next,
        inverse: { type: "set-parameters", nodeId: command.nodeId, values: previous },
      };
    }
    case "add-edge": {
      if (next.edges[command.edge.id]) throw new Error(`Duplicate edge: ${command.edge.id}`);
      requireNode(graph, command.edge.from.nodeId);
      requireNode(graph, command.edge.to.nodeId);
      next.edges[command.edge.id] = structuredClone(command.edge);
      return { graph: next, inverse: { type: "remove-edge", edgeId: command.edge.id } };
    }
    case "remove-edge": {
      const edge = graph.edges[command.edgeId];
      if (!edge) throw new Error(`Unknown edge: ${command.edgeId}`);
      delete next.edges[command.edgeId];
      return { graph: next, inverse: { type: "add-edge", edge: structuredClone(edge) } };
    }
  }
}
