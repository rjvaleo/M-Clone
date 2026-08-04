import { describe, expect, it } from "vitest";
import { AudioClockBridge, SNAP_THRESHOLD_SEC } from "./clockBridge";
import { VoiceBank, CHOKE_SEC, envelopeLifeSec } from "./voices";
import { GrainScheduler, grainOffsetSec, scanAdvanceUnit, clampGrainSize } from "./grains";
import { createPlayer, isNotePlayer, isPlayerModule, PLAYER_BUILDERS, readPercussionSlots } from "./players";
import { PlayerNoteAdapter } from "./noteAdapter";
import type { AudioNodeSpec } from "./audioPlan";
import type { RuntimeEvent } from "../runtime/eventqueue";
import { FakeAudioContext, FakeBuffer, FakeBufferSource, FakeNode } from "./testing/fakeContext";
import { moduleRegistry } from "../registry/registry";
import { syntheticAssetId } from "./assets";

const buffer = (seconds = 1, rate = 48000) => new FakeBuffer(1, seconds * rate, rate);

const sources = (context: FakeAudioContext) =>
  context.created.filter((node): node is FakeBufferSource => node instanceof FakeBufferSource);

describe("Bridging the runtime clock to the audio clock", () => {
  it("holds the difference between the two", () => {
    const bridge = new AudioClockBridge();
    bridge.sample(10, 4);
    expect(bridge.offset).toBe(6);
    expect(bridge.toAudioTime(5)).toBe(11);
    expect(bridge.ready).toBe(true);
  });

  it("eases toward a new reading rather than following jitter", () => {
    const bridge = new AudioClockBridge({ smoothing: 0.5 });
    bridge.sample(10, 4);
    bridge.sample(10.01, 4);
    // Halfway, not all the way: a single bad sample must not move every note.
    expect(bridge.offset).toBeCloseTo(6.005, 6);
    expect(bridge.snapCount).toBe(0);
  });

  it("snaps when a suspended context makes the clocks jump", () => {
    // Easing across a two-second gap would smear every note over the catch-up.
    const bridge = new AudioClockBridge();
    bridge.sample(10, 4);
    bridge.sample(10, 6);
    expect(bridge.offset).toBe(4);
    expect(bridge.snapCount).toBe(1);
    // A drift smaller than the threshold is still eased.
    const before = bridge.offset;
    bridge.sample(10 + SNAP_THRESHOLD_SEC / 2, 6);
    expect(bridge.snapCount).toBe(1);
    expect(bridge.offset).not.toBe(before);
  });

  it("ignores a reading that is not a number", () => {
    const bridge = new AudioClockBridge();
    bridge.sample(Number.NaN, 1);
    expect(bridge.ready).toBe(false);
  });
});

