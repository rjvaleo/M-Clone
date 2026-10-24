// Modulators: modules with no audio of their own that move other modules'
// knobs. See ../modulation.ts for how a mapping works.

import type { ModuleDescriptor } from "../model/graph";
import { LFO_COLORS, LFO_SHAPES, LFO_TYPE } from "../modulation";
import { custom, defineModule, enumParam, jsonParam, numberParam, param, section } from "./descriptorKit";

const LFO = defineModule({
  type: LFO_TYPE,
  label: "LFO",
  family: "control",
  colorToken: "audio",
  ports: [],
  parameters: [
    numberParam("rate", "Rate", 1, 0.01, 20, 0.01, "Hz"),
    enumParam("shape", "Shape", LFO_SHAPES, "Sine"),
    // The amount sits beside the LFO and scales everything it moves.
    numberParam("amount", "Amount", 0.5, 0, 1, 0.01),
    numberParam("phase", "Phase", 0, 0, 360, 1, "°"),
    enumParam("color", "Colour", LFO_COLORS.map((c) => c.name), LFO_COLORS[0].name),
    jsonParam("targets", "Mapped to", []),
  ],
  face: [
    section("lfo", "LFO", [
      custom("lfo-map", "Map", ["color", "targets"]),
      param("rate"),
      param("shape"),
      param("amount"),
      param("phase"),
    ]),
  ],
});

export const MODULATOR_MODULES: ModuleDescriptor[] = [LFO];

/** The modulators the audio plan carries, so the engine can build them. */
export const MODULATOR_TYPES: ReadonlySet<string> = new Set([LFO_TYPE]);
