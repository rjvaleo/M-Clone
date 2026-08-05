// The stream processors for the clock-to-note vertical slice.
//
// Each processor is a small state machine over one window. It reads its own
// input inboxes, emits to its own output ports, and never touches another
// node, the document, or React. Everything musical is decided in whole ticks
// and every random draw is keyed by position, so a processor produces the same
// output regardless of how the timeline was chopped into windows.
//
// The chain this file completes:
//
//   Transport -> Time Base -> Phase -> Note Order -> Step Notes
//     -> Note Density -> MIDI Output
//
// with the Note Editor supplying pattern material by reference rather than as
// timed messages, because pattern data is state, not events.

import type { JsonValue } from "../model/graph";
import type { RuntimeEvent } from "./eventqueue";
import type { MessageBus, PortInbox, StreamMessage } from "./messages";
import { randomUnit, streamKey } from "./rng";
import { PPQN, stepTicks, type Tick, type TempoMap } from "./time";

export type ProcessWindow = {
  /** Inclusive start of the window in ticks. */
  startTick: Tick;
  /** Exclusive end of the window in ticks. */
  endTick: Tick;
  tempo: TempoMap;
};

/** Mutable per-node parameter storage, written by the scheduled edit queue. */
export class ParameterBag {
  private readonly values: Record<string, JsonValue>;

  constructor(values: Record<string, JsonValue> = {}) {
    this.values = { ...values };
  }

  set(id: string, value: JsonValue): void {
    this.values[id] = value;
  }

  raw(id: string): JsonValue | undefined {
    return this.values[id];
  }

  number(id: string, fallback: number): number {
    const value = this.values[id];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  json<T>(id: string, fallback: T): T {
    const value = this.values[id];
    return value === undefined || value === null ? fallback : (value as unknown as T);
  }
}

/** Where a sink puts events it wants the runtime to schedule. */
export interface ScheduledEventSink {
  acquire(): RuntimeEvent;
  submit(event: RuntimeEvent): void;
}

/** Pattern material read by reference, never copied into the message stream. */
export type PatternView = {
  steps: readonly (readonly number[])[];
  outputLength: number;
};

export const EMPTY_PATTERN: PatternView = { steps: [], outputLength: 0 };

export type ProcessorBuild = {
  nodeId: string;
  parameters: ParameterBag;
  bus: MessageBus;
  budget: number;
  /** Project seed, combined with the node id for this node's draws. */
  seed: number;
  /** Supplied to Note Order for the Note Editor it is wired to. */
  pattern?: () => PatternView;
  /** Supplied to sinks. */
  sink?: ScheduledEventSink;
};

export interface StreamProcessor {
  readonly nodeId: string;
  process(window: ProcessWindow): void;
  /** Return to a known state at a musical position. */
  reset(atTick: Tick): void;
  /** Lossy, read-only values for node-face status fields. */
  status?(): Readonly<Record<string, string>>;
}

/**
 * Matches numeric control messages to event ticks.
 *
 * Controls may arrive in an earlier window than their target event. The
 * matcher keeps control values keyed by tick until they are either used or
 * become stale beyond a bounded grace window.
 */
class TickControlMatcher {
  private readonly byTick = new Map<Tick, number>();
  private ticks: Tick[] = [];

  ingest(controls: PortInbox): void {
    for (let i = 0; i < controls.count; i++) {
      const message = controls.items[i];
      if (message.kind !== "control") continue;
      const value = Number.isFinite(message.controlValue) ? message.controlValue : 0;
      if (!this.byTick.has(message.atTick)) this.ticks.push(message.atTick);
      this.byTick.set(message.atTick, value);
    }
    this.ticks.sort((a, b) => a - b);
  }

  valueAt(tick: Tick, fallback: number): number {
    const value = this.byTick.get(tick);
    return value === undefined ? fallback : value;
  }

  prune(beforeTick: Tick): void {
    while (this.ticks.length > 0 && this.ticks[0] < beforeTick) {
      const stale = this.ticks.shift() as Tick;
      this.byTick.delete(stale);
    }
  }

  clear(): void {
    this.byTick.clear();
    this.ticks = [];
  }
}

const CONTROL_MATCH_GRACE_TICKS = PPQN * 4;

type CyclicCell = number | readonly [number, number];

class CyclicSequenceCore {
  private position = 0;

  constructor(
    private readonly key: number,
    private readonly parameters: ParameterBag,
  ) {}

  stepAt(tick: Tick): number {
    const { cells, length } = this.currentPreset();
    const index = this.position % length;
    const level = resolveCyclicCell(cells[index], this.key, tick, index);
    this.position = (this.position + 1) % length;
    return level;
  }

  reset(): void {
    this.position = 0;
  }

  get cursor(): number {
    return this.position;
  }

