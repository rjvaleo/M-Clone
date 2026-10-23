/**
 * Where the time goes. Each named piece of work — a module type's render, the
 * port measure, the status poll, a drag move — records how long it took; the
 * report ranks them by total time over the last few seconds, so the top row
 * is the thing to optimise first. Frames are recorded too, as gaps between
 * animation frames: a slow frame is one the eye sees as a hitch.
 */

export type PerfRow = { name: string; calls: number; totalMs: number; avgMs: number; maxMs: number };
export type FrameStats = { count: number; slow: number; p95Ms: number; fps: number };

/** A frame longer than this is one the eye catches: two 60Hz frames, nearly. */
export const SLOW_FRAME_MS = 25;

type Sample = { at: number; ms: number };

export class PerfRecorder {
  enabled = true;
  private readonly samples = new Map<string, Sample[]>();
  private frameSamples: Sample[] = [];
  private readonly windowMs: number;
  private readonly clock: () => number;

  constructor({ windowMs = 5000, clock = () => performance.now() }: { windowMs?: number; clock?: () => number } = {}) {
    this.windowMs = windowMs;
    this.clock = clock;
  }

  record(name: string, ms: number): void {
    if (!this.enabled) return;
    const list = this.samples.get(name) ?? [];
    list.push({ at: this.clock(), ms });
    this.samples.set(name, list);
  }

  time<T>(name: string, work: () => T): T {
    if (!this.enabled) return work();
    const start = this.clock();
    try { return work(); } finally { this.record(name, this.clock() - start); }
  }

  frame(gapMs: number): void {
    if (!this.enabled) return;
    this.frameSamples.push({ at: this.clock(), ms: gapMs });
  }

  report(): PerfRow[] {
    const since = this.clock() - this.windowMs;
    const rows: PerfRow[] = [];
    for (const [name, list] of this.samples) {
      const recent = list.filter((s) => s.at >= since);
      this.samples.set(name, recent);
      if (!recent.length) continue;
      const totalMs = recent.reduce((sum, s) => sum + s.ms, 0);
      rows.push({ name, calls: recent.length, totalMs, avgMs: totalMs / recent.length, maxMs: Math.max(...recent.map((s) => s.ms)) });
    }
    return rows.sort((a, b) => b.totalMs - a.totalMs);
  }

  frames(): FrameStats {
    const since = this.clock() - this.windowMs;
    this.frameSamples = this.frameSamples.filter((s) => s.at >= since);
    const gaps = this.frameSamples.map((s) => s.ms).sort((a, b) => a - b);
    const total = gaps.reduce((sum, g) => sum + g, 0);
    return {
      count: gaps.length,
      slow: gaps.filter((g) => g > SLOW_FRAME_MS).length,
      p95Ms: gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.95))] : 0,
      fps: total > 0 ? gaps.length / (total / 1000) : 0,
    };
  }

  clear(): void {
    this.samples.clear();
    this.frameSamples = [];
  }
}

/** The app's one recorder. Off until the performance panel is opened. */
export const perf = new PerfRecorder();
perf.enabled = false;
