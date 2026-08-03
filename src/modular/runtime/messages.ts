// The per-window message bus that connects compiled processors.
//
// Processors never see each other. Each one reads the buffers belonging to its
// own input ports and writes to its own output ports; the bus routes an output
// to every input the compiled plan connected it to. That keeps a processor a
// pure function of its inputs and its own state, which is what makes a golden
// trace reproducible and a node testable on its own.
//
// Everything here is pooled and reused. A window's messages are released back
// at the end of the window, so steady-state playback allocates nothing beyond
// the buffers that were sized on the first few windows.

import type { Tick } from "./time";

export type MessageKind = "step-clock" | "reset" | "step-event" | "note-event" | "control";

/**
 * One message on a cable.
 *
 * A single flat shape for every kind, for the same reason `RuntimeEvent` is:
 * one hidden class, poolable regardless of type. Fields not meaningful for a
 * kind are left at their reset values.
 *
 * `pitches` references pattern storage rather than copying it. Readers must
 * treat it as immutable — fan-out shares one message object between every
 * destination.
 */
export type StreamMessage = {
  kind: MessageKind;
  atTick: Tick;
  /** Nominal length of a step or note, before legato and gate shaping. */
  durationTicks: number;
  /** Which step of the pattern this came from, for provenance and telemetry. */
  stepIndex: number;
  pitches: readonly number[];
  note: number;
  velocity: number;
  channel: number;
  controlValue: number;
  /** Duration multiplier applied downstream by legato and gate processors. */
  gate: number;
  sourceNodeId: string;
};

const NO_PITCHES: readonly number[] = [];

const blankMessage = (): StreamMessage => ({
  kind: "reset",
  atTick: 0,
  durationTicks: 0,
  stepIndex: 0,
  pitches: NO_PITCHES,
  note: 60,
  velocity: 100,
  channel: 1,
  controlValue: 0,
  gate: 1,
  sourceNodeId: "",
});

const resetMessage = (message: StreamMessage): StreamMessage => {
  message.kind = "reset";
  message.atTick = 0;
  message.durationTicks = 0;
  message.stepIndex = 0;
  message.pitches = NO_PITCHES;
  message.note = 60;
  message.velocity = 100;
  message.channel = 1;
  message.controlValue = 0;
  message.gate = 1;
  message.sourceNodeId = "";
  return message;
};

export class MessagePool {
  private readonly free: StreamMessage[] = [];
  private createdCount = 0;

  constructor(preallocate = 0) {
    for (let i = 0; i < preallocate; i++) {
      this.free.push(blankMessage());
      this.createdCount += 1;
    }
  }

  /** Objects ever constructed. Flat across windows means the path is clean. */
  get created(): number {
    return this.createdCount;
  }

  get available(): number {
    return this.free.length;
  }

  acquire(): StreamMessage {
    const message = this.free.pop();
    if (message) return resetMessage(message);
    this.createdCount += 1;
    return blankMessage();
  }

  release(message: StreamMessage): void {
    this.free.push(message);
  }
}

/** A port's messages for the current window. */
export type PortInbox = {
  items: readonly StreamMessage[];
  count: number;
};

export const portKey = (nodeId: string, portId: string): string => `${nodeId}\u0000${portId}`;

const EMPTY_INBOX: PortInbox = { items: [], count: 0 };

/**
 * Routes messages between ports for one window.
 *
 * Budgets are enforced here rather than inside each processor, so a module
 * author cannot forget to bound its own output. A node that exceeds its budget
 * stops being able to emit for the rest of the window and is reported — the
 * rest of the graph keeps playing.
 */
export class MessageBus {
  private readonly pool: MessagePool;
  private readonly routes = new Map<string, string[]>();
  private readonly inboxes = new Map<string, StreamMessage[]>();
  private readonly counts = new Map<string, number>();
  private readonly issued: StreamMessage[] = [];
  private issuedCount = 0;

  private currentNodeId = "";
  private currentBudget = 0;
  private currentEmitted = 0;
  private overrunNodes = new Set<string>();

  constructor(pool: MessagePool = new MessagePool()) {
    this.pool = pool;
  }

  /** Wire an output port to an input port, as the compiled plan specifies. */
  connect(fromNodeId: string, fromPortId: string, toNodeId: string, toPortId: string): void {
    const from = portKey(fromNodeId, fromPortId);
    const to = portKey(toNodeId, toPortId);
    const targets = this.routes.get(from);
    if (targets) {
      if (!targets.includes(to)) targets.push(to);
    } else this.routes.set(from, [to]);
    if (!this.inboxes.has(to)) {
      this.inboxes.set(to, []);
      this.counts.set(to, 0);
    }
  }

  /** How many nodes hit their emission budget this window. */
  get overrunCount(): number {
    return this.overrunNodes.size;
  }

  /** Which nodes overran, for the diagnostic surfaced on their faces. */
  get overruns(): readonly string[] {
    return [...this.overrunNodes];
  }

  /** Begin one node's turn. Emissions are counted against its budget. */
  beginNode(nodeId: string, budget: number): void {
    this.currentNodeId = nodeId;
    this.currentBudget = budget;
    this.currentEmitted = 0;
  }

  /** True while the current node may still emit. */
  get withinBudget(): boolean {
    return this.currentEmitted < this.currentBudget;
  }

  /**
   * Take a message to fill in. Returns null when the current node has spent
   * its budget, which a processor must treat as "stop generating this window".
   */
  acquire(): StreamMessage | null {
    if (!this.withinBudget) {
      this.overrunNodes.add(this.currentNodeId);
      return null;
    }
    this.currentEmitted += 1;
    const message = this.pool.acquire();
    message.sourceNodeId = this.currentNodeId;
    this.issued[this.issuedCount] = message;
    this.issuedCount += 1;
    return message;
  }

  /**
   * Deliver a filled message to everything connected to `portId`. An output
   * nobody listens to costs one pooled object and nothing else.
   */
  publish(portId: string, message: StreamMessage): void {
    const targets = this.routes.get(portKey(this.currentNodeId, portId));
    if (!targets) return;
    for (const target of targets) {
      const inbox = this.inboxes.get(target) as StreamMessage[];
      const count = this.counts.get(target) as number;
      inbox[count] = message;
      this.counts.set(target, count + 1);
    }
  }

  /** Everything delivered to one input port this window. */
  read(nodeId: string, portId: string): PortInbox {
    const key = portKey(nodeId, portId);
    const inbox = this.inboxes.get(key);
    if (!inbox) return EMPTY_INBOX;
    return { items: inbox, count: this.counts.get(key) as number };
  }

  /** True when anything is wired to this input. */
  isConnected(nodeId: string, portId: string): boolean {
    return this.inboxes.has(portKey(nodeId, portId));
  }

  /** Release the window's messages and empty every inbox. */
  endWindow(): void {
    for (let i = 0; i < this.issuedCount; i++) {
      this.pool.release(this.issued[i]);
      this.issued[i] = undefined as unknown as StreamMessage;
    }
    this.issuedCount = 0;
    for (const key of this.counts.keys()) this.counts.set(key, 0);
    this.overrunNodes.clear();
  }

  /** Drop all routing, for a re-compile. */
  clearRoutes(): void {
    this.endWindow();
    this.routes.clear();
    this.inboxes.clear();
    this.counts.clear();
  }
}
