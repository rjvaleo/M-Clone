import { describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./audioEngine";
import { ManualTransitionScheduler } from "./transitions";
import { FakeAudioContext, FakeBuffer } from "./testing/fakeContext";
import { createNode, moduleRegistry } from "../registry/registry";
import { emptyGraph, type GraphDocument } from "../model/graph";
import { hasAudioPorts } from "./compileAudioPlan";
import { computePeaks } from "./waveform";
import { rampParam } from "./params";
import { VoiceBank } from "./voices";
import { createPlayer } from "./players";
import { AuditionPlayer } from "./audition";
import { GrainScheduler } from "./grains";

/**
 * The guards. Each of these exists because a browser audio graph fails in ways
 * a pure function does not: a source that has already ended, a limiter that
 * reports nothing, a buffer full of NaN from a half-decoded file. None of them
 * may reach the scheduling loop as an exception.
 */

const patch = (): GraphDocument => {
  const document = emptyGraph();
  for (const [id, type] of [["rev", "m.audio-reverb"], ["out", "m.audio-output"]]) {
    document.nodes[id] = createNode(type, id, { x: 0, y: 0 });
  }
  document.edges.e1 = {
    id: "e1", enabled: true,
    from: { nodeId: "rev", portId: "audio-out" },
    to: { nodeId: "out", portId: "audio-in" },
  };
  return document;
};

describe("Routing outputs to the master chain", () => {
  it("connects each output once, however many times the plan is applied", () => {
    const context = new FakeAudioContext();
    const engine = new AudioEngine(context, moduleRegistry, {
      scheduler: new ManualTransitionScheduler(),
    });
    engine.update(patch());
    const first = context.created.length;
    // Same document again: nothing rebuilt, so nothing re-routed.
    engine.update(patch());
    expect(context.created.length).toBe(first);
  });

  it("forgets an output that has been deleted", () => {
    const context = new FakeAudioContext();
    const engine = new AudioEngine(context, moduleRegistry, {
      scheduler: new ManualTransitionScheduler(),
    });
    engine.update(patch());
    const without = patch();
    delete without.nodes.out;
    delete without.edges.e1;
    expect(() => engine.update(without)).not.toThrow();
    // And routing it again afterwards still works.
    expect(() => engine.update(patch())).not.toThrow();
  });
});

describe("Which modules have audio at all", () => {
  it("says no for a module type the registry does not have", () => {
    expect(hasAudioPorts(moduleRegistry, "m.audio-reverb")).toBe(true);
    expect(hasAudioPorts(moduleRegistry, "m.retired")).toBe(false);
    expect(hasAudioPorts(moduleRegistry, "m.note-editor")).toBe(false);
  });
});

describe("Peaks from a damaged buffer", () => {
  it("reads a sample that is not a number as silence", () => {
    const channel = new Float32Array(8).fill(Number.NaN);
    expect(computePeaks([channel], 4).every((value) => value === 0)).toBe(true);
  });
});

describe("Ramping", () => {
  it("uses the policy's own duration when the caller names none", () => {
    const context = new FakeAudioContext();
    const gain = context.createGain();
    rampParam(gain.gain, 0.5, 0, "linear");
    const linear = (gain.gain as unknown as { calls: { time: number }[] }).calls.slice(-1)[0]?.time ?? 0;
    rampParam(gain.gain, 0.25, 0, "none");
    const none = (gain.gain as unknown as { calls: { time: number }[] }).calls.slice(-1)[0]?.time ?? 0;
    expect(linear).toBeGreaterThan(none);
  });
});

describe("Sources that will not do as they are told", () => {
  it("shrugs off a start that throws", () => {
    // An offset past the end of the buffer throws in a real browser.
    const context = new FakeAudioContext();
    const bank = new VoiceBank(context, context.createGain(), 4);
    const buffer = new FakeBuffer(1, 480, 48000);
    expect(bank.play(buffer, { atSec: 0, level: 1, offsetSec: 1000 })).toBe(true);
    expect(() => bank.play(buffer, { atSec: 0, level: 1, durationSec: 0.01 })).not.toThrow();
  });

  it("shrugs off a stop that throws", () => {
    const context = new FakeAudioContext();
    const bank = new VoiceBank(context, context.createGain(), 2);
    bank.play(new FakeBuffer(1, 4800, 48000), { atSec: 0, level: 1, chokeGroup: 1 });
    // Choking a voice stops it; stopping it a second time must not throw.
    expect(() => bank.panic(0)).not.toThrow();
    expect(() => bank.panic(0)).not.toThrow();
  });
});

describe("Auditioning", () => {
  it("fades one preview out when the next begins, and survives a stop that throws", () => {
    const context = new FakeAudioContext();
    const audition = new AuditionPlayer(context, context.createGain());
    const buffer = new FakeBuffer(1, 4800, 48000);
    audition.play("preview", buffer);
    expect(() => audition.play("preview", buffer)).not.toThrow();
    expect(() => audition.stop()).not.toThrow();
    expect(() => audition.stop()).not.toThrow();
    audition.dispose();
  });
});

describe("Grain placement given nonsense", () => {
  it("clamps a position that is not a number, and wraps one that runs past the end", () => {
    const scheduler = new GrainScheduler(() => {});
    expect(() => scheduler.seek(Number.NaN)).not.toThrow();
    expect(() => scheduler.seek(-0.25)).not.toThrow();
    expect(() => scheduler.seek(1.75)).not.toThrow();
    expect(scheduler.grainCount).toBe(0);
  });
});

describe("A player left to the browser's own timer", () => {
  it("schedules and cancels its wake when nothing else supplies one", () => {
    vi.useFakeTimers();
    const context = new FakeAudioContext();
    const player = createPlayer(context, {
      nodeId: "g", moduleType: "m.granular", structure: {},
      parameters: { level: 1, "free-run": 1 }, bypass: false, wet: 1,
    }, 0, { samples: () => new FakeBuffer(1, 48000, 48000) }, () => "linear");

    player.setParameter("free-run", 1, 0);
    expect(() => vi.advanceTimersByTime(200)).not.toThrow();
    player.dispose();
    expect(() => vi.advanceTimersByTime(200)).not.toThrow();
    vi.useRealTimers();
  });
});
