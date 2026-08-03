// Counter-based deterministic randomness.
//
// Classic M-Clone gave each voice a sequential PRNG stream consumed in call
// order. That makes the music a function of *how many steps happened to fall
// in each scheduling window* — so a busy machine, a longer lookahead, or a
// recovered stall silently produce a different performance. It also makes the
// golden-trace tests the plan depends on unreproducible in principle.
//
// Here every draw is a pure hash of (project seed, node, stream name, tick,
// draw index). Nothing is carried between draws, so:
//
//   - window boundaries cannot change the result;
//   - a stall, a pause, or a re-plan replays identically;
//   - a node can be evaluated at any tick without replaying the ones before;
//   - golden traces are exact regardless of machine load.

const GOLDEN = 0x9e3779b1;
const UINT32 = 4294967296;

/** Final avalanche mix of a 32-bit word (splitmix-style). */
function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97);
  h ^= h >>> 15;
  return h >>> 0;
}

function combine(a: number, b: number): number {
  return mix32((a ^ Math.imul(b >>> 0, GOLDEN)) >>> 0);
}

/** Stable 32-bit hash of an identifier, so node and stream names can key draws. */
export function hashName(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h);
}

/**
 * The per-stream key. Derived from the project seed and stable identifiers, so
 * moving a node on the canvas or renaming its label cannot change its music,
 * while two instances of the same module still decorrelate.
 */
export function streamKey(seed: number, nodeId: string, stream: string): number {
  return combine(combine(mix32(seed >>> 0), hashName(nodeId)), hashName(stream));
}

/**
 * Raw 32 bits for one draw. Ticks exceed 32 bits over a long performance, so
 * the position is folded as a high/low pair rather than truncated.
 */
export function randomBits(key: number, tick: number, draw: number): number {
  const position = Math.max(0, Math.floor(tick));
  const low = position % UINT32;
  const high = Math.floor(position / UINT32);
  return combine(combine(key, low), combine(high, draw >>> 0));
}

/** Uniform float in [0, 1) for one draw. */
export function randomUnit(key: number, tick: number, draw: number): number {
  return randomBits(key, tick, draw) / UINT32;
}

/**
 * A cursor over the draws belonging to one (stream, tick). It counts draws so
 * call sites read like an ordinary RNG, but the values depend only on the
 * position — re-creating the cursor at the same tick replays it exactly.
 */
export class DrawCursor {
  private readonly key: number;
  private readonly tick: number;
  private draw = 0;

  constructor(key: number, tick: number) {
    this.key = key;
    this.tick = tick;
  }

  /** How many draws have been taken, for trace assertions. */
  get drawCount(): number {
    return this.draw;
  }

  /** Restart at the first draw for this position. */
  rewind(): void {
    this.draw = 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return randomUnit(this.key, this.tick, this.draw++);
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    if (n <= 1) return 0;
    return Math.min(n - 1, Math.floor(this.next() * n));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }

  /** Uniformly pick an element of a non-empty array. */
  pick<T>(values: readonly T[]): T {
    return values[this.int(values.length)];
  }

  /**
   * Pick an index in [0, n) that is never `avoid` unless there is no choice.
   * This is M's "weighted with memory" feel: randomness that reads as
   * intentional rather than jittery.
   */
  pickAvoiding(n: number, avoid: number): number {
    if (n <= 1) return 0;
    if (avoid < 0 || avoid >= n) return this.int(n);
    const picked = this.int(n - 1);
    return picked >= avoid ? picked + 1 : picked;
  }
}

/**
 * A reflecting random walk indexed by step number.
 *
 * A walk is genuinely sequential, so it keeps state — but the state advances
 * exactly once per step index and each increment draws from the counter-based
 * source, so the value at step k is the same however the steps were batched
 * into scheduling windows. `advanceTo` can also replay from any earlier point,
 * which is what makes stall recovery and re-plan reproducible.
 */
export class DeterministicWalk {
  private readonly key: number;
  private readonly stepSize: number;
  private readonly start: number;
  private index = 0;
  private current: number;

  constructor(key: number, start = 0.5, stepSize = 0.15) {
    this.key = key;
    this.start = clampUnit(start);
    this.stepSize = Math.max(0, stepSize);
    this.current = this.start;
  }

  get value(): number {
    return this.current;
  }

  get stepIndex(): number {
    return this.index;
  }

  /** Advance (or replay from the beginning) to a given step index. */
  advanceTo(stepIndex: number): number {
    const target = Math.max(0, Math.floor(stepIndex));
    if (target < this.index) {
      this.index = 0;
      this.current = this.start;
    }
    while (this.index < target) {
      this.index += 1;
      const delta = (randomUnit(this.key, this.index, 0) * 2 - 1) * this.stepSize;
      this.current = reflectUnit(this.current + delta);
    }
    return this.current;
  }
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function reflectUnit(value: number): number {
  let v = value;
  if (v > 1) v = 2 - v;
  if (v < 0) v = -v;
  return clampUnit(v);
}
