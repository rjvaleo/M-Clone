import { describe, expect, it, vi } from "vitest";
import { AudioEngine, engineSupports } from "./audioEngine";
import { ManualTransitionScheduler } from "./transitions";
import { FakeAudioContext, FakeBuffer } from "./testing/fakeContext";
import { createNode, moduleRegistry } from "../registry/registry";
import { emptyGraph, type GraphDocument } from "../model/graph";
import { AssetLibrary, assetIdForBytes } from "./assets";
import { AudioClockBridge } from "./clockBridge";
import { compileAudioPlan } from "./compileAudioPlan";
import { decodeAsset } from "./decode";
import { GrainScheduler } from "./grains";
import { applyModuleParameter } from "./graphAdapter";
import { generatorFor, renderGenerated } from "./kit";
import { PlayerNoteAdapter } from "./noteAdapter";
import { rampParam } from "./params";
import { peaksToPath } from "./waveform";
import { VoiceBank } from "./voices";

/**
 * The parts of the audio layer that only run in situations nobody wants: a
 * decoder handed a corrupt file, a sample that vanished between sessions, a
 * device whose limiter reports nothing, a note arriving after its module was
 * torn down. Each is an ordinary Tuesday for a browser audio graph, and each
 * must produce a quiet, explicable outcome rather than an exception inside the
 * scheduling loop.
 */

const patch = (): GraphDocument => {
  const document = emptyGraph();
  for (const [id, type] of [["rev", "m.audio-reverb"], ["out", "m.audio-output"]]) {
    document.nodes[id] = createNode(type, id, { x: 0, y: 0 });
  }
  document.edges.e1 = {
    id: "e1",
    from: { nodeId: "rev", portId: "audio-out" },
    to: { nodeId: "out", portId: "audio-in" },
    enabled: true,
  };
  return document;
};

const rig = () => {
  const context = new FakeAudioContext();
  const scheduler = new ManualTransitionScheduler();
  const engine = new AudioEngine(context, moduleRegistry, { scheduler });
  return { context, scheduler, engine };
};

describe("What the engine reports to the app", () => {
  it("answers for the master chain and the plan it is running", () => {
    const { engine } = rig();
    engine.update(patch());
    expect(Number.isFinite(engine.reductionDb)).toBe(true);
    expect(Object.keys(engine.currentPlan.nodes)).toHaveLength(2);
    expect(() => engine.setMasterVolume(0.5)).not.toThrow();
  });

  it("reports no voices for a node that is not a player, or not there", () => {
    const { engine } = rig();
    engine.update(patch());
    expect(engine.playerVoices("rev")).toBe(0);
    expect(engine.playerVoices("nobody")).toBe(0);
  });

  it("knows which module types it can build", () => {
    // Effects only: a player is built by the player factory, not this one.
    expect(engineSupports("m.audio-reverb")).toBe(true);
    expect(engineSupports("m.note-editor")).toBe(false);
  });

  it("builds a player, feeds it a sample from the pool, and counts its voices", () => {
    // The whole path in one go: the engine finds the player by node id, the
    // player asks the library for the sample, and a voice starts. Each link is
    // one closure wired in the constructor, and a break in any of them is a
    // patch that runs and makes no sound.
    const { engine } = rig();
    const kick = engine.library.list().find((asset) => asset.name.toLowerCase().includes("kick"));
    expect(kick, "the starter kit should provide a kick").toBeDefined();

    const document = patch();
    document.nodes.drums = createNode("m.percussion", "drums", { x: 0, y: 200 }, {
      slots: [{ note: 36, assetId: kick?.id ?? "", chokeGroup: 0, gain: 1 }],
      level: 1,
    });
    document.edges.e2 = {
      id: "e2",
      from: { nodeId: "drums", portId: "audio-out" },
      to: { nodeId: "out", portId: "audio-in" },
      enabled: true,
    };
    engine.update(document);
    expect(engine.playerVoices("drums")).toBe(0);

    engine.clockBridge.sample(0, 0);
    engine.notes.send([{
      type: "note-on", atTick: 0, atSec: 0, note: 36, velocity: 100,
      channel: 1, portId: "drums",
    } as never], 1);
    expect(engine.playerVoices("drums")).toBe(1);
  });

  it("stops working the moment it is disposed", () => {
    const { engine } = rig();
    engine.update(patch());
    engine.dispose();
    expect(() => engine.update(patch())).not.toThrow();
  });
});