  private currentPreset(): { cells: readonly CyclicCell[]; length: number } {
    const presets = this.parameters.json<unknown[]>("preset-values", []);
    if (!Array.isArray(presets) || presets.length === 0) {
      return { cells: Array.from({ length: 16 }, () => 2), length: 16 };
    }
    const active = clampInt(this.parameters.number("active-position", 0), 0, presets.length - 1);
    const preset = presets[active];
    if (!Array.isArray(preset) || preset.length === 0) {
      return { cells: Array.from({ length: 16 }, () => 2), length: 16 };
    }
    // A sequence may be shorter than its grid: `sequence-length` is how many of
    // the sixteen steps are used before it wraps, which is what lets an accent
    // of five run against a pattern of sixteen and drift the way Classic's
    // cyclic editors do.
    const declared = Math.round(this.parameters.number("sequence-length", preset.length));
    const length = clampInt(declared, 1, preset.length);
    return {
      cells: preset as CyclicCell[],
      length,
    };
  }
}

const rhythmFactor = (level: number): number => {
  const table = [0.5, 0.75, 1, 1.25, 1.5] as const;
  return table[clampInt(level, 0, 4)];
};

function resolveCyclicCell(cell: CyclicCell, key: number, tick: Tick, drawOffset: number): number {
  if (typeof cell === "number" && Number.isFinite(cell)) return clampInt(cell, 0, 4);
  if (Array.isArray(cell) && cell.length >= 2
    && typeof cell[0] === "number" && Number.isFinite(cell[0])
    && typeof cell[1] === "number" && Number.isFinite(cell[1])) {
    const low = clampInt(Math.min(cell[0], cell[1]), 0, 4);
    const high = clampInt(Math.max(cell[0], cell[1]), 0, 4);
    if (high <= low) return low;
    const draw = randomUnit(key, tick, 200 + drawOffset);
    return low + Math.floor(draw * (high - low + 1));
  }
  return 2;
}

abstract class BaseProcessor implements StreamProcessor {
  readonly nodeId: string;
  protected readonly parameters: ParameterBag;
  protected readonly bus: MessageBus;
  protected readonly key: number;

  constructor(build: ProcessorBuild, stream: string) {
    this.nodeId = build.nodeId;
    this.parameters = build.parameters;
    this.bus = build.bus;
    this.key = streamKey(build.seed, build.nodeId, stream);
  }

  abstract process(window: ProcessWindow): void;

  reset(_atTick: Tick): void {
    // Stateless by default.
  }
}

/**
 * The transport is the shared musical origin. Position comes from the tempo
 * map, so nothing needs to be sent every window — the only thing that travels
 * a cable is a reset, when the user syncs.
 */
export class TransportProcessor extends BaseProcessor {
  private pendingResetTick: Tick | null = null;

  constructor(build: ProcessorBuild) {
    super(build, "transport");
  }

  /** Queue a Sync. It is delivered at the start of the next window. */
  requestReset(atTick: Tick): void {
    this.pendingResetTick = atTick;
  }

  process(window: ProcessWindow): void {
    if (this.pendingResetTick === null) return;
    const at = this.pendingResetTick;
    this.pendingResetTick = null;
    const message = this.bus.acquire();
    if (!message) return;
    message.kind = "reset";
    message.atTick = Math.max(window.startTick, at);
    this.bus.publish("reset-out", message);
  }

  reset(atTick: Tick): void {
    this.pendingResetTick = atTick;
  }
}

/**
 * Turns the shared transport into one stream's step pulses.
 *
 * Pulses land on absolute tick multiples of the step length, so two streams
 * with the same time base are sample-identically in phase however long the
 * performance runs, and a stall cannot shift one relative to another.
 */
export class TimeBaseProcessor extends BaseProcessor {
  private nextPulseTick = 0;

  constructor(build: ProcessorBuild) {
    super(build, "time-base");
  }

  process(window: ProcessWindow): void {
    const resets = inbox(this.bus, this.nodeId, "reset-in");
    for (let i = 0; i < resets.count; i++) this.nextPulseTick = resets.items[i].atTick;
    const denominator = this.parameters.number("denominator", 16);
    // Classic's `sa`: this stream advances only from a Step Advance module.
    if (denominator <= 0) return;
    const step = stepTicks(this.parameters.number("numerator", 1), denominator);

    // After a stall the next pulse may be far behind the window. Jump forward
    // on the grid rather than emitting a burst of stale pulses.
    if (this.nextPulseTick < window.startTick) {
      const behind = window.startTick - this.nextPulseTick;
      this.nextPulseTick += Math.ceil(behind / step) * step;
    }
    while (this.nextPulseTick < window.endTick) {
      const message = this.bus.acquire();
      if (!message) return;
      message.kind = "step-clock";
      message.atTick = this.nextPulseTick;
      message.durationTicks = step;
      this.bus.publish("clock-out", message);
      this.nextPulseTick += step;
    }
  }

  reset(atTick: Tick): void {
    this.nextPulseTick = atTick;
  }

