import { describe, expect, it } from "vitest";
import { createPlayer, PLAYER_BUILDERS } from "./players";
import type { AudioNodeSpec } from "./audioPlan";
import { FakeAudioContext, FakeBuffer, FakeBufferSource } from "./testing/fakeContext";
import { moduleRegistry } from "../registry/registry";

/**
 * The shape every player presents to the rest of the engine.
 *
 * A player is a `ManagedAudioNode` like any effect — the graph adapter wires it,
 * bypasses it, ramps its parameters and disposes it without knowing it is a
 * sampler. That interface is what this covers, once per player, on its own
 * registry defaults: a missing method or a wrong assumption shows up here rather
 * than as a module that goes silent when someone bypasses it.
 */

const buffer = (seconds = 0.5, rate = 48000) => new FakeBuffer(1, seconds * rate, rate);

const sources = (context: FakeAudioContext) =>
  context.created.filter((node): node is FakeBufferSource => node instanceof FakeBufferSource);

const players = Object.keys(PLAYER_BUILDERS);

/** Voices sounding, which only the player classes expose. */
const voicesOf = (player: unknown): number =>
  (player as { activeVoices: number }).activeVoices;

const rig = (moduleType: string, overrides: Partial<AudioNodeSpec> = {}) => {
  const descriptor = moduleRegistry.get(moduleType);
  const parameters = Object.fromEntries(
    (descriptor?.parameters ?? [])
      .filter((parameter) => parameter.kind === "number" || parameter.kind === "boolean")
      .map((parameter) => [parameter.id, Number(parameter.defaultValue) || 0]),
  );
  const context = new FakeAudioContext();
  const wakes: (() => void)[] = [];
  const player = createPlayer(context, {
    nodeId: "p", moduleType, structure: {}, parameters, bypass: false, wet: 1,
    ...overrides,
  }, 0, {
    samples: () => buffer(),
    schedule: (_ms, task) => { wakes.push(task); return () => {}; },
    random: () => 0.5,
  }, () => "linear");
  return { context, player, tick: () => wakes.forEach((wake) => wake()) };
};

describe("Every player, as the graph adapter sees it", () => {
  it("offers an input and an output to wire", () => {
    for (const moduleType of players) {
      const { player } = rig(moduleType);
      expect(player.input, moduleType).toBeDefined();
      expect(player.output, moduleType).toBeDefined();
    }
  });

  it("starts with no voices sounding", () => {
    for (const moduleType of players) {
      expect(voicesOf(rig(moduleType).player), moduleType).toBe(0);
    }
  });

  it("takes bypass and wet without complaint, and without changing route", () => {
    // Bypass belongs to the adapter, which mutes the module's own level. A
    // player accepting the call and doing nothing is the correct behaviour;
    // throwing would break the one path every module shares.
    for (const moduleType of players) {
      const { player } = rig(moduleType);
      expect(() => player.setBypass(true, 0)).not.toThrow();
      expect(() => player.setWet(0.5, 0)).not.toThrow();
      expect(player.output, moduleType).toBeDefined();
    }
  });

  it("goes quiet on demand", () => {
    for (const moduleType of players) {
      const { player } = rig(moduleType);
      expect(() => player.silence(0)).not.toThrow();
      expect(voicesOf(player), moduleType).toBe(0);
    }
  });

  it("takes a note off for a note it never tracked", () => {
    // Percussion and looper voices end on their own envelope; a note-off from
    // upstream is information they do not need and must not choke on.
    for (const moduleType of players) {
      const { player } = rig(moduleType);
      expect(() => player.noteOff(60, 0.5)).not.toThrow();
    }
  });

  it("accepts every numeric parameter its module declares", () => {
    for (const moduleType of players) {
      const descriptor = moduleRegistry.get(moduleType);
      const { player } = rig(moduleType);
      for (const parameter of descriptor?.parameters ?? []) {
        if (parameter.kind !== "number") continue;
        expect(
          () => player.setParameter(parameter.id, Number(parameter.defaultValue) || 0, 0),
          `${moduleType}.${parameter.id}`,
        ).not.toThrow();
      }
    }
  });

  it("disposes cleanly, twice if asked", () => {
    for (const moduleType of players) {
      const { player } = rig(moduleType);
      expect(() => player.dispose()).not.toThrow();
      expect(() => player.dispose(), moduleType).not.toThrow();
    }
  });

  it("stops making sound once disposed", () => {
    for (const moduleType of players) {
      const { context, player } = rig(moduleType, {
        structure: { slots: [{ note: 60, assetId: "a", chokeGroup: 0, gain: 1 }] },
      });
      player.dispose();
      const before = sources(context).length;
      player.noteOn(60, 100, 1);
      expect(sources(context).length, moduleType).toBe(before);
    }
  });

  it("refuses a module type that is not a player", () => {
    expect(() => createPlayer(new FakeAudioContext(), {
      nodeId: "p", moduleType: "m.audio-reverb", structure: {}, parameters: {},
      bypass: false, wet: 1,
    }, 0, { samples: () => undefined }, () => "linear"))
      .toThrow("No player for module type");
  });
});

describe("The granular cloud", () => {
  it("starts and stops free-running from its own parameter", () => {
    const { player } = rig("m.granular", { parameters: { level: 1, "free-run": 0 } });
    const granular = player as unknown as { isRunning: boolean };
    expect(granular.isRunning).toBe(false);

    player.setParameter("free-run", 1, 0);
    expect(granular.isRunning).toBe(true);
    // Asking twice does not start a second cloud.
    player.setParameter("free-run", 1, 0);
    expect(granular.isRunning).toBe(true);

    player.setParameter("free-run", 0, 0);
    expect(granular.isRunning).toBe(false);
  });

  it("schedules grains on its own wake, and stops when disposed", () => {
    const { context, player, tick } = rig("m.granular", {
      parameters: { level: 1, "free-run": 1, "grain-size-ms": 50, density: 8 },
    });
    player.setParameter("free-run", 1, 0);
    tick();
    const running = sources(context).length;
    player.dispose();
    tick();
    expect(sources(context).length).toBe(running);
  });
});
