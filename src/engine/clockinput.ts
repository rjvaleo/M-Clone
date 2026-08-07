export type ClockRealtimeMessage = 0xf8 | 0xfa | 0xfb | 0xfc;
export type ClockStatus = "locked" | "lost" | "disabled";
export type ClockTransportAction = "start" | "stop" | "continue";

export type ClockInputSettings = {
  enabled: boolean;
  syncRatio: number;
  timeoutMs?: number;
  smoothing?: number;
  jitterTolerance?: number;
};

export type ClockInputDiagnostics = {
  inferredBpm: number;
  clockJitter: number;
  clockStatus: ClockStatus;
  pulseCount: number;
  quarterNotes: number;
  phasePulse: number;
  lostClockCount: number;
  recoveredClockCount: number;
};

export type ClockInputUpdate = {
  transport?: ClockTransportAction;
  inferredTempo?: number;
  diagnostics: ClockInputDiagnostics;
  lostClock: boolean;
  recoveredClock: boolean;
};

const NORMAL_SYNC_RATIO = 4;
const DEFAULT_TIMEOUT_MS = 200;
const DEFAULT_SMOOTHING = 0.25;
const DEFAULT_JITTER_TOLERANCE = 0.15;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function pulseIntervalToBpm(intervalMs: number): number {
  return 60_000 / (Math.max(0.001, intervalMs) * 24);
}

export function decodeClockInputMessage(data: ArrayLike<number>): ClockRealtimeMessage | null {
  const status = data[0];
  return status === 0xf8 || status === 0xfa || status === 0xfb || status === 0xfc
    ? status
    : null;
}

export function mapExternalClockTempo(inferredBpm: number, syncRatio: number): number {
  return Math.max(1, inferredBpm * NORMAL_SYNC_RATIO / Math.max(1, syncRatio));
}

export class ClockInput {
  private lastPulseMs: number | null = null;
  private filteredIntervalMs: number | null = null;
  private jitterMs = 0;
  private pulseCount = 0;
  private quarterNotes = 0;
  private running = false;
  private status: ClockStatus = "disabled";
  private lostClockCount = 0;
  private recoveredClockCount = 0;

  handle(
    message: ClockRealtimeMessage,
    performanceMs: number,
    settings: ClockInputSettings,
  ): ClockInputUpdate {
    if (!settings.enabled) return this.disable();
    if (message === 0xfa) {
      const transport = this.running ? undefined : "start";
      if (!this.running) {
        this.running = true;
        this.pulseCount = 0;
        this.quarterNotes = 0;
        if (this.status === "disabled") this.status = "lost";
      }
      return this.snapshot(settings, { transport });
    }
    if (message === 0xfb) {
      const transport = this.running ? undefined : "continue";
      this.running = true;
      if (this.status === "disabled") this.status = "lost";
      return this.snapshot(settings, { transport });
    }
    if (message === 0xfc) {
      const transport = this.running ? "stop" : undefined;
      this.running = false;
      if (this.status === "locked") this.status = "lost";
      return this.snapshot(settings, { transport });
    }
    return this.handlePulse(performanceMs, settings);
  }

  observeTimeout(performanceMs: number, settings: ClockInputSettings): ClockInputUpdate | null {
    if (!settings.enabled) return null;
    if (this.lastPulseMs === null) return null;
    const timeoutMs = Math.max(1, settings.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (performanceMs - this.lastPulseMs <= timeoutMs || this.status !== "locked") return null;
    this.status = "lost";
    this.lostClockCount += 1;
    return this.snapshot(settings, { lostClock: true });
  }

  disable(): ClockInputUpdate {
    this.lastPulseMs = null;
    this.filteredIntervalMs = null;
    this.jitterMs = 0;
    this.pulseCount = 0;
    this.quarterNotes = 0;
    this.running = false;
    this.status = "disabled";
    return this.snapshot({ enabled: false, syncRatio: NORMAL_SYNC_RATIO });
  }

  diagnostics(): ClockInputDiagnostics {
    return this.snapshot({ enabled: this.status !== "disabled", syncRatio: NORMAL_SYNC_RATIO }).diagnostics;
  }

  private handlePulse(performanceMs: number, settings: ClockInputSettings): ClockInputUpdate {
    let recoveredClock = false;
    if (this.status === "lost") {
      this.status = "locked";
      this.recoveredClockCount += 1;
      recoveredClock = true;
    } else if (this.status === "disabled") this.status = "locked";
    let inferredTempo: number | undefined;
    if (this.lastPulseMs !== null && performanceMs > this.lastPulseMs) {
      const rawIntervalMs = performanceMs - this.lastPulseMs;
      const jitterTolerance = Math.max(0, settings.jitterTolerance ?? DEFAULT_JITTER_TOLERANCE);
      const smoothing = clamp(settings.smoothing ?? DEFAULT_SMOOTHING, 0, 1);
      const boundedIntervalMs = this.filteredIntervalMs === null
        ? rawIntervalMs
        : clamp(
            rawIntervalMs,
            this.filteredIntervalMs * (1 - jitterTolerance),
            this.filteredIntervalMs * (1 + jitterTolerance),
          );
      const previous = this.filteredIntervalMs ?? boundedIntervalMs;
      this.filteredIntervalMs = this.filteredIntervalMs === null
        ? boundedIntervalMs
        : previous + (boundedIntervalMs - previous) * smoothing;
      const skewMs = Math.abs(rawIntervalMs - previous);
      this.jitterMs = this.jitterMs === 0 ? skewMs : this.jitterMs + (skewMs - this.jitterMs) * smoothing;
      inferredTempo = mapExternalClockTempo(pulseIntervalToBpm(this.filteredIntervalMs), settings.syncRatio);
    }
    this.lastPulseMs = performanceMs;
    if (this.running) {
      this.pulseCount += 1;
      if (this.pulseCount % 24 === 0) this.quarterNotes += 1;
    }
    return this.snapshot(settings, { inferredTempo, recoveredClock });
  }

  private snapshot(
    settings: Pick<ClockInputSettings, "syncRatio"> & Partial<Pick<ClockInputSettings, "enabled">>,
    over: Partial<ClockInputUpdate> = {},
  ): ClockInputUpdate {
    const externalBpm = this.filteredIntervalMs === null ? 0 : pulseIntervalToBpm(this.filteredIntervalMs);
    return {
      diagnostics: {
        inferredBpm: externalBpm,
        clockJitter: this.jitterMs,
        clockStatus: settings.enabled === false ? "disabled" : this.status,
        pulseCount: this.pulseCount,
        quarterNotes: this.quarterNotes,
        phasePulse: this.pulseCount % 24,
        lostClockCount: this.lostClockCount,
        recoveredClockCount: this.recoveredClockCount,
      },
      lostClock: false,
      recoveredClock: false,
      ...over,
    };
  }
}