  status(): Readonly<Record<string, string>> {
    const denominator = this.parameters.number("denominator", 16);
    if (denominator <= 0) return { "step-rate": "Step advance" };
    return {
      "step-rate": `${stepTicks(this.parameters.number("numerator", 1), denominator)} ticks`,
    };
  }
}

/**
 * Delays a step clock by a whole number of ticks.
 *
 * A delayed pulse can land beyond the current window, so it is held and
 * emitted by a later one. That holding is also what makes Phase a legitimate
 * feedback break when its offset is at least one tick.
 */
export class PhaseProcessor extends BaseProcessor {
  private readonly pending: { atTick: Tick; durationTicks: number }[] = [];

  constructor(build: ProcessorBuild) {
    super(build, "phase");
  }

  /** Pulses waiting for a future window, for the node face's status field. */
  get pendingCount(): number {
    return this.pending.length;
  }

  process(window: ProcessWindow): void {
    if (inbox(this.bus, this.nodeId, "reset-in").count > 0) this.pending.length = 0;
    const offset = Math.max(0, Math.round(this.parameters.number("offset-ticks", 0)));

    const clocks = inbox(this.bus, this.nodeId, "clock-in");
    for (let i = 0; i < clocks.count; i++) {
      const message = clocks.items[i];
      this.pending.push({
        atTick: message.atTick + offset,
        durationTicks: message.durationTicks,
      });
    }
    this.pending.sort((a, b) => a.atTick - b.atTick);

    let emitted = 0;
    while (emitted < this.pending.length && this.pending[emitted].atTick < window.endTick) {
      const held = this.pending[emitted];
      const message = this.bus.acquire();
      if (!message) break;
      message.kind = "step-clock";
      // Emitted at its own position, never clamped to the window start:
      // clamping would make the delivered tick depend on where the window
      // boundary happened to fall, which is exactly what must not happen.
      message.atTick = held.atTick;
      message.durationTicks = held.durationTicks;
      this.bus.publish("clock-out", message);
      emitted += 1;
    }
    if (emitted > 0) this.pending.splice(0, emitted);
  }

  reset(_atTick: Tick): void {
    this.pending.length = 0;
  }

  status(): Readonly<Record<string, string>> {
    return { pending: `${this.pending.length} pulse${this.pending.length === 1 ? "" : "s"}` };
  }
}

/**
 * One stream's pattern traversal: Original, Cyclic, and Utterly mixed.
 *
 * Original walks the pattern in order, Cyclic walks a stable scramble of it,
 * and Utterly picks freely while avoiding an immediate repeat. Which one is
 * used at each step is a draw keyed by the step's own tick, so the traversal
 * is identical however the windows fell.
 */
export class NoteOrderProcessor extends BaseProcessor {
  private readonly pattern: () => PatternView;
  private position = 0;
  private lastIndex = -1;
  private scrambleGeneration = 0;
  private scramble: number[] = [];
  private scrambleLength = -1;
  private scrambleFor = -1;

  constructor(build: ProcessorBuild) {
    super(build, "note-order");
    this.pattern = build.pattern ?? (() => EMPTY_PATTERN);
  }

  /** New Cyclic material, as ReScramble does in Classic. */
  rescramble(): void {
    this.scrambleGeneration += 1;
    this.scrambleFor = -1;
  }

  private scrambledOrder(length: number): readonly number[] {
    if (this.scrambleLength === length && this.scrambleFor === this.scrambleGeneration) {
      return this.scramble;
    }
    // A deterministic permutation: Fisher-Yates driven by draws keyed on the
    // scramble generation, so the same generation always rebuilds identically.
    const order = Array.from({ length }, (_, index) => index);
    for (let i = length - 1; i > 0; i--) {
      const draw = randomUnit(this.key, this.scrambleGeneration * 1_000_003 + i, 7);
      const j = Math.min(i, Math.floor(draw * (i + 1)));
      const swap = order[i];
      order[i] = order[j];
      order[j] = swap;
    }
    this.scramble = order;
    this.scrambleLength = length;
    this.scrambleFor = this.scrambleGeneration;
    return order;
  }

  process(_window: ProcessWindow): void {
    if (inbox(this.bus, this.nodeId, "reset-in").count > 0) {
      this.position = 0;
      this.lastIndex = -1;
    }
    const view = this.pattern();
    const length = Math.max(0, Math.min(view.outputLength, view.steps.length));
    const clocks = inbox(this.bus, this.nodeId, "clock-in");
    if (length <= 0 || clocks.count === 0) return;

    const original = Math.max(0, this.parameters.number("original", 50));
    const cyclic = Math.max(0, this.parameters.number("cyclic", 4));
    const utterly = Math.max(0, this.parameters.number("utterly", 46));
    const total = original + cyclic + utterly;

    for (let i = 0; i < clocks.count; i++) {
      const clock = clocks.items[i];
      const index = this.chooseIndex(clock.atTick, length, original, cyclic, total);
      const message = this.bus.acquire();
      if (!message) return;
      message.kind = "step-event";
      message.atTick = clock.atTick;
      message.durationTicks = clock.durationTicks;
      message.stepIndex = index;
      message.pitches = view.steps[index] ?? [];
      this.bus.publish("steps-out", message);
      this.position = (this.position + 1) % length;
      this.lastIndex = index;
    }
  }

