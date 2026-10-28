// Which knobs an LFO can move. Apart from modulation.ts because it reads the
// registry, which itself imports the LFO's descriptor from there.

import { hasAudioPorts } from "./audio/compileAudioPlan";
import { AUDIO_STRUCTURE_PARAMS } from "./registry/audioModules";
import { PLAYER_STRUCTURE_PARAMS } from "./registry/playerModules";
import { PRISM_STRUCTURE_PARAMS } from "./registry/prismModules";
import { moduleRegistry } from "./registry/registry";

/**
 * Whether an LFO can move a knob: a number on a module the audio plan carries,
 * that the plan carries as a value rather than as structure.
 */
export function isMappable(moduleType: string, parameterId: string): boolean {
  if (!hasAudioPorts(moduleRegistry, moduleType)) return false;
  const parameter = moduleRegistry.get(moduleType)?.parameters.find((p) => p.id === parameterId);
  if (parameter?.kind !== "number" || parameter.minimum === undefined || parameter.maximum === undefined) return false;
  const structural = [
    ...(AUDIO_STRUCTURE_PARAMS[moduleType] ?? []),
    ...(PLAYER_STRUCTURE_PARAMS[moduleType] ?? []),
    ...(PRISM_STRUCTURE_PARAMS[moduleType] ?? []),
  ];
  return !structural.includes(parameterId) && parameterId !== "mix" && parameterId !== "mute";
}
