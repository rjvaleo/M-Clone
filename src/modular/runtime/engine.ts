// The scheduling loop.
//
// One wake does exactly this, in this order:
//
//   1. sample the presentation clock and measure how late the wake was;
//   2. recover if that lateness was a real stall;
//   3. work out this window's tick span from the tempo map;
//   4. apply the parameter edits that come due inside it;
//   5. run every processor once, in compiled order;
//   6. convert the events that fall inside the window to seconds and hand
//      them to the adapters;
//   7. report telemetry, last, where it cannot delay anything that makes sound.
//
// The loop never reads the document, never re-derives what changed, and never
// allocates in steady state. It compares `plan.generation`, and that is all.

import type { GraphDocument, JsonValue } from "../model/graph";
import { materializeStreamCompounds } from "../model/stream";
import type { CompiledPlan } from "../compiler/compileGraph";
import type { ModuleRegistry } from "../registry/registry";
import {
  EventHeap,
  EventPool,
  type RuntimeEvent,
} from "./eventqueue";
import { MessageBus, MessagePool } from "./messages";
import {
  ParameterQueue,
  nextStepBoundary,
  scheduledTickFor,
  type MorphPolicy,
} from "./parameters";
import {
  EMPTY_PATTERN,
  ParameterBag,
  PROCESSOR_FACTORIES,
  TransportProcessor,
  NoteOrderProcessor,
  type PatternView,
  type ProcessWindow,
  type ScheduledEventSink,
  type StreamProcessor,
} from "./processors";
import {
  SchedulingMonitor,
  TelemetryRing,
  type SchedulingConfig,
  type SchedulingDiagnostics,
} from "./scheduling";
import type { SchedulerDriver } from "./clock";
import { PPQN, TempoMap, type Tick } from "./time";

/** Where scheduled events go. Adapters own their own device state. */
export interface OutputAdapter {
  readonly id: string;
  /**
   * Send `count` events from `events`. The array and its objects are pooled
   * and reused immediately after this returns, so an adapter that needs to
   * keep anything must copy it.
   */
  send(events: readonly RuntimeEvent[], count: number): void;
  /** Release everything sounding, now. */
  panic(): void;
  dispose?(): void;
}

export type TelemetryEntry = {
  kind: "note" | "window";
  nodeId: string;
  atTick: Tick;
  note: number;
  velocity: number;
  channel: number;
};

export type RuntimeOptions = {
  registry: ModuleRegistry;
  driver: SchedulerDriver;
  /** Audio time source. Injected so tests can drive time by hand. */
  clock: { nowSec(): number };
  seed?: number;
  tempoBpm?: number;
  wakeIntervalMs?: number;
  scheduling?: Partial<SchedulingConfig>;
  telemetryCapacity?: number;
  /** How far ahead of `now` playback begins, so the first window is not late. */
  startLeadSec?: number;
};

type NodeRuntime = {
  nodeId: string;
  moduleType: string;
  processor: StreamProcessor;
  parameters: ParameterBag;
  /** Step length used to quantize step-locked parameter edits for this node. */
  stepTicks: number;
};

const DEFAULT_WAKE_MS = 25;
const DEFAULT_START_LEAD_SEC = 0.06;
/** Attacks later than this are dropped rather than replayed after a stall. */
const LATE_ATTACK_GRACE_SEC = 0.02;

export class ModularRuntime {
  private readonly options: Required<Omit<RuntimeOptions, "scheduling">> & {
    scheduling: Partial<SchedulingConfig>;
  };
  private readonly monitor: SchedulingMonitor;
  private readonly telemetryRing: TelemetryRing<TelemetryEntry>;
  private readonly eventPool = new EventPool(256);
  private readonly messagePool = new MessagePool(256);
  private readonly heap = new EventHeap();
  private readonly bus: MessageBus;
  private readonly parameterQueue = new ParameterQueue();
  private readonly drainBuffer: RuntimeEvent[] = [];
  private readonly adapters: OutputAdapter[] = [];

  private nodes = new Map<string, NodeRuntime>();
  private order: readonly string[] = [];
  private plan: CompiledPlan | null = null;
  private transport: TransportProcessor | null = null;

  private tempo: TempoMap;
  private windowEndTick: Tick = 0;
  private expectedWakeSec = 0;
  private pausedAtSec: number | null = null;
  private running = false;

  private readonly sink: ScheduledEventSink;