  private chooseIndex(
    tick: Tick,
    length: number,
    original: number,
    cyclic: number,
    total: number,
  ): number {
    // A degenerate mix — every weight zeroed — falls back to Original rather
    // than silently stopping the stream.
    if (total <= 0) return this.position % length;
    const pick = randomUnit(this.key, tick, 0) * total;
    if (pick < original) return this.position % length;
    if (pick < original + cyclic) return this.scrambledOrder(length)[this.position % length];
    const free = Math.floor(randomUnit(this.key, tick, 1) * (length > 1 ? length - 1 : 1));
    if (length <= 1) return 0;
    const avoid = this.lastIndex;
    if (avoid < 0 || avoid >= length) return Math.min(length - 1, free);
    return free >= avoid ? Math.min(length - 1, free + 1) : free;
  }

  reset(_atTick: Tick): void {
    this.position = 0;
    this.lastIndex = -1;
  }

  status(): Readonly<Record<string, string>> {
    return { cursor: this.lastIndex < 0 ? "Waiting" : `Step ${this.lastIndex + 1}` };
  }
}

abstract class CyclicControlProcessor extends BaseProcessor {
  protected readonly core: CyclicSequenceCore;
  private readonly outputPortId: string;

  constructor(build: ProcessorBuild, stream: string, outputPortId: string) {
    super(build, stream);
    this.outputPortId = outputPortId;
    this.core = new CyclicSequenceCore(this.key, this.parameters);
  }

  process(_window: ProcessWindow): void {
    if (inbox(this.bus, this.nodeId, "reset-in").count > 0) this.core.reset();
    const clocks = inbox(this.bus, this.nodeId, "clock-in");
    for (let i = 0; i < clocks.count; i++) {
      const clock = clocks.items[i];
      const message = this.bus.acquire();
      if (!message) return;
      message.kind = "control";
      message.atTick = clock.atTick;
      message.durationTicks = clock.durationTicks;
      message.controlValue = this.core.stepAt(clock.atTick);
      this.bus.publish(this.outputPortId, message);
    }
  }

  reset(_atTick: Tick): void {
    this.core.reset();
  }

  status(): Readonly<Record<string, string>> {
    return { cursor: `Step ${this.core.cursor + 1}` };
  }
}

export class CyclicAccentProcessor extends CyclicControlProcessor {
  constructor(build: ProcessorBuild) {
    super(build, "cyclic-accent", "accent-out");
  }
}

export class CyclicLegatoProcessor extends CyclicControlProcessor {
  constructor(build: ProcessorBuild) {
    super(build, "cyclic-legato", "legato-out");
  }
}

export class CyclicRhythmProcessor extends BaseProcessor {
  private readonly core: CyclicSequenceCore;
  private nextTick: Tick | null = null;

  constructor(build: ProcessorBuild) {
    super(build, "cyclic-rhythm");
    this.core = new CyclicSequenceCore(this.key, this.parameters);
  }

  process(window: ProcessWindow): void {
    const resets = inbox(this.bus, this.nodeId, "reset-in");
    if (resets.count > 0) {
      this.core.reset();
      this.nextTick = resets.items[resets.count - 1].atTick;
    }

    const clocks = inbox(this.bus, this.nodeId, "clock-in");
    for (let i = 0; i < clocks.count; i++) {
      const clock = clocks.items[i];
      const level = this.core.stepAt(clock.atTick);
      const warpedDuration = Math.max(1, Math.round(clock.durationTicks * rhythmFactor(level)));

      if (this.nextTick === null || this.nextTick < window.startTick) this.nextTick = clock.atTick;

      const message = this.bus.acquire();
      if (!message) return;
      message.kind = "step-clock";
      message.atTick = this.nextTick;
      message.durationTicks = warpedDuration;
      this.bus.publish("clock-out", message);
      this.nextTick += warpedDuration;
    }
  }

  reset(atTick: Tick): void {
    this.core.reset();
    this.nextTick = atTick;
  }

  status(): Readonly<Record<string, string>> {
    return { cursor: `Step ${this.core.cursor + 1}` };
  }
}

/**
 * The explicit step-event to note-event converter.
 *
 * Keeping this visible rather than blurring the two signal types means the
 * decisions it makes — how loud, how long, which channel — have a node face
 * and a place in the document instead of being buried in a planner.
 */
export class StepToNotesProcessor extends BaseProcessor {
  private readonly velocityMatcher = new TickControlMatcher();
  private readonly gateMatcher = new TickControlMatcher();
  private lastNotesPerStep = 0;

  constructor(build: ProcessorBuild) {
    super(build, "step-notes");
  }

