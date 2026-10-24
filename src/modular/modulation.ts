// Modulators and the knobs they move.
//
// An LFO keeps the knobs it is mapped to in its own `targets` parameter, so a
// mapping is saved with the document and goes when the LFO does. The face's
// Map button adds one; the knob then wears a ring in the LFO's colour and its
// pointer moves with the LFO. In the Rust engine each mapping is a route: the
// LFO's output, already scaled by its amount, moves the knob by up to half the
// knob's range either way, held inside the range.
//
// Everything here is plain functions over documents and numbers, so the parts
// the faces draw from are tested without a browser.

import type { GraphDocument, JsonValue, NodeInstance } from "./model/graph";


export const LFO_TYPE = "m.lfo";

/** In the order of `LfoShape` in rust/dsp-core/src/lfo.rs: the index is the wire value. */
export const LFO_SHAPES = ["Sine", "Triangle", "Saw up", "Saw down", "Square", "S&H", "Smooth random"] as const;

/** Each LFO wears one, on itself and on every knob it moves. */
export const LFO_COLORS = [
  { name: "Amber", value: "#f5a623" },
  { name: "Cyan", value: "#22c7e8" },
  { name: "Magenta", value: "#e8459c" },
  { name: "Lime", value: "#8fd14f" },
  { name: "Violet", value: "#9b6cf0" },
  { name: "Coral", value: "#ff7a5c" },
  { name: "Teal", value: "#1fb5a0" },
  { name: "Gold", value: "#e6c84a" },
] as const;

export type ModTarget = { nodeId: string; parameterId: string };

export const targetKey = (target: ModTarget): string => `${target.nodeId}|${target.parameterId}`;

const isTarget = (value: JsonValue): value is ModTarget =>
  typeof value === "object" && value !== null && !Array.isArray(value)
  && typeof (value as Record<string, unknown>).nodeId === "string"
  && typeof (value as Record<string, unknown>).parameterId === "string";

/** The knobs an LFO moves, as its document holds them. */
export const targetsOf = (node: NodeInstance): ModTarget[] => {
  const raw = node.parameters.targets;
  return Array.isArray(raw)
    ? raw.filter(isTarget).map((t) => ({ nodeId: t.nodeId, parameterId: t.parameterId }))
    : [];
};

export const withTarget = (targets: readonly ModTarget[], target: ModTarget): ModTarget[] =>
  targets.some((t) => targetKey(t) === targetKey(target)) ? [...targets] : [...targets, { ...target }];

export const withoutTarget = (targets: readonly ModTarget[], target: ModTarget): ModTarget[] =>
  targets.filter((t) => targetKey(t) !== targetKey(target));

export const lfoColor = (node: NodeInstance): string =>
  (LFO_COLORS.find((c) => c.name === node.parameters.color) ?? LFO_COLORS[0]).value;

export type Mapping = { lfoNodeId: string; color: string };

/** Every knob some LFO moves, keyed by `targetKey`, with the LFOs in document order. */
export function mappingsByTarget(graph: GraphDocument): Map<string, Mapping[]> {
  const map = new Map<string, Mapping[]>();
  for (const node of Object.values(graph.nodes)) {
    if (node.moduleType !== LFO_TYPE) continue;
    for (const target of targetsOf(node)) {
      if (!graph.nodes[target.nodeId]) continue;
      const key = targetKey(target);
      map.set(key, [...(map.get(key) ?? []), { lfoNodeId: node.id, color: lfoColor(node) }]);
    }
  }
  return map;
}

/** The first colour no LFO in the document wears, so a new one stands apart. */
export function nextLfoColor(graph: GraphDocument): string {
  const worn = new Set(Object.values(graph.nodes)
    .filter((node) => node.moduleType === LFO_TYPE)
    .map((node) => node.parameters.color));
  return (LFO_COLORS.find((c) => !worn.has(c.name)) ?? LFO_COLORS[0]).name;
}

/** Where a knob is with an LFO on it: the LFO's value over half its range, held inside it. */
export const modulatedValue = (base: number, lfoValue: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, base + lfoValue * ((max - min) / 2)));

/**
 * The shape at a phase, as `Lfo::shape_at` plays it, before the amount. Null
 * for the random shapes, which a face cannot predict and holds instead.
 */
export function shapeValue(shape: number, phase: number): number | null {
  switch (shape) {
    case 0: return Math.sin(phase * 2 * Math.PI);
    case 1: return 1 - 4 * Math.abs(phase - 0.5);
    case 2: return phase * 2 - 1;
    case 3: return 1 - phase * 2;
    case 4: return phase < 0.5 ? 1 : -1;
    default: return null;
  }
}

/** The phase `seconds` after a report, at `rateHz`. */
export const extrapolatePhase = (phase: number, rateHz: number, seconds: number): number => {
  const next = phase + rateHz * seconds;
  return next - Math.floor(next);
};

/** An LFO as the rack last reported it, and when (in seconds) the report came. */
export type LfoReport = { phase: number; value: number; at: number };

/** Past this a report is stale — audio stopped — and a face holds instead of running on. */
export const STALE_REPORT_SECONDS = 0.5;

/**
 * An LFO's output now, from its last report: a predictable shape carried
 * forward at its rate, a random one held, and anything held once the reports
 * stop coming.
 */
export function liveLfoValue(
  report: LfoReport,
  lfo: { rate: number; shape: number; amount: number },
  now: number,
): number {
  const elapsed = now - report.at;
  if (elapsed < 0 || elapsed > STALE_REPORT_SECONDS) return report.value;
  const shaped = shapeValue(lfo.shape, extrapolatePhase(report.phase, lfo.rate, elapsed));
  return shaped === null ? report.value : shaped * lfo.amount;
}

/** Every LFO's rate, shape (as its wire index) and amount, for drawing it live. */
export function lfoStates(graph: GraphDocument): Map<string, { rate: number; shape: number; amount: number }> {
  const states = new Map<string, { rate: number; shape: number; amount: number }>();
  for (const node of Object.values(graph.nodes)) {
    if (node.moduleType !== LFO_TYPE) continue;
    const number = (id: string, fallback: number) => {
      const value = node.parameters[id];
      return typeof value === "number" && Number.isFinite(value) ? value : fallback;
    };
    const shape = LFO_SHAPES.indexOf(node.parameters.shape as (typeof LFO_SHAPES)[number]);
    states.set(node.id, { rate: number("rate", 1), shape: Math.max(0, shape), amount: number("amount", 0.5) });
  }
  return states;
}
