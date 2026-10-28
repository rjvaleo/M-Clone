// Four instruments made of arithmetic.
//
// The pool has to have something in it. Not for decoration: until there is
// audible material, nothing downstream can be checked — not the effect rack,
// not audition, not the players Stage E adds. Requiring the user to find a
// drum sample before anything makes a sound would put an errand in front of
// the first useful moment, and would make the audio path untestable in a
// browser session that has no files.
//
// So the AV prototype's synthetic buffers come across: a kick as a pitch sweep
// with an exponential decay, a snare as noise plus a tuned body, a hihat as
// noise through a one-pole difference, and a pad as a held triad.
//
// The one change is the noise. The prototype used `Math.random`, so its snare
// was a different snare on every reload. Here it comes from the project's
// counter hash, which means the starter kit is the same kit every session —
// the same reason the reverb tail is generated the way it is.

import { randomUnit, streamKey } from "../runtime/rng";
import { describeGeneratedAsset } from "./decode";
import { syntheticAssetId } from "./assets";
import type { AssetRecord } from "./assets";
import type { AudioBufferLike, EffectContext } from "./nodes";

export type KitVoice = "kick" | "snare" | "hihat" | "pad";

export const KIT: readonly { voice: KitVoice; name: string; seconds: number }[] = [
  { voice: "kick", name: "Kick.synth", seconds: 0.5 },
  { voice: "snare", name: "Snare.synth", seconds: 0.5 },
  { voice: "hihat", name: "Hihat.synth", seconds: 0.25 },
  { voice: "pad", name: "Pad.synth", seconds: 4 },
];

/** Render one voice into a mono channel. */
export function renderVoice(voice: KitVoice, channel: Float32Array, sampleRate: number): void {
  const rate = Math.max(1, sampleRate);
  const key = streamKey(0, voice, "kit");

  if (voice === "kick") {
    for (let i = 0; i < channel.length; i++) {
      const t = i / rate;
      // 150 Hz down to 40: the sweep is what makes it read as a kick rather
      // than as a low sine blip.
      const frequency = 40 + 110 * Math.exp(-t * 30);
      channel[i] = Math.sin(2 * Math.PI * frequency * t) * Math.exp(-t * 8);
    }
    return;
  }

  if (voice === "snare") {
    for (let i = 0; i < channel.length; i++) {
      const t = i / rate;
      const noise = randomUnit(key, i, 0) * 2 - 1;
      const body = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 20);
      channel[i] = (noise * 0.7 * Math.exp(-t * 12) + body * 0.3) * Math.exp(-t * 4);
    }
    return;
  }

  if (voice === "hihat") {
    let previous = 0;
    for (let i = 0; i < channel.length; i++) {
      const t = i / rate;
      const sample = (randomUnit(key, i, 0) * 2 - 1) * Math.exp(-t * 35);
      // A one-pole difference is a cheap highpass, and the reason this reads as
      // metal rather than as a noise burst.
      channel[i] = (sample - previous) * 0.5;
      previous = sample;
    }
    return;
  }

  for (let i = 0; i < channel.length; i++) {
    const t = i / rate;
    channel[i] = 0.25 * (
      Math.sin(2 * Math.PI * 220 * t)
      + Math.sin(2 * Math.PI * 261.63 * t)
      + Math.sin(2 * Math.PI * 329.63 * t)
    );
  }
}

/** One voice as a buffer plus the record that describes it. */
export function renderKitVoice(
  context: EffectContext,
  voice: KitVoice,
  name: string,
  seconds: number,
): { record: AssetRecord; buffer: AudioBufferLike } {
  const frames = Math.max(1, Math.round(seconds * context.sampleRate));
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  renderVoice(voice, buffer.getChannelData(0), context.sampleRate);
  // Named by voice, not by name: renaming a kit entry must not make it a
  // different asset, for the same reason renaming a file does not.
  return {
    buffer,
    record: describeGeneratedAsset(syntheticAssetId(voice), name, buffer, generatorFor(voice)),
  };
}

/** The recipe string a bundle stores instead of the audio. */
export const generatorFor = (voice: KitVoice): string => `kit:${voice}`;

const VOICES = new Set<string>(KIT.map((entry) => entry.voice));

/**
 * Rebuild generated audio from its recipe.
 *
 * This is what lets a bundle omit the kit entirely. An unknown recipe returns
 * null rather than throwing — a project written by a newer version may name a
 * generator this one has never heard of, and the right outcome is one missing
 * row, not a project that will not open.
 */
export function renderGenerated(
  context: EffectContext,
  generator: string,
): { voice: KitVoice; buffer: AudioBufferLike } | null {
  if (!generator.startsWith("kit:")) return null;
  const voice = generator.slice(4);
  if (!VOICES.has(voice)) return null;
  const entry = KIT.find((candidate) => candidate.voice === voice) as (typeof KIT)[number];
  const frames = Math.max(1, Math.round(entry.seconds * context.sampleRate));
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  renderVoice(entry.voice, buffer.getChannelData(0), context.sampleRate);
  return { voice: entry.voice, buffer };
}

/** The whole starter kit. */
export function renderKit(
  context: EffectContext,
): { record: AssetRecord; buffer: AudioBufferLike }[] {
  return KIT.map((entry) => renderKitVoice(context, entry.voice, entry.name, entry.seconds));
}
