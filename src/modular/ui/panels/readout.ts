// A control's number as its original printed it, where that differs from
// idMLab's own: SoundHack's dials print bare numbers to a fixed number of
// places, a few on a 0–100 scale where this port's control runs 0–1, and
// ++compand prints its slope as a ratio ("2.0:1" below unity, "1:2.5" above).

export type Readout = {
  /** Places after the point; the number is printed without its unit. */
  decimals?: number;
  /** Multiplies the value first, for an original that showed 0–100. */
  scale?: number;
  /** A compressor slope as a ratio. */
  ratio?: boolean;
};

export function readoutText(value: number, readout: Readout): string {
  if (readout.ratio) {
    const slope = Math.max(value, 1e-6);
    return slope <= 1 ? `${(1 / slope).toFixed(1)}:1` : `1:${slope.toFixed(1)}`;
  }
  const scaled = value * (readout.scale ?? 1);
  // Four figures and up print whole, so a 20 kHz cutoff fits on its dial.
  const places = Math.abs(scaled) >= 1000 ? 0 : readout.decimals ?? 2;
  const text = scaled.toFixed(places);
  // toFixed keeps the sign of a value that rounds to zero.
  return Number(text) === 0 ? (0).toFixed(places) : text;
}
