// Scheduling policy and bounded telemetry.
//
// The lookahead policy is carried over from the Classic engine, which got this
// part right: measure how late each wake actually was, grow the lookahead to
// absorb it, and never replay a stale attack after a stall. Two things change
// for Modular:
//
//   - the lookahead ceiling is higher, because an off-main-thread clock makes
//     a long window cheap while the canvas UI makes jank far more likely;
//   - a per-window event budget bounds what a user-authored graph can emit, so
//     a runaway generator degrades one node instead of freezing the tab.
//
// Telemetry back to the UI goes through a bounded ring that overwrites its
// oldest entries. Reporting is lossy by design and must never be able to
// back-pressure the scheduler.

export type SchedulingConfig = {
  baseLookaheadSec: number;
  minLookaheadSec: number;
  maxLookaheadSec: number;
  seriousStallSec: number;
  /** Events one window may schedule before the graph is treated as runaway. */
  eventBudgetPerWindow: number;
};

export type SchedulingDiagnostics = {
  wakeCount: number;
  maxWakeLatenessSec: number;
  minSubmissionLeadSec: number | null;
  maxEventLatenessSec: number;
  maxQueueDepth: number;
  droppedWindows: number;
  droppedEvents: number;
  budgetOverruns: number;
  recoveries: number;
  lookaheadSec: number;
};

export const DEFAULT_SCHEDULING_CONFIG: SchedulingConfig = {
  baseLookaheadSec: 0.12,
  minLookaheadSec: 0.08,
  // Higher than Classic's 0.25: a worklet-driven wake makes a long window
  // cheap, and a heavy canvas repaint can stall the main thread for longer
  // than a quarter second.
  maxLookaheadSec: 0.5,
  seriousStallSec: 0.4,
  eventBudgetPerWindow: 4096,
};

const emptyDiagnostics = (lookaheadSec: number): SchedulingDiagnostics => ({
  wakeCount: 0,
  maxWakeLatenessSec: 0,
  minSubmissionLeadSec: null,
  maxEventLatenessSec: 0,
  maxQueueDepth: 0,
  droppedWindows: 0,
  droppedEvents: 0,
  budgetOverruns: 0,
  recoveries: 0,
  lookaheadSec,
});

/** Pure measurements and bounded policy decisions for the runtime scheduler. */
export class SchedulingMonitor {
  private readonly config: SchedulingConfig;
  private diagnostics: SchedulingDiagnostics;

  constructor(config: Partial<SchedulingConfig> = {}) {
    this.config = { ...DEFAULT_SCHEDULING_CONFIG, ...config };
    this.diagnostics = emptyDiagnostics(this.config.baseLookaheadSec);
  }

  get eventBudget(): number {
    return this.config.eventBudgetPerWindow;
  }

  observeWake(
    actualSec: number,
    expectedSec: number,
    queueDepth: number,
  ): { recover: boolean; latenessSec: number; lookaheadSec: number } {
    const latenessSec = Math.max(0, actualSec - expectedSec);
    const recover = latenessSec >= this.config.seriousStallSec;
    const adaptive = this.config.baseLookaheadSec + latenessSec * 0.5;
    this.diagnostics.wakeCount += 1;
    this.diagnostics.maxWakeLatenessSec = Math.max(
      this.diagnostics.maxWakeLatenessSec,
      latenessSec,
    );
    this.diagnostics.maxQueueDepth = Math.max(this.diagnostics.maxQueueDepth, queueDepth);
    this.diagnostics.lookaheadSec = Math.max(
      this.config.minLookaheadSec,
      Math.min(this.config.maxLookaheadSec, adaptive),
    );
    if (recover) {
      this.diagnostics.droppedWindows += 1;
      this.diagnostics.recoveries += 1;
    }
    return { recover, latenessSec, lookaheadSec: this.diagnostics.lookaheadSec };
  }

  /**
   * `count` bounds the live portion of a reused buffer, so the caller never
   * has to slice one on the scheduling path just to measure it.
   */
  observeBatch(
    events: readonly { atSec: number }[],
    nowSec: number,
    count = events.length,
  ): void {
    for (let i = 0; i < count; i++) {
      const lead = events[i].atSec - nowSec;
      this.diagnostics.minSubmissionLeadSec =
        this.diagnostics.minSubmissionLeadSec === null
          ? lead
          : Math.min(this.diagnostics.minSubmissionLeadSec, lead);
      this.diagnostics.maxEventLatenessSec = Math.max(
        this.diagnostics.maxEventLatenessSec,
        Math.max(0, -lead),
      );
    }
  }

  recordRecovery(): void {
    this.diagnostics.droppedWindows += 1;
    this.diagnostics.recoveries += 1;
  }

  recordDroppedEvents(count: number): void {
    this.diagnostics.droppedEvents += Math.max(0, Math.round(count));
  }

  recordBudgetOverrun(): void {
    this.diagnostics.budgetOverruns += 1;
  }

  snapshot(): SchedulingDiagnostics {
    return { ...this.diagnostics };
  }

  reset(): void {
    this.diagnostics = emptyDiagnostics(this.config.baseLookaheadSec);
  }
}

/**
 * Never replay a stale attack after a stall; releases and state changes still
 * go through, because those repair a device rather than making noise on it.
 */
export function dropLateAttacks<T extends { type: string; atSec: number }>(
  events: readonly T[],
  nowSec: number,
  graceSec: number,
): { events: T[]; dropped: number } {
  const cutoff = nowSec - Math.max(0, graceSec);
  const kept = events.filter((event) => event.type !== "note-on" || event.atSec >= cutoff);
  return { events: kept, dropped: events.length - kept.length };
}

/**
 * A fixed-capacity ring that overwrites its oldest entries.
 *
 * The runtime writes to it from the scheduling path and the UI drains it once
 * per animation frame. Because it never grows and never blocks, a slow or
 * suspended UI costs the scheduler nothing but discarded history.
 */
export class TelemetryRing<T> {
  private readonly slots: (T | undefined)[];
  private writeIndex = 0;
  private count = 0;
  private droppedCount = 0;

  constructor(capacity = 1024) {
    this.slots = new Array<T | undefined>(Math.max(1, Math.floor(capacity)));
  }

  get capacity(): number {
    return this.slots.length;
  }

  /** Entries currently buffered. */
  get size(): number {
    return this.count;
  }

  /** Entries lost to overwriting since the last `resetDropped`. */
  get dropped(): number {
    return this.droppedCount;
  }

  push(value: T): void {
    if (this.count === this.slots.length) this.droppedCount += 1;
    else this.count += 1;
    this.slots[this.writeIndex] = value;
    this.writeIndex = (this.writeIndex + 1) % this.slots.length;
  }

  /** Take everything buffered, oldest first, and empty the ring. */
  drain(): T[] {
    const out: T[] = new Array(this.count);
    const start = (this.writeIndex - this.count + this.slots.length) % this.slots.length;
    for (let i = 0; i < this.count; i++) {
      out[i] = this.slots[(start + i) % this.slots.length] as T;
      this.slots[(start + i) % this.slots.length] = undefined;
    }
    this.count = 0;
    return out;
  }

  resetDropped(): void {
    this.droppedCount = 0;
  }

  clear(): void {
    this.slots.fill(undefined);
    this.writeIndex = 0;
    this.count = 0;
    this.droppedCount = 0;
  }
}
