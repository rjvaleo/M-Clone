// Previewing a sample without patching it into anything.
//
// Audition is the pool's whole reason for being usable: you drop twenty files
// and you need to hear which is which before deciding what goes where. It is
// deliberately *not* part of the graph — no node, no plan, no diff — because a
// preview that changed the patch would be a preview with consequences.
//
// Three properties, each of which the prototype's version got wrong in a way
// that is audible:
//
//   1. **One at a time.** Starting a second preview stops the first. Clicking
//      down a list otherwise stacks every sample on top of the last.
//   2. **A fade, not a cut.** `stop()` on a source mid-waveform is a step to
//      zero, which clicks. Stopping here ramps a gain down over a few
//      milliseconds and stops the source after the ramp has finished.
//   3. **Through the master chain.** The preview passes the same limiter as
//      everything else, so a hot file cannot be louder than the patch.

import { rampParam } from "./params";
import type { AudioBufferLike, AudioBufferSourceNodeLike, GainNodeLike, SampleContext } from "./nodes";
import type { AudioNodeLike } from "./graphAdapter";

/** Long enough to be inaudible as a step, short enough to feel immediate. */
export const AUDITION_FADE_SEC = 0.008;

type Voice = {
  source: AudioBufferSourceNodeLike;
  gain: GainNodeLike;
  assetId: string;
};

export class AuditionPlayer {
  private readonly context: SampleContext;
  private readonly destination: AudioNodeLike;
  private voice: Voice | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(context: SampleContext, destination: AudioNodeLike) {
    this.context = context;
    this.destination = destination;
  }

  /** The asset being previewed, or null. */
  get playingAssetId(): string | null {
    return this.voice?.assetId ?? null;
  }

  /**
   * Preview a buffer, replacing whatever was playing.
   *
   * `onended` fires for a natural finish *and* for a stop, so it checks that
   * the voice it is retiring is still the current one — otherwise stopping A to
   * start B would clear B's state a moment after B began.
   */
  play(assetId: string, buffer: AudioBufferLike, onended?: () => void): void {
    this.stop();
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    rampParam(gain.gain, 1, now, "none");
    source.connect(gain);
    gain.connect(this.destination);

    const voice: Voice = { source, gain, assetId };
    source.onended = () => {
      if (this.voice !== voice) return;
      this.release(voice);
      this.voice = null;
      onended?.();
    };
    this.voice = voice;
    source.start(now);
  }

  /** Fade out and stop. Safe to call when nothing is playing. */
  stop(): void {
    const voice = this.voice;
    this.voice = null;
    this.clearTimer();
    if (!voice) return;

    const now = this.context.currentTime;
    rampParam(voice.gain.gain, 0, now, "linear", { durationSec: AUDITION_FADE_SEC });
    try {
      // Stopping after the ramp is what makes this a fade rather than a cut.
      voice.source.stop(now + AUDITION_FADE_SEC);
    } catch {
      // A source that already ended throws; that is the outcome we wanted.
    }
    // `onended` will not fire for a voice we have already dropped, so the
    // cleanup is scheduled here instead of leaking two nodes per preview.
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null;
      this.release(voice);
    }, Math.ceil(AUDITION_FADE_SEC * 1000) + 20);
  }

  dispose(): void {
    this.stop();
    this.clearTimer();
  }

  private release(voice: Voice): void {
    voice.source.onended = null;
    voice.source.disconnect();
    voice.gain.disconnect();
  }

  private clearTimer(): void {
    if (this.stopTimer === null) return;
    clearTimeout(this.stopTimer);
    this.stopTimer = null;
  }
}