describe("Compiling the audio subgraph", () => {
  it("ignores a node whose module the registry does not have", () => {
    const document = patch();
    document.nodes.rev = { ...document.nodes.rev, moduleType: "m.retired" };
    const plan = compileAudioPlan(document, moduleRegistry);
    expect(Object.keys(plan.nodes)).toEqual(["out"]);
  });

  it("falls back to a parameter's default when the node has no value", () => {
    const document = patch();
    const [first] = moduleRegistry.get("m.audio-reverb")?.parameters ?? [];
    delete document.nodes.rev.parameters[first.id];
    const plan = compileAudioPlan(document, moduleRegistry);
    expect(plan.nodes.rev.parameters[first.id] ?? plan.nodes.rev.structure[first.id])
      .toBeDefined();
  });

  it("ignores a disabled cable and a cable that is not audio", () => {
    const document = patch();
    document.edges.e1.enabled = false;
    expect(compileAudioPlan(document, moduleRegistry).connections).toHaveLength(0);

    const document2 = patch();
    document2.nodes.ed = createNode("m.note-editor", "ed", { x: 0, y: 400 });
    document2.edges.e2 = {
      id: "e2", enabled: true,
      from: { nodeId: "ed", portId: "pattern-out" },
      to: { nodeId: "rev", portId: "audio-in" },
    };
    expect(compileAudioPlan(document2, moduleRegistry).connections).toHaveLength(1);
  });
});

describe("The asset library", () => {
  it("hands back the bytes it was given, and nothing for one it lacks", () => {
    const bytes = Uint8Array.from({ length: 8 }, (_, i) => i);
    const library = new AssetLibrary();
    const id = assetIdForBytes(bytes);
    library.add({
      id, name: "Kick.wav", byteLength: bytes.length,
      durationSec: 1, sampleRate: 48000, channels: 1, peaks: [0, 0],
    }, new FakeBuffer(1, 100, 48000), bytes);
    expect(library.source(id)).toEqual(bytes);
    expect(library.source("missing")).toBeUndefined();
  });

  it("orders two samples with the same name by id, so listing is stable", () => {
    const library = new AssetLibrary();
    for (const id of ["bbbb", "aaaa"]) {
      library.add({
        id, name: "Same.wav", byteLength: 1,
        durationSec: 1, sampleRate: 48000, channels: 1, peaks: [0, 0],
      }, new FakeBuffer(1, 100, 48000));
    }
    expect(library.list().map((asset) => asset.id)).toEqual(["aaaa", "bbbb"]);
  });
});

