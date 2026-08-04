/**
 * Shared builders for module descriptors.
 *
 * The registry enforces a strict contract — every parameter and command must
 * appear on the node face, every `many` input must declare a merge policy,
 * telemetry ports must be named as such — and writing thirty descriptors by
 * hand is thirty chances to break one of those quietly. These helpers make the
 * common shapes one call each, so the descriptor reads as a statement of what
 * the module *is* rather than as boilerplate.
 */

import type {
  ModuleDescriptor,
  NodeFaceElement,
  NodeFaceSection,
  ParameterDescriptor,
  PortDescriptor,
  SignalType,
} from "../model/graph";

// ---- signals ---------------------------------------------------------------

export const transportSignal = (): SignalType => ({ kind: "transport", resolution: 960 });
export const stepClockSignal = (): SignalType => ({ kind: "step-clock" });
export const resetSignal = (): SignalType => ({ kind: "reset" });
export const patternSignal = (): SignalType => ({ kind: "pattern-data" });
export const stepEventSignal = (): SignalType => ({ kind: "step-event" });
export const noteSignal = (): SignalType => ({ kind: "note-event" });
export const midiSignal = (): SignalType => ({ kind: "midi", protocol: "midi1" });
export const numberSignal = (): SignalType => ({ kind: "control", value: "number" });
export const indexSignal = (): SignalType => ({ kind: "control", value: "index" });
export const booleanSignal = (): SignalType => ({ kind: "control", value: "boolean" });
export const telemetrySignal = (schema: string): SignalType => ({ kind: "telemetry", schema });

// ---- ports -----------------------------------------------------------------

type PortOptions = {
  required?: boolean;
  /** Only for `many` inputs, which the registry refuses without one. */
  merge?: PortDescriptor["mergePolicy"];
};

export const input = (
  id: string,
  label: string,
  signal: SignalType,
  options: PortOptions = {},
): PortDescriptor => ({
  id,
  label,
  direction: "input",
  signal,
  cardinality: options.merge ? "many" : "one",
  ...(options.merge ? { mergePolicy: options.merge } : {}),
  ...(options.required ? { required: true } : {}),
});

export const output = (id: string, label: string, signal: SignalType): PortDescriptor => ({
  id,
  label,
  direction: "output",
  signal,
  cardinality: "many",
});

/** Reset is always a bus: several sources may sync the same node. */
export const resetInput = (): PortDescriptor =>
  input("reset-in", "Reset", resetSignal(), { merge: "first-wins" });

/** The a–h selector every embedded-preset module accepts. */
export const positionInput = (): PortDescriptor =>
  input("position-in", "Preset position", indexSignal());

export const telemetryOutput = (id: string, label: string, schema: string): PortDescriptor =>
  output(id, label, telemetrySignal(schema));

// ---- parameters ------------------------------------------------------------

export const numberParam = (
  id: string,
  label: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
  step = 1,
  unit?: string,
): ParameterDescriptor => ({
  id,
  label,
  kind: "number",
  defaultValue,
  minimum,
  maximum,
  step,
  unit,
  smoothing: "linear",
  morph: "linear",
  automation: "record",
});

export const boolParam = (
  id: string,
  label: string,
  defaultValue = false,
): ParameterDescriptor => ({
  id,
  label,
  kind: "boolean",
  defaultValue,
  smoothing: "none",
  morph: "step-end",
  automation: "record",
});

export const enumParam = (
  id: string,
  label: string,
  options: readonly string[],
  defaultValue = options[0],
): ParameterDescriptor => ({
  id,
  label,
  kind: "enum",
  defaultValue,
  options,
  smoothing: "none",
  morph: "step-end",
  automation: "record",
});

export const jsonParam = (
  id: string,
  label: string,
  defaultValue: ParameterDescriptor["defaultValue"],
): ParameterDescriptor => ({
  id,
  label,
  kind: "json",
  defaultValue,
  smoothing: "none",
  morph: "step-end",
  automation: "record",
});

export const stringParam = (
  id: string,
  label: string,
  defaultValue = "",
): ParameterDescriptor => ({
  id,
  label,
  kind: "string",
  defaultValue,
  smoothing: "none",
  morph: "immediate",
  automation: "none",
});

/** Slots on the shared preset pad — two rows of eight. */
export const PRESET_SLOTS = 16;

/**
 * Pad a module's stored positions out to the pad's size.
 *
 * Modules declare the presets they ship with, which is rarely sixteen; the rest
 * are empty slots waiting to be filled by shift-clicking them.
 */
export const presetSlots = (
  values: readonly ParameterDescriptor["defaultValue"][],
): ParameterDescriptor["defaultValue"] =>
  Array.from({ length: PRESET_SLOTS }, (_, index) => values[index] ?? null) as ParameterDescriptor["defaultValue"];

/** The stored positions every Variable carries. */
export const presetParams = (
  label: string,
  defaultValue: ParameterDescriptor["defaultValue"],
  activeDefault = 0,
): ParameterDescriptor[] => [
  jsonParam("preset-values", label, Array.isArray(defaultValue)
    ? presetSlots(defaultValue as ParameterDescriptor["defaultValue"][])
    : defaultValue),
  {
    ...numberParam("active-position", "Active preset", activeDefault, 0, PRESET_SLOTS - 1),
    smoothing: "none",
    morph: "step-end",
  },
];

// ---- face --------------------------------------------------------------------

export const section = (
  id: string,
  label: string,
  elements: NodeFaceElement[],
): NodeFaceSection => ({ id, label, elements });

export const param = (parameterId: string): NodeFaceElement => ({ kind: "parameter", parameterId });
export const command = (id: string, label: string): NodeFaceElement => ({ kind: "command", id, label });
export const status = (id: string, label: string): NodeFaceElement => ({ kind: "status", id, label });
export const custom = (
  id: string,
  label: string,
  parameterIds?: readonly string[],
): NodeFaceElement => ({ kind: "custom", id, label, parameterIds });

/**
 * The preset pad, identical on every module that has one.
 *
 * `captures` is the only thing that varies: the parameters a slot stores and
 * restores. Everything else — sixteen slots, two rows of eight, click to
 * recall, shift-click to store — is the same control everywhere.
 */
export const presetSection = (
  customId: string,
  label: string,
  captures: readonly string[] = [],
  placement: "top" | "bottom" | "left" | "right" = "bottom",
): NodeFaceSection =>
  section("presets", "Presets", [{
    kind: "custom",
    id: customId,
    label,
    parameterIds: ["preset-values", "active-position"],
    captures,
    placement,
  }]);

// ---- module ------------------------------------------------------------------

export type ModuleSpec = {
  type: string;
  label: string;
  family: ModuleDescriptor["family"];
  layout?: ModuleDescriptor["layout"];
  colorToken?: string;
  ports: PortDescriptor[];
  parameters?: ParameterDescriptor[];
  commands?: { id: string; label: string }[];
  face: NodeFaceSection[];
  feedbackBreak?: ModuleDescriptor["feedbackBreak"];
};

export const defineModule = (spec: ModuleSpec): ModuleDescriptor => ({
  type: spec.type,
  version: 1,
  label: spec.label,
  family: spec.family,
  layout: spec.layout ?? "compact",
  colorToken: spec.colorToken ?? spec.family,
  ports: spec.ports,
  parameters: spec.parameters ?? [],
  commands: spec.commands ?? [],
  face: spec.face,
  ...(spec.feedbackBreak ? { feedbackBreak: spec.feedbackBreak } : {}),
});