describe("Voices", () => {
  const rig = () => {
    const context = new FakeAudioContext();
    const out = new FakeNode("out");
    return { context, out, bank: new VoiceBank(context, out) };
  };

  it("plays a buffer into the given destination", () => {
    const { context, out, bank } = rig();
    expect(bank.play(buffer(), { atSec: 1, level: 0.5 })).toBe(true);
    const source = sources(context)[0];
    expect(source.starts).toEqual([1]);
    const gain = [...source.outgoing][0] as FakeNode;
    expect(gain.outgoing.has(out)).toBe(true);
    expect(bank.activeCount).toBe(1);
  });

  it("refuses a missing or empty sample instead of pretending", () => {
    const { bank } = rig();
    expect(bank.play(undefined, { atSec: 0, level: 1 })).toBe(false);
    expect(bank.play(new FakeBuffer(1, 0, 48000), { atSec: 0, level: 1 })).toBe(false);
    expect(bank.activeCount).toBe(0);
  });

  it("chokes only its own group", () => {
    // The hihat rule: an open hat stops when a closed hat is struck, and the
    // kick carries on regardless.
    const { context, bank } = rig();
    bank.play(buffer(), { atSec: 0, level: 1, chokeGroup: 1 });
    bank.play(buffer(), { atSec: 0, level: 1, chokeGroup: 0 });
    expect(bank.activeCount).toBe(2);

    bank.play(buffer(), { atSec: 1, level: 1, chokeGroup: 1 });
    // The first is gone, the ungrouped one and the new one remain.
    expect(bank.activeCount).toBe(2);
    expect(sources(context)[0].stops).toHaveLength(1);
    expect(sources(context)[1].stops).toHaveLength(0);
  });

  it("chokes on the audio clock, not on a wall-clock timer", () => {
    // The prototype used setTimeout(…, 30) to stop the source. Scheduling the
    // stop keeps a choke sample-accurate when the main thread is busy.
    const { context, bank } = rig();
    bank.play(buffer(), { atSec: 0, level: 1, chokeGroup: 2 });
    bank.play(buffer(), { atSec: 5, level: 1, chokeGroup: 2 });
    expect(sources(context)[0].stops[0]).toBeGreaterThanOrEqual(5 + CHOKE_SEC);
  });

  it("steals the oldest voice at the ceiling rather than growing without bound", () => {
    const context = new FakeAudioContext();
    const bank = new VoiceBank(context, new FakeNode("out"), 3);
    for (let i = 0; i < 6; i++) bank.play(buffer(), { atSec: i, level: 1 });
    expect(bank.activeCount).toBeLessThanOrEqual(3);
    expect(bank.startedCount).toBe(6);
  });

  it("frees a decaying voice when its envelope is spent", () => {
    const { context, bank } = rig();
    bank.play(buffer(10), { atSec: 0, level: 1, decaySec: 0.1 });
    // A ten-second buffer under a 100 ms decay is inaudible long before it ends.
    const stop = sources(context)[0].stops[0];
    expect(stop).toBeGreaterThan(0);
    expect(stop).toBeLessThan(1);
  });

  it("lets a loop run rather than cutting it at an envelope", () => {
    const { context, bank } = rig();
    bank.play(buffer(2), { atSec: 0, level: 1, loop: true, loopStartSec: 0.5, loopEndSec: 1.5 });
    const source = sources(context)[0];
    expect(source.loop).toBe(true);
    expect(source.loopStart).toBe(0.5);
    expect(source.loopEnd).toBe(1.5);
    expect(source.stops).toEqual([]);
  });

  it("computes when a voice has become inaudible", () => {
    expect(envelopeLifeSec({ atSec: 0, level: 1 })).toBeNull();
    expect(envelopeLifeSec({ atSec: 0, level: 1, durationSec: 0.3 })).toBe(0.3);
    // Three time constants is about −26 dB: past the point it contributes.
    expect(envelopeLifeSec({ atSec: 0, level: 1, decaySec: 0.1 })).toBeCloseTo(0.3, 6);
  });

  it("silences everything on panic and after disposal", () => {
    const { context, bank } = rig();
    bank.play(buffer(), { atSec: 0, level: 1 });
    bank.play(buffer(), { atSec: 0, level: 1, chokeGroup: 3 });
    bank.panic(2);
    expect(bank.activeCount).toBe(0);
    for (const source of sources(context)) expect(source.stops.length).toBeGreaterThan(0);
    expect(() => bank.dispose()).not.toThrow();
  });
});