  process(window: ProcessWindow): void {
    this.velocityMatcher.ingest(inbox(this.bus, this.nodeId, "velocity-in"));
    this.gateMatcher.ingest(inbox(this.bus, this.nodeId, "gate-in"));

    const baseVelocity = this.parameters.number("velocity", 100);
    const baseGatePercent = this.parameters.number("gate", 90);
    const channel = clampInt(this.parameters.number("channel", 1), 1, 16);

    const steps = inbox(this.bus, this.nodeId, "steps-in");
    for (let i = 0; i < steps.count; i++) {
      const step = steps.items[i];
      this.lastNotesPerStep = step.pitches.length;
      const velocity = clampInt(this.velocityMatcher.valueAt(step.atTick, baseVelocity), 1, 127);
      const gate = Math.max(1, this.gateMatcher.valueAt(step.atTick, baseGatePercent)) / 100;
      for (const pitch of step.pitches) {
        const message = this.bus.acquire();
        if (!message) return;
        message.kind = "note-event";
        message.atTick = step.atTick;
        message.stepIndex = step.stepIndex;
        message.note = clampInt(pitch, 0, 127);
        message.velocity = velocity;
        message.channel = channel;
        message.gate = gate;
        // At least one tick, so a note always has somewhere to end.
        message.durationTicks = Math.max(1, Math.round(step.durationTicks * gate));
        this.bus.publish("notes-out", message);
      }
    }

    this.velocityMatcher.prune(window.startTick - CONTROL_MATCH_GRACE_TICKS);
    this.gateMatcher.prune(window.startTick - CONTROL_MATCH_GRACE_TICKS);
  }

  reset(_atTick: Tick): void {
    this.velocityMatcher.clear();
    this.gateMatcher.clear();
    this.lastNotesPerStep = 0;
  }

  status(): Readonly<Record<string, string>> {
    return { rate: `${this.lastNotesPerStep} note${this.lastNotesPerStep === 1 ? "" : "s"}` };
  }
}

/**
 * The deterministic probability gate.
 *
 * The draw is keyed on the note's tick alone, so every note of a chord shares
 * one decision — a chord is accepted or rejected whole, as in Classic, rather
 * than being thinned into an arpeggio.
 */
export class NoteDensityProcessor extends BaseProcessor {
  private acceptedCount = 0;
  private rejectedCount = 0;
  private readonly densityMatcher = new TickControlMatcher();

  constructor(build: ProcessorBuild) {
    super(build, "density");
  }

  get accepted(): number {
    return this.acceptedCount;
  }

  get rejected(): number {
    return this.rejectedCount;
  }

  process(window: ProcessWindow): void {
    this.densityMatcher.ingest(inbox(this.bus, this.nodeId, "density-in"));
    const baseDensity = this.parameters.number("density", 57);
    const notes = inbox(this.bus, this.nodeId, "notes-in");
    for (let i = 0; i < notes.count; i++) {
      const note = notes.items[i];
      const density = clamp(this.densityMatcher.valueAt(note.atTick, baseDensity), 0, 100) / 100;
      if (randomUnit(this.key, note.atTick, 0) >= density) {
        this.rejectedCount += 1;
        continue;
      }
      const message = this.bus.acquire();
      if (!message) return;
      copyNote(message, note);
      this.acceptedCount += 1;
      this.bus.publish("notes-out", message);
    }

    this.densityMatcher.prune(window.startTick - CONTROL_MATCH_GRACE_TICKS);
  }

  reset(_atTick: Tick): void {
    this.acceptedCount = 0;
    this.rejectedCount = 0;
    this.densityMatcher.clear();
  }

  status(): Readonly<Record<string, string>> {
    return { activity: `${this.acceptedCount} accepted · ${this.rejectedCount} rejected` };
  }
}

/**
 * Maps cyclic accent levels onto a configurable velocity range.
 */
export class VelocityRangeProcessor extends BaseProcessor {
  private readonly accentMatcher = new TickControlMatcher();

  constructor(build: ProcessorBuild) {
    super(build, "velocity-range");
  }

  process(window: ProcessWindow): void {
    applyVelocityPresetFromPosition(this.bus, this.nodeId, this.parameters);
    this.accentMatcher.ingest(inbox(this.bus, this.nodeId, "accent-in"));

    const low = clampInt(this.parameters.number("low", 60), 1, 127);
    const high = clampInt(this.parameters.number("high", 100), 1, 127);
    const min = Math.min(low, high);
    const max = Math.max(low, high);
    const fallbackLevel = clampInt(this.parameters.number("accent-level", 2), 0, 4);

    const notes = inbox(this.bus, this.nodeId, "notes-in");
    for (let i = 0; i < notes.count; i++) {
      const source = notes.items[i];
      const level = clampInt(this.accentMatcher.valueAt(source.atTick, fallbackLevel), 0, 4);
      const velocity = clampInt(min + ((max - min) * level) / 4, 1, 127);
      const message = this.bus.acquire();
      if (!message) return;
      copyNote(message, source);
      message.velocity = velocity;
      this.bus.publish("notes-out", message);
    }

    this.accentMatcher.prune(window.startTick - CONTROL_MATCH_GRACE_TICKS);
  }

  reset(_atTick: Tick): void {
    this.accentMatcher.clear();
  }
}

/**
 * Applies cyclic legato levels as a duration multiplier.
 */
export class LegatoProcessor extends BaseProcessor {
  private readonly legatoMatcher = new TickControlMatcher();
  private overlapCount = 0;

  constructor(build: ProcessorBuild) {
    super(build, "legato-processor");
  }

