/**
 * Getting the Rust rack onto the audio thread.
 *
 * Three things have to line up before a note can come out of it: the `.wasm`
 * has to be fetched and compiled on the main thread (a worklet constructor
 * cannot await, but a compiled `WebAssembly.Module` is structured-cloneable
 * and instantiating one is synchronous), the worklet bundle has to be
 * registered with `addModule`, and the node has to be built and connected.
 *
 * Any of those can fail on a perfectly reasonable machine — an older browser
 * with no `audioWorklet`, a deployment where `npm run build:engine` never ran,
 * a locked-down context that refuses the module. All of them return `null`
 * here rather than throwing, and the caller falls back to Web Audio. That is
 * the same shape `AudioWorkletSchedulerDriver.create` uses in
 * `runtime/clock.ts`, for the same reason: the fallback works, so failing
 * loudly would trade a working session for a broken one.
 */

import { RACK_PROCESSOR_NAME } from "./rackProtocol";
import { WasmRackNode, type RackNodeLike } from "./rackNode";
// The project's own narrowed node type rather than the DOM's `AudioNode`, so
// the master chain's input — which is an `AudioNodeLike` — can be a
// destination without a cast at the one call site that matters.
import type { AudioNodeLike } from "../graphAdapter";

/** Where `npm run build:wasm` puts the engine, relative to the site root. */
export const DEFAULT_WASM_URL = "/idmlab-engine.wasm";

/** Where `npm run build:worklet` puts the processor bundle. */
export const DEFAULT_WORKLET_URL = "/idmlab-rack.js";

/** The part of an `AudioContext` this needs. Narrow, so tests need no context. */
export interface RackWorkletHost {
  readonly audioWorklet?: { addModule(url: string): Promise<void> };
}

/** A node this can connect and hand to `WasmRackNode`. */
export type ConnectableRackNode = RackNodeLike & {
  connect(destination: AudioNodeLike): void;
};

export interface RackLoadOptions {
  wasmUrl?: string;
  workletUrl?: string;
  /** Injected by tests; defaults to fetch-and-compile. */
  compileModule?: (url: string) => Promise<WebAssembly.Module>;
  /** Injected by tests; defaults to the real `AudioWorkletNode`. */
  createNode?: (module: WebAssembly.Module) => ConnectableRackNode | null;
}

/* v8 ignore start -- fetch and WebAssembly.compile against a real URL; the
   decision this shim sits inside (what to do when it rejects) is covered by
   the "cannot be fetched or compiled" test, which injects a failing stub. */
const fetchAndCompile = async (url: string): Promise<WebAssembly.Module> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return WebAssembly.compile(await response.arrayBuffer());
};
/* v8 ignore stop */

/**
 * Build the real node.
 *
 * Stereo out because the master chain downstream is stereo; the rack currently
 * writes the same signal to both channels, and will write a genuine pair once
 * the panner lands. One input, for the host feed.
 */
/* v8 ignore start -- constructs a real AudioWorkletNode, which needs a real
   AudioContext and a registered processor; neither exists in Node. Every
   branch around it — null return, throw, success — is covered by tests that
   inject a stub in its place. */
const createWorkletNode =
  (context: RackWorkletHost) =>
  (module: WebAssembly.Module): ConnectableRackNode | null => {
    if (typeof AudioWorkletNode === "undefined") return null;
    return new AudioWorkletNode(context as unknown as BaseAudioContext, RACK_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { module },
    }) as unknown as ConnectableRackNode;
  };
/* v8 ignore stop */

/**
 * Load the rack and connect it to `destination`, or return `null` if any part
 * of that is unavailable.
 *
 * `destination` is the master chain's input rather than the context's
 * destination: the limiter on the end of that chain is a safety device, and a
 * backend that routed around it could be louder than the one it replaced.
 */
export async function loadRackNode(
  context: RackWorkletHost,
  destination: AudioNodeLike,
  options: RackLoadOptions = {},
): Promise<WasmRackNode | null> {
  if (!context.audioWorklet) return null;
  try {
    const compile = options.compileModule ?? fetchAndCompile;
    const module = await compile(options.wasmUrl ?? DEFAULT_WASM_URL);
    await context.audioWorklet.addModule(options.workletUrl ?? DEFAULT_WORKLET_URL);
    const node = (options.createNode ?? createWorkletNode(context))(module);
    if (!node) return null;
    node.connect(destination);
    return new WasmRackNode(node);
  } catch {
    return null;
  }
}
