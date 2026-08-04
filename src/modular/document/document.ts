import type { Edge, GraphDocument, JsonValue, NodeInstance } from "../model/graph";
import { isAssetRecord, type AssetRecord } from "../audio/assets";

export const MODULAR_DOCUMENT_VERSION = 2;

export type ModularDocument = {
  format: "m-modular";
  schemaVersion: 2;
  product: "modular";
  graph: GraphDocument;
  snapshots: JsonValue[];
  macros: JsonValue[];
  performance?: JsonValue;
  /**
   * Identity and metadata for every sample the patch refers to — never the
   * audio itself. A document is a patch, not a sample library: embedding the
   * bytes would make saving slow, sharing worse, and a `.idmlab` a thing you
   * cannot read. An asset whose bytes are absent from the session opens as
   * `missing`, and re-dropping the file re-attaches it silently because the id
   * is derived from its contents rather than from where it lives.
   */
  assets: AssetRecord[];
};

export type ModularDecodeResult =
  | { ok: true; document: ModularDocument; warnings: string[] }
  | { ok: false; error: string };

type Bag = Record<string, unknown>;

const isBag = (value: unknown): value is Bag =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFinitePoint = (value: unknown): value is { x: number; y: number } =>
  isBag(value) && typeof value.x === "number" && Number.isFinite(value.x)
  && typeof value.y === "number" && Number.isFinite(value.y);

const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isBag(value) && Object.values(value).every(isJsonValue);
};

const readNode = (value: unknown): NodeInstance | null => {
  if (!isBag(value)
    || typeof value.id !== "string"
    || typeof value.moduleType !== "string"
    || typeof value.moduleVersion !== "number"
    || !Number.isInteger(value.moduleVersion)
    || value.moduleVersion < 1
    || typeof value.label !== "string"
    || !isFinitePoint(value.position)
    || !isBag(value.parameters)
    || !Object.values(value.parameters).every(isJsonValue)
    || typeof value.enabled !== "boolean") return null;
  return {
    id: value.id,
    moduleType: value.moduleType,
    moduleVersion: value.moduleVersion,
    label: value.label,
    position: { ...value.position },
    parameters: structuredClone(value.parameters) as Record<string, JsonValue>,
    enabled: value.enabled,
  };
};

const readEdge = (value: unknown): Edge | null => {
  if (!isBag(value)
    || typeof value.id !== "string"
    || !isBag(value.from)
    || typeof value.from.nodeId !== "string"
    || typeof value.from.portId !== "string"
    || !isBag(value.to)
    || typeof value.to.nodeId !== "string"
    || typeof value.to.portId !== "string"
    || typeof value.enabled !== "boolean") return null;
  return {
    id: value.id,
    from: { nodeId: value.from.nodeId, portId: value.from.portId },
    to: { nodeId: value.to.nodeId, portId: value.to.portId },
    enabled: value.enabled,
  };
};

const readGraph = (value: unknown): GraphDocument | null => {
  if (!isBag(value) || !isBag(value.nodes) || !isBag(value.edges)) return null;
  const nodes: GraphDocument["nodes"] = {};
  for (const [key, raw] of Object.entries(value.nodes)) {
    const node = readNode(raw);
    if (!node || node.id !== key) return null;
    nodes[key] = node;
  }
  const edges: GraphDocument["edges"] = {};
  for (const [key, raw] of Object.entries(value.edges)) {
    const edge = readEdge(raw);
    if (!edge || edge.id !== key) return null;
    edges[key] = edge;
  }
  return { nodes, edges };
};

export const createModularDocument = (
  graph: GraphDocument,
  assets: readonly AssetRecord[] = [],
): ModularDocument => ({
  format: "m-modular",
  schemaVersion: MODULAR_DOCUMENT_VERSION,
  product: "modular",
  graph: structuredClone(graph),
  snapshots: [],
  macros: [],
  assets: structuredClone(assets) as AssetRecord[],
});

export const encodeModularDocument = (document: ModularDocument): ModularDocument =>
  structuredClone(document);

const NOTE_EDITOR_V1_TO_V2_PARAM = {
  from: "pattern-presets",
  to: "preset-values",
} as const;

