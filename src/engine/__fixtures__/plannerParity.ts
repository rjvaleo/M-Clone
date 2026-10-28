// Scenarios that pin the planner's exact output. The JSON beside this file was
// recorded from planWindow before its step logic moved into step.ts; the
// parity test replays these scenarios and expects the same notes, so the
// refactor provably changes nothing M plays.

import { createDefaultProject } from "../project";
import { makeCursors, planWindow, type PlannedNote, type PlannedStep } from "../planner";
import { Rng } from "../rng";
import type { ProjectState } from "../types";

const seeded = (state: ProjectState) =>
  state.voices.map((_, voice) => new Rng((state.seed ^ Math.imul(voice + 1, 0x9e3779b1)) >>> 0));

export function parityScenarios(): Record<string, ProjectState> {
  const plain = createDefaultProject();

  const busy = createDefaultProject();
  busy.seed = 7;
  busy.tempo = 132;
  busy.velocityOffset = 9;
  busy.voices.forEach((voice, i) => {
    voice.patternIndex = 0;
    voice.density = [1, 0.6, 0.35, 0.8][i];
    voice.noteOrderMix = [
      { original: 100, cyclic: 0, utterly: 0 },
      { original: 40, cyclic: 30, utterly: 30 },
      { original: 0, cyclic: 100, utterly: 0 },
      { original: 20, cyclic: 0, utterly: 80 },
    ][i];
    voice.transposition = [0, 3, -5, 12][i];
    voice.legato = [1, 0.7, 1.3, 0.5][i];
    voice.velocityRange = { low: 30 + i * 10, high: 110 - i * 5 };
    voice.phase = i * 24;
    voice.playEnabled = true;
  });
  busy.voices[2].playEnabled = false;
  busy.voices[1].timeDistort = { points: [{ x: 0.5, y: 0.3 }], length: 4, denominator: 4 };
  busy.patterns[0].scrambledSteps = [...busy.patterns[0].steps].reverse();
  busy.cyclicLengths = { accent: [3, 5, 16, 2], legato: [4, 2, 7, 16], rhythm: [2, 3, 16, 5] };
  busy.cyclic.accent[0] = [1, 4, { min: 2, max: 4 }, ...Array(13).fill(3)];
  busy.cyclic.legato[1] = [{ min: 0, max: 4 }, 4, ...Array(14).fill(2)];
  busy.cyclic.rhythm[0] = [2, 3, ...Array(14).fill(1)];
  busy.cyclic.rhythm[3] = [{ min: 1, max: 4 }, 2, 0, 4, 1, ...Array(11).fill(1)];

  const harmony = structuredClone(busy);
  harmony.diatonicTranspose = true;
  harmony.scaleSnap = true;
  harmony.chordTones = true;
  harmony.root = 2;
  harmony.scale = "dorian";

  return { plain, busy, harmony };
}

export type ParityRecord = { notes: PlannedNote[]; steps: PlannedStep[]; resets: number[][] };

/** Play a scenario for eight seconds in 100 ms windows, as the runtime would. */
export function playScenario(state: ProjectState): ParityRecord {
  const rngs = seeded(state);
  let cursors = makeCursors(state, 0);
  const record: ParityRecord = { notes: [], steps: [], resets: [] };
  for (let end = 0.1; end <= 8.0001; end += 0.1) {
    const result = planWindow(state, cursors, rngs, end - 0.1, end);
    cursors = result.cursors;
    record.notes.push(...result.notes);
    record.steps.push(...result.steps);
    record.resets.push(result.cyclicResets);
  }
  return record;
}
