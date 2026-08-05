// The processor that hosts the Rust rack on the audio thread.
//
// Bundled separately (`npm run build:worklet`) rather than imported, because an
// `AudioWorklet` runs in its own global scope with no DOM, no `fetch`, and no
// module resolution — `addModule` takes a URL to a self-contained script. That
// is also why `WasmRack` is bundled *into* this file rather than talking to it
// across `postMessage`: every call it makes is a plain function call into WASM,
// and routing those through a message port would put the main thread back in
// the audio path, which is the whole thing this migration exists to end.
//
// What crosses the port is only what has to: a compiled plan going in, and
// later the telemetry stream going out.
//
// This file cannot be unit tested — there is no `AudioWorkletGlobalScope` in
// Node and no way to construct one. It is kept as thin as the shim in
// `rust/wasm/src/lib.rs` for the same reason, and everything with a decision in
// it lives in `engineBridge.ts` next door, which is fully covered.

import { WasmRack, type EngineExports } from "./engineBridge";
// The name and the message shape live in rackProtocol.ts so the main thread can
// import them without importing this file, which registers a processor the
// moment it loads and only exists inside an AudioWorkletGlobalScope.
import { RACK_PROCESSOR_NAME, type RackMessage } from "./rackProtocol";

export { RACK_PROCESSOR_NAME };
export type { RackMessage };

declare const sampleRate: number;
declare const AudioWorkletProcessor: {
  new (): { readonly port: MessagePort };
};
declare function registerProcessor(name: string, processor: unknown): void;

class RackProcessor extends AudioWorkletProcessor {
  private readonly rack: WasmRack;
  /** Set when construction failed; the node then renders silence rather than throwing every quantum. */
  private readonly broken: boolean;

  constructor(options: { processorOptions?: { module?: WebAssembly.Module } }) {
    super();
    const compiled = options.processorOptions?.module;
    // The module arrives already compiled: `WebAssembly.compile` is async and
    // a constructor cannot await, but a `WebAssembly.Module` is structured-
    // cloneable and instantiating one is synchronous and cheap.
    const instance = compiled ? new WebAssembly.Instance(compiled, {}) : null;
    this.broken = instance === null;
    this.rack = instance
      ? new WasmRack(instance.exports as unknown as EngineExports, sampleRate)
      : (null as unknown as WasmRack);

    this.port.onmessage = (event: MessageEvent<RackMessage>) => {
      if (this.broken) return;
      const message = event.data;
      switch (message.type) {
        case "sample":
          // Before any plan that names it: a plan assigning a slot to audio
          // the engine does not hold yet would point a sampler at nothing.
          this.rack.loadSample(message.slot, {
            channels: message.channels,
            sampleRate: message.sampleRate,
          });
          break;
        case "sample-map":
          this.rack.setSampleMap(message.map);
          break;
        case "plan":
          this.rack.update(message.plan);
          break;
        case "reset":
          this.rack.reset();
          break;
        case "note-on":
          this.rack.noteOn(message.note, message.velocity);
          break;
        case "note-off":
          this.rack.noteOff(message.note);
          break;
        case "all-notes-off":
          this.rack.allNotesOff();
          break;
        case "modulation":
          this.rack.setModulation(message.nodeId, message.source, message.dest, message.amount);
          break;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (this.broken) {
      for (const channel of output) channel.fill(0);
      return true;
    }

    // Mono in: the rack's host input is one channel, and summing here rather
    // than downstream keeps the engine's port model honest until `Frame`'s
    // sixteen channels are actually wired through.
    const input = inputs[0];
    if (input && input.length > 0) {
      this.rack.input.set(input[0]);
    } else {
      this.rack.input.fill(0);
    }

    this.rack.process();

    // Same signal to every output channel. Stereo comes with the panner.
    for (const channel of output) channel.set(this.rack.output);
    return true;
  }
}

registerProcessor(RACK_PROCESSOR_NAME, RackProcessor);