const migrateGraphV1ToV2 = (graph: GraphDocument): { graph: GraphDocument; warnings: string[] } => {
  const migrated = structuredClone(graph);
  const warnings: string[] = [];

  for (const node of Object.values(migrated.nodes)) {
    if (node.moduleType === "m.note-editor") {
      if (NOTE_EDITOR_V1_TO_V2_PARAM.from in node.parameters
        && !(NOTE_EDITOR_V1_TO_V2_PARAM.to in node.parameters)) {
        node.parameters[NOTE_EDITOR_V1_TO_V2_PARAM.to] = node.parameters[NOTE_EDITOR_V1_TO_V2_PARAM.from];
        delete node.parameters[NOTE_EDITOR_V1_TO_V2_PARAM.from];
        warnings.push(`Renamed m.note-editor parameter ${NOTE_EDITOR_V1_TO_V2_PARAM.from} to ${NOTE_EDITOR_V1_TO_V2_PARAM.to}`);
      }
      node.moduleVersion = Math.max(node.moduleVersion, 2);
    }
    if (node.moduleType === "m.note-order"
      || node.moduleType === "m.note-density"
      || node.moduleType === "m.midi-output"
      || node.moduleType === "m.time-base"
      || node.moduleType === "m.phase"
      || node.moduleType === "m.step-to-notes") {
      node.moduleVersion = Math.max(node.moduleVersion, 2);
    }
  }

  const renamePort = (edge: Edge, endpoint: "from" | "to", oldPortId: string, newPortId: string) => {
    const target = edge[endpoint];
    if (target.portId === oldPortId) {
      target.portId = newPortId;
      warnings.push(`Renamed port ${oldPortId} to ${newPortId} on edge ${edge.id}`);
    }
  };

  for (const edge of Object.values(migrated.edges)) {
    const fromNode = migrated.nodes[edge.from.nodeId];
    const toNode = migrated.nodes[edge.to.nodeId];

    if (fromNode?.moduleType === "m.note-editor") renamePort(edge, "from", "step-clock-in", "clock-in");
    if (toNode?.moduleType === "m.note-editor") renamePort(edge, "to", "step-clock-in", "clock-in");

    if (fromNode?.moduleType === "m.note-order") renamePort(edge, "from", "cursor-out", "cursor-telemetry");
    if (toNode?.moduleType === "m.note-order") renamePort(edge, "to", "cursor-out", "cursor-telemetry");

    if (fromNode?.moduleType === "m.note-density") renamePort(edge, "from", "rejected-out", "rejected-telemetry");
    if (toNode?.moduleType === "m.note-density") renamePort(edge, "to", "rejected-out", "rejected-telemetry");

    if (fromNode?.moduleType === "m.midi-output") renamePort(edge, "from", "monitor-out", "monitor-telemetry");
    if (toNode?.moduleType === "m.midi-output") renamePort(edge, "to", "monitor-out", "monitor-telemetry");
  }

  return { graph: migrated, warnings };
};

export function decodeModularDocument(value: unknown): ModularDecodeResult {
  if (!isBag(value)) return { ok: false, error: "idMLab document must be an object" };
  if (value.format !== "m-modular") return { ok: false, error: "Not an idMLab document" };
  if (value.schemaVersion !== 1 && value.schemaVersion !== MODULAR_DOCUMENT_VERSION) {
    return { ok: false, error: `Unsupported idMLab document version: ${String(value.schemaVersion)}` };
  }
  if (value.product !== "modular") return { ok: false, error: "Invalid idMLab product marker" };
  const decodedGraph = readGraph(value.graph);
  if (!decodedGraph) return { ok: false, error: "Invalid idMLab graph" };
  const migrated = value.schemaVersion === 1 ? migrateGraphV1ToV2(decodedGraph) : { graph: decodedGraph, warnings: [] };
  const snapshots = Array.isArray(value.snapshots) && value.snapshots.every(isJsonValue)
    ? structuredClone(value.snapshots) : null;
  const macros = Array.isArray(value.macros) && value.macros.every(isJsonValue)
    ? structuredClone(value.macros) : null;
  const rawAssets = Array.isArray(value.assets) && value.assets.every(isJsonValue)
    ? structuredClone(value.assets) : null;
  if (!snapshots || !macros || !rawAssets) {
    return { ok: false, error: "Invalid idMLab document collections" };
  }
  // A malformed asset entry costs a thumbnail, not the patch: dropping it with
  // a warning is a better outcome than refusing to open the document.
  const assets = rawAssets.filter(isAssetRecord);
  const assetWarnings = assets.length === rawAssets.length
    ? []
    : [`Ignored ${rawAssets.length - assets.length} unreadable asset entries`];
  if (value.performance !== undefined && !isJsonValue(value.performance)) {
    return { ok: false, error: "Invalid idMLab performance data" };
  }
  return {
    ok: true,
    document: {
      format: "m-modular",
      schemaVersion: 2,
      product: "modular",
      graph: migrated.graph,
      snapshots,
      macros,
      ...(value.performance === undefined
        ? {} : { performance: structuredClone(value.performance) as JsonValue }),
      assets,
    },
    warnings: [...migrated.warnings, ...assetWarnings],
  };
}
