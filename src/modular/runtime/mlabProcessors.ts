/**
 * The M modules' processors.
 *
 * These are M Clone's own engine running on the canvas runtime, not a second
 * implementation of it. Each NoteSeq step goes through `cyclePicks` and
 * `playStep` from src/engine/step.ts, which is also what the classic planner
 * runs; only the clock differs, ticks here instead of seconds there.
 *
 * Every note is tagged with its `voice`, so one cable can carry them all.
 */

import type { MessageBus, PortInbox } from "./messages";
import { streamKey } from "./rng";
import { PPQN, stepTicks, type Tick } from "./time";
import type { ParameterBag, ProcessorBuild, ProcessWindow, StreamProcessor } from "./processors";
import { Rng } from "../../engine/rng";
import { cyclePicks, playStep, type CyclicCounters, type StepPattern, type StepState, type VoiceCycles } from "../../engine/step";
import { distortClockTicks, normalizeTimeMap } from "../../engine/timemap";
import type { CyclicVariable, NoteOrderCursor, NoteOrderMix } from "../../engine/types";
import type { ScaleName } from "../../engine/music";
import { activeSteps, defaultCellLengths, defaultCells, defaultNoteSeqPatterns, directionIndex, type SeqCellLengths, type SeqCells, type SeqDirection } from "../mlab/noteSeq";
import { warpToTimeMap, type WarpBank } from "../mlab/warpSteps";
import {
  MAX_VOICES,
  defaultCyclePositions,
  defaultCycleValues,
  defaultHarmony,
  defaultOrchestration,
  defaultPrograms,
  type CyclePositions,
  type CycleValues,
  type VoicePattern,
} from "../mlab/model";

const DEFAULT_POSITIONS = defaultCyclePositions();
const DEFAULT_VALUES = defaultCycleValues();
const DEFAULT_HARMONY = defaultHarmony();

/** A fresh generator for one draw site, the same however the windows fall. */
const stepRng = (key: number, voice: number, step: number): Rng =>
  new Rng((key ^ Math.imul(voice + 1, 0x9e3779b1) ^ Math.imul(step + 1, 0x85ebca6b)) >>> 0);


abstract class MLabProcessor implements StreamProcessor {
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
  abstract reset(atTick: Tick): void;

  protected read(portId: string): PortInbox {
    return this.bus.read(this.nodeId, portId);
  }
}

/* ===== M Conductor: the transport half ===== */

/**
 * M's Conducting window, transport half: it sets the canvas tempo, sends Sync
 * now or on the next beat or bar, and runs Tap Conduct as a gate — shut until
 * a tap, then open for one beat per tap. The pads are added by
 * MConductorProcessor below.
 */
abstract class ConductorTransport extends MLabProcessor {
  private sentRun: number | null = null;
  private syncRequested = false;
  private syncAt: number | null = null;
  private tapRequested = false;
  private openUntil: number | null = null;
  private at = 0;

  reset(_atTick: Tick): void {
    this.sentRun = null;
    this.openUntil = null;
  }

  command(id: string): boolean {
    if (id === "sync") this.syncRequested = true;
    else if (id === "tap") this.tapRequested = true;
    else return false;
    return true;
  }

  protected transport(window: ProcessWindow): void {
    const tempo = this.parameters.number("tempo", 120);
    if (tempo > 0 && Math.abs(window.tempo.bpmAt(window.startTick) - tempo) > 1e-9) window.tempo.setTempoAt(window.startTick, tempo);
    this.at = window.startTick;
    this.runGate(window);
    this.sync(window);
  }

  private sendRun(value: number, atTick: number): void {
    if (this.sentRun === value) return;
    const message = this.bus.acquire();
    if (!message) return;
    message.kind = "control";
    message.atTick = atTick;
    message.controlValue = value;
    message.sourceNodeId = this.nodeId;
    this.bus.publish("run-out", message);
    this.sentRun = value;
  }

