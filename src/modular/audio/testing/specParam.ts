// An AudioParam that keeps Web Audio's own timeline rules.
//
// `FakeParam` in fakeContext.ts updates `value` the moment anything is
// scheduled. That is convenient and wrong in exactly the way that hid a real
// bug: in a browser `value` is the *intrinsic* value — the default, or the last
// one the audio thread rendered — and scheduling an event does not change it.
// Code that cancels its own events and then pins `param.value` therefore pins
// the default, not what it just scheduled. This param reproduces that, and
// evaluates the event list the way the Web Audio specification does, so a test
// can ask what the audio will actually be at a time.

import { FakeAudioContext, FakeGain } from "./fakeContext";
import type { AudioParamLike } from "../params";
import type { GainNodeLike } from "../nodes";

type SpecEvent =
  | { kind: "set"; time: number; value: number }
  | { kind: "linear"; time: number; value: number }
  | { kind: "target"; time: number; value: number; tau: number };

export class SpecParam implements AudioParamLike {
  private readonly events: SpecEvent[] = [];

  /** Nothing renders here, so the intrinsic value is the default forever. */
  constructor(readonly value: number) {}

  setValueAtTime(value: number, startTime: number): void {
    this.insert({ kind: "set", time: startTime, value });
  }

  linearRampToValueAtTime(value: number, endTime: number): void {
    this.insert({ kind: "linear", time: endTime, value });
  }

  /** Not used by the voice bank; a ramp that cannot reach zero is never asked for. */
  exponentialRampToValueAtTime(): void {
    throw new Error("SpecParam does not model exponential ramps");
  }

  setTargetAtTime(target: number, startTime: number, timeConstant: number): void {
    this.insert({ kind: "target", time: startTime, value: target, tau: timeConstant });
  }

  /** Removes every event at or after the time, as the specification says. */
  cancelScheduledValues(startTime: number): void {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].time >= startTime) this.events.splice(i, 1);
    }
  }

  /** What the parameter will be at `t`, by the specification's rules. */
  valueAt(t: number): number {
    let anchorTime = 0;
    let anchorValue = this.value;
    let target: { value: number; tau: number; start: number; from: number } | null = null;
    const at = (time: number): number =>
      target ? target.value + (target.from - target.value) * Math.exp(-(time - target.start) / target.tau) : anchorValue;

    for (const event of this.events) {
      if (event.kind === "linear") {
        const from = at(anchorTime);
        if (t < event.time) return from + ((event.value - from) * (t - anchorTime)) / (event.time - anchorTime);
        anchorTime = event.time;
        anchorValue = event.value;
        target = null;
        continue;
      }
      if (event.time > t) break;
      if (event.kind === "set") {
        anchorTime = event.time;
        anchorValue = event.value;
        target = null;
      } else {
        const from = at(event.time);
        target = { value: event.value, tau: event.tau, start: event.time, from };
        anchorTime = event.time;
        anchorValue = from;
      }
    }
    return at(t);
  }

  /** Events at one time keep the order they were scheduled in. */
  private insert(event: SpecEvent): void {
    let index = this.events.length;
    while (index > 0 && this.events[index - 1].time > event.time) index--;
    this.events.splice(index, 0, event);
  }
}

/** A fake context whose gains keep Web Audio's timeline rules. */
export class SpecContext extends FakeAudioContext {
  createGain(): GainNodeLike {
    const gain = super.createGain() as FakeGain;
    Object.defineProperty(gain, "gain", { value: new SpecParam(1) });
    return gain;
  }
}

/** The spec param behind a gain made by `SpecContext`. */
export const specGain = (node: unknown): SpecParam => (node as { gain: SpecParam }).gain;
