// The compiled audio topology, and what changed between two of them.
//
// The rule this file exists to make enforceable: **a parameter change must
// never touch topology.** Rebuilding a Web Audio subgraph because a knob moved
// is the standard way an audio application acquires clicks, dropouts and leaked
// nodes, and it is invisible in a screenshot — so it has to be a property the
// types and the tests can check, not a habit.
//
// That is why a node's state is split in two. `structure` holds everything that
// decides the shape of the Web Audio graph a node compiles to — a delay line's
// maximum length, an oscillator's waveform, a convolver's impulse response.
// `parameters` holds everything that can be moved in place with a scheduled
// ramp. A change to the first rebuilds that node behind a crossfade; a change
// to the second is a ramp and nothing else.

import type { JsonValue } from "../model/graph";

export type AudioPortRef = { nodeId: string; portId: string };

export type AudioConnection = { from: AudioPortRef; to: AudioPortRef };

export type AudioNodeSpec = {
  nodeId: string;
  moduleType: string;
  /** Decides the shape of the compiled subgraph. Changing it rebuilds the node. */
  structure: Readonly<Record<string, JsonValue>>;
  /** Ramped in place. Changing it never rebuilds anything. */
  parameters: Readonly<Record<string, number>>;
  /** Bypassed nodes may suspend their DSP; wet 0 keeps processing alive. */
  bypass: boolean;
  /** Dry/wet balance, 0..1, for nodes that declare one. */
  wet: number;
};

export type AudioPlan = {
  generation: number;
  nodes: Readonly<Record<string, AudioNodeSpec>>;
  connections: readonly AudioConnection[];
};

export type ParameterChange = { nodeId: string; parameterId: string; value: number };

export type AudioPlanDiff = {
  /** Nodes that did not exist before. */
  added: readonly AudioNodeSpec[];
  /** Node ids that are gone. */
  removed: readonly string[];
  /** Nodes whose structure changed, so the subgraph must be rebuilt. */
  rebuilt: readonly AudioNodeSpec[];
  connected: readonly AudioConnection[];
  disconnected: readonly AudioConnection[];
  parameters: readonly ParameterChange[];
  bypass: readonly { nodeId: string; bypass: boolean }[];
  wet: readonly { nodeId: string; wet: number }[];
};

export const emptyAudioPlan = (generation = 0): AudioPlan => ({
  generation,
  nodes: {},
  connections: [],
});

/** Unambiguous without a separator character that an id could contain. */
export const connectionKey = (connection: AudioConnection): string =>
  JSON.stringify([
    connection.from.nodeId,
    connection.from.portId,
    connection.to.nodeId,
    connection.to.portId,
  ]);

/** Structural equality by value, so a rebuild is never triggered by identity. */
function sameStructure(a: AudioNodeSpec, b: AudioNodeSpec): boolean {
  if (a.moduleType !== b.moduleType) return false;
  const keys = new Set([...Object.keys(a.structure), ...Object.keys(b.structure)]);
  for (const key of keys) {
    if (JSON.stringify(a.structure[key]) !== JSON.stringify(b.structure[key])) return false;
  }
  return true;
}

/**
 * What has to happen to turn `previous` into `next`.
 *
 * A node that survives with the same structure is never listed in `added`,
 * `removed` or `rebuilt`, and its existing connections are never listed in
 * `connected` or `disconnected` — which is precisely what makes a parameter-only
 * edit produce a diff with no topology work in it.
 */
export function diffAudioPlans(previous: AudioPlan, next: AudioPlan): AudioPlanDiff {
  const added: AudioNodeSpec[] = [];
  const rebuilt: AudioNodeSpec[] = [];
  const removed: string[] = [];
  const parameters: ParameterChange[] = [];
  const bypass: { nodeId: string; bypass: boolean }[] = [];
  const wet: { nodeId: string; wet: number }[] = [];

  // Sorted so a diff is deterministic and two equal graphs always compare equal.
  for (const nodeId of Object.keys(next.nodes).sort()) {
    const after = next.nodes[nodeId];
    const before = previous.nodes[nodeId];
    if (!before) {
      added.push(after);
      continue;
    }
    if (!sameStructure(before, after)) {
      rebuilt.push(after);
      continue;
    }
    // Survives untouched: only the movable state can differ.
    for (const parameterId of Object.keys(after.parameters).sort()) {
      if (before.parameters[parameterId] !== after.parameters[parameterId]) {
        parameters.push({ nodeId, parameterId, value: after.parameters[parameterId] });
      }
    }
    if (before.bypass !== after.bypass) bypass.push({ nodeId, bypass: after.bypass });
    if (before.wet !== after.wet) wet.push({ nodeId, wet: after.wet });
  }

  for (const nodeId of Object.keys(previous.nodes).sort()) {
    if (!next.nodes[nodeId]) removed.push(nodeId);
  }

  // A rebuilt or removed node's cables have to be re-made even when the edge
  // itself is unchanged, because the node on one end is a different object.
  const unstable = new Set([...rebuilt.map((node) => node.nodeId), ...removed]);
  const touches = (connection: AudioConnection) =>
    unstable.has(connection.from.nodeId) || unstable.has(connection.to.nodeId);

  const beforeConnections = new Map(previous.connections.map((c) => [connectionKey(c), c]));
  const afterConnections = new Map(next.connections.map((c) => [connectionKey(c), c]));

  const connected: AudioConnection[] = [];
  const disconnected: AudioConnection[] = [];
  for (const [key, connection] of afterConnections) {
    if (!beforeConnections.has(key) || touches(connection)) connected.push(connection);
  }
  for (const [key, connection] of beforeConnections) {
    // A removed node's connections die with it; disconnecting them separately
    // would be a no-op at best and a double-disconnect at worst.
    if (removed.includes(connection.from.nodeId) || removed.includes(connection.to.nodeId)) continue;
    if (!afterConnections.has(key) || touches(connection)) disconnected.push(connection);
  }

  return { added, removed, rebuilt, connected, disconnected, parameters, bypass, wet };
}

/**
 * Whether a diff changes the graph's shape.
 *
 * The property worth asserting in tests: this is false for every edit that only
 * moved a control.
 */
export const isTopologyChange = (diff: AudioPlanDiff): boolean =>
  diff.added.length > 0 ||
  diff.removed.length > 0 ||
  diff.rebuilt.length > 0 ||
  diff.connected.length > 0 ||
  diff.disconnected.length > 0;

/** Whether a diff does nothing at all. */
export const isEmptyDiff = (diff: AudioPlanDiff): boolean =>
  !isTopologyChange(diff) &&
  diff.parameters.length === 0 &&
  diff.bypass.length === 0 &&
  diff.wet.length === 0;
