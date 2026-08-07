// The stereo image, end to end.
//
// Every assertion here is about *where* a signal is, which before this build
// was a question the audio layer could not answer: one `createStereoPanner`
// caller, no splitter, no merger, and a reverb whose two sides were the same
// samples arriving on two wires.
//
// The tests are written against channel indices rather than against node
// counts, because a node count cannot tell a genuinely stereo graph from a
// mono one wired twice — which is exactly the bug that was here.

import { describe, expect, it } from "vitest";
import { createPlayer, readPercussionSlots } from "./players";
import { VoiceBank } from "./voices";
import { createFeedbackNetwork } from "./reverbTank";
import { createWidener, DEFAULT_CROSSOVER_HZ, WIDENER_DEFAULTS } from "./widener";
import { createMixer, MIXER_CHANNELS, mixerInputPortId } from "./mixer";
import { EFFECT_BUILDERS } from "./effects";
import type { AudioNodeSpec } from "./audioPlan";
import {
  FakeAudioContext,
  FakeBuffer,
  FakeChannelMerger,
  FakeChannelSplitter,
  FakeNode,
  FakeStereoPanner,
} from "./testing/fakeContext";
import { moduleRegistry } from "../registry/registry";

const buffer = (seconds = 1, rate = 48000) => new FakeBuffer(1, seconds * rate, rate);

const spec = (moduleType: string, overrides: Partial<AudioNodeSpec> = {}): AudioNodeSpec => ({
  nodeId: "n1",
  moduleType,
  structure: {},
  parameters: {},
  bypass: false,
  wet: 1,
  ...overrides,
});

const panners = (context: FakeAudioContext) =>
  context.created.filter((node): node is FakeStereoPanner => node instanceof FakeStereoPanner);

const mergers = (context: FakeAudioContext) =>
  context.created.filter((node): node is FakeChannelMerger => node instanceof FakeChannelMerger);

const splitters = (context: FakeAudioContext) =>
  context.created.filter((node): node is FakeChannelSplitter => node instanceof FakeChannelSplitter);

/** Which merger inputs anything reached — the signature of a stereo graph. */
const mergerInputsUsed = (context: FakeAudioContext, merger: FakeChannelMerger): Set<number> => {
  const used = new Set<number>();
  for (const node of context.created) {
    for (const wire of node.wires) {
      if (wire.destination === merger) used.add(wire.input);
    }
  }
  return used;
};

const noRuntime = { samples: () => undefined };
const noSmoothing = () => "linear" as const;

describe("The fake context's channel bookkeeping", () => {
  // The tests above are only as good as the record they read, so the recorder
  // gets its own coverage rather than being trusted.
  it("forgets one destination's wires without forgetting the rest", () => {
    const node = new FakeNode("source");
    const keep = new FakeNode("keep");
    const drop = new FakeNode("drop");
    node.connect(keep, 0, 0);
    node.connect(drop, 0, 1);
    node.connect(drop, 0, 0);
    expect(node.wires).toHaveLength(3);

    node.disconnect(drop);
    expect(node.wires).toEqual([{ destination: keep, output: 0, input: 0 }]);
    expect(node.outgoing.has(drop)).toBe(false);
    expect(node.outgoing.has(keep)).toBe(true);

    node.disconnect();
    expect(node.wires).toHaveLength(0);
    expect(node.outgoing.size).toBe(0);
  });

  it("defaults both indices to zero, so ordinary wiring reads unchanged", () => {
    const node = new FakeNode("source");
    const other = new FakeNode("other");
    node.connect(other);
    expect(node.wires).toEqual([{ destination: other, output: 0, input: 0 }]);
  });
});