describe("Grain scanning", () => {
  it("keeps a grain inside the buffer", () => {
    // A grain running off the end is a click at exactly the moment the scan
    // reaches it — the most noticeable place for one.
    expect(grainOffsetSec(1, 0, 2, 0.2, 0.5)).toBeCloseTo(1.8, 6);
    expect(grainOffsetSec(0, 1, 2, 0.2, 0)).toBe(0);
    expect(grainOffsetSec(0.5, 0, 0.1, 0.2, 0.5)).toBe(0);
  });

  it("moves the scan slower as stretch rises", () => {
    // The whole point of the control: same grain size, same rate of emission,
    // less buffer covered per grain.
    const normal = scanAdvanceUnit(0.08, 4, 1);
    expect(scanAdvanceUnit(0.08, 4, 2)).toBeCloseTo(normal / 2, 9);
    expect(scanAdvanceUnit(0.08, 0, 1)).toBe(0);
    // A stretch of zero would divide by nothing; it is floored instead.
    expect(Number.isFinite(scanAdvanceUnit(0.08, 4, 0))).toBe(true);
  });

  it("clamps a grain size that would click or loop", () => {
    expect(clampGrainSize(0)).toBeGreaterThan(0);
    expect(clampGrainSize(1000)).toBeLessThanOrEqual(2);
    expect(clampGrainSize(Number.NaN)).toBeGreaterThan(0);
  });

  const settings = (overrides: Partial<Parameters<GrainScheduler["advance"]>[2]> = {}) => ({
    sizeSec: 0.2, spacingSec: 0.08, position: 0.5, jitter: 0, stretch: 1, freeze: false, ...overrides,
  });

  it("places every grain in the lookahead window ahead of time", () => {
    const placed: number[] = [];
    const scheduler = new GrainScheduler((grain) => placed.push(grain.atSec), () => 0.5);
    scheduler.start(10, 0);
    scheduler.advance(10, 4, settings(), 0.2);
    // Scheduled, not fired one at a time: a busy main thread changes nothing.
    expect(placed.length).toBeGreaterThan(1);
    expect(Math.max(...placed)).toBeLessThanOrEqual(10.2);
    for (let i = 1; i < placed.length; i++) {
      expect(placed[i] - placed[i - 1]).toBeCloseTo(0.08, 6);
    }
  });

  it("advances the scan, and stops advancing when frozen", () => {
    const scheduler = new GrainScheduler(() => {}, () => 0.5);
    scheduler.start(0, 0);
    scheduler.advance(0, 4, settings(), 0.2);
    const moved = scheduler.position;
    expect(moved).toBeGreaterThan(0);

    const frozen = new GrainScheduler(() => {}, () => 0.5);
    frozen.start(0, 0.25);
    frozen.advance(0, 4, settings({ freeze: true }), 0.2);
    expect(frozen.position).toBe(0.25);
  });

  it("wraps rather than stopping at the end of the buffer", () => {
    const scheduler = new GrainScheduler(() => {}, () => 0.5);
    scheduler.start(0, 0.99);
    scheduler.advance(0, 0.5, settings(), 0.5);
    expect(scheduler.position).toBeGreaterThanOrEqual(0);
    expect(scheduler.position).toBeLessThanOrEqual(1);
  });

  it("does not try to catch up after being idle", () => {
    // A suspended context or a stalled tab must not produce a burst of grains
    // for the time that passed while nothing was running.
    const placed: number[] = [];
    const scheduler = new GrainScheduler((grain) => placed.push(grain.atSec), () => 0.5);
    scheduler.start(0, 0);
    scheduler.advance(0, 4, settings(), 0.2);
    const first = placed.length;
    placed.length = 0;
    scheduler.advance(100, 4, settings(), 0.2);
    expect(placed.every((at) => at >= 100)).toBe(true);
    expect(placed.length).toBeLessThanOrEqual(first + 1);
  });

  it("thins out rather than hanging on an absurd spacing", () => {
    const placed: number[] = [];
    const scheduler = new GrainScheduler((grain) => placed.push(grain.atSec), () => 0.5);
    scheduler.start(0, 0);
    scheduler.advance(0, 4, settings({ spacingSec: 0.0000001 }), 1, 32);
    expect(placed).toHaveLength(32);
  });

  it("does nothing without a buffer or before starting", () => {
    const placed: number[] = [];
    const scheduler = new GrainScheduler((grain) => placed.push(grain.atSec));
    scheduler.advance(0, 4, settings());
    expect(placed).toEqual([]);
    scheduler.start(0, 0);
    scheduler.advance(0, 0, settings());
    expect(placed).toEqual([]);
  });
});

