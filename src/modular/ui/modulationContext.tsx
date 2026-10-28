// What the faces need to know about LFO mappings, as a context: which LFO is
// waiting for a knob, and which LFOs move each knob. Only the knobs and the LFO
// faces read it, so starting a mapping re-renders those and not the modules
// around them.

import { createContext, useContext } from "react";
import type { Mapping, ModTarget } from "../modulation";

export type ModulationApi = {
  /** The LFO whose Map button is on, waiting for a knob to be clicked. */
  mappingFrom: string | null;
  /** Every mapped knob, by `targetKey`. */
  mappings: ReadonlyMap<string, readonly Mapping[]>;
  startMap: (lfoNodeId: string) => void;
  cancelMap: () => void;
  /** The knob clicked while an LFO was waiting. */
  finishMap: (target: ModTarget) => void;
  unmap: (lfoNodeId: string, target: ModTarget) => void;
  /** "Delay · Feedback", for an LFO's list of what it moves. */
  describe: (target: ModTarget) => string;
};

const NO_MAPPINGS: ReadonlyMap<string, readonly Mapping[]> = new Map();

export const ModulationContext = createContext<ModulationApi>({
  mappingFrom: null,
  mappings: NO_MAPPINGS,
  startMap: () => {},
  cancelMap: () => {},
  finishMap: () => {},
  unmap: () => {},
  describe: (target) => `${target.nodeId} · ${target.parameterId}`,
});

export const useModulation = (): ModulationApi => useContext(ModulationContext);
