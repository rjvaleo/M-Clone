import type { EngineEvent, OutputDestination } from "../events";

export interface OutputSink {
  readonly destination: OutputDestination;
  /** Submit explicit events which were planned from one clock snapshot. */
  scheduleBatch(events: readonly EngineEvent[]): void;
  /** Remove timestamped events which have not reached the device yet. */
  cancelScheduled(): void;
  /** Immediately silence everything (transport stop / panic). */
  panic(): void;
}
