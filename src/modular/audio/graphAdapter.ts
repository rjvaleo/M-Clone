// Applying an audio plan diff to real nodes.
//
// This is the only place in the audio layer that constructs, connects or drops
// a Web Audio node, which is what makes the safety contract checkable: leaks,
// clicks and churn all have exactly one file to be absent from.
//
// The adapter owns three guarantees:
//
//   1. **No churn.** A diff with no topology in it produces no construction,
//      no connect and no disconnect — only scheduled ramps.
//   2. **No clicks.** Anything arriving fades in from silence; anything leaving
//      fades out to silence and is disposed only after the fade has finished.
//   3. **No leaks.** Every node the adapter builds is tracked until it is
//      disposed, so a test can assert the count returns to where it started.

import { fadeParam, holdParam, rampParam, type AudioParamLike, type SmoothingPolicy } from "./params";
import {
  connectionKey,
  emptyAudioPlan,
  type AudioConnection,
  type AudioNodeSpec,
  type AudioPlan,
  type AudioPlanDiff,
} from "./audioPlan";
import { crossfadeSchedule, CROSSFADE_SEC, type TransitionScheduler } from "./transitions";

/** The slice of `AudioNode` used here. */
export interface AudioNodeLike {
  connect(destination: AudioNodeLike): void;
  disconnect(destination?: AudioNodeLike): void;
}

/**
 * One compiled module.
 *
 * `level` is the adapter's crossfade handle — the module exposes it and does
 * not otherwise touch it, so fading is never something a module author has to
 * remember to implement.
 */
export interface ManagedAudioNode {
  readonly nodeId: string;
  readonly input: AudioNodeLike;
  readonly output: AudioNodeLike;
  readonly level: AudioParamLike;
  /** Ramp one of the module's own parameters. */
  setParameter(parameterId: string, value: number, atSec: number): void;
  /** Bypass may suspend DSP; wet at zero must not. */
  setBypass(bypass: boolean, atSec: number): void;
  setWet(wet: number, atSec: number): void;
  /** Release every resource. Called only after the fade-out has completed. */
  dispose(): void;

  /**
   * Per-port wiring, for modules with more than one audio port.
   *
   * `AudioConnection` has always carried a `portId` — `connectionKey` includes
   * it, so the plan can distinguish two wires between the same pair of nodes —
   * but the adapter had nowhere to send it and collapsed every audio port onto
   * the single `input`/`output` pair. That was correct while every audio module
   * was one-in-one-out. The DP/4+ is four-in-four-out, and folding its four
   * inputs together would silently destroy the two-, three- and four-source
   * configurations that are the whole point of the machine.
   *
   * Both are optional and both fall back to `input`/`output`, so every existing
   * module is unaffected and no existing test changes.
   */
  inputFor?(portId: string): AudioNodeLike;
  outputFor?(portId: string): AudioNodeLike;
}

/** Resolve a connection endpoint, honouring per-port wiring when offered. */
const sourceNode = (node: ManagedAudioNode, portId: string): AudioNodeLike =>
  node.outputFor?.(portId) ?? node.output;

const destinationNode = (node: ManagedAudioNode, portId: string): AudioNodeLike =>
  node.inputFor?.(portId) ?? node.input;

export interface AudioModuleFactory {
  create(spec: AudioNodeSpec, atSec: number): ManagedAudioNode;
  /** How a module's parameter should move, from the registry descriptor. */
  smoothingFor(moduleType: string, parameterId: string): SmoothingPolicy;
}

export type AdapterOptions = {
  crossfadeSec?: number;
};

export class AudioGraphAdapter {
  private readonly factory: AudioModuleFactory;
  private readonly scheduler: TransitionScheduler;
  private readonly crossfadeSec: number;

  private readonly live = new Map<string, ManagedAudioNode>();
  /** Faded out, not yet disposed. Still real nodes, so still counted. */
  private readonly retiring = new Set<ManagedAudioNode>();
  private readonly connections = new Map<string, AudioConnection>();
  private plan: AudioPlan = emptyAudioPlan();

  private builtCount = 0;
  private disposedCount = 0;
  private connectCount = 0;
  private disconnectCount = 0;

  constructor(
    factory: AudioModuleFactory,
    scheduler: TransitionScheduler,
    options: AdapterOptions = {},
  ) {
    this.factory = factory;
    this.scheduler = scheduler;
    this.crossfadeSec = options.crossfadeSec ?? CROSSFADE_SEC;
  }

  /** Nodes that exist right now, including those waiting to be disposed. */
  get liveNodeCount(): number {
    return this.live.size + this.retiring.size;
  }

  /** Nodes still fading out. Zero once every transition has settled. */
  get retiringCount(): number {
    return this.retiring.size;
  }

  get currentPlan(): AudioPlan {
    return this.plan;
  }

  /** Lifetime counters, for leak and churn assertions. */
  stats(): { built: number; disposed: number; connects: number; disconnects: number } {
    return {
      built: this.builtCount,
      disposed: this.disposedCount,
      connects: this.connectCount,
      disconnects: this.disconnectCount,
    };
  }