describe("The players", () => {
  const spec = (moduleType: string, overrides: Partial<AudioNodeSpec> = {}): AudioNodeSpec => ({
    nodeId: "p1",
    moduleType,
    structure: {},
    parameters: {},
    bypass: false,
    wet: 1,
    ...overrides,
  });

  const rig = (moduleType: string, overrides: Partial<AudioNodeSpec> = {}, samples?: Map<string, FakeBuffer>) => {
    const context = new FakeAudioContext();
    const pool = samples ?? new Map([["kick", buffer(0.5)]]);
    const wakes: (() => void)[] = [];
    const player = createPlayer(context, spec(moduleType, overrides), 0, {
      samples: (id) => pool.get(id),
      schedule: (_ms, task) => { wakes.push(task); return () => {}; },
      random: () => 0.5,
    }, () => "linear");
    return { context, player, wakes, tick: () => wakes.forEach((wake) => wake()) };
  };

  it("registers a builder for every player in the registry", () => {
    const registered = [...moduleRegistry.values()]
      .filter((descriptor) => descriptor.family === "instrument")
      .map((descriptor) => descriptor.type)
      .sort();
    expect(Object.keys(PLAYER_BUILDERS).sort()).toEqual(registered);
    for (const type of registered) expect(isPlayerModule(type)).toBe(true);
  });

  it("arrives silent and answers to the note adapter", () => {
    const { player } = rig("m.percussion");
    expect(player.level.value).toBe(0);
    expect(isNotePlayer(player)).toBe(true);
  });

  it("fires the percussion slot mapped to a note, and only that one", () => {
    const { context, player } = rig("m.percussion", {
      structure: { slots: [
        { note: 36, assetId: "kick", chokeGroup: 0, gain: 1 },
        { note: 38, assetId: "missing", chokeGroup: 0, gain: 1 },
      ] },
      parameters: { level: 1, "decay-seconds": 0.2 },
    });
    player.noteOn(36, 127, 1);
    expect(sources(context)).toHaveLength(1);
    // A slot pointing at a sample this session lacks is silent, not an error.
    player.noteOn(38, 127, 1);
    expect(sources(context)).toHaveLength(1);
    // And an unmapped note does nothing at all.
    player.noteOn(60, 127, 1);
    expect(sources(context)).toHaveLength(1);
  });

  it("layers two slots sharing one note", () => {
    // Two slots on one note is a legitimate layer; playing only the first would
    // be a rule nobody asked for.
    const { context, player } = rig("m.percussion", {
      structure: { slots: [
        { note: 36, assetId: "kick", chokeGroup: 0, gain: 1 },
        { note: 36, assetId: "kick", chokeGroup: 0, gain: 0.5 },
      ] },
    });
    player.noteOn(36, 100, 0);
    expect(sources(context)).toHaveLength(2);
  });

  it("scales level with velocity", () => {
    const struck = (velocity: number) => {
      const { context, player } = rig("m.percussion", {
        structure: { slots: [{ note: 36, assetId: "kick", chokeGroup: 0, gain: 1 }] },
        parameters: { level: 1 },
      });
      player.noteOn(36, velocity, 0);
      const source = sources(context)[0];
      const gain = [...source.outgoing][0] as never as { gain: { moves(): { value: number }[] } };
      // The second scheduled write is the level. The first is `rampParam`
      // pinning the gain's existing value, and the last is the decay's target
      // of zero — so neither the start nor the end says how hard it hit.
      return gain.gain.moves()[1].value;
    };
    expect(struck(127)).toBeGreaterThan(struck(64));
    expect(struck(64)).toBeGreaterThan(struck(16));
    expect(struck(0)).toBe(0);
  });

  it("reads slots defensively, because they come from a document", () => {
    expect(readPercussionSlots(null)).toEqual([]);
    expect(readPercussionSlots([{}])).toEqual([
      { note: 36, assetId: "", chokeGroup: 0, gain: 1 },
    ]);
    expect(readPercussionSlots([{ note: "x", gain: null }])[0].note).toBe(36);
  });

  it("defaults the percussion kit to something audible with two hats choking", () => {
    const descriptor = moduleRegistry.get("m.percussion");
    const slots = readPercussionSlots(
      descriptor?.parameters.find((parameter) => parameter.id === "slots")?.defaultValue);
    expect(slots).toHaveLength(8);
    expect(slots[0].assetId).toBe(syntheticAssetId("kick"));
    const hats = slots.filter((slot) => slot.chokeGroup === 1);
    expect(hats).toHaveLength(2);
  });

  it("loops a sample and honours its region", () => {
    const { context, player } = rig("m.looper", {
      structure: { "asset-id": "kick" },
      parameters: { loop: 1, "loop-start": 0.25, "loop-end": 0.75, rate: 1, level: 1 },
    });
    player.noteOn(60, 127, 0);
    const source = sources(context)[0];
    expect(source.loop).toBe(true);
    expect(source.loopStart).toBeCloseTo(0.125, 6);
    expect(source.loopEnd).toBeCloseTo(0.375, 6);
  });

  it("holds a loop through note off unless gated", () => {
    const { context, player } = rig("m.looper", {
      structure: { "asset-id": "kick" },
      parameters: { loop: 1 },
    });
    player.noteOn(60, 127, 0);
    player.noteOff(60, 1);
    expect(sources(context)[0].stops).toEqual([]);

    const gated = rig("m.looper", {
      structure: { "asset-id": "kick" },
      parameters: { loop: 1, gate: 1 },
    });
    gated.player.noteOn(60, 127, 0);
    gated.player.noteOff(60, 1);
    expect(sources(gated.context)[0].stops.length).toBeGreaterThan(0);
  });

  it("plays backwards when reversed", () => {
    const { context, player } = rig("m.looper", {
      structure: { "asset-id": "kick" },
      parameters: { reverse: 1, rate: 1 },
    });
    player.noteOn(60, 127, 0);
    expect(sources(context)[0].playbackRate.value).toBeLessThan(0);
  });

  it("emits overlapping grains in time-stretch mode", () => {
    // The mode exists so speed and pitch stop being the same control.
    const { context, player, tick } = rig("m.looper", {
      structure: { "asset-id": "kick" },
      parameters: { "time-stretch": 1, rate: 0.5, "pitch-shift": 0 },
    });
    player.noteOn(60, 127, 0);
    tick();
    expect(sources(context).length).toBeGreaterThan(1);
    // Pitch is untouched by rate here, which is the whole point.
    for (const source of sources(context)) expect(source.playbackRate.value).toBeCloseTo(1, 6);
  });

  it("runs a grain cloud while a note is held", () => {
    const { context, player, tick } = rig("m.granular", {
      structure: { "asset-id": "kick" },
      parameters: { "grain-size": 0.05, "grain-spacing": 0.02, position: 0.5, level: 1 },
    });
    player.noteOn(60, 127, 0);
    tick();
    expect(sources(context).length).toBeGreaterThan(2);
    const before = sources(context).length;
    player.noteOff(60, 1);
    tick();
    // Stopped: no new grains after the note is released.
    expect(sources(context).length).toBe(before);
  });

  it("keeps running past note off when free-running", () => {
    const { player, tick, context } = rig("m.granular", {
      structure: { "asset-id": "kick" },
      parameters: { "free-run": 1, "grain-spacing": 0.05 },
    });
    tick();
    const before = sources(context).length;
    expect(before).toBeGreaterThan(0);
    player.noteOff(60, 1);
    // Time has to move for there to be new grains to place.
    context.currentTime = 1;
    tick();
    expect(sources(context).length).toBeGreaterThan(before);
  });

  it("moves the scan immediately when position is dragged", () => {
    const { player } = rig("m.granular", { structure: { "asset-id": "kick" } });
    player.setParameter("position", 0.8, 0);
    expect((player as unknown as { scanPosition: number }).scanPosition).toBeCloseTo(0.8, 6);
  });

  it("stops its wake when disposed, so a removed module leaves nothing running", () => {
    let cancelled = false;
    const context = new FakeAudioContext();
    const player = createPlayer(context, spec("m.granular", {
      structure: { "asset-id": "kick" },
      parameters: { "free-run": 1 },
    }), 0, {
      samples: () => buffer(),
      schedule: () => () => { cancelled = true; },
    }, () => "linear");
    player.dispose();
    expect(cancelled).toBe(true);
  });
});