  process(window: ProcessWindow): void {
    applyLegatoPresetFromPosition(this.bus, this.nodeId, this.parameters);
    this.legatoMatcher.ingest(inbox(this.bus, this.nodeId, "legato-in"));

    const base = clamp(this.parameters.number("base-multiplier", 100), 1, 400) / 100;
    const fallbackLevel = clampInt(this.parameters.number("legato-level", 2), 0, 4);
    const notes = inbox(this.bus, this.nodeId, "notes-in");
    for (let i = 0; i < notes.count; i++) {
      const source = notes.items[i];
      const level = clampInt(this.legatoMatcher.valueAt(source.atTick, fallbackLevel), 0, 4);
      const factor = base * legatoFactor(level);
      const message = this.bus.acquire();
      if (!message) return;
      copyNote(message, source);
      message.durationTicks = Math.max(1, Math.round(source.durationTicks * factor));
      message.gate = source.gate * factor;
      if (message.gate > 1) this.overlapCount += 1;
      this.bus.publish("notes-out", message);
    }

    this.legatoMatcher.prune(window.startTick - CONTROL_MATCH_GRACE_TICKS);
  }

  reset(_atTick: Tick): void {
    this.legatoMatcher.clear();
    this.overlapCount = 0;
  }

  status(): Readonly<Record<string, string>> {
    return { overlap: `${this.overlapCount} overlapping` };
  }
}

/**
 * Per-path mute gate for note events.
 *
 * This only filters note events and does not alter any upstream clock or
 * control flow, so muting one path does not stop the rest of the patch.
 */
export class PlayEnableProcessor extends BaseProcessor {
  private readonly enableMatcher = new TickControlMatcher();
  private mutedCount = 0;

  constructor(build: ProcessorBuild) {
    super(build, "play-enable");
  }

  process(window: ProcessWindow): void {
    applyPlayEnablePresetFromPosition(this.bus, this.nodeId, this.parameters);
    this.enableMatcher.ingest(inbox(this.bus, this.nodeId, "play-enabled-in"));

    const fallback = this.parameters.raw("play-enabled") === true ? 1 : 0;
    const notes = inbox(this.bus, this.nodeId, "notes-in");
    for (let i = 0; i < notes.count; i++) {
      const source = notes.items[i];
      const enabled = this.enableMatcher.valueAt(source.atTick, fallback) >= 0.5;
      if (!enabled) {
        this.mutedCount += 1;
        continue;
      }
      const message = this.bus.acquire();
      if (!message) return;
      copyNote(message, source);
      this.bus.publish("notes-out", message);
    }

    this.enableMatcher.prune(window.startTick - CONTROL_MATCH_GRACE_TICKS);
  }

  reset(_atTick: Tick): void {
    this.enableMatcher.clear();
    this.mutedCount = 0;
  }

  status(): Readonly<Record<string, string>> {
    return { muted: `${this.mutedCount} muted` };
  }
}

/**
 * Pitch-domain shaper with semitone and scale-degree modes.
 */
export class TranspositionProcessor extends BaseProcessor {
  private readonly transposeMatcher = new TickControlMatcher();
  private readonly scaleContextMatcher = new TickControlMatcher();

  constructor(build: ProcessorBuild) {
    super(build, "transposition");
  }

  process(window: ProcessWindow): void {
    applyTranspositionPresetFromPosition(this.bus, this.nodeId, this.parameters);
    this.transposeMatcher.ingest(inbox(this.bus, this.nodeId, "transposition-in"));
    this.scaleContextMatcher.ingest(inbox(this.bus, this.nodeId, "scale-context-in"));

    const mode = this.parameters.raw("mode") === "scale-degree" ? "scale-degree" : "semitone";
    const baseSemitones = clampInt(this.parameters.number("semitones", 0), -48, 48);
    const baseDegrees = clampInt(this.parameters.number("degrees", 0), -14, 14);
    const baseRoot = clampInt(this.parameters.number("scale-root", 0), 0, 11);
    const scaleMode = this.parameters.raw("scale-mode") === "minor" ? "minor" : "major";

    const notes = inbox(this.bus, this.nodeId, "notes-in");
    for (let i = 0; i < notes.count; i++) {
      const source = notes.items[i];
      const amount = Math.round(this.transposeMatcher.valueAt(source.atTick, 0));
      const rootOffset = Math.round(this.scaleContextMatcher.valueAt(source.atTick, baseRoot));
      const root = clampInt(rootOffset, 0, 11);

      const transposed = mode === "semitone"
        ? clampInt(source.note + baseSemitones + amount, 0, 127)
        : transposeScaleDegree(
          source.note,
          baseDegrees + amount,
          root,
          scaleMode,
        );

      const message = this.bus.acquire();
      if (!message) return;
      copyNote(message, source);
      message.note = transposed;
      this.bus.publish("notes-out", message);
    }

    this.transposeMatcher.prune(window.startTick - CONTROL_MATCH_GRACE_TICKS);
    this.scaleContextMatcher.prune(window.startTick - CONTROL_MATCH_GRACE_TICKS);
  }

