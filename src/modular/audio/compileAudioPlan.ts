// The audio half of compilation.
//
// `compileGraph` deliberately ignores audio edges — an audio cable is a
// topology fact, not an evaluation dependency, and mixing the two would make
// the event order depend on where a reverb was patched. This is the other half:
// the same document read for the audio subgraph alone.
//
// Two decisions are made here and nowhere else.
//
// **What is audible.** Only what reaches an Audio Output. A module wired to
// nothing is built and running but connected to no destination, so a half-
// finished patch is silent rather than surprising. `compileAudioPlan` does not
// prune it — pruning would make a knob move on an unconnected reverb rebuild
// the graph the moment it was finally patched — but the engine only routes
// Audio Outputs to the master chain.
//
// **What is movable.** Every parameter is sorted into `structure` or
// `parameters` using the registry's declaration, which is what makes "a knob
// move never rebuilds topology" a property of the compiler rather than a habit
// of whoever wrote the module.

import type { GraphDocument, JsonValue } from "../model/graph";
import type { ModuleRegistry } from "../registry/registry";
import {
  AUDIO_MIX_PARAM,
  AUDIO_MUTE_PARAM,
  AUDIO_STRUCTURE_PARAMS,
} from "../registry/audioModules";
import { PLAYER_STRUCTURE_PARAMS } from "../registry/playerModules";
import type { AudioConnection, AudioNodeSpec, AudioPlan } from "./audioPlan";

export const AUDIO_OUTPUT_MODULE = "m.audio-output";

/** A module belongs to the audio graph if it carries any audio port at all. */
export function hasAudioPorts(registry: ModuleRegistry, moduleType: string): boolean {
  const descriptor = registry.get(moduleType);
  return descriptor?.ports.some((port) => port.signal.kind === "audio") ?? false;
}

export type CompileAudioOptions = {
  generation?: number;
};

/**
 * Read the audio subgraph out of an edited document.
 *
 * Disabled nodes and disabled edges are simply absent, which is what makes
 * disabling a module a real silence rather than a muted one: the node is
 * removed from the plan, and the adapter fades it out and disposes it.
 */
export function compileAudioPlan(
  graph: GraphDocument,
  registry: ModuleRegistry,
  options: CompileAudioOptions = {},
): AudioPlan {
  const nodes: Record<string, AudioNodeSpec> = {};

  // Sorted so two equal documents always compile to the same plan, and a diff
  // between them is empty rather than merely equivalent.
  for (const nodeId of Object.keys(graph.nodes).sort()) {
    const node = graph.nodes[nodeId];
    if (!node.enabled) continue;
    const descriptor = registry.get(node.moduleType);
    if (!descriptor || !hasAudioPorts(registry, node.moduleType)) continue;

    const structuralIds = new Set([
      ...(AUDIO_STRUCTURE_PARAMS[node.moduleType] ?? []),
      ...(PLAYER_STRUCTURE_PARAMS[node.moduleType] ?? []),
    ]);
    const structure: Record<string, JsonValue> = {};
    const parameters: Record<string, number> = {};

    for (const parameter of descriptor.parameters) {
      const value = node.parameters[parameter.id] ?? parameter.defaultValue;
      if (parameter.id === AUDIO_MIX_PARAM || parameter.id === AUDIO_MUTE_PARAM) continue;
      if (structuralIds.has(parameter.id)) {
        structure[parameter.id] = value as JsonValue;
        continue;
      }
      // Anything that is not a number cannot be an AudioParam, so it cannot be
      // ramped; declaring it movable would be a promise the audio layer breaks.
      if (typeof value === "number" && Number.isFinite(value)) parameters[parameter.id] = value;
      // A boolean is a number with two settings. Carrying it here rather than
      // in `structure` is what keeps a checkbox — freeze, reverse, loop — from
      // rebuilding a subgraph and cutting off whatever was sounding.
      else if (typeof value === "boolean") parameters[parameter.id] = value ? 1 : 0;
    }

    nodes[nodeId] = {
      nodeId,
      moduleType: node.moduleType,
      structure,
      parameters,
      bypass: node.parameters[AUDIO_MUTE_PARAM] === true,
      wet: numberOr(node.parameters[AUDIO_MIX_PARAM], 1),
    };
  }

  const connections: AudioConnection[] = [];
  for (const edgeId of Object.keys(graph.edges).sort()) {
    const edge = graph.edges[edgeId];
    if (!edge.enabled) continue;
    if (!nodes[edge.from.nodeId] || !nodes[edge.to.nodeId]) continue;
    const fromDescriptor = registry.get(graph.nodes[edge.from.nodeId].moduleType);
    const port = fromDescriptor?.ports.find((candidate) => candidate.id === edge.from.portId);
    if (port?.signal.kind !== "audio") continue;
    connections.push({ from: { ...edge.from }, to: { ...edge.to } });
  }

  return { generation: options.generation ?? 0, nodes, connections };
}

/** Node ids that reach the speakers, in document order. */
export const audioOutputNodeIds = (plan: AudioPlan): string[] =>
  Object.keys(plan.nodes)
    .filter((nodeId) => plan.nodes[nodeId].moduleType === AUDIO_OUTPUT_MODULE)
    .sort();

function numberOr(value: JsonValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