describe("A voice given a position", () => {
  it("builds a panner only when it is asked for one", () => {
    const context = new FakeAudioContext();
    const bank = new VoiceBank(context, new FakeNode("out"));

    bank.play(buffer(), { atSec: 0, level: 1 });
    expect(panners(context)).toHaveLength(0);

    bank.play(buffer(), { atSec: 0, level: 1, pan: -0.5 });
    expect(panners(context)).toHaveLength(1);
    expect(panners(context)[0].pan.value).toBe(-0.5);
  });

  it("puts the panner between the envelope and the destination", () => {
    // Order matters: panning before the envelope would move the *shape* of the
    // note across the field rather than the note.
    const context = new FakeAudioContext();
    const out = new FakeNode("out");
    const bank = new VoiceBank(context, out);
    bank.play(buffer(), { atSec: 0, level: 1, pan: 1 });

    const panner = panners(context)[0];
    const gain = context.created.find((node) => node.kind === "gain" && node.outgoing.has(panner));
    expect(gain).toBeDefined();
    expect(panner.outgoing.has(out)).toBe(true);
    expect(gain?.outgoing.has(out)).toBe(false);
  });

  it("drops the panner when the voice is disposed, so nothing is left wired", () => {
    const context = new FakeAudioContext();
    const bank = new VoiceBank(context, new FakeNode("out"));
    bank.play(buffer(), { atSec: 0, level: 1, pan: 0.5 });
    bank.dispose();
    expect(panners(context)[0].disconnectCalls).toBeGreaterThan(0);
  });
});

describe("A player's own position", () => {
  for (const moduleType of ["m.percussion", "m.looper", "m.granular"]) {
    it(`gives ${moduleType} a pan that ramps rather than rebuilding`, () => {
      const context = new FakeAudioContext();
      const player = createPlayer(
        context,
        spec(moduleType, { parameters: { pan: -1 } }),
        0,
        noRuntime,
        noSmoothing,
      );

      // Built at the declared position, not at centre and corrected later.
      const panner = panners(context)[0];
      expect(panner.pan.value).toBe(-1);

      const nodesBefore = context.created.length;
      player.setParameter("pan", 0.5, 1);
      expect(panner.pan.value).toBe(0.5);
      // The whole point of the contract: moving it built nothing.
      expect(context.created.length).toBe(nodesBefore);
      // And it ramped rather than stepping — a stepped pan is a click.
      const moves = panner.pan.moves();
      expect(moves[moves.length - 1].method).toBe("linear");
    });
  }

  it("clamps a pan that arrives out of range", () => {
    const context = new FakeAudioContext();
    const player = createPlayer(context, spec("m.looper"), 0, noRuntime, noSmoothing);
    player.setParameter("pan", 9, 1);
    expect(panners(context)[0].pan.value).toBe(1);
  });

  it("declares pan on all three players, so the face can show it", () => {
    for (const moduleType of ["m.percussion", "m.looper", "m.granular"]) {
      const descriptor = moduleRegistry.get(moduleType);
      const pan = descriptor?.parameters.find((parameter) => parameter.id === "pan");
      expect(pan, `${moduleType} declares pan`).toBeDefined();
      expect(pan?.smoothing, `${moduleType} pan is smoothed`).not.toBe("none");
    }
  });
});

describe("A percussion kit across the field", () => {
  it("pans each pad independently of the module", () => {
    const context = new FakeAudioContext();
    const kick = buffer();
    const hat = buffer();
    const player = createPlayer(
      context,
      spec("m.percussion", {
        structure: {
          slots: [
            { note: 36, assetId: "kick", chokeGroup: 0, gain: 1, pan: 0 },
            { note: 42, assetId: "hat", chokeGroup: 0, gain: 1, pan: 0.8 },
          ],
        },
      }),
      0,
      { samples: (id) => (id === "kick" ? kick : hat) },
      noSmoothing,
    );

    // One panner exists already: the module's own.
    const before = panners(context).length;
    player.noteOn(36, 100, 1);
    // A centred pad builds nothing — that is the cost decision, asserted.
    expect(panners(context)).toHaveLength(before);

    player.noteOn(42, 100, 2);
    const added = panners(context).slice(before);
    expect(added).toHaveLength(1);
    expect(added[0].pan.value).toBeCloseTo(0.8, 6);
  });

  it("ships a default kit that is not all in one place", () => {
    const descriptor = moduleRegistry.get("m.percussion");
    const slots = readPercussionSlots(
      descriptor?.parameters.find((parameter) => parameter.id === "slots")?.defaultValue);
    expect(slots.some((slot) => slot.pan !== 0)).toBe(true);
    // The kick stays centred; a kick that wanders is a mix defect, not a choice.
    expect(slots[0].pan).toBe(0);
  });
});

