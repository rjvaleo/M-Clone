// Single shared runtime instance, bound to the live store so the engine always
// reads current project state (that's what makes live tweaking work).

import { MRuntime } from "../engine/runtime";
import { useM } from "../state/store";

let runtime: MRuntime | null = null;

export function getRuntime(): MRuntime {
  if (!runtime) {
    runtime = new MRuntime(
      () => useM.getState().project,
      (notes) => useM.getState().recordMidiNotes(notes),
    );
  }
  runtime.setSynthSettings(useM.getState().synthSettings);
  return runtime;
}
