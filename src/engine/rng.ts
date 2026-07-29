// Seedable, deterministic randomness for M-Clone's generative engine.
//
// M's "alive" feel does not come from flat uniform noise. This module provides
// the building blocks we tune toward that feel:
//   - a deterministic uniform source (reproducible performances),
//   - no-immediate-repeat selection ("weighted with memory"),
//   - a Brownian / 1-f-ish walk that wanders smoothly yet still surprises.

/** mulberry32 — a small, fast, well-distributed seeded PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private rand: () => number;

  constructor(seed: number) {
    this.rand = mulberry32(seed >>> 0);
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.rand();
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** True with probability p (clamped to [0,1]). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniformly pick an element of a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /**
   * Pick an index in [0, n) while never returning `avoid` (unless it's the
   * only option). This is the "no immediate repeats" rule that keeps
   * randomness feeling intentional rather than jittery.
   */
  pickIndexAvoiding(n: number, avoid: number): number {
    if (n <= 1) return 0;
    const candidates: number[] = [];
    for (let i = 0; i < n; i++) {
      if (i !== avoid) candidates.push(i);
    }
    return candidates[this.int(candidates.length)];
  }
}

/**
 * A reflecting random walk in [0, 1]. Successive values move by at most
 * `stepSize`, producing smooth-but-unpredictable contours — the texture
 * behind M's "musical" randomness.
 */
export class BrownianWalk {
  value: number;
  private rng: Rng;
  private stepSize: number;

  constructor(rng: Rng, value = 0.5, stepSize = 0.15) {
    this.rng = rng;
    this.value = value;
    this.stepSize = stepSize;
  }

  next(): number {
    const delta = (this.rng.next() * 2 - 1) * this.stepSize;
    let v = this.value + delta;
    if (v > 1) v = 2 - v; // reflect off the top
    if (v < 0) v = -v; // reflect off the bottom
    v = Math.max(0, Math.min(1, v));
    this.value = v;
    return v;
  }
}
