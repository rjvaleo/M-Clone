// The mixer — eight channels, each with a level, a position, a mute and a solo,
// and two aux sends, A and B, each with a return.
//
// `MODULAR_IMPLEMENTATION_PLAN.md` §12 Phase 6 asks for "mixer/master output,
// metering, mute/solo/pan/fader", and `AUDIO_ENGINE_SPEC.md` §15 gives every
// instrument channel "level, pan, mute, solo". This is that node.
//
//     in₁ ─► gain₁ ─► pan₁ ─┬────────────────────┐
//      │                    └─► post₁ᴬ ─► sendᴬ  ├─► sum ─► out
//      └─► gate₁ ─► pre₁ᴬ ─────────────► sendᴬ   │
//     …eight of those…                           │
//     returnᴬ ─► return level ───────────────────┘
//
// ## Sends
//
// A send is post-fader by default: what leaves the channel's panner, times its
// send level. Pre-fader, it is the channel's input before level and pan, past
// a gate that is shut while the channel is muted or soloed out, so a silenced
// channel sends nothing either way. Each channel has both paths to each bus,
// one of them at zero: switching pre and post is two ramps, never a rebuild.
// The send buses leave by `outputFor`, as the DP/4's outputs do; the returns
// come in by `inputFor` and join the sum at their own level. The Rust `Mixer`
// in dsp-core is the same arithmetic, and the tests hold both to one set of
// numbers.
//
// ## Eight inputs, not one
//
// A mixer whose eight cables were summed at a single input would be a gain node
// with extra controls, so it takes the DP/4's route: `inputFor` gives each port
// its own node, and the eight stay eight until the sum bus. That is the same
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
// Soloing channel 3 has to silence every other channel, so no single channel's
// control owns the answer. The effective gain of every channel is recomputed
// whenever any mute or solo moves, which is also what makes un-soloing restore
// exactly the levels that were there before rather than a remembered guess.

import type { AudioNodeSpec } from "./audioPlan";
import type { AudioNodeLike } from "./graphAdapter";
import type { EffectContext, GainNodeLike, StereoPannerNodeLike } from "./nodes";
import { rampParam } from "./params";
import { clamp, numberOr, setNow } from "./reverbTank";
import { clampPan } from "./voices";

/** Eight channels, as idMLab's docs leave the count open ("N channel strips"). */
export const MIXER_CHANNELS = 8;

/** The aux sends, A then B. */
export const MIXER_SENDS = ["a", "b"] as const;

/** `audio-in-1` … `audio-in-8`. Ports are 1-based because faces are. */
export const mixerInputPortId = (index: number): string => `audio-in-${index + 1}`;

const channelIndexFromPort = (portId: string): number => {
  const match = /^audio-in-([1-9][0-9]*)$/.exec(portId);
  if (!match) return 0;
  const index = Number.parseInt(match[1], 10) - 1;
  return index >= 0 && index < MIXER_CHANNELS ? index : 0;
};

const busFromPort = (portId: string, end: "in" | "out"): number => {
  const match = new RegExp(`^(?:${end === "out" ? "send" : "return"})-([ab])-${end}$`).exec(portId);
  return match ? MIXER_SENDS.indexOf(match[1] as "a" | "b") : -1;
};

type Channel = {
  input: GainNodeLike;
  gain: GainNodeLike;
  panner: StereoPannerNodeLike;
  /** 1 while the channel plays, 0 while muted or soloed out: the pre-fader sends' tap. */
  gate: GainNodeLike;
  /** Per bus, the post-fader and pre-fader send gains. */
  post: GainNodeLike[];
  pre: GainNodeLike[];
  level: number;
  muted: boolean;
  soloed: boolean;
  sends: number[];
};

export type MixerCore = {
  input: AudioNodeLike;
  output: AudioNodeLike;
  owned: readonly AudioNodeLike[];
  inputFor(portId: string): AudioNodeLike;
  /** A send bus, or nothing for the main out (the shell's own). */
  outputFor(portId: string): AudioNodeLike | undefined;
  setParameter(parameterId: string, value: number, atSec: number): void;
  /** The effective gain of one channel, after mute and solo. For tests and meters. */
  channelGain(index: number): number;
};

type Parsed =
  | { control: "level" | "pan" | "mute" | "solo"; index: number }
  | { control: "send"; bus: number; index: number }
  | { control: "pre"; bus: number }
  | { control: "return"; bus: number };

/** `level-2` → `{ control: "level", index: 1 }`, `send-b-3`, `send-a-pre`, `return-b`. */
const parseParameter = (parameterId: string): Parsed | null => {
  const channel = (n: string) => {
    const index = Number.parseInt(n, 10) - 1;
    return index >= 0 && index < MIXER_CHANNELS ? index : -1;
  };
  let match = /^(level|pan|mute|solo)-([1-9][0-9]*)$/.exec(parameterId);
  if (match) {
    const index = channel(match[2]);
    return index < 0 ? null : { control: match[1] as "level" | "pan" | "mute" | "solo", index };
  }
  match = /^send-([ab])-([1-9][0-9]*)$/.exec(parameterId);
  if (match) {
    const index = channel(match[2]);
    return index < 0 ? null : { control: "send", bus: MIXER_SENDS.indexOf(match[1] as "a" | "b"), index };
  }
  match = /^send-([ab])-pre$/.exec(parameterId);
  if (match) return { control: "pre", bus: MIXER_SENDS.indexOf(match[1] as "a" | "b") };
  match = /^return-([ab])$/.exec(parameterId);
  if (match) return { control: "return", bus: MIXER_SENDS.indexOf(match[1] as "a" | "b") };
  return null;
};