  private runGate(window: ProcessWindow): void {
    const mode = this.parameters.raw("tap-conduct") ?? "off";
    if (mode !== "held") {
      this.tapRequested = false;
      this.openUntil = null;
      this.sendRun(1, window.startTick);
      return;
    }
    if (this.tapRequested) {
      this.tapRequested = false;
      this.sendRun(1, window.startTick);
      this.openUntil = window.startTick + PPQN;
    } else if (this.sentRun === null) {
      // A beat for nothing: the music waits for the first tap.
      this.sendRun(0, window.startTick);
    }
    if (this.openUntil !== null && this.openUntil < window.endTick) {
      this.sendRun(0, this.openUntil);
      this.openUntil = null;
    }
  }

  private sync(window: ProcessWindow): void {
    if (this.syncRequested) {
      this.syncRequested = false;
      const quantize = this.parameters.raw("sync-quantize") ?? "now";
      const bar = Math.max(1, Math.round(this.parameters.number("bar-length", 4)));
      const unit = quantize === "bar" ? bar * PPQN : quantize === "beat" ? PPQN : 0;
      this.syncAt = unit ? Math.ceil(window.startTick / unit) * unit : window.startTick;
    }
    if (this.syncAt === null || this.syncAt >= window.endTick) return;
    const message = this.bus.acquire();
    if (!message) return;
    message.kind = "reset";
    message.atTick = this.syncAt;
    message.sourceNodeId = this.nodeId;
    this.bus.publish("sync-out", message);
    this.syncAt = null;
  }

  protected transportStatus(): Record<string, string> {
    const bar = Math.max(1, Math.round(this.parameters.number("bar-length", 4)));
    const sixteenths = Math.floor(this.at / (PPQN / 4));
    return {
      run: this.sentRun === 0 ? "Waiting for a tap" : "Running",
      bar: String(Math.floor(sixteenths / (4 * bar)) + 1),
      beat: String((Math.floor(sixteenths / 4) % bar) + 1),
      sixteenth: String((sixteenths % 4) + 1),
    };
  }
}

/* ===== M Conductor ===== */

export type XYPad = { x: number; y: number; glide: number };
export const defaultPads = (): XYPad[] => Array.from({ length: 3 }, () => ({ x: 0, y: 0, glide: 0 }));
const PAD_PORTS = [["x1-out", "y1-out"], ["x2-out", "y2-out"], ["x3-out", "y3-out"]] as const;

/**
 * M's Conducting window: the transport above, and the pads — three of them,
 * each sending X and Y from -1 to +1 and gliding toward its target over Glide
 * seconds. Pad 1 is M's baton; the face moves the Variables armed with arrows
 * and the tempo as it goes.
 */
export class MConductorProcessor extends ConductorTransport {
  private current: { x: number; y: number }[] | null = null;
  private sent: (number | null)[] = Array(6).fill(null);

  constructor(build: ProcessorBuild) {
    super(build, "m-conductor");
  }

  reset(atTick: Tick): void {
    super.reset(atTick);
    this.sent = Array(6).fill(null);
  }

  process(window: ProcessWindow): void {
    this.transport(window);
    const pads = this.parameters.json<XYPad[]>("pads", defaultPads());
    const seconds = window.tempo.tickToSeconds(window.endTick) - window.tempo.tickToSeconds(window.startTick);
    if (!this.current) this.current = pads.map((pad) => ({ x: pad.x, y: pad.y }));
    for (let p = 0; p < 3; p++) {
      const target = pads[p] ?? { x: 0, y: 0, glide: 0 };
      const now = this.current[p] ?? { x: target.x, y: target.y };
      const share = target.glide > 0 ? Math.min(1, seconds / target.glide) : 1;
      now.x += (target.x - now.x) * share;
      now.y += (target.y - now.y) * share;
      this.current[p] = now;
      this.send(p * 2, PAD_PORTS[p][0], now.x, window.startTick);
      this.send(p * 2 + 1, PAD_PORTS[p][1], now.y, window.startTick);
    }
  }

