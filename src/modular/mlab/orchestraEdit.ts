/** Editing M Orchestra's channel matrix and Sound Choice from its face. */

export function toggleChannel(orchestration: number[][][], position: number, voice: number, channel: number): number[][][] {
  const next = structuredClone(orchestration);
  const channels = next[position][voice] ?? [];
  next[position][voice] = channels.includes(channel)
    ? channels.filter((c) => c !== channel)
    : [...channels, channel].sort((a, b) => a - b);
  return next;
}

export function setProgram(programs: (number | null)[][], position: number, channel: number, program: number | null): (number | null)[][] {
  const next = structuredClone(programs);
  next[position][channel] = program;
  return next;
}

/** A stored program (0–127) as the synth's panel shows it. */
export function shownProgram(program: number | null, numbering: unknown): string {
  if (program === null) return "";
  return String(numbering === "1-128" ? program + 1 : program);
}

/** Typed program text back to a stored program; blank or invalid sends nothing. */
export function parseProgram(text: string, numbering: unknown): number | null {
  if (text.trim() === "") return null;
  const value = Math.round(Number(text)) - (numbering === "1-128" ? 1 : 0);
  return Number.isFinite(value) && value >= 0 && value <= 127 ? value : null;
}