  constructor(options: RuntimeOptions) {
    this.options = {
      registry: options.registry,
      driver: options.driver,
      clock: options.clock,
      seed: options.seed ?? 0,
      tempoBpm: options.tempoBpm ?? 120,
      wakeIntervalMs: options.wakeIntervalMs ?? DEFAULT_WAKE_MS,
      telemetryCapacity: options.telemetryCapacity ?? 2048,
      startLeadSec: options.startLeadSec ?? DEFAULT_START_LEAD_SEC,
      scheduling: options.scheduling ?? {},
    };
    this.monitor = new SchedulingMonitor(this.options.scheduling);
    this.telemetryRing = new TelemetryRing<TelemetryEntry>(this.options.telemetryCapacity);
    this.bus = new MessageBus(this.messagePool);
    this.tempo = new TempoMap(this.options.tempoBpm, 0);
    this.sink = {
      acquire: () => this.eventPool.acquire(),
      submit: (event) => this.heap.push(event),
    };
  }

  get isRunning(): boolean {
    return this.running;
  }

  get generation(): number {
    return this.plan?.generation ?? 0;
  }

  /** Current musical position. */
  get positionTick(): Tick {
    return this.windowEndTick;
  }

  get tempoMap(): TempoMap {
    return this.tempo;
  }

  addAdapter(adapter: OutputAdapter): void {
    this.adapters.push(adapter);
  }

  diagnostics(): SchedulingDiagnostics {
    return this.monitor.snapshot();
  }

  /**
   * How many pooled objects have ever been constructed. A value that stops
   * growing once playback settles is the allocation-budget assertion: the
   * scheduling path is reusing everything rather than making garbage.
   */
  poolStats(): { events: number; messages: number } {
    return { events: this.eventPool.created, messages: this.messagePool.created };
  }

  /** Take buffered telemetry. Intended to be called once per animation frame. */
  drainTelemetry(): TelemetryEntry[] {
    return this.telemetryRing.drain();
  }

  /** Read-only, lossy values for one node face; never used by scheduling. */
  nodeStatus(nodeId: string): Readonly<Record<string, string>> {
    const node = this.nodes.get(nodeId);
    if (!node) return {};
    const status: Record<string, string> = { ...(node.processor.status?.() ?? {}) };
    if (node.moduleType === "m.transport-clock") {
      const beats = Math.floor(this.windowEndTick / PPQN);
      status.position = `${this.running ? "Playing" : "Stopped"} · ${Math.floor(beats / 4) + 1}.${beats % 4 + 1}`;
    }
    return status;
  }

  /**
   * Instantiate the compiled plan.
   *
   * Called on a plan generation change and nowhere else. Processor state is
   * created here, once, and mutated in place for the rest of the plan's life.
   */
  build(graph: GraphDocument, plan: CompiledPlan): void {
    const runtimeGraph = materializeStreamCompounds(graph);
    this.bus.clearRoutes();
    this.nodes = new Map();
    this.transport = null;
    this.plan = plan;
    this.order = plan.order;

    for (const edge of Object.values(runtimeGraph.edges)) {
      if (!edge.enabled) continue;
      if (!runtimeGraph.nodes[edge.from.nodeId]?.enabled) continue;
      if (!runtimeGraph.nodes[edge.to.nodeId]?.enabled) continue;
      this.bus.connect(edge.from.nodeId, edge.from.portId, edge.to.nodeId, edge.to.portId);
    }

    for (const nodeId of plan.order) {
      const node = runtimeGraph.nodes[nodeId];
      const factory = PROCESSOR_FACTORIES[node.moduleType];
      const parameters = new ParameterBag(node.parameters);
      if (!factory) {
        // A node with no executable processor is still a legitimate document
        // node — a Note Editor holds pattern material without running.
        this.nodes.set(nodeId, {
          nodeId,
          moduleType: node.moduleType,
          processor: inertProcessor(nodeId),
          parameters,
          stepTicks: PPQN / 4,
        });
        continue;
      }
      const processor = factory({
        nodeId,
        parameters,
        bus: this.bus,
        budget: plan.eventBudgetPerNode,
        seed: this.options.seed,
        pattern: this.patternProviderFor(runtimeGraph, nodeId),
        sink: this.sink,
      });
      if (processor instanceof TransportProcessor) this.transport = processor;
      this.nodes.set(nodeId, {
        nodeId,
        moduleType: node.moduleType,
        processor,
        parameters,
        stepTicks: stepTicksFor(parameters, node.moduleType),
      });
    }
  }

  /**
   * Pattern material is state, not events, so a Note Order reads its editor
   * by reference. Resolved once at build time; the returned view always
   * reflects the editor's current parameters.
   */
  private patternProviderFor(
    graph: GraphDocument,
    nodeId: string,
  ): (() => PatternView) | undefined {
    const edge = Object.values(graph.edges).find(
      (candidate) =>
        candidate.enabled && candidate.to.nodeId === nodeId && candidate.to.portId === "pattern-in",
    );
    if (!edge) return undefined;
    const sourceId = edge.from.nodeId;
    return () => {
      const source = this.nodes.get(sourceId);
      if (!source) return EMPTY_PATTERN;
      return patternView(source.parameters);
    };
  }