  private send(slot: number, port: string, raw: number, atTick: number): void {
    const value = Math.round(Math.max(-1, Math.min(1, raw)) * 1000) / 1000;
    if (this.sent[slot] === value) return;
    const message = this.bus.acquire();
    if (!message) return;
    message.kind = "control";
    message.atTick = atTick;
    message.controlValue = value;
    message.sourceNodeId = this.nodeId;
    this.bus.publish(port, message);
    this.sent[slot] = value;
  }

  status(): Readonly<Record<string, string>> {
    return { ...this.transportStatus(), current: JSON.stringify(this.current ?? []) };
  }
}

/* ===== M Orchestra ===== */

const DEFAULT_ORCHESTRATION = defaultOrchestration();
const DEFAULT_PROGRAMS = defaultPrograms();

/**
 * M's Midi window: each voice's notes copied onto every channel in its
 * orchestration, one output port per channel, and each channel's Sound Choice
 * sent ahead of its notes whenever it changes.
 */
export class MOrchestraProcessor extends MLabProcessor {
  /** The program last sent on each channel; null for none. */
  private sent: (number | null)[] = [];

  constructor(build: ProcessorBuild) {
    super(build, "m-orchestra");
    this.reset(0);
  }

  reset(_atTick: Tick): void {
    this.sent = Array.from({ length: 16 }, () => null);
  }

  process(window: ProcessWindow): void {
    const clamp = (value: number) => Math.max(0, Math.min(5, Math.round(value)));
    const position = clamp(this.parameters.number("position", 0));
    if (!this.sendPrograms(clamp(this.parameters.number("sound-position", 0)), window.startTick)) return;
    const orchestration = this.parameters.json<number[][][]>("orchestration", DEFAULT_ORCHESTRATION);
    const muted = this.parameters.json<boolean[]>("muted", []);
    const notes = this.read("notes-in");
    for (let i = 0; i < notes.count; i++) {
      const note = notes.items[i];
      if (note.kind !== "note-event") continue;
      const channels = orchestration[position]?.[note.voice] ?? DEFAULT_ORCHESTRATION[0][note.voice] ?? [note.voice + 1];
      for (const channel of channels) {
        if (channel < 1 || channel > 16 || muted[channel - 1]) continue;
        const copy = this.bus.acquire();
        if (!copy) return;
        Object.assign(copy, note);
        copy.channel = channel;
        copy.sourceNodeId = this.nodeId;
        this.bus.publish(`channel-${channel}-out`, copy);
      }
    }
  }

  private sendPrograms(position: number, atTick: number): boolean {
    const programs = this.parameters.json<(number | null)[][]>("programs", DEFAULT_PROGRAMS);
    for (let channel = 1; channel <= 16; channel++) {
      const program = programs[position]?.[channel - 1] ?? null;
      if (program === null || program === this.sent[channel - 1]) continue;
      const message = this.bus.acquire();
      if (!message) return false;
      message.kind = "program-change";
      message.atTick = atTick;
      message.channel = channel;
      message.controlValue = program;
      message.sourceNodeId = this.nodeId;
      this.bus.publish(`channel-${channel}-out`, message);
      this.sent[channel - 1] = program;
    }
    return true;
  }
}

const freshStepState = (): StepState => ({ order: { pos: 0, last: -1, bval: 0.5 }, holdNext: false });

/* ===== M NoteSeq ===== */

const NS_PATTERNS = defaultNoteSeqPatterns();
const NS_CELLS = defaultCells();
const NS_LENGTHS = defaultCellLengths();
const NS_ORDER: NoteOrderMix = { original: 100, cyclic: 0, utterly: 0 };
const H_SYNC_BEATS: Readonly<Record<string, number>> = { none: 0, "1": 1, "2": 2, "4": 4, "8": 8, "16": 16 };
const freshCursor = (): NoteOrderCursor => ({ pos: 0, last: -1, bval: 0.5 });
const zeroCounters = (): CyclicCounters => ({ accent: 0, legato: 0, rhythm: 0 });

