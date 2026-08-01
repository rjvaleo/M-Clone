export type SchedulerHandle = unknown;

export interface ClockDriver {
  nowSec(): number;
}

export interface SchedulerDriver {
  repeat(callback: () => void, intervalMs: number): SchedulerHandle;
  once(callback: () => void, delayMs: number): SchedulerHandle;
  cancel(handle: SchedulerHandle): void;
}

export const browserScheduler: SchedulerDriver = {
  repeat: (callback, intervalMs) => setInterval(callback, intervalMs),
  once: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => {
    clearInterval(handle as ReturnType<typeof setInterval>);
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export type SchedulingConfig = {
  baseLookaheadSec: number;
  minLookaheadSec: number;
  maxLookaheadSec: number;
  seriousStallSec: number;
};

export type SchedulingDiagnostics = {
  wakeCount: number;
  maxWakeLatenessSec: number;
  minSubmissionLeadSec: number | null;
  maxEventLatenessSec: number;
  maxQueueDepth: number;
  droppedWindows: number;
  droppedEvents: number;
  recoveries: number;
  lookaheadSec: number;
};

const DEFAULT_CONFIG: SchedulingConfig = {
  baseLookaheadSec: 0.12,
  minLookaheadSec: 0.08,
  maxLookaheadSec: 0.25,
  seriousStallSec: 0.4,
};

/** Pure measurements and bounded policy decisions for an adapter scheduler. */
export class SchedulingMonitor {
  private config: SchedulingConfig;
  private diagnostics: SchedulingDiagnostics;

  constructor(config: Partial<SchedulingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.diagnostics = {
      wakeCount: 0,
      maxWakeLatenessSec: 0,
      minSubmissionLeadSec: null,
      maxEventLatenessSec: 0,
      maxQueueDepth: 0,
      droppedWindows: 0,
      droppedEvents: 0,
      recoveries: 0,
      lookaheadSec: this.config.baseLookaheadSec,
    };
  }

  observeWake(actualSec: number, expectedSec: number, queueDepth: number) {
    const latenessSec = Math.max(0, actualSec - expectedSec);
    const recover = latenessSec >= this.config.seriousStallSec;
    const adaptive = Math.max(
      this.config.baseLookaheadSec,
      this.config.baseLookaheadSec + latenessSec * 0.5,
    );
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

  observeBatch(events: readonly { atSec: number }[], nowSec: number): void {
    for (const event of events) {
      const lead = event.atSec - nowSec;
      this.diagnostics.minSubmissionLeadSec = this.diagnostics.minSubmissionLeadSec === null
        ? lead
        : Math.min(this.diagnostics.minSubmissionLeadSec, lead);
      this.diagnostics.maxEventLatenessSec = Math.max(
        this.diagnostics.maxEventLatenessSec,
        Math.max(0, -lead),
      );
    }
  }

  snapshot(): SchedulingDiagnostics {
    return { ...this.diagnostics };
  }

  recordRecovery(): void {
    this.diagnostics.droppedWindows += 1;
    this.diagnostics.recoveries += 1;
  }

  recordDroppedEvents(count: number): void {
    this.diagnostics.droppedEvents += Math.max(0, Math.round(count));
  }
}

/** Never replay stale attacks; releases and state changes still repair devices. */
export function dropLateAttacks<T extends { type: string; atSec: number }>(
  events: readonly T[],
  nowSec: number,
  graceSec: number,
): { events: T[]; dropped: number } {
  const cutoff = nowSec - Math.max(0, graceSec);
  const kept = events.filter((event) => event.type !== "note-on" || event.atSec >= cutoff);
  return { events: kept, dropped: events.length - kept.length };
}