describe("Routing note events to players", () => {
  const event = (overrides: Partial<RuntimeEvent> = {}): RuntimeEvent => ({
    type: "note-on",
    atTick: 0,
    atSec: 10,
    sequence: 0,
    portId: "p1",
    channel: 1,
    note: 36,
    velocity: 100,
    program: 0,
    controller: 0,
    value: 0,
    noteId: 1,
    ...overrides,
  });

  class Spy {
    readonly nodeId = "p1";
    readonly ons: { note: number; at: number }[] = [];
    readonly offs: number[] = [];
    silenced = 0;
    noteOn(note: number, _velocity: number, atSec: number) { this.ons.push({ note, at: atSec }); }
    noteOff(_note: number, atSec: number) { this.offs.push(atSec); }
    silence() { this.silenced += 1; }
  }

  const rig = (audioNow = 100, runtimeNow = 10) => {
    const player = new Spy();
    const bridge = new AudioClockBridge();
    const adapter = new PlayerNoteAdapter({
      lookup: (nodeId) => (nodeId === "p1" ? player : undefined),
      bridge,
      audioNow: () => audioNow,
      runtimeNow: () => runtimeNow,
    });
    return { player, adapter, bridge };
  };

  it("converts runtime time to audio time before playing", () => {
    // The two clocks are different hardware; scheduling against the wrong one
    // puts every note in the wrong place.
    const { player, adapter } = rig(100, 10);
    adapter.send([event({ atSec: 12 })], 1);
    expect(player.ons).toEqual([{ note: 36, at: 102 }]);
    expect(adapter.deliveredCount).toBe(1);
  });

  it("plays a late note now rather than dropping it", () => {
    const { player, adapter } = rig(100, 10);
    adapter.send([event({ atSec: 5 })], 1);
    expect(player.ons[0].at).toBe(100);
  });

  it("delivers releases as well as attacks", () => {
    const { player, adapter } = rig(100, 10);
    adapter.send([event({ type: "note-off", atSec: 11 })], 1);
    expect(player.offs).toEqual([101]);
  });

  it("counts an event for a node that is not a player", () => {
    const { adapter } = rig();
    adapter.send([event({ portId: "somewhere-else" })], 1);
    expect(adapter.deliveredCount).toBe(0);
    expect(adapter.droppedCount).toBe(1);
  });

  it("ignores events that are not notes", () => {
    const { player, adapter } = rig();
    adapter.send([event({ type: "control-change" })], 1);
    expect(player.ons).toEqual([]);
    expect(adapter.droppedCount).toBe(0);
  });

  it("respects the count rather than the array length", () => {
    // The runtime's buffer is pooled and reused, so anything past `count` is
    // last window's event still sitting there.
    const { player, adapter } = rig();
    adapter.send([event(), event({ note: 99 })], 1);
    expect(player.ons.map((entry) => entry.note)).toEqual([36]);
  });

  it("silences every player it has touched on panic", () => {
    const { player, adapter } = rig();
    adapter.send([event()], 1);
    adapter.panic();
    expect(player.silenced).toBe(1);
    // Cleared afterwards: panicking twice must not re-silence a stale player.
    adapter.panic();
    expect(player.silenced).toBe(1);
  });

  it("samples both clocks once per batch, not once per event", () => {
    let audioReads = 0;
    const player = new Spy();
    const adapter = new PlayerNoteAdapter({
      lookup: () => player,
      bridge: new AudioClockBridge(),
      audioNow: () => { audioReads += 1; return 100; },
      runtimeNow: () => 10,
    });
    adapter.send([event(), event(), event()], 3);
    // One sampling read plus the per-event floor comparison — never a fresh
    // measurement mid-batch, which would smear a chord across a tick.
    expect(audioReads).toBeLessThanOrEqual(4);
    expect(player.ons).toHaveLength(3);
  });
});