  reset(_atTick: Tick): void {
    this.transposeMatcher.clear();
    this.scaleContextMatcher.clear();
  }
}

/**
 * The sink: note events become scheduled note-on/note-off pairs.
 *
 * This is the last point at which anything is expressed in ticks — the runtime
 * converts to seconds once, on submission. Anything that *ends* a note's
 * journey through the graph is one of these, whether it goes out as MIDI bytes
 * or into a sample player, because the scheduling is identical and only the
 * adapter on the far side differs.
 */
export class MidiOutputProcessor extends BaseProcessor {
  private readonly sink: ScheduledEventSink | null;
  private noteId = 0;
  private sequence = 0;

  constructor(build: ProcessorBuild, kind = "midi-output") {
    super(build, kind);
    this.sink = build.sink ?? null;
  }

  process(_window: ProcessWindow): void {
    if (!this.sink) return;
    const fallbackChannel = clampInt(this.parameters.number("channel", 1), 1, 16);
    const notes = inbox(this.bus, this.nodeId, "notes-in");
    for (let i = 0; i < notes.count; i++) {
      const note = notes.items[i];
      const channel = note.channel > 0 ? clampInt(note.channel, 1, 16) : fallbackChannel;
      const noteId = this.noteId++;
      const duration = Math.max(1, Math.round(note.durationTicks));

      const on = this.sink.acquire();
      on.type = "note-on";
      on.atTick = note.atTick;
      on.portId = this.nodeId;
      on.channel = channel;
      on.note = note.note;
      on.velocity = note.velocity;
      on.noteId = noteId;
      on.sequence = this.sequence++;
      this.sink.submit(on);

      const off = this.sink.acquire();
      off.type = "note-off";
      off.atTick = note.atTick + duration;
      off.portId = this.nodeId;
      off.channel = channel;
      off.note = note.note;
      off.velocity = 0;
      off.noteId = noteId;
      off.sequence = this.sequence++;
      this.sink.submit(off);
    }
  }
}

/** Copy one note message onto another, preserving the pooled object. */
function copyNote(target: StreamMessage, source: StreamMessage): void {
  target.kind = "note-event";
  target.atTick = source.atTick;
  target.durationTicks = source.durationTicks;
  target.stepIndex = source.stepIndex;
  target.note = source.note;
  // Carried like the note itself, and for the same reason: a message comes
  // out of the pool reset, so a transform that forgot this would silently
  // drop a quantised note back to 12-TET on its way through. The detune is
  // part of the pitch, not decoration on it.
  target.detuneCents = source.detuneCents;
  target.velocity = source.velocity;
  target.channel = source.channel;
  target.gate = source.gate;
}

/**
 * Read an inbox without copying it.
 *
 * Buffers are reused and grow to the high-water mark, so the live portion is
 * almost always shorter than the backing array. Slicing here would allocate on
 * every port read of every window — exactly the garbage this design exists to
 * avoid — so callers index against `count` instead.
 */
function inbox(bus: MessageBus, nodeId: string, portId: string): PortInbox {
  return bus.read(nodeId, portId);
}

const legatoFactor = (level: number): number => {
  const table = [0.5, 0.75, 1, 1.25, 1.5] as const;
  return table[clampInt(level, 0, 4)];
};

function applyVelocityPresetFromPosition(
  bus: MessageBus,
  nodeId: string,
  parameters: ParameterBag,
): void {
  const position = inbox(bus, nodeId, "position-in");
  if (position.count === 0) return;
  const message = position.items[position.count - 1];
  if (message.kind !== "control") return;
  const presets = parameters.json<Array<{ low?: number; high?: number; accent?: number }>>("preset-values", []);
  if (!Array.isArray(presets) || presets.length === 0) return;
  const active = clampInt(message.controlValue, 0, presets.length - 1);
  const preset = presets[active] ?? {};
  parameters.set("active-position", active);
  if (typeof preset.low === "number" && Number.isFinite(preset.low)) parameters.set("low", preset.low);
  if (typeof preset.high === "number" && Number.isFinite(preset.high)) parameters.set("high", preset.high);
  if (typeof preset.accent === "number" && Number.isFinite(preset.accent)) parameters.set("accent-level", preset.accent);
}

function applyLegatoPresetFromPosition(
  bus: MessageBus,
  nodeId: string,
  parameters: ParameterBag,
): void {
  const position = inbox(bus, nodeId, "position-in");
  if (position.count === 0) return;
  const message = position.items[position.count - 1];
  if (message.kind !== "control") return;
  const presets = parameters.json<Array<{ base?: number; level?: number }>>("preset-values", []);
  if (!Array.isArray(presets) || presets.length === 0) return;
  const active = clampInt(message.controlValue, 0, presets.length - 1);
  const preset = presets[active] ?? {};
  parameters.set("active-position", active);
  if (typeof preset.base === "number" && Number.isFinite(preset.base)) parameters.set("base-multiplier", preset.base);
  if (typeof preset.level === "number" && Number.isFinite(preset.level)) parameters.set("legato-level", preset.level);
}

function applyPlayEnablePresetFromPosition(
  bus: MessageBus,
  nodeId: string,
  parameters: ParameterBag,
): void {
  const position = inbox(bus, nodeId, "position-in");
  if (position.count === 0) return;
  const message = position.items[position.count - 1];
  if (message.kind !== "control") return;
  const presets = parameters.json<boolean[]>("preset-values", []);
  if (!Array.isArray(presets) || presets.length === 0) return;
  const active = clampInt(message.controlValue, 0, presets.length - 1);
  const preset = presets[active];
  parameters.set("active-position", active);
  if (typeof preset === "boolean") parameters.set("play-enabled", preset);
}

function applyTranspositionPresetFromPosition(
  bus: MessageBus,
  nodeId: string,
  parameters: ParameterBag,
): void {
  const position = inbox(bus, nodeId, "position-in");
  if (position.count === 0) return;
  const message = position.items[position.count - 1];
  if (message.kind !== "control") return;
  const presets = parameters.json<Array<{
    mode?: string;
    semitones?: number;
    degrees?: number;
    root?: number;
    scale?: string;
  }>>("preset-values", []);
  if (!Array.isArray(presets) || presets.length === 0) return;
  const active = clampInt(message.controlValue, 0, presets.length - 1);
  const preset = presets[active] ?? {};
  parameters.set("active-position", active);
  if (preset.mode === "semitone" || preset.mode === "scale-degree") parameters.set("mode", preset.mode);
  if (typeof preset.semitones === "number" && Number.isFinite(preset.semitones)) parameters.set("semitones", preset.semitones);
  if (typeof preset.degrees === "number" && Number.isFinite(preset.degrees)) parameters.set("degrees", preset.degrees);
  if (typeof preset.root === "number" && Number.isFinite(preset.root)) parameters.set("scale-root", preset.root);
  if (preset.scale === "major" || preset.scale === "minor") parameters.set("scale-mode", preset.scale);
}

function transposeScaleDegree(
  note: number,
  degreeShift: number,
  root: number,
  mode: "major" | "minor",
): number {
  const intervals = mode === "major"
    ? [0, 2, 4, 5, 7, 9, 11]
    : [0, 2, 3, 5, 7, 8, 10];
  const relative = note - root;
  const octave = floorDiv(relative, 12);
  const pitchClass = positiveMod(relative, 12);

  let degree = 0;
  for (let i = intervals.length - 1; i >= 0; i--) {
    if (intervals[i] <= pitchClass) {
      degree = i;
      break;
    }
  }

  const accidental = pitchClass - intervals[degree];
  const absoluteDegree = octave * 7 + degree + degreeShift;
  const outOctave = floorDiv(absoluteDegree, 7);
  const outDegree = positiveMod(absoluteDegree, 7);
  return clampInt(root + outOctave * 12 + intervals[outDegree] + accidental, 0, 127);
}

function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

function positiveMod(value: number, modulo: number): number {
  // Twice, rather than a sign test: `%` keeps the sign of the dividend, and a
  // note below the scale root is the ordinary case here.
  return ((value % modulo) + modulo) % modulo;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

const clampInt = (value: number, low: number, high: number): number =>
  Math.round(clamp(value, low, high));

/** Every module type the vertical slice can execute. */
export const PROCESSOR_FACTORIES: Record<
  string,
  (build: ProcessorBuild) => StreamProcessor
> = {
  "m.transport-clock": (build) => new TransportProcessor(build),
  "m.time-base": (build) => new TimeBaseProcessor(build),
  "m.phase": (build) => new PhaseProcessor(build),
  "m.note-order": (build) => new NoteOrderProcessor(build),
  "m.cyclic-accent": (build) => new CyclicAccentProcessor(build),
  "m.cyclic-legato": (build) => new CyclicLegatoProcessor(build),
  "m.cyclic-rhythm": (build) => new CyclicRhythmProcessor(build),
  "m.step-to-notes": (build) => new StepToNotesProcessor(build),
  "m.note-density": (build) => new NoteDensityProcessor(build),
  "m.velocity-range": (build) => new VelocityRangeProcessor(build),
  "m.legato-processor": (build) => new LegatoProcessor(build),
  "m.play-enable": (build) => new PlayEnableProcessor(build),
  "m.transposition": (build) => new TranspositionProcessor(build),
  "m.midi-output": (build) => new MidiOutputProcessor(build),
  // The players schedule exactly as a MIDI Output does — the difference is
  // entirely on the other side of the scheduler, where one adapter writes bytes
  // to a port and the other starts a buffer on the audio clock. Giving them a
  // separate processor would be duplicating the one piece of code that must not
  // drift: the conversion from note messages to scheduled events.
  "m.percussion": (build) => new MidiOutputProcessor(build, "percussion"),
  "m.looper": (build) => new MidiOutputProcessor(build, "looper"),
  "m.granular": (build) => new MidiOutputProcessor(build, "granular"),
  "m.synth": (build) => new MidiOutputProcessor(build, "synth"),
};