  /** Queue a live control change, landing per the parameter's morph policy. */
  queueParameter(
    nodeId: string,
    parameterId: string,
    value: JsonValue,
    morph: MorphPolicy = "immediate",
  ): void {
    const node = this.nodes.get(nodeId);
    const earliest = this.windowEndTick;
    const boundary = nextStepBoundary(earliest, node?.stepTicks ?? PPQN / 4);
    this.parameterQueue.push(
      nodeId,
      parameterId,
      value,
      scheduledTickFor(morph, earliest, boundary),
    );
  }

  /** Read a live parameter, for the node face. */
  parameterValue(nodeId: string, parameterId: string): JsonValue | undefined {
    return this.nodes.get(nodeId)?.parameters.raw(parameterId);
  }

  /**
   * How far ahead of `now` the music begins.
   *
   * The first window is not computed until the first wake arrives, which can
   * be a whole wake interval away. If the music were due to start before that,
   * its opening notes would already be in the past and would be dropped as
   * stale attacks — so a patch would open differently depending on the wake
   * interval. The lead therefore always covers at least two wakes.
   */
  private effectiveStartLeadSec(): number {
    return Math.max(this.options.startLeadSec, (this.options.wakeIntervalMs / 1000) * 2);
  }

  start(): void {
    if (this.running) return;
    const now = this.options.clock.nowSec();
    this.tempo = new TempoMap(this.options.tempoBpm, now + this.effectiveStartLeadSec());
    this.windowEndTick = 0;
    this.pausedAtSec = null;
    this.heap.clear(this.eventPool);
    this.parameterQueue.clear();
    this.monitor.reset();
    for (const node of this.nodes.values()) node.processor.reset(0);
    this.expectedWakeSec = now + this.options.wakeIntervalMs / 1000;
    this.running = true;
    this.options.driver.start(() => this.tick(), this.options.wakeIntervalMs);
  }

  /** Stop scheduling but keep the musical position. */
  pause(): void {
    if (!this.running) return;
    this.options.driver.stop();
    this.running = false;
    this.pausedAtSec = this.options.clock.nowSec();
    this.heap.clear(this.eventPool);
    this.panic();
  }

  /** Continue from where the cursor was, not from the top. */
  resume(): void {
    if (this.running) return;
    if (this.pausedAtSec === null) {
      this.start();
      return;
    }
    const now = this.options.clock.nowSec();
    // The entire implementation of resume: one map slides along real time and
    // every stream is still exactly in phase.
    this.tempo.shiftSeconds(now - this.pausedAtSec);
    this.pausedAtSec = null;
    this.expectedWakeSec = now + this.options.wakeIntervalMs / 1000;
    this.running = true;
    this.options.driver.start(() => this.tick(), this.options.wakeIntervalMs);
  }

  stop(): void {
    this.options.driver.stop();
    this.running = false;
    this.pausedAtSec = null;
    this.heap.clear(this.eventPool);
    this.parameterQueue.clear();
    this.panic();
  }

  /** M's Sync: every stream returns to the top together. */
  sync(): void {
    this.heap.clear(this.eventPool);
    this.panic();
    for (const node of this.nodes.values()) node.processor.reset(this.windowEndTick);
    this.transport?.requestReset(this.windowEndTick);
  }

  /** ReScramble the Cyclic material of one Note Order. */
  rescramble(nodeId: string): boolean {
    const processor = this.nodes.get(nodeId)?.processor;
    if (processor instanceof NoteOrderProcessor) {
      processor.rescramble();
      return true;
    }
    return false;
  }

  panic(): void {
    for (const adapter of this.adapters) adapter.panic();
  }

  dispose(): void {
    this.stop();
    for (const adapter of this.adapters) adapter.dispose?.();
    this.adapters.length = 0;
    this.options.driver.dispose();
  }

  /** One scheduling wake. Public so tests can drive windows deterministically. */
  tick(): void {
    if (!this.plan) return;
    const now = this.options.clock.nowSec();
    const decision = this.monitor.observeWake(now, this.expectedWakeSec, this.heap.size);
    this.expectedWakeSec = now + this.options.wakeIntervalMs / 1000;
    if (decision.recover) this.recoverFromStall(now);

    const endTick = this.tempo.secondsToTickFloor(now + decision.lookaheadSec) + 1;
    if (endTick <= this.windowEndTick) return;
    const window: ProcessWindow = {
      startTick: this.windowEndTick,
      endTick,
      tempo: this.tempo,
    };

    for (const edit of this.parameterQueue.drainThrough(endTick)) {
      this.nodes.get(edit.nodeId)?.parameters.set(edit.parameterId, edit.value);
    }

    for (const nodeId of this.order) {
      const node = this.nodes.get(nodeId);
      if (!node) continue;
      this.bus.beginNode(nodeId, this.plan.eventBudgetPerNode);
      node.processor.process(window);
    }
    for (let i = 0; i < this.bus.overrunCount; i++) this.monitor.recordBudgetOverrun();
    this.bus.endWindow();
    this.windowEndTick = endTick;

    this.submit(endTick, now);
  }