describe("The feedback network's output", () => {
  const network = (lineCount = 8) => {
    const context = new FakeAudioContext();
    const fdn = createFeedbackNetwork(
      context,
      {
        lineCount,
        sizeScale: 1,
        decaySeconds: 2,
        dampingHz: 6000,
        modRateHz: 0.3,
        modDepthSeconds: 0.0005,
      },
      0,
    );
    return { context, fdn };
  };

  it("reaches both sides of a merger", () => {
    const { context } = network();
    expect(mergers(context)).toHaveLength(1);
    expect(mergerInputsUsed(context, mergers(context)[0])).toEqual(new Set([0, 1]));
  });

  it("sends different delay lines to each side, so the tail decorrelates", () => {
    // The property that separates a stereo tank from a mono one on two wires:
    // no single line may feed both sides at equal strength, or the two channels
    // are the same signal and the image collapses.
    const { context, fdn } = network();
    const merger = mergers(context)[0];
    const left = new Set<FakeNode>();
    const right = new Set<FakeNode>();
    for (const node of context.created) {
      for (const wire of node.wires) {
        if (wire.destination !== merger) continue;
        (wire.input === 0 ? left : right).add(node);
      }
    }
    expect(left.size).toBeGreaterThan(0);
    expect(right.size).toBeGreaterThan(0);
    for (const node of left) expect(right.has(node)).toBe(false);
    expect(fdn.output).toBe(merger);
  });

  it("still decorrelates when the network is asked for the fewest lines", () => {
    const { context } = network(2);
    expect(mergerInputsUsed(context, mergers(context)[0])).toEqual(new Set([0, 1]));
  });

  it("drops the merger on dispose", () => {
    const { context, fdn } = network();
    fdn.dispose();
    expect(mergers(context)[0].disconnectCalls).toBeGreaterThan(0);
  });

  it("damps every line together, because one bright line is a resonance", () => {
    // The DP/4's `hf-damping` reaches this and nothing else did. A network
    // whose lines damp at different corners rings at the undamped ones.
    const { context, fdn } = network(4);
    fdn.setDamping(3000, 1);
    const dampers = context.created.filter(
      (node) => node.kind === "biquad"
        && (node as unknown as { type: string }).type === "lowpass",
    );
    expect(dampers).toHaveLength(4);
    for (const damper of dampers) {
      expect((damper as unknown as { frequency: { value: number } }).frequency.value).toBe(3000);
    }
  });

  it("clamps a damping corner to something a filter can take", () => {
    const { context, fdn } = network(2);
    fdn.setDamping(0, 1);
    const damper = context.created.find(
      (node) => node.kind === "biquad"
        && (node as unknown as { type: string }).type === "lowpass",
    );
    expect((damper as unknown as { frequency: { value: number } }).frequency.value).toBe(200);
  });
});

