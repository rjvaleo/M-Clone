// The worker that makes the Grain Engine's slow builds.
//
// Bundled separately (`npm run build:worklet`), as the rack worklet is, and as
// thin: everything with a decision in it is `GrainBuilder`, next door, which
// is tested against a fake engine. This only wires it to the port. It also
// enumerates the cloud pad's grains (`buildGrains`). Requests
// are answered one at a time, in order; the module refuses any answer it has
// stopped waiting for, so a slow one landing late does no harm.

import { GrainBuilder, resultTransfers, type BuildExports, type BuilderMessage } from "./grainBuilder";
import type { EngineExports } from "./engineBridge";

declare const self: {
  onmessage: ((event: MessageEvent<BuilderMessage>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

let builder: GrainBuilder | null = null;

self.onmessage = (event) => {
  const message = event.data;
  switch (message.type) {
    case "init": {
      const instance = new WebAssembly.Instance(message.module, {});
      builder = new GrainBuilder(instance.exports as unknown as EngineExports & BuildExports, message.sampleRate);
      break;
    }
    case "sample":
      builder?.loadSample(message.slot, { channels: message.channels, sampleRate: message.sampleRate });
      break;
    case "grains": {
      if (!builder) break;
      const result = builder.grains(message);
      self.postMessage(result, [result.data.buffer]);
      break;
    }
    case "build": {
      if (!builder) break;
      const result = builder.build(message.request);
      self.postMessage(result, resultTransfers(result));
      break;
    }
  }
};
