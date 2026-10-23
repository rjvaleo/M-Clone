// Tap tempo, as M computes it, shared by the store's Input Control and the
// canvas's M Conductor.

/**
 * Tap tempo from the time between two taps, as M computes it: the interval is
 * held to 59 ms..1.5 s and read as one Sync Ratio unit (a quarter note at 4).
 */
export function tapTempo(intervalSec: number, syncRatio: number): { tempo: number; beatSec: number } {
  const beatSec = Math.max(0.059, Math.min(1.5, intervalSec));
  const tempo = (60 * 4) / (Math.max(1, syncRatio) * beatSec);
  return { tempo: Math.max(1, Math.min(255, Math.round(tempo))), beatSec };
}

/** Tap Affects Velocity: the offset the key's velocity gives every note. */
export const tapOffset = (velocity: number) => Math.trunc((velocity - 64) / 2);

/** A pause longer than this between taps starts a new count. */
const NEW_COUNT_SEC = 2;

/**
 * The tempo a run of taps sets: the average of up to the last four intervals,
 * counted from the last pause, read as quarter notes. Null until there are two
 * taps in the current count. `times` are in seconds, oldest first.
 */
export function tappedTempo(times: readonly number[]): number | null {
  let start = times.length - 1;
  while (start > 0 && times[start] - times[start - 1] <= NEW_COUNT_SEC) start--;
  const run = times.slice(Math.max(start, times.length - 5));
  if (run.length < 2) return null;
  const average = (run[run.length - 1] - run[0]) / (run.length - 1);
  return tapTempo(average, 4).tempo;
}