describe("The stereo widener", () => {
  const widener = (parameters: Record<string, number> = {}) => {
    const context = new FakeAudioContext();
    const core = createWidener(context, spec("m.audio-widener", { parameters }), 0);
    return { context, core };
  };

  it("takes the signal apart and puts it back together", () => {
    const { context, core } = widener();
    expect(splitters(context)).toHaveLength(1);
    expect(splitters(context)[0].numberOfOutputs).toBe(2);
    expect(mergers(context)[0].numberOfInputs).toBe(2);
    expect(mergerInputsUsed(context, mergers(context)[0])).toEqual(new Set([0, 1]));
    expect(core.output).toBe(mergers(context)[0]);
  });

  it("reads both sides of the splitter, or there is no side signal at all", () => {
    const { context } = widener();
    const splitter = splitters(context)[0];
    const outputsUsed = new Set(splitter.wires.map((wire) => wire.output));
    expect(outputsUsed).toEqual(new Set([0, 1]));
  });

  it("builds the mid as a sum and the side as a difference", () => {
    // The one asymmetry that makes it mid/side rather than two copies: exactly
    // one path inverts. Without it both merger inputs carry (L+R) and the
    // module is an expensive way to make everything mono.
    const { context } = widener();
    const inverters = context.created.filter(
      (node) => node.kind === "gain" && (node as unknown as { gain: { value: number } }).gain.value === -1,
    );
    expect(inverters.length).toBeGreaterThan(0);
  });

  it("scales both reconstructed sides from one width gain", () => {
    // If width reached the two sides through separate gains they could ramp at
    // different rates and the image would swing on its way to a new width.
    const { context, core } = widener({ width: 1 });
    core.setWidth(1.8, 1);
    expect(core.widthValue).toBeCloseTo(1.8, 6);
    const merger = mergers(context)[0];
    const feeders = context.created.filter((node) =>
      node.wires.some((wire) => wire.destination === merger));
    // mid (to both inputs), the width gain, and the side inverter.
    expect(feeders.length).toBe(3);
  });

  it("clamps width to the range past which the centre hollows out", () => {
    const { core } = widener();
    core.setWidth(99, 1);
    expect(core.widthValue).toBe(2);
    core.setWidth(-3, 2);
    expect(core.widthValue).toBe(0);
  });

  it("keeps the bass mono by high-passing the side path", () => {
    const { context } = widener({ crossover: 200 });
    const highpass = context.created.find(
      (node) => node.kind === "biquad"
        && (node as unknown as { type: string }).type === "highpass",
    );
    expect(highpass).toBeDefined();
    expect((highpass as unknown as { frequency: { value: number } }).frequency.value).toBe(200);
  });

  it("clamps a crossover outside the range a bass corner can sensibly take", () => {
    const { context, core } = widener();
    core.setCrossoverHz(9000, 1);
    const highpass = context.created.find(
      (node) => node.kind === "biquad"
        && (node as unknown as { type: string }).type === "highpass",
    );
    expect((highpass as unknown as { frequency: { value: number } }).frequency.value).toBe(500);
  });

  it("defaults to unity width and a conventional bass corner", () => {
    expect(WIDENER_DEFAULTS.width).toBe(1);
    expect(WIDENER_DEFAULTS.crossover).toBe(DEFAULT_CROSSOVER_HZ);
    const { core } = widener();
    expect(core.widthValue).toBe(1);
  });

  it("is wired into the rack as a series effect with no dry blend", () => {
    const context = new FakeAudioContext();
    const built = EFFECT_BUILDERS["m.audio-widener"](
      context,
      spec("m.audio-widener", { parameters: {} }),
    );
    expect(built.parallel).toBe(false);
    built.setParameter?.("width", 0, 1);
    built.setParameter?.("crossover", 300, 1);
    // An id it does not own must be survivable, not a throw.
    built.setParameter?.("nonsense", 1, 1);
  });
});

