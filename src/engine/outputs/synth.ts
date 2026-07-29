// Built-in WebAudio synth sink — so M-Clone makes sound with zero setup.
// Deliberately simple (a triangle-ish voice with a quick AD envelope); the
// richer instrument work (SoundFonts, WAM, sampler) comes in a later phase.

import type { OutputSink, ScheduledNote } from "./types";

function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

export class SynthSink implements OutputSink {
  private ctx: AudioContext;
  private master: GainNode;
  private active = new Set<OscillatorNode>();

  constructor(ctx: AudioContext, master: GainNode) {
    this.ctx = ctx;
    this.master = master;
  }

  schedule(n: ScheduledNote): void {
    const start = Math.max(n.startSec, this.ctx.currentTime);
    const end = start + Math.max(n.durationSec, 0.03);
    const level = (n.velocity / 127) * 0.25;

    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = midiToFreq(n.note);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(level, 0.0002), start + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(g).connect(this.master);
    osc.start(start);
    osc.stop(end + 0.02);

    this.active.add(osc);
    osc.onended = () => {
      g.disconnect();
      osc.disconnect();
      this.active.delete(osc);
    };
  }

  panic(): void {
    for (const osc of this.active) {
      try {
        osc.stop();
      } catch {
        // already stopped
      }
    }
    this.active.clear();
  }
}
