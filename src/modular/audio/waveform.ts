// Waveform thumbnails, small enough to save.
//
// A thumbnail exists so a row in the sound pool is recognisable at a glance —
// which sample is the kick, which one has the long tail, which one is silent
// because the file decoded wrong. That is a low bar, and meeting it cheaply
// matters more than accuracy: the reduction runs once per decode over millions
// of samples, and the result is stored in the project document.
//
// Two decisions follow from "stored in the document".
//
// **Min and max per bucket, not RMS.** A waveform read at a glance is an
// envelope, and averaging hides the transient that makes a drum recognisable.
// Keeping both extremes also keeps an asymmetric waveform looking asymmetric.
//
// **Quantised to signed bytes.** A float per peak would make the manifest tens
// of kilobytes of numbers that no one can read and that JSON stores as decimal
// text. At 128 buckets a thumbnail is 256 small integers, which is both plenty
// of resolution for a 200-pixel row and small enough that saving it is free.

/** Buckets in a stored thumbnail. Enough for a row; small enough to save. */
export const THUMBNAIL_BUCKETS = 128;

/** Peaks are stored as signed bytes: −127 to 127 maps to −1 to 1. */
export const PEAK_SCALE = 127;

/**
 * Interleaved `[min, max, min, max, …]` peaks, one pair per bucket.
 *
 * A flat array rather than an array of pairs, because this ends up in JSON and
 * `[-31,44,-90,88]` is a quarter the size of `[{"min":…,"max":…},…]`.
 */
export type WaveformPeaks = number[];

/**
 * Reduce channel data to a fixed number of min/max pairs.
 *
 * Channels are folded together by taking the widest excursion of any of them,
 * so a stereo file whose sides differ does not show as the left channel alone.
 */
export function computePeaks(
  channels: readonly Float32Array[],
  buckets = THUMBNAIL_BUCKETS,
): WaveformPeaks {
  const count = Math.max(1, Math.floor(buckets));
  const frames = channels.reduce((longest, channel) => Math.max(longest, channel.length), 0);
  const peaks: WaveformPeaks = new Array(count * 2).fill(0);
  if (frames === 0 || channels.length === 0) return peaks;

  for (let bucket = 0; bucket < count; bucket++) {
    // Computed from the bucket index rather than accumulated, so rounding
    // cannot drift and leave the last bucket short of the end of the file.
    const start = Math.floor((bucket * frames) / count);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) * frames) / count));
    let minimum = 0;
    let maximum = 0;
    for (const channel of channels) {
      const limit = Math.min(end, channel.length);
      for (let i = start; i < limit; i++) {
        const sample = channel[i];
        if (sample < minimum) minimum = sample;
        if (sample > maximum) maximum = sample;
      }
    }
    peaks[bucket * 2] = quantise(minimum);
    peaks[bucket * 2 + 1] = quantise(maximum);
  }
  return peaks;
}

/** A stored peak back to −1..1, for drawing. */
export const peakToUnit = (value: number): number =>
  Math.max(-1, Math.min(1, value / PEAK_SCALE));

/**
 * An SVG path across a box, two passes: maxima left to right, minima back.
 *
 * Returned as a path string rather than as elements so the caller can put it in
 * whatever markup it likes, and so this stays testable without a DOM.
 */
export function peaksToPath(peaks: WaveformPeaks, width: number, height: number): string {
  const buckets = Math.floor(peaks.length / 2);
  if (buckets === 0 || width <= 0 || height <= 0) return "";
  const middle = height / 2;
  const step = width / buckets;
  const y = (unit: number) => middle - unit * middle;

  const top: string[] = [];
  const bottom: string[] = [];
  for (let bucket = 0; bucket < buckets; bucket++) {
    const x = round(bucket * step);
    top.push(`${x},${round(y(peakToUnit(peaks[bucket * 2 + 1])))}`);
    bottom.unshift(`${x},${round(y(peakToUnit(peaks[bucket * 2])))}`);
  }
  return `M${top.join(" L")} L${bottom.join(" L")} Z`;
}

/** Whether a thumbnail is all zeroes — a decode that produced silence. */
export const isSilent = (peaks: WaveformPeaks): boolean =>
  peaks.every((value) => value === 0);

const quantise = (sample: number): number => {
  if (!Number.isFinite(sample)) return 0;
  return Math.round(Math.max(-1, Math.min(1, sample)) * PEAK_SCALE);
};

const round = (value: number): number => Math.round(value * 100) / 100;
