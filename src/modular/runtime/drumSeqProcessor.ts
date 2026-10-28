/**
 * The Drum Sequencer's processor.
 *
 * Every hit is decided in drums/drumSeq.ts as a pure function of the step's
 * number since the last reset; this only keeps that reset's tick (the origin)
 * and asks, window by window, for the hits that fall inside. A Sync on Sync In
 * or the face's ⏮ moves the origin; the runtime's own reset (transport start,
 * M's Sync) does the same.
 *
 * Stopped (Play off), it sends nothing but keeps counting, so pressing Play
 * again comes back in time with everything else rather than from wherever the
 * button happened to be pressed.
 */

import type { MessageBus } from "./messages";
import type { ParameterBag, ProcessorBuild, ProcessWindow, StreamProcessor } from "./processors";
import { streamKey } from "./rng";
import type { Tick } from "./time";
import { defaultDrumRows, drumSettings, hitsInRange, readDrumRows, rowStepAt, type DrumRow, type DrumSettings } from "../drums/drumSeq";

const DEFAULT_ROWS = defaultDrumRows();

export class DrumSeqProcessor implements StreamProcessor {
  readonly nodeId: string;
  private readonly parameters: ParameterBag;
  private readonly bus: MessageBus;
  private readonly seed: number;
  private origin = 0;
  private resetRequested = false;
  private position = -1;
  private rowSteps: number[] = [];

  constructor(build: ProcessorBuild) {
    this.nodeId = build.nodeId;
    this.parameters = build.parameters;
    this.bus = build.bus;
    this.seed = build.seed;
  }

  reset(atTick: Tick): void {
    this.origin = atTick;
  }

  /** ⏮ on the face: start again from step 1 at the next window. */
  command(id: string): boolean {
    if (id !== "reset") return false;
    this.resetRequested = true;
    return true;
  }

  process(window: ProcessWindow): void {
    if (this.resetRequested) {
      this.resetRequested = false;
      this.reset(window.startTick);
    }
    const settings = drumSettings(
      (id, fallback) => this.parameters.number(id, fallback),
      (id) => this.parameters.raw(id) === true,
    );
    const rows = readDrumRows(this.parameters.json<unknown>("rows", DEFAULT_ROWS));
    const playing = this.parameters.raw("play") !== false;
    const channel = Math.max(1, Math.min(16, Math.round(this.parameters.number("channel", 10))));
    const key = streamKey(this.seed, this.nodeId, `drum-seq:${Math.round(this.parameters.number("seed", 0))}`);

    const syncs = this.bus.read(this.nodeId, "sync-in");
    const resets: number[] = [];
    for (let i = 0; i < syncs.count; i++) resets.push(Math.max(window.startTick, Math.min(window.endTick, syncs.items[i].atTick)));
    resets.sort((a, b) => a - b);

    let from = window.startTick;
    for (const tick of [...resets, window.endTick]) {
      if (playing && !this.send(rows, settings, key, channel, from, tick)) break;
      if (tick < window.endTick) this.reset(tick);
      from = tick;
    }
    this.report(rows, settings, window.startTick);
  }

  /** The hits in [from, to). False once the window's budget runs out. */
  private send(rows: DrumRow[], settings: DrumSettings, key: number, channel: number, from: number, to: number): boolean {
    for (const hit of hitsInRange(rows, settings, key, from - this.origin, to - this.origin)) {
      const message = this.bus.acquire();
      if (!message) return false;
      message.kind = "note-event";
      message.atTick = this.origin + hit.tick;
      message.durationTicks = hit.duration;
      message.stepIndex = hit.step;
      message.note = hit.note;
      message.velocity = hit.velocity;
      message.channel = channel;
      message.gate = 1;
      message.voice = 0;
      message.sourceNodeId = this.nodeId;
      this.bus.publish("notes-out", message);
    }
    return true;
  }

  private report(rows: DrumRow[], settings: DrumSettings, tick: number): void {
    if (settings.stepTicks <= 0) {
      this.position = -1;
      this.rowSteps = [];
      return;
    }
    const n = Math.max(0, Math.floor((tick - this.origin) / settings.stepTicks));
    this.position = n % settings.length;
    this.rowSteps = rows.slice(0, settings.tracks).map((row) => rowStepAt(row, settings, n));
  }

  status(): Readonly<Record<string, string>> {
    return { step: String(this.position), rows: JSON.stringify(this.rowSteps) };
  }
}