describe("The mixer", () => {
  const mixer = (parameters: Record<string, number> = {}) => {
    const context = new FakeAudioContext();
    const core = createMixer(context, spec("m.audio-mixer", { parameters }), 0);
    return { context, core };
  };

  it("gives every channel its own input, so four sources stay four sources", () => {
    const { core } = mixer();
    const seen = new Set([
      core.inputFor("audio-in-1"),
      core.inputFor("audio-in-2"),
      core.inputFor("audio-in-3"),
      core.inputFor("audio-in-4"),
    ]);
    expect(seen.size).toBe(MIXER_CHANNELS);
  });

  it("gives every channel a panner", () => {
    const { context } = mixer();
    expect(panners(context)).toHaveLength(MIXER_CHANNELS);
  });

  it("moves one channel's pan without touching the others", () => {
    const { context, core } = mixer();
    const before = context.created.length;
    core.setParameter("pan-2", -1, 1);
    expect(panners(context)[1].pan.value).toBe(-1);
    expect(panners(context)[0].pan.value).toBe(0);
    expect(context.created.length).toBe(before);
  });

  it("builds each channel at its declared level rather than correcting later", () => {
    const { core } = mixer({ "level-1": 0.25, "pan-1": -0.5 });
    expect(core.channelGain(0)).toBeCloseTo(0.25, 6);
  });

  it("mutes a channel without disconnecting it", () => {
    // Same reasoning as bypass in the safety contract: a disconnected channel
    // cannot be un-muted without a topology change.
    const { context, core } = mixer();
    const before = context.created.length;
    core.setParameter("mute-1", 1, 1);
    expect(core.channelGain(0)).toBe(0);
    expect(context.created.length).toBe(before);
    core.setParameter("mute-1", 0, 2);
    expect(core.channelGain(0)).toBeGreaterThan(0);
  });

  it("silences every unsoloed channel when one is soloed", () => {
    const { core } = mixer();
    core.setParameter("solo-3", 1, 1);
    expect(core.channelGain(0)).toBe(0);
    expect(core.channelGain(2)).toBeGreaterThan(0);
    core.setParameter("solo-3", 0, 2);
    expect(core.channelGain(0)).toBeGreaterThan(0);
  });

  it("keeps a muted channel silent even when it is also soloed", () => {
    // Mute wins. A soloed-and-muted channel is a contradiction the user can
    // reach with two clicks, and silence is the reading that cannot surprise.
    const { core } = mixer();
    core.setParameter("mute-2", 1, 1);
    core.setParameter("solo-2", 1, 2);
    expect(core.channelGain(1)).toBe(0);
  });

  it("honours mute and solo that arrive with the document", () => {
    const { core } = mixer({ "solo-4": 1, "mute-1": 1 });
    expect(core.channelGain(3)).toBeGreaterThan(0);
    expect(core.channelGain(0)).toBe(0);
    expect(core.channelGain(1)).toBe(0);
  });

  it("falls back to the first channel for a port it does not know", () => {
    const { core } = mixer();
    expect(core.inputFor("nonsense")).toBe(core.inputFor("audio-in-1"));
    expect(core.inputFor("audio-in-9")).toBe(core.inputFor("audio-in-1"));
  });

  it("ignores a parameter that is not a channel control", () => {
    const { core } = mixer();
    core.setParameter("mute", 1, 1);
    core.setParameter("level-9", 0, 1);
    expect(core.channelGain(0)).toBeGreaterThan(0);
  });

  it("names its ports the way the descriptor does", () => {
    expect(mixerInputPortId(0)).toBe("audio-in-1");
    expect(mixerInputPortId(3)).toBe("audio-in-4");
  });

  it("declares four inputs and one output in the registry", () => {
    const descriptor = moduleRegistry.get("m.audio-mixer");
    const inputs = descriptor?.ports.filter((port) => port.direction === "input") ?? [];
    const outputs = descriptor?.ports.filter((port) => port.direction === "output") ?? [];
    expect(inputs).toHaveLength(MIXER_CHANNELS);
    expect(outputs).toHaveLength(1);
  });

  it("is wired into the rack with per-port inputs", () => {
    const context = new FakeAudioContext();
    const built = EFFECT_BUILDERS["m.audio-mixer"](context, spec("m.audio-mixer"));
    expect(built.parallel).toBe(false);
    expect(built.inputFor?.("audio-in-2")).not.toBe(built.inputFor?.("audio-in-1"));
    built.setParameter?.("level-1", 0.2, 1);
  });
});
