// A sink receives fully-planned notes (times in the AudioContext domain) and
// realizes them — as audio, as MIDI, later as WAM instruments. Keeping the
// interface note-oriented lets the runtime treat all outputs uniformly.

export type ScheduledNote = {
  note: number;
  velocity: number;
  channel: number;
  startSec: number;
  durationSec: number;
};

export interface OutputSink {
  schedule(n: ScheduledNote): void;
  /** Immediately silence everything (transport stop / panic). */
  panic(): void;
}
