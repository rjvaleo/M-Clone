import { describe, expect, it, vi } from "vitest";
import { transferSample, type SampleTransferExports } from "./sampleTransfer";

/**
 * A fake engine with real linear memory, so the thing under test is the actual
 * pointer arithmetic rather than a mock of it.
 *
 * `growOnAlloc` reproduces the trap this module exists for: WASM grows its
 * memory during the allocation, which detaches every view the host already
 * held.
 */
class FakeEngine implements SampleTransferExports {
  memory = { buffer: new ArrayBuffer(4096) };
  private lens = new Map<number, number>();
  private ptrs = new Map<number, number>();
  private next = 64;
  allocCalls: unknown[][] = [];
  freed: number[] = [];
  growOnAlloc = false;

  sample_alloc(id: number, channels: number, frames: number, rate: number): number {
    this.allocCalls.push([id, channels, frames, rate]);
    if (channels === 0 || frames === 0 || rate <= 0) return 0;
    if (this.growOnAlloc) this.memory = { buffer: new ArrayBuffer(16384) };
    const length = channels * frames;
    this.ptrs.set(id, this.next);
    this.lens.set(id, length);
    this.next += length * 4;
    return 1;
  }

  sample_ptr(id: number): number {
    return this.ptrs.get(id) ?? 0;
  }

  sample_len(id: number): number {
    return this.lens.get(id) ?? 0;
  }

  sample_free(id: number): void {
    this.freed.push(id);
    this.ptrs.delete(id);
    this.lens.delete(id);
  }

  /** What actually landed in linear memory, for assertions. */
  readBack(id: number): Float32Array {
    return new Float32Array(this.memory.buffer, this.sample_ptr(id), this.sample_len(id));
  }
}

const channel = (values: number[]) => Float32Array.from(values);

describe("transferSample", () => {
  it("allocates with the buffer's own shape and rate", () => {
    const engine = new FakeEngine();
    transferSample(engine, 3, { channels: [channel([1, 2]), channel([3, 4])], sampleRate: 44100 });
    expect(engine.allocCalls).toEqual([[3, 2, 2, 44100]]);
  });

  it("writes the audio channel-major, matching the bank's layout", () => {
    const engine = new FakeEngine();
    transferSample(engine, 0, {
      channels: [channel([1, 2, 3]), channel([4, 5, 6])],
      sampleRate: 48000,
    });
    expect([...engine.readBack(0)]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("survives WASM growing its memory during the allocation", () => {
    // The bug this module is shaped around. Allocating megabytes of audio is
    // exactly what makes linear memory grow, which detaches the view the host
    // was about to write through — so the view has to be taken *after* the
    // allocation, never before.
    const engine = new FakeEngine();
    engine.growOnAlloc = true;
    const written = transferSample(engine, 0, {
      channels: [channel([1, 2, 3, 4])],
      sampleRate: 48000,
    });
    expect(written).toBe(true);
    expect([...engine.readBack(0)]).toEqual([1, 2, 3, 4]);
  });

  it("reports failure when the engine refuses the allocation", () => {
    const engine = new FakeEngine();
    expect(transferSample(engine, 0, { channels: [], sampleRate: 48000 })).toBe(false);
    expect(transferSample(engine, 0, { channels: [channel([])], sampleRate: 48000 })).toBe(false);
  });

  it("refuses a null pointer rather than writing to address zero", () => {
    // sample_ptr returns null for an id holding nothing. Writing there is not
    // a recoverable mistake, so it is checked rather than trusted.
    const engine = new FakeEngine();
    engine.sample_ptr = () => 0;
    expect(transferSample(engine, 0, { channels: [channel([1])], sampleRate: 48000 })).toBe(false);
  });

  it("refuses when the engine's room does not match what was asked for", () => {
    // A length mismatch means the two sides disagree about the shape, and
    // writing anyway would run off the end of the allocation.
    const engine = new FakeEngine();
    const realLen = engine.sample_len.bind(engine);
    engine.sample_len = (id: number) => realLen(id) - 1;
    expect(transferSample(engine, 0, { channels: [channel([1, 2])], sampleRate: 48000 })).toBe(false);
  });

  it("frees the slot when a transfer is abandoned, so nothing half-written plays", () => {
    const engine = new FakeEngine();
    engine.sample_ptr = () => 0;
    transferSample(engine, 4, { channels: [channel([1])], sampleRate: 48000 });
    expect(engine.freed).toContain(4);
  });

  it("pads a short channel rather than reading past its end", () => {
    // Decoders occasionally hand back channels of unequal length. The bank's
    // shape is one rectangle, so the short one is padded with silence.
    const engine = new FakeEngine();
    transferSample(engine, 0, {
      channels: [channel([1, 2, 3]), channel([4])],
      sampleRate: 48000,
    });
    expect([...engine.readBack(0)]).toEqual([1, 2, 3, 4, 0, 0]);
  });

  it("sizes the allocation from the longest channel", () => {
    const engine = new FakeEngine();
    transferSample(engine, 0, { channels: [channel([1]), channel([1, 2, 3])], sampleRate: 48000 });
    expect(engine.allocCalls[0]).toEqual([0, 2, 3, 48000]);
  });

  it("rejects a rate that is not a real rate", () => {
    const engine = new FakeEngine();
    const bad = vi.fn();
    engine.sample_alloc = bad as never;
    expect(transferSample(engine, 0, { channels: [channel([1])], sampleRate: 0 })).toBe(false);
    expect(transferSample(engine, 0, { channels: [channel([1])], sampleRate: Number.NaN })).toBe(false);
    expect(bad).not.toHaveBeenCalled();
  });
});
