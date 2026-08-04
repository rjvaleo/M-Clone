// Voices are pooled, never built per note.
//
// The obvious way to play a note in Web Audio is to construct an oscillator and
// a gain, wire them up, start them and let `onended` drop them. It works, and
// it is what the AV prototype did. It also allocates a small object graph for
// every note, every grain and every drum hit, which at modular densities is a
// steady stream of garbage — and GC pauses in an audio application are heard as
// timing jitter, the same failure the event runtime was built to avoid.
//
// So instruments take a voice from a pool, and the pool never grows past its
// capacity. When every voice is busy, the oldest is stolen rather than a new
// one created: a voice count is a musical decision the user can see, and
// silently exceeding it to avoid a stolen note is how a patch ends up with
// hundreds of live oscillators.

export type VoiceId = number;

export interface PooledVoice {
  /** Return the voice to its resting state. Called before every reuse. */
  reset(): void;
  /** Release resources. Called only when the pool itself is disposed. */
  dispose(): void;
}

export type VoiceLease<V> = {
  id: VoiceId;
  voice: V;
  /** When this lease was taken, for stealing the oldest. */
  startedAtSec: number;
};

export type VoicePoolOptions<V> = {
  capacity: number;
  create: () => V;
  /** Told when a sounding voice is taken away, so it can be released cleanly. */
  onSteal?: (lease: VoiceLease<V>) => void;
};

/**
 * A fixed-capacity pool of reusable voices.
 *
 * Construction happens lazily up to the capacity and then never again, so
 * `constructed` settling below `capacity` is the property a test asserts to
 * prove the steady state allocates nothing.
 */
export class VoicePool<V extends PooledVoice> {
  private readonly capacity: number;
  private readonly create: () => V;
  private readonly onSteal?: (lease: VoiceLease<V>) => void;

  private readonly idle: V[] = [];
  private readonly active = new Map<VoiceId, VoiceLease<V>>();
  private constructedCount = 0;
  private stolenCount = 0;
  private nextId: VoiceId = 1;

  constructor(options: VoicePoolOptions<V>) {
    this.capacity = Math.max(1, Math.floor(options.capacity));
    this.create = options.create;
    this.onSteal = options.onSteal;
  }

  get size(): number {
    return this.capacity;
  }

  get activeCount(): number {
    return this.active.size;
  }

  get idleCount(): number {
    return this.idle.length;
  }

  /** Voices ever constructed. Never exceeds capacity. */
  get constructed(): number {
    return this.constructedCount;
  }

  /** Notes cut short because every voice was busy. */
  get stolen(): number {
    return this.stolenCount;
  }

  /**
   * Take a voice.
   *
   * Prefers an idle one, then builds one if the pool has not reached capacity,
   * and only then steals the longest-sounding voice.
   */
  acquire(atSec: number): VoiceLease<V> {
    const reused = this.idle.pop();
    if (reused) return this.lease(reused, atSec);

    if (this.constructedCount < this.capacity) {
      this.constructedCount += 1;
      return this.lease(this.create(), atSec);
    }

    // Everything is busy: the oldest note yields, because it is the one closest
    // to being over and the least likely to be missed.
    let oldest: VoiceLease<V> | null = null;
    for (const lease of this.active.values()) {
      if (!oldest || lease.startedAtSec < oldest.startedAtSec) oldest = lease;
    }
    if (!oldest) {
      // Capacity reached but nothing active and nothing idle can only happen if
      // a caller dropped a lease without releasing it; rebuild rather than fail.
      this.constructedCount += 1;
      return this.lease(this.create(), atSec);
    }
    this.stolenCount += 1;
    this.onSteal?.(oldest);
    this.active.delete(oldest.id);
    return this.lease(oldest.voice, atSec);
  }

  /** Give a voice back. Releasing twice, or releasing a stranger, is harmless. */
  release(id: VoiceId): void {
    const lease = this.active.get(id);
    if (!lease) return;
    this.active.delete(id);
    lease.voice.reset();
    this.idle.push(lease.voice);
  }

  /** Every voice currently sounding, oldest first. */
  activeLeases(): VoiceLease<V>[] {
    return [...this.active.values()].sort((a, b) => a.startedAtSec - b.startedAtSec);
  }

  /** Return everything to idle without disposing, for stop and panic. */
  releaseAll(): void {
    for (const id of [...this.active.keys()]) this.release(id);
  }

  dispose(): void {
    this.releaseAll();
    for (const voice of this.idle) voice.dispose();
    this.idle.length = 0;
    this.constructedCount = 0;
  }

  private lease(voice: V, atSec: number): VoiceLease<V> {
    voice.reset();
    const lease: VoiceLease<V> = { id: this.nextId++, voice, startedAtSec: atSec };
    this.active.set(lease.id, lease);
    return lease;
  }
}
