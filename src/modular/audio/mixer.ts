// The mixer — four channels, each with a level, a position, a mute and a solo.
//
// `MODULAR_IMPLEMENTATION_PLAN.md` §12 Phase 6 asks for "mixer/master output,
// metering, mute/solo/pan/fader", and `AUDIO_ENGINE_SPEC.md` §15 gives every
// instrument channel "level, pan, mute, solo". This is that node.
//
//     in₁ ─► gain₁ ─► pan₁ ─┐
//     in₂ ─► gain₂ ─► pan₂ ─┤
//     in₃ ─► gain₃ ─► pan₃ ─┼─► sum ─► out
//     in₄ ─► gain₄ ─► pan₄ ─┘
//
// ## Four inputs, not one
//
// A mixer whose four cables were summed at a single input would be a gain node
// with extra controls, so it takes the DP/4's route: `inputFor` gives each port
// its own node, and the four stay four until the sum bus. That is the same
// mechanism, for the same reason — the machine's defining feature is that its
// inputs are independent.
//
// ## Why mute is a gain and not a disconnection
//
// The audio safety contract's rule about bypass applies here unchanged: a
// disconnected channel cannot be un-muted without a topology change, and a
// topology change during a performance is a crossfade the user did not ask
// for. Mute is a ramp to zero on a channel that stays wired.
//
// ## Solo is a property of the whole strip, not of one channel
//
// Soloing channel 3 has to silence 1, 2 and 4, so no single channel's control
// owns the answer. The effective gain of every channel is recomputed whenever
// any mute or solo moves, which is also what makes un-soloing restore exactly
// the levels that were there before rather than a remembered guess.

import type { AudioNodeSpec } from "./audioPlan";
import type { AudioNodeLike } from "./graphAdapter";
import type { EffectContext, GainNodeLike, StereoPannerNodeLike } from "./nodes";
import { rampParam } from "./params";
import { clamp, numberOr, setNow } from "./reverbTank";
import { clampPan } from "./voices";

/** Four is what fits a face without a scroll; more channels are more mixers. */
export const MIXER_CHANNELS = 4;

/** `audio-in-1` … `audio-in-4`. Ports are 1-based because faces are. */
export const mixerInputPortId = (index: number): string => `audio-in-${index + 1}`;

const channelIndexFromPort = (portId: string): number => {
  const match = /^audio-in-([1-9][0-9]*)$/.exec(portId);
  if (!match) return 0;
  const index = Number.parseInt(match[1], 10) - 1;
  return index >= 0 && index < MIXER_CHANNELS ? index : 0;
};

type Channel = {
  input: GainNodeLike;
  gain: GainNodeLike;
  panner: StereoPannerNodeLike;
  level: number;
  muted: boolean;
  soloed: boolean;
};

export type MixerCore = {
  input: AudioNodeLike;
  output: AudioNodeLike;
  owned: readonly AudioNodeLike[];
  inputFor(portId: string): AudioNodeLike;
  setParameter(parameterId: string, value: number, atSec: number): void;
  /** The effective gain of one channel, after mute and solo. For tests and meters. */
  channelGain(index: number): number;
};

/** `level-2`, `pan-2`, `mute-2`, `solo-2` → `{ control: "level", index: 1 }`. */
const parseChannelParameter = (
  parameterId: string,
): { control: "level" | "pan" | "mute" | "solo"; index: number } | null => {
  const match = /^(level|pan|mute|solo)-([1-9][0-9]*)$/.exec(parameterId);
  if (!match) return null;
  const index = Number.parseInt(match[2], 10) - 1;
  if (index < 0 || index >= MIXER_CHANNELS) return null;
  return { control: match[1] as "level" | "pan" | "mute" | "solo", index };
};

export function createMixer(
  context: EffectContext,
  spec: AudioNodeSpec,
  atSec: number,
): MixerCore {
  const sum = context.createGain();
  setNow(sum.gain, 1, atSec);

  const channels: Channel[] = Array.from({ length: MIXER_CHANNELS }, (_, i) => {
    const input = context.createGain();
    const gain = context.createGain();
    const panner = context.createStereoPanner();

    const level = clamp(numberOr(spec.parameters[`level-${i + 1}`], 0.8), 0, 2);
    const muted = numberOr(spec.parameters[`mute-${i + 1}`], 0) >= 0.5;
    const soloed = numberOr(spec.parameters[`solo-${i + 1}`], 0) >= 0.5;

    setNow(input.gain, 1, atSec);
    setNow(panner.pan, clampPan(numberOr(spec.parameters[`pan-${i + 1}`], 0)), atSec);

    input.connect(gain);
    gain.connect(panner);
    panner.connect(sum);

    return { input, gain, panner, level, muted, soloed };
  });

  /** Nothing soloed means everything plays; anything soloed means only those do. */
  const effectiveGain = (channel: Channel): number => {
    const anySolo = channels.some((candidate) => candidate.soloed);
    if (channel.muted) return 0;
    if (anySolo && !channel.soloed) return 0;
    return channel.level;
  };

  const applyGains = (at: number): void => {
    for (const channel of channels) {
      rampParam(channel.gain.gain, effectiveGain(channel), at, "linear");
    }
  };
  applyGains(atSec);

  return {
    // The shell wires its dry path to `input`; a mixer has no meaningful single
    // input, so channel one stands in and `inputFor` does the real work.
    input: channels[0].input,
    output: sum,
    owned: [sum, ...channels.flatMap((channel) => [channel.input, channel.gain, channel.panner])],
    inputFor(portId: string): AudioNodeLike {
      return channels[channelIndexFromPort(portId)].input;
    },
    channelGain(index: number): number {
      return effectiveGain(channels[index]);
    },
    setParameter(parameterId: string, value: number, at: number): void {
      const parsed = parseChannelParameter(parameterId);
      if (!parsed) return;
      const channel = channels[parsed.index];
      if (parsed.control === "pan") {
        rampParam(channel.panner.pan, clampPan(value), at, "linear");
        return;
      }
      if (parsed.control === "level") channel.level = clamp(value, 0, 2);
      if (parsed.control === "mute") channel.muted = value >= 0.5;
      if (parsed.control === "solo") channel.soloed = value >= 0.5;
      // Every channel, not just this one: a solo anywhere changes them all.
      applyGains(at);
    },
  };
}