  node(nodeId: string): ManagedAudioNode | undefined {
    return this.live.get(nodeId);
  }

  /**
   * Bring the real graph in line with `plan`.
   *
   * The order matters: outgoing nodes start fading before incoming ones are
   * wired in, and disconnection happens on a timer after both ramps are done,
   * so at no point is a path to the output simply cut.
   */
  apply(diff: AudioPlanDiff, plan: AudioPlan): void {
    const now = this.scheduler.now();
    const schedule = crossfadeSchedule(now, this.crossfadeSec);

    // 1. Retire what is leaving, including the old copy of anything rebuilt.
    const leaving = [
      ...diff.removed,
      ...diff.rebuilt.map((spec) => spec.nodeId),
    ];
    for (const nodeId of leaving) {
      const existing = this.live.get(nodeId);
      if (!existing) continue;
      this.live.delete(nodeId);
      this.retiring.add(existing);
      fadeParam(existing.level, 0, schedule.fadeStartSec, this.crossfadeSec);
      this.scheduler.after(schedule.disposeDelaySec, () => this.retire(existing));
    }

    // 2. Explicit disconnections, also deferred until the fade has finished.
    for (const connection of diff.disconnected) {
      const key = connectionKey(connection);
      if (!this.connections.has(key)) continue;
      this.connections.delete(key);
      const from = this.live.get(connection.from.nodeId);
      const to = this.live.get(connection.to.nodeId);
      if (!from || !to) continue;
      const src = sourceNode(from, connection.from.portId);
      const dst = destinationNode(to, connection.to.portId);
      this.scheduler.after(schedule.disposeDelaySec, () => {
        src.disconnect(dst);
        this.disconnectCount += 1;
      });
    }

    // 3. Build what is arriving, silent, then fade it up.
    for (const spec of [...diff.added, ...diff.rebuilt]) {
      const created = this.factory.create(spec, schedule.fadeStartSec);
      this.builtCount += 1;
      this.live.set(spec.nodeId, created);
      // Silent first, so wiring it in cannot be heard as a step.
      fadeParam(created.level, 0, schedule.fadeStartSec, 0);
      created.setBypass(spec.bypass, schedule.fadeStartSec);
      created.setWet(spec.wet, schedule.fadeStartSec);
      fadeParam(created.level, spec.bypass ? 0 : 1, schedule.fadeStartSec, this.crossfadeSec);
    }

    // 4. Wire the new shape.
    for (const connection of diff.connected) {
      const from = this.live.get(connection.from.nodeId);
      const to = this.live.get(connection.to.nodeId);
      if (!from || !to) continue;
      sourceNode(from, connection.from.portId).connect(destinationNode(to, connection.to.portId));
      this.connections.set(connectionKey(connection), connection);
      this.connectCount += 1;
    }

    // 5. Movable state. Nothing here constructs or connects anything.
    for (const change of diff.parameters) {
      this.live.get(change.nodeId)?.setParameter(change.parameterId, change.value, now);
    }
    for (const change of diff.bypass) {
      const node = this.live.get(change.nodeId);
      if (!node) continue;
      node.setBypass(change.bypass, now);
      // Bypass is a level change, not a disconnection: the node stays wired so
      // it can be switched back without another topology edit.
      fadeParam(node.level, change.bypass ? 0 : 1, now, this.crossfadeSec);
    }
    for (const change of diff.wet) {
      this.live.get(change.nodeId)?.setWet(change.wet, now);
    }

    this.plan = plan;
  }

  /** Ramp a single parameter outside a plan change, for live control moves. */
  setParameter(nodeId: string, parameterId: string, value: number): void {
    this.live.get(nodeId)?.setParameter(parameterId, value, this.scheduler.now());
  }

  /**
   * Stop everything moving without stepping any value.
   *
   * Cancelling automation alone would let a scheduled ramp's final value snap
   * in, which is the click panic is supposed to prevent.
   */
  panic(): void {
    const now = this.scheduler.now();
    for (const node of this.live.values()) holdParam(node.level, now);
    for (const node of this.retiring) holdParam(node.level, now);
  }

  /** Drop the whole graph. Nothing is left tracked afterwards. */
  dispose(): void {
    this.scheduler.cancelAll();
    for (const node of this.retiring) this.retire(node);
    for (const node of [...this.live.values()]) {
      this.live.delete(node.nodeId);
      node.output.disconnect();
      node.dispose();
      this.disposedCount += 1;
    }
    this.connections.clear();
    this.plan = emptyAudioPlan();
  }

  private retire(node: ManagedAudioNode): void {
    if (!this.retiring.delete(node)) return;
    node.output.disconnect();
    node.dispose();
    this.disposedCount += 1;
  }
}

/** Convenience for module authors: ramp a parameter per its declared policy. */
export function applyModuleParameter(
  param: AudioParamLike,
  value: number,
  atSec: number,
  smoothing: SmoothingPolicy,
): void {
  rampParam(param, value, atSec, smoothing);
}