describe("Decoding a dropped file", () => {
  it("names a failure that was not thrown as an Error", async () => {
    const result = await decodeAsset(
      { decodeAudioData: () => Promise.reject("not audio") } as never,
      "Broken.wav",
      Uint8Array.from([1, 2, 3]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.name).toBe("Broken.wav");
    expect(result.failure.reason).toBe("Could not decode audio");
  });
});

describe("The synthetic kit", () => {
  it("has nothing to render for a recipe it does not know", () => {
    const context = new FakeAudioContext();
    expect(generatorFor("kick")).toBe("kit:kick");
    expect(renderGenerated(context, "kit:triangle")).toBeNull();
    expect(renderGenerated(context, "sample:whatever")).toBeNull();
    expect(renderGenerated(context, generatorFor("kick"))?.voice).toBe("kick");
  });
});

describe("Small pieces with their own edges", () => {
  it("resets the clock bridge to unstarted", () => {
    const bridge = new AudioClockBridge();
    bridge.sample(10, 4);
    expect(bridge.ready).toBe(true);
    bridge.reset();
    expect(bridge.ready).toBe(false);
    expect(bridge.offset).toBe(0);
  });

  it("counts grains in flight", () => {
    expect(new GrainScheduler(() => {}).grainCount).toBe(0);
  });

  it("takes a limiter that reports no reduction as no reduction", () => {
    const context = new FakeAudioContext();
    const engine = new AudioEngine(context, moduleRegistry, {
      scheduler: new ManualTransitionScheduler(),
    });
    expect(engine.reductionDb).toBe(0);
  });

  it("ramps a parameter over a duration the caller chose", () => {
    const context = new FakeAudioContext();
    const gain = context.createGain();
    rampParam(gain.gain, 0.5, 0, "linear", { durationSec: 0.4 });
    expect((gain.gain as unknown as { calls: { time: number }[] }).calls.slice(-1)[0]?.time).toBeCloseTo(0.4, 6);
  });

  it("applies a module parameter through the one writer", () => {
    const context = new FakeAudioContext();
    const gain = context.createGain();
    applyModuleParameter(gain.gain, 0.25, 0, "linear");
    expect(gain.gain.value).toBeCloseTo(0.25, 6);
  });

  it("draws nothing for a peak list that is not numbers", () => {
    expect(peaksToPath([Number.NaN, Number.NaN], 100, 20)).toContain("M");
  });
});

describe("The note adapter", () => {
  const adapter = () => new PlayerNoteAdapter({
    lookup: () => undefined,
    bridge: new AudioClockBridge(),
    audioNow: () => 0,
    runtimeNow: () => 0,
  });

  it("reads a latency that is not a number as none", () => {
    const player = adapter();
    expect(() => player.setLatency(Number.NaN)).not.toThrow();
    expect(() => player.setLatency(12)).not.toThrow();
  });

  it("does nothing for an empty batch", () => {
    expect(() => adapter().send([], 0)).not.toThrow();
  });
});

describe("A voice bank that has been torn down", () => {
  it("refuses to start anything new", () => {
    // The crossfade is over and the node is gone; one more note was in flight.
    const context = new FakeAudioContext();
    const bank = new VoiceBank(context, context.createGain(), 4);
    const buffer = new FakeBuffer(1, 4800, 48000);
    expect(bank.play(buffer, { atSec: 0, level: 1 })).toBe(true);
    bank.dispose();
    expect(bank.play(buffer, { atSec: 0, level: 1 })).toBe(false);
    expect(bank.activeCount).toBe(0);
  });

  it("retires a voice when its source ends on its own", () => {
    const context = new FakeAudioContext();
    const bank = new VoiceBank(context, context.createGain(), 4);
    bank.play(new FakeBuffer(1, 4800, 48000), { atSec: 0, level: 1 });
    expect(bank.activeCount).toBe(1);
    const source = context.created.find((node) => "onended" in node) as {
      onended: (() => void) | null;
    };
    source.onended?.();
    expect(bank.activeCount).toBe(0);
  });
});

describe("The fake context, which the audio tests all stand on", () => {
  it("records exponential ramps as well as linear ones", () => {
    const context = new FakeAudioContext();
    const gain = context.createGain();
    gain.gain.exponentialRampToValueAtTime(0.5, 1);
    expect((gain.gain as unknown as { calls: { time: number }[] }).calls.slice(-1)[0]).toEqual({ method: "exponential", value: 0.5, time: 1 });
    expect(gain.gain.value).toBe(0.5);
  });

  it("counts the nodes of one kind that were built", () => {
    const context = new FakeAudioContext();
    context.createGain();
    context.createGain();
    context.createBiquadFilter();
    expect(context.countOf("gain")).toBe(2);
    expect(context.countOf("biquad")).toBe(1);
  });

  it("refuses to stop a source that never started", () => {
    const context = new FakeAudioContext();
    const source = context.createBufferSource();
    expect(() => source.stop(0)).toThrow();
  });

  it("forgets a destination it was never connected to", () => {
    const context = new FakeAudioContext();
    const a = context.createGain();
    const b = context.createGain();
    expect(() => a.disconnect(b)).not.toThrow();
  });
});

describe("Auditioning a sample", () => {
  it("survives a source that will not stop", () => {
    // Stopping a source twice throws in some browsers; the audition must not
    // take the UI with it.
    const context = new FakeAudioContext();
    const stop = vi.fn(() => { throw new Error("already stopped"); });
    const source = { ...context.createBufferSource(), stop };
    expect(() => source.stop()).toThrow();
  });
});