/**
 * One voice of M as a Numerology note sequencer: M Cyclic's clock and M
 * Pattern's notes in one module, through the same `cyclePicks` → `playStep`
 * the planner runs, with Numerology's rows around them — the start marker,
 * Skip, Mute, Direction, Random Jump, a Velocity lane, Run Mode and H.Sync.
 *
 * Direction picks which active step comes next; M's Note Order then decides
 * whether that step is read from the Original list, the Cyclic-Random
 * (scrambled) list, or replaced by any step at all (Utterly random).
 */
export class MNoteSeqProcessor extends MLabProcessor {
  private origin = 0;
  private clock = 0;
  private counters = zeroCounters();
  private cells = zeroCounters();
  private step = 0;
  private cursor = freshCursor();
  private stepState = freshStepState();
  private gateOpen = false;
  private interval = 0;
  private velocityIn = 0;
  private lastIndex = -1;
  private lastSource = "";
  private lastOnset = 0;
  private resetRequested = false;
  private readonly warp: () => ParameterBag | undefined;

  constructor(build: ProcessorBuild) {
    super(build, "m-noteseq");
    this.warp = build.reference?.("warp-in") ?? (() => undefined);
  }

  reset(atTick: Tick): void {
    this.origin = atTick;
    this.clock = 0;
    this.counters = zeroCounters();
    this.cursor = freshCursor();
    this.stepState = freshStepState();
  }

  /** ⏮ on the face: start again from the start step at the next window. */
  command(id: string): boolean {
    if (id !== "reset") return false;
    this.resetRequested = true;
    return true;
  }

  process(window: ProcessWindow): void {
    type Change = { tick: number; order: number; apply: () => boolean };
    const changes: Change[] = [];
    if (this.resetRequested) {
      this.resetRequested = false;
      this.reset(window.startTick);
    }
    const resets = this.read("sync-in");
    for (let i = 0; i < resets.count; i++) {
      const tick = resets.items[i].atTick;
      changes.push({ tick, order: 0, apply: () => { this.reset(tick); return true; } });
    }
    const beats = H_SYNC_BEATS[String(this.parameters.raw("h-sync") ?? "none")] ?? 0;
    if (beats > 0) {
      const unit = beats * PPQN;
      for (let tick = Math.ceil(window.startTick / unit) * unit; tick < window.endTick; tick += unit) {
        if (tick > 0) changes.push({ tick, order: 0, apply: () => { this.reset(tick); return true; } });
      }
    }
    const controls = (port: string, set: (value: number) => void) => {
      const inbox = this.read(port);
      for (let i = 0; i < inbox.count; i++) {
        const value = inbox.items[i].controlValue;
        changes.push({ tick: inbox.items[i].atTick, order: 1, apply: () => { set(value); return true; } });
      }
    };
    controls("interval-in", (v) => { this.interval = Math.round(v); });
    controls("velocity-in", (v) => { this.velocityIn = v; });
    const mode = String(this.parameters.raw("run-mode") ?? "normal");
    const trigs = this.read("trig-in");
    for (let i = 0; i < trigs.count; i++) {
      const tick = trigs.items[i].atTick;
      const open = trigs.items[i].controlValue > 0;
      changes.push({
        tick, order: 2, apply: () => {
          const rising = open && !this.gateOpen;
          this.gateOpen = open;
          // CV Trig: Step — each gate on plays exactly one step, there and then.
          return mode === "cv-step" && rising ? this.playTriggered(tick) : true;
        },
      });
    }
    changes.sort((a, b) => a.tick - b.tick || a.order - b.order);
    let cursor = window.startTick;
    for (const change of changes) {
      const tick = Math.max(cursor, Math.min(window.endTick, change.tick));
      if (!this.advance(cursor, tick, mode)) return;
      if (!change.apply()) return;
      cursor = tick;
    }
    this.advance(cursor, window.endTick, mode);
  }

  private running(mode: string): boolean {
    if (mode === "manual") return this.parameters.raw("play") !== false;
    if (mode === "cv-gated") return this.gateOpen;
    return mode !== "cv-step";
  }

