export type NodeId = string;
export type EdgeId = string;
export type ModuleTypeId = string;
export type PortId = string;
export type ParameterId = string;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SignalType =
  | { kind: "transport"; resolution: 960 }
  | { kind: "step-clock" }
  | { kind: "reset" }
  | { kind: "pattern-data" }
  | { kind: "step-event" }
  | { kind: "note-event" }
  | { kind: "midi"; protocol: "midi1" }
  | { kind: "control"; value: "number" | "boolean" | "index"; polarity?: "uni" | "bi" }
  | { kind: "scene" }
  | { kind: "audio"; channels: 1 | 2 }
  | { kind: "telemetry"; schema: string };

export type PortDescriptor = {
  id: PortId;
  label: string;
  direction: "input" | "output";
  signal: SignalType;
  cardinality: "one" | "many";
  mergePolicy?: "ordered-by-tick" | "first-wins" | "sum";
  required?: boolean;
};

export type ParameterDescriptor = {
  id: ParameterId;
  label: string;
  kind: "number" | "boolean" | "enum" | "string" | "json";
  defaultValue: JsonValue;
  minimum?: number;
  maximum?: number;
  step?: number;
  unit?: string;
  options?: readonly string[];
  smoothing: "none" | "linear" | "exponential";
  morph: "immediate" | "linear" | "exponential" | "step-start" | "step-end";
  automation: "none" | "record" | "record-and-host";
};

export type NodeFaceElement =
  | { kind: "parameter"; parameterId: ParameterId }
  | { kind: "command"; id: string; label: string }
  | { kind: "status"; id: string; label: string }
  | { kind: "custom"; id: string; label: string; parameterIds?: readonly ParameterId[] };

export type NodeFaceSection = {
  id: string;
  label: string;
  elements: readonly NodeFaceElement[];
};

export type ModuleDescriptor = {
  type: ModuleTypeId;
  version: number;
  label: string;
  family: "clock" | "source" | "transform" | "control" | "routing" | "scene" | "instrument" | "audio";
  layout: "compact" | "editor" | "utility";
  colorToken: string;
  ports: readonly PortDescriptor[];
  parameters: readonly ParameterDescriptor[];
  commands: readonly { id: string; label: string }[];
  face: readonly NodeFaceSection[];
  /**
   * Declared by the only modules allowed to close a cycle.
   *
   * A graph that feeds an output back into an upstream input has no evaluation
   * order and no terminating window plan, so cycles are rejected — unless they
   * pass through a module that breaks the loop in time. `minDelayTicks` must be
   * at least one whole tick: a zero-delay break is still an infinite loop, just
   * a better-documented one. `maxGain` bounds an audio feedback path so it
   * cannot run away.
   */
  feedbackBreak?: { minDelayTicks: number; maxGain?: number };
};

export type GraphPoint = { x: number; y: number };

export type NodeInstance = {
  id: NodeId;
  moduleType: ModuleTypeId;
  moduleVersion: number;
  label: string;
  position: GraphPoint;
  parameters: Record<ParameterId, JsonValue>;
  enabled: boolean;
};

export type PortRef = { nodeId: NodeId; portId: PortId };

export type Edge = {
  id: EdgeId;
  from: PortRef;
  to: PortRef;
  enabled: boolean;
};

export type GraphDocument = {
  nodes: Record<NodeId, NodeInstance>;
  edges: Record<EdgeId, Edge>;
};

export const emptyGraph = (): GraphDocument => ({ nodes: {}, edges: {} });

export const signalTypeKey = (signal: SignalType): string => {
  if (signal.kind === "control") return `${signal.kind}:${signal.value}:${signal.polarity ?? "uni"}`;
  if (signal.kind === "audio") return `${signal.kind}:${signal.channels}`;
  if (signal.kind === "telemetry") return `${signal.kind}:${signal.schema}`;
  if (signal.kind === "transport") return `${signal.kind}:${signal.resolution}`;
  if (signal.kind === "midi") return `${signal.kind}:${signal.protocol}`;
  return signal.kind;
};

export const compatibleSignals = (from: SignalType, to: SignalType): boolean =>
  signalTypeKey(from) === signalTypeKey(to);