  /**
   * Hand the window's events to the adapters.
   *
   * This is the one place ticks become seconds. Late attacks are compacted out
   * in place rather than filtered into a new array, because this runs on every
   * window for the life of the session.
   */
  private submit(endTick: Tick, nowSec: number): void {
    const drained = this.heap.drainBefore(endTick, this.drainBuffer);
    if (drained === 0) return;
    const cutoff = nowSec - LATE_ATTACK_GRACE_SEC;
    let kept = 0;
    let dropped = 0;
    for (let i = 0; i < drained; i++) {
      const event = this.drainBuffer[i];
      event.atSec = this.tempo.tickToSeconds(event.atTick);
      // A stale release still repairs a device; a stale attack is just noise.
      if (event.type === "note-on" && event.atSec < cutoff) {
        this.eventPool.release(event);
        dropped += 1;
        continue;
      }
      this.drainBuffer[kept] = event;
      kept += 1;
    }
    if (dropped > 0) this.monitor.recordDroppedEvents(dropped);
    if (kept === 0) return;

    this.monitor.observeBatch(this.drainBuffer, nowSec, kept);
    for (const adapter of this.adapters) adapter.send(this.drainBuffer, kept);

    for (let i = 0; i < kept; i++) {
      const event = this.drainBuffer[i];
      if (event.type === "note-on") {
        this.telemetryRing.push({
          kind: "note",
          nodeId: event.portId,
          atTick: event.atTick,
          note: event.note,
          velocity: event.velocity,
          channel: event.channel,
        });
      }
    }
    this.eventPool.releaseAll(this.drainBuffer, kept);
    for (let i = 0; i < kept; i++) {
      this.drainBuffer[i] = undefined as unknown as RuntimeEvent;
    }
  }

  /**
   * Come back from a stall without replaying the missed music.
   *
   * The tempo map slides so the next unplayed tick lands just ahead of now.
   * Every stream keeps its phase relationship for free, because there is only
   * one map to move.
   */
  private recoverFromStall(nowSec: number): void {
    this.panic();
    this.heap.clear(this.eventPool);
    this.bus.endWindow();
    const nextSec = this.tempo.tickToSeconds(this.windowEndTick);
    const target = nowSec + this.effectiveStartLeadSec();
    if (target > nextSec) this.tempo.shiftSeconds(target - nextSec);
  }
}

/** A document node with no runtime behavior, such as a Note Editor. */
function inertProcessor(nodeId: string): StreamProcessor {
  return {
    nodeId,
    process: () => undefined,
    reset: () => undefined,
  };
}

/** The step length a node's step-locked parameter edits quantize to. */
function stepTicksFor(parameters: ParameterBag, moduleType: string): number {
  if (moduleType !== "m.time-base") return PPQN / 4;
  const denominator = parameters.number("denominator", 16);
  if (denominator <= 0) return PPQN / 4;
  return Math.max(1, Math.round((PPQN * 4 * parameters.number("numerator", 1)) / denominator));
}

/** The Note Editor's active pattern position, as a Note Order sees it. */
export function patternView(parameters: ParameterBag): PatternView {
  const presets = parameters.json<number[][][]>("preset-values", []);
  if (!Array.isArray(presets) || presets.length === 0) return EMPTY_PATTERN;
  const position = Math.min(
    presets.length - 1,
    Math.max(0, Math.round(parameters.number("active-position", 0))),
  );
  const steps = presets[position];
  if (!Array.isArray(steps)) return EMPTY_PATTERN;
  return {
    steps,
    outputLength: Math.max(0, Math.round(parameters.number("output-length", steps.length))),
  };
}

/**
 * An adapter that keeps what it was sent. The runtime recycles its event
 * objects immediately, so every field is copied out.
 */
export class RecordingAdapter implements OutputAdapter {
  readonly id: string;
  readonly events: RuntimeEvent[] = [];
  panicCount = 0;

  constructor(id = "recorder") {
    this.id = id;
  }

  send(events: readonly RuntimeEvent[], count: number): void {
    for (let i = 0; i < count; i++) this.events.push({ ...events[i] });
  }

  panic(): void {
    this.panicCount += 1;
  }

  /** A compact trace for golden-trace assertions. */
  trace(): string[] {
    return this.events.map(
      (event) => `${event.atTick} ${event.type} ${event.channel} ${event.note} ${event.velocity}`,
    );
  }

  clear(): void {
    this.events.length = 0;
  }
}