  /** Play the steps that begin before `to`. False once the budget runs out. */
  private advance(from: number, to: number, mode: string): boolean {
    if (to <= from) return true;
    if (!this.running(mode)) {
      // Waiting — for Play, or for the gate: the voice's clock slides along.
      this.origin += to - from;
      return true;
    }
    const base = this.timeBase();
    if (base <= 0) return true;
    const cycles = this.cycles();
    const warped = this.warpCurve();
    const at = (clock: number) => this.origin + warped(clock);
    for (;;) {
      const onset = at(this.clock);
      if (onset >= to) return true;
      const rng = stepRng(this.key, 0, this.step);
      const picks = cyclePicks(cycles, this.counters, rng);
      const nextClock = this.clock + Math.max(1, base * picks.rhythm);
      const duration = Math.max(1, Math.round(at(nextClock) - onset));
      if (!this.playOne(Math.round(onset), duration, picks, rng)) return false;
      this.counters = picks.next;
      this.clock = nextClock;
      this.step += 1;
    }
  }

  private playTriggered(tick: number): boolean {
    const base = this.timeBase();
    if (base <= 0) return true;
    const rng = stepRng(this.key, 0, this.step);
    const picks = cyclePicks(this.cycles(), this.counters, rng);
    const duration = Math.max(1, Math.round(base * picks.rhythm));
    if (!this.playOne(tick, duration, picks, rng)) return false;
    this.counters = picks.next;
    this.step += 1;
    return true;
  }

  private playOne(onset: number, duration: number, picks: ReturnType<typeof cyclePicks>, rng: Rng): boolean {
    this.cells = picks.cells;
    this.lastOnset = onset;
    const groups = this.parameters.json<VoicePattern[]>("patterns", NS_PATTERNS);
    const group = Math.max(0, Math.min(5, Math.round(this.parameters.number("group", 0))));
    const pattern = groups[group] ?? NS_PATTERNS[group];
    const skip = this.parameters.json<boolean[]>("skip", []);
    const active = activeSteps(pattern.length, this.parameters.number("start", 0), skip, pattern.steps.length);
    if (active.length === 0) return true;
    const dir = String(this.parameters.raw("dir") ?? "fwd") as SeqDirection;
    const next = directionIndex(dir, this.cursor, active.length, rng);
    this.cursor = next.cursor;
    const view: StepPattern = {
      steps: active.map((i) => ({ pitches: pattern.steps[i] ?? [] })),
      scrambledSteps: active.map((i) => ({ pitches: pattern.scrambled[i] ?? [] })),
      outputLength: active.length,
    };
    const played = playStep(
      {
        noteOrderMix: this.parameters.json<NoteOrderMix>("note-order", NS_ORDER),
        density: this.parameters.number("density", 1),
        velocityRange: { low: this.parameters.number("vel-low", 48), high: this.parameters.number("vel-high", 110) },
        transposition: this.parameters.number("transposition", 0) + 12 * this.parameters.number("octave", 0) + this.interval,
        legato: this.parameters.number("legato", 1),
        playEnabled: true,
      },
      view,
      {
        root: this.parameters.number("key", DEFAULT_HARMONY.root),
        scale: (this.parameters.raw("scale") ?? DEFAULT_HARMONY.scale) as ScaleName,
        scaleSnap: this.parameters.raw("scale-snap") === true,
        diatonicTranspose: this.parameters.raw("diatonic") === true,
        chordTones: this.parameters.raw("chord-tones") === true,
      },
      { order: { ...this.stepState.order, pos: next.index }, holdNext: this.stepState.holdNext },
      picks.accentLevel,
      picks.legato,
      0,
      rng,
    );
    this.stepState = played.next;
    const real = active[played.index];
    this.lastIndex = real;
    this.lastSource = played.source;
    // Random Jump: this step's chance that the next one is anywhere at all.
    const jump = this.parameters.json<number[]>("rnd-jump", [])[real] ?? 0;
    if (jump > 0 && rng.next() < jump) this.cursor = { ...this.cursor, pos: rng.int(active.length) };
    const muted = this.parameters.json<boolean[]>("mute", [])[real] === true || this.parameters.raw("mute-all") === true;
    if (muted || played.pitches.length === 0) return true;
    const offset = Math.round(63 * ((this.parameters.json<number[]>("velocity", [])[real] ?? 0) + this.velocityIn));
    const velocity = Math.max(1, Math.min(127, played.velocity + offset));
    const channel = Math.max(1, Math.min(16, Math.round(this.parameters.number("channel", 1))));
    const voice = Math.max(0, Math.min(MAX_VOICES - 1, Math.round(this.parameters.number("voice", 1)) - 1));
    const length = Math.max(1, Math.round(duration * played.lengthFactor));
    for (const note of played.pitches) {
      const message = this.bus.acquire();
      if (!message) return false;
      message.kind = "note-event";
      message.atTick = onset;
      message.durationTicks = length;
      message.stepIndex = real;
      message.note = note;
      message.velocity = velocity;
      message.channel = channel;
      message.gate = 1;
      message.voice = voice;
      message.sourceNodeId = this.nodeId;
      this.bus.publish("notes-out", message);
    }
    return this.sendOut("gate-out", onset, played.lengthFactor)
      && this.sendOut("velocity-out", onset, velocity / 127)
      && this.sendOut("interval-out", onset, played.pitches[0] - (60 + this.parameters.number("key", 0)));
  }

