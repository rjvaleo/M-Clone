import { describe, expect, it } from "vitest";
import { VoicePool, type PooledVoice, type VoiceLease } from "./voicePool";

class FakeVoice implements PooledVoice {
  resets = 0;
  disposed = false;
  constructor(readonly serial: number) {}
  reset() { this.resets += 1; }
  dispose() { this.disposed = true; }
}

const pool = (capacity: number, onSteal?: (lease: VoiceLease<FakeVoice>) => void) => {
  let serial = 0;
  const created: FakeVoice[] = [];
  const instance = new VoicePool<FakeVoice>({
    capacity,
    create: () => {
      const voice = new FakeVoice(serial++);
      created.push(voice);
      return voice;
    },
    onSteal,
  });
  return { instance, created };
};

describe("Voice pooling", () => {
  it("builds lazily and never past its capacity", () => {
    // The property that matters: a steady stream of notes stops allocating.
    const { instance, created } = pool(4);
    expect(instance.constructed).toBe(0);
    for (let i = 0; i < 4; i++) instance.acquire(i);
    expect(instance.constructed).toBe(4);

    for (let i = 0; i < 100; i++) instance.acquire(10 + i);
    expect(instance.constructed).toBe(4);
    expect(created).toHaveLength(4);
  });

  it("reuses a released voice rather than building another", () => {
    const { instance } = pool(4);
    const lease = instance.acquire(0);
    instance.release(lease.id);
    expect(instance.idleCount).toBe(1);
    const again = instance.acquire(1);
    expect(again.voice).toBe(lease.voice);
    expect(instance.constructed).toBe(1);
  });

  it("resets a voice before every reuse", () => {
    const { instance } = pool(2);
    const lease = instance.acquire(0);
    expect(lease.voice.resets).toBe(1);
    instance.release(lease.id);
    instance.acquire(1);
    expect(lease.voice.resets).toBe(3); // acquire, release, acquire
  });

  it("steals the oldest note when everything is busy", () => {
    // A voice count is a musical decision; silently exceeding it to avoid a
    // stolen note is how a patch ends up with hundreds of live oscillators.
    const stolen: number[] = [];
    const { instance } = pool(2, (lease) => stolen.push(lease.voice.serial));
    const first = instance.acquire(0);
    instance.acquire(1);

    const third = instance.acquire(2);
    expect(third.voice).toBe(first.voice);
    expect(stolen).toEqual([first.voice.serial]);
    expect(instance.stolen).toBe(1);
    expect(instance.activeCount).toBe(2);
  });

  it("gives every lease a distinct id", () => {
    const { instance } = pool(3);
    const ids = [instance.acquire(0).id, instance.acquire(1).id, instance.acquire(2).id];
    expect(new Set(ids).size).toBe(3);
  });

  it("lists what is sounding, oldest first", () => {
    const { instance } = pool(3);
    instance.acquire(5);
    instance.acquire(1);
    instance.acquire(3);
    expect(instance.activeLeases().map((lease) => lease.startedAtSec)).toEqual([1, 3, 5]);
  });

  it("ignores a release of something it does not hold", () => {
    const { instance } = pool(2);
    const lease = instance.acquire(0);
    instance.release(lease.id);
    instance.release(lease.id);
    instance.release(999);
    expect(instance.idleCount).toBe(1);
    expect(instance.activeCount).toBe(0);
  });

  it("returns everything to idle on stop", () => {
    const { instance } = pool(4);
    for (let i = 0; i < 4; i++) instance.acquire(i);
    instance.releaseAll();
    expect(instance.activeCount).toBe(0);
    expect(instance.idleCount).toBe(4);
    // Reusable straight afterwards, without building anything.
    instance.acquire(10);
    expect(instance.constructed).toBe(4);
  });

  it("disposes every voice it owns", () => {
    const { instance, created } = pool(3);
    for (let i = 0; i < 3; i++) instance.acquire(i);
    instance.dispose();
    expect(created.every((voice) => voice.disposed)).toBe(true);
    expect(instance.idleCount).toBe(0);
    expect(instance.constructed).toBe(0);
  });

  it("insists on at least one voice", () => {
    const { instance } = pool(0);
    expect(instance.size).toBe(1);
    expect(instance.acquire(0)).toBeDefined();
  });

  it("recovers if a caller drops a lease without releasing it", () => {
    const { instance } = pool(1);
    instance.acquire(0);
    // Nothing idle, nothing stealable that the pool still knows about.
    instance.releaseAll();
    expect(() => instance.acquire(1)).not.toThrow();
    expect(instance.activeCount).toBe(1);
  });
});
