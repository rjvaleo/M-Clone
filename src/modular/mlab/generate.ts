/**
 * M NoteSeq's Generate menu: M's own Pattern commands next to Numerology's
 * generator algorithms (manual p48–51). Every one is a pure edit of the
 * pattern and the cycles in play, so it can be undone like any other edit.
 */

import type { Rng } from "../../engine/rng";
import type { CyclicStep, CyclicVariable } from "../../engine/types";
import { reScramble, scrambleSteps } from "../../engine/patterncmd";
import { createDefaultPattern } from "../../engine/project";
import { snapToScale, type ScaleName } from "../../engine/music";
import type { VoicePattern } from "./model";
import { PATTERN_COMMANDS, runPatternCommand, type PatternCommandId } from "./patternEdit";

/** What Generate and Evolve work on: the group and positions now playing. */
export type SeqMaterial = {
  pattern: VoicePattern;
  cells: Record<CyclicVariable, CyclicStep[]>;
  root: number;
  scale: ScaleName;
};

export const GENERATORS = [
  ...PATTERN_COMMANDS.map((c) => ({ id: c.id as GeneratorId, label: c.label, group: "M" as const })),
  { id: "rnd-few", label: "RndFew", group: "Numerology" as const },
  { id: "rnd-some", label: "RndSome", group: "Numerology" as const },
  { id: "rnd-most", label: "RndMost", group: "Numerology" as const },
  { id: "rnd-all", label: "RndAll", group: "Numerology" as const },
  { id: "cell", label: "Cell", group: "Numerology" as const },
  { id: "357", label: "357", group: "Numerology" as const },
  { id: "minmal", label: "Minmal", group: "Numerology" as const },
] as { id: GeneratorId; label: string; group: "M" | "Numerology" }[];

type RandomId = "rnd-few" | "rnd-some" | "rnd-most" | "rnd-all";
export type GeneratorId = PatternCommandId | RandomId | "cell" | "357" | "minmal";

/** "No more than 15% / 30% / 60% of parameters are randomized." */
const RANDOM_SHARES: Record<RandomId, number> = { "rnd-few": 0.15, "rnd-some": 0.3, "rnd-most": 0.6, "rnd-all": 1 };

/** Random levels keep off the extremes, as Numerology's do. */
const LEVEL_SPAN: Record<CyclicVariable, [number, number]> = { accent: [1, 4], legato: [1, 4], rhythm: [1, 3] };

const centreOf = (pattern: VoicePattern): number => {
  const notes = pattern.steps.slice(0, pattern.length).flat();
  return notes.length ? Math.round((Math.min(...notes) + Math.max(...notes)) / 2) : 60;
};

/** A note in the scale within an octave either side of `centre`. */
const randomNote = (centre: number, material: SeqMaterial, rng: Rng): number =>
  Math.max(0, Math.min(127, snapToScale(centre - 12 + rng.int(25), material.root, material.scale)));

const randomLevel = (kind: CyclicVariable, rng: Rng): number => {
  const [low, high] = LEVEL_SPAN[kind];
  return low + rng.int(high - low + 1);
};

/** `count` distinct indexes below `n`. */
const pickIndexes = (n: number, count: number, rng: Rng): number[] => {
  const pool = Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  while (out.length < count && pool.length) out.push(pool.splice(rng.int(pool.length), 1)[0]);
  return out;
};

const seedFrom = (rng: Rng) => rng.int(0x7fffffff);

/** Keep the scrambled copy a shuffle of the played steps after a rewrite. */
function rescrambled(steps: number[][], length: number, rng: Rng): VoicePattern {
  const played = steps.slice(0, length).map((pitches) => ({ pitches }));
  const shuffled = scrambleSteps(played, seedFrom(rng)).map((s) => [...s.pitches]);
  return { steps, length, scrambled: [...shuffled, ...steps.slice(length).map((s) => [...s])] };
}

function randomize(id: RandomId, material: SeqMaterial, rng: Rng): SeqMaterial {
  const share = RANDOM_SHARES[id];
  const { pattern } = material;
  const centre = centreOf(pattern);
  const steps = pattern.steps.map((s) => [...s]);
  const count = (n: number) => (share >= 1 ? n : Math.max(1, Math.floor(n * share)));
  for (const i of pickIndexes(pattern.length, count(pattern.length), rng)) {
    if (steps[i].length > 0 || share >= 1) steps[i] = [randomNote(centre, material, rng)];
  }
  const cells = { ...material.cells };
  for (const kind of ["accent", "legato", "rhythm"] as CyclicVariable[]) {
    const next = [...cells[kind]];
    for (const i of pickIndexes(next.length, count(next.length), rng)) next[i] = randomLevel(kind, rng);
    cells[kind] = next;
  }
  return { ...material, pattern: rescrambled(steps, pattern.length, rng), cells };
}

/**
 * Numerology's cell generators: a short phrase of `k` notes copied out to the
 * pattern's length, strictly (Cell, 357) or irregularly (Minmal), with an
 * accent cell of the same length.
 */
function cellular(id: "cell" | "357" | "minmal", material: SeqMaterial, rng: Rng): SeqMaterial {
  const { pattern } = material;
  const k = id === "357" ? [3, 5, 7][rng.int(3)] : id === "cell" ? 3 + rng.int(5) : 2 + rng.int(7);
  const centre = centreOf(pattern);
  const cell = Array.from({ length: k }, () => randomNote(centre, material, rng));
  const accents = Array.from({ length: k }, () => randomLevel("accent", rng));
  const steps = pattern.steps.map((s) => [...s]);
  const accent = [...material.cells.accent];
  let at = 0;
  let i = 0;
  while (i < pattern.length) {
    steps[i] = [cell[at]];
    if (i < accent.length) accent[i] = accents[at];
    i += 1;
    at += 1;
    // Irregular repetition: a copy may break off early and start the cell again.
    const breakOff = id === "minmal" && at > 1 && rng.chance(0.25);
    if (at >= k || breakOff) at = 0;
  }
  return { ...material, pattern: rescrambled(steps, pattern.length, rng), cells: { ...material.cells, accent } };
}

export function generate(id: GeneratorId, material: SeqMaterial, rng: Rng, options: { preserveRests: boolean }): SeqMaterial {
  if (id in RANDOM_SHARES) return randomize(id as RandomId, material, rng);
  if (id === "cell" || id === "357" || id === "minmal") return cellular(id, material, rng);
  if (id === "rescramble") {
    const { pattern } = material;
    const whole = {
      ...createDefaultPattern("m-noteseq"),
      steps: pattern.steps.slice(0, pattern.length).map((pitches) => ({ pitches: [...pitches] })),
      scrambledSteps: pattern.scrambled.slice(0, pattern.length).map((pitches) => ({ pitches: [...pitches] })),
      outputLength: pattern.length,
    };
    const next = reScramble(whole, null, seedFrom(rng), options.preserveRests);
    const tail = pattern.steps.slice(pattern.length);
    return {
      ...material,
      pattern: {
        steps: [...next.steps.map((s) => [...s.pitches]), ...tail.map((s) => [...s])],
        scrambled: [...next.scrambledSteps.map((s) => [...s.pitches]), ...tail.map((s) => [...s])],
        length: pattern.length,
      },
    };
  }
  return { ...material, pattern: runPatternCommand(material.pattern, id as PatternCommandId) };
}