  private sendOut(port: string, atTick: number, value: number): boolean {
    const message = this.bus.acquire();
    if (!message) return false;
    message.kind = "control";
    message.atTick = atTick;
    message.controlValue = value;
    message.sourceNodeId = this.nodeId;
    this.bus.publish(port, message);
    return true;
  }

  private timeBase(): number {
    const numerator = this.parameters.number("rate-num", 1);
    const denominator = this.parameters.number("rate-den", 8);
    return numerator > 0 && denominator > 0 ? stepTicks(numerator, denominator) : 0;
  }

  private cycles(): VoiceCycles {
    const cells = this.parameters.json<SeqCells>("cells", NS_CELLS);
    const lengths = this.parameters.json<SeqCellLengths>("cycle-lengths", NS_LENGTHS);
    const positions = this.parameters.json<CyclePositions>("cycle-positions", DEFAULT_POSITIONS);
    const pick = <T>(table: Record<CyclicVariable, T[]>, fallback: Record<CyclicVariable, T[]>, kind: CyclicVariable): T => {
      const position = positions[kind] ?? 0;
      return table[kind]?.[position] ?? fallback[kind][position] ?? fallback[kind][0];
    };
    return {
      cells: { accent: pick(cells, NS_CELLS, "accent"), legato: pick(cells, NS_CELLS, "legato"), rhythm: pick(cells, NS_CELLS, "rhythm") },
      lengths: { accent: pick(lengths, NS_LENGTHS, "accent"), legato: pick(lengths, NS_LENGTHS, "legato"), rhythm: pick(lengths, NS_LENGTHS, "rhythm") },
      values: this.parameters.json<CycleValues>("cycle-values", DEFAULT_VALUES),
    };
  }

  /** The Time Distortion this voice plays through. */
  private warpCurve(): (clock: number) => number {
    // A Time Warp cabled into Warp In wins; otherwise the NoteSeq's own Warp lane.
    const wired = this.warp();
    const source = wired
      ? { banks: wired.json<WarpBank[]>("banks", []), position: wired.number("position", 0), amount: wired.number("amount", 1) }
      : { banks: this.parameters.json<WarpBank[]>("warp", []), position: this.parameters.number("warp-position", 0), amount: this.parameters.number("warp-amount", 1) };
    const bank = source.banks[Math.max(0, Math.min(5, Math.round(source.position)))];
    if (!bank) return (clock) => clock;
    const map = normalizeTimeMap(warpToTimeMap(bank));
    return (clock) => distortClockTicks(map, clock, source.amount);
  }

  status(): Readonly<Record<string, string>> {
    return {
      index: String(this.lastIndex),
      source: this.lastSource,
      cells: JSON.stringify([this.cells.accent, this.cells.legato, this.cells.rhythm]),
      steps: String(this.step),
      bar: String(Math.floor(this.lastOnset / (4 * PPQN))),
    };
  }
}
