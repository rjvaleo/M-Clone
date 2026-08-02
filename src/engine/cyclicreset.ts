export function cyclicResetVoices(
  before: readonly number[],
  after: readonly number[],
  lengths: readonly number[],
): number[] {
  return after.flatMap((position, voice) => {
    const length = Math.max(1, lengths[voice] ?? 16);
    return Math.floor(position / length) > Math.floor((before[voice] ?? 0) / length)
      ? [voice] : [];
  });
}
