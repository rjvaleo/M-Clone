/**
 * Getting decoded audio into the engine's own memory.
 *
 * The samplers are the last part of the rack that cannot move to Rust, and
 * this is why: every sample lives in JavaScript as an `AudioBuffer`, which the
 * engine cannot see. Granular processing in particular is a short read from an
 * arbitrary position at an arbitrary rate — thousands of them a second — so it
 * needs the audio *in* WASM linear memory rather than a handle across the
 * boundary.
 *
 * Transfer is two calls rather than one. The engine allocates and hands back a
 * pointer; the host writes straight into it. Passing the audio through the ABI
 * instead would copy megabytes twice — once to hand over, once into the bank.
 *
 * # The trap
 *
 * **Allocating can grow WASM linear memory, and growing it detaches every
 * existing JavaScript view.** Allocating a sample is precisely the operation
 * most likely to grow it. So the `Float32Array` written through must be taken
 * *after* `sample_alloc` returns — a view captured before it is either dead or,
 * worse, pointing at a buffer nothing reads any more. The same hazard already
 * bit `WasmRack`'s own input/output views once; this module is shaped to make
 * it impossible rather than to remember not to do it.
 */

/** The sample half of the engine's exports. */
export interface SampleTransferExports {
  sample_alloc(id: number, channels: number, frames: number, sampleRate: number): number;
  sample_ptr(id: number): number;
  sample_len(id: number): number;
  sample_free(id: number): void;
  readonly memory: { readonly buffer: ArrayBuffer };
}

/** Decoded audio, in the shape an `AudioBuffer` yields it. */
export interface SampleSource {
  /** One `Float32Array` per channel. */
  channels: readonly Float32Array[];
  sampleRate: number;
}

/**
 * Copy `source` into the engine under `id`, replacing anything already there.
 *
 * Returns whether the audio actually landed. A refusal frees the slot rather
 * than leaving a half-written buffer behind: silence is recoverable and a
 * partially-filled sample playing as if it were whole is not.
 */
export function transferSample(
  engine: SampleTransferExports,
  id: number,
  source: SampleSource,
): boolean {
  const { channels, sampleRate } = source;
  if (channels.length === 0) return false;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return false;

  // The longest channel decides the shape. Decoders occasionally return
  // channels of unequal length, and the bank is one rectangle.
  const frames = channels.reduce((longest, channel) => Math.max(longest, channel.length), 0);
  if (frames === 0) return false;

  if (engine.sample_alloc(id, channels.length, frames, sampleRate) !== 1) return false;

  const pointer = engine.sample_ptr(id);
  const length = engine.sample_len(id);
  // Null means the id holds nothing despite the allocation reporting success,
  // and a length disagreement means the two sides have different ideas about
  // the shape. Writing under either would run off the end of the allocation.
  if (pointer === 0 || length !== channels.length * frames) {
    engine.sample_free(id);
    return false;
  }

  // Taken here, after the allocation that may have grown and re-created the
  // backing buffer. See the note at the top of this file.
  const target = new Float32Array(engine.memory.buffer, pointer, length);
  for (let channel = 0; channel < channels.length; channel += 1) {
    // `set` writes only what the source holds, leaving the rest of a short
    // channel's row as the zeroes the engine allocated.
    target.set(channels[channel], channel * frames);
  }
  return true;
}
