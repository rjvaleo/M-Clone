/** Where a scope trace starts: the first rising zero crossing within `search` samples, else 0. */
export function triggerIndex(samples: Float32Array, search: number): number {
  const end = Math.min(search, samples.length);
  for (let i = 1; i < end; i++) if (samples[i - 1] < 0 && samples[i] >= 0) return i;
  return 0;
}