export function createMixer(
  context: EffectContext,
  spec: AudioNodeSpec,
  atSec: number,
): MixerCore {
  const sum = context.createGain();
  setNow(sum.gain, 1, atSec);
  const value = (id: string, fallback: number) => numberOr(spec.parameters[id], fallback);

  const buses = MIXER_SENDS.map(() => {
    const bus = context.createGain();
    setNow(bus.gain, 1, atSec);
    return bus;
  });
  const returns = MIXER_SENDS.map((bus) => {
    const back = context.createGain();
    setNow(back.gain, clamp(value(`return-${bus}`, 1), 0, 2), atSec);
    back.connect(sum);
    return back;
  });
  const preFader = MIXER_SENDS.map((bus) => value(`send-${bus}-pre`, 0) >= 0.5);

  const channels: Channel[] = Array.from({ length: MIXER_CHANNELS }, (_, i) => {
    const input = context.createGain();
    const gain = context.createGain();
    const panner = context.createStereoPanner();
    const gate = context.createGain();

    const level = clamp(value(`level-${i + 1}`, 0.8), 0, 2);
    const muted = value(`mute-${i + 1}`, 0) >= 0.5;
    const soloed = value(`solo-${i + 1}`, 0) >= 0.5;
    const sends = MIXER_SENDS.map((bus) => clamp(value(`send-${bus}-${i + 1}`, 0), 0, 1));

    setNow(input.gain, 1, atSec);
    setNow(panner.pan, clampPan(value(`pan-${i + 1}`, 0)), atSec);

    input.connect(gain);
    gain.connect(panner);
    panner.connect(sum);
    input.connect(gate);

    const post = buses.map((bus) => {
      const send = context.createGain();
      panner.connect(send);
      send.connect(bus);
      return send;
    });
    const pre = buses.map((bus) => {
      const send = context.createGain();
      gate.connect(send);
      send.connect(bus);
      return send;
    });

    return { input, gain, panner, gate, post, pre, level, muted, soloed, sends };
  });

  /** Nothing soloed means everything plays; anything soloed means only those do. */
  const silent = (channel: Channel): boolean => {
    const anySolo = channels.some((candidate) => candidate.soloed);
    return channel.muted || (anySolo && !channel.soloed);
  };
  const effectiveGain = (channel: Channel): number => (silent(channel) ? 0 : channel.level);

  const applyGains = (at: number): void => {
    for (const channel of channels) {
      rampParam(channel.gain.gain, effectiveGain(channel), at, "linear");
      rampParam(channel.gate.gain, silent(channel) ? 0 : 1, at, "linear");
      MIXER_SENDS.forEach((_, bus) => {
        const amount = channel.sends[bus];
        rampParam(channel.post[bus].gain, preFader[bus] ? 0 : amount, at, "linear");
        rampParam(channel.pre[bus].gain, preFader[bus] ? amount : 0, at, "linear");
      });
    }
  };
  applyGains(atSec);

  return {
    // The shell wires its dry path to `input`; a mixer has no meaningful single
    // input, so channel one stands in and `inputFor` does the real work.
    input: channels[0].input,
    output: sum,
    owned: [
      sum,
      ...buses,
      ...returns,
      ...channels.flatMap((channel) => [channel.input, channel.gain, channel.panner, channel.gate, ...channel.post, ...channel.pre]),
    ],
    inputFor(portId: string): AudioNodeLike {
      const bus = busFromPort(portId, "in");
      return bus >= 0 ? returns[bus] : channels[channelIndexFromPort(portId)].input;
    },
    outputFor(portId: string): AudioNodeLike | undefined {
      const bus = busFromPort(portId, "out");
      return bus >= 0 ? buses[bus] : undefined;
    },
    channelGain(index: number): number {
      return effectiveGain(channels[index]);
    },
    setParameter(parameterId: string, value: number, at: number): void {
      const parsed = parseParameter(parameterId);
      if (!parsed) return;
      if (parsed.control === "return") {
        rampParam(returns[parsed.bus].gain, clamp(value, 0, 2), at, "linear");
        return;
      }
      if (parsed.control === "pre") preFader[parsed.bus] = value >= 0.5;
      else if (parsed.control === "send") channels[parsed.index].sends[parsed.bus] = clamp(value, 0, 1);
      else {
        const channel = channels[parsed.index];
        if (parsed.control === "pan") {
          rampParam(channel.panner.pan, clampPan(value), at, "linear");
          return;
        }
        if (parsed.control === "level") channel.level = clamp(value, 0, 2);
        if (parsed.control === "mute") channel.muted = value >= 0.5;
        if (parsed.control === "solo") channel.soloed = value >= 0.5;
      }
      // Every channel, not just this one: a solo anywhere changes them all.
      applyGains(at);
    },
  };
}
