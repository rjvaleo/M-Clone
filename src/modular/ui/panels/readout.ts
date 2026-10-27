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
  /**
   * So many significant figures (two places at most), with the unit after:
   * hertz from 1000 in k, milliseconds from 1000 in seconds. For dials too
   * small for idMLab's own formatting.
   */
  figures?: number;
};

/** The places that keep `figures` significant figures of `v`, two at most. */
const placesFor = (v: number, figures: number) =>
  Math.min(Math.max(figures - 1 - Math.floor(Math.log10(Math.max(Math.abs(v), 1e-9))), 0), 2);

export function readoutText(value: number, readout: Readout, unit = ""): string {
  if (readout.figures !== undefined) {
    const [v, u] = unit === "Hz" && Math.abs(value) >= 1000 ? [value / 1000, "kHz"]
      : unit === "ms" && Math.abs(value) >= 1000 ? [value / 1000, "s"] : [value, unit];
    const places = Math.abs(v) >= 1000 ? 0 : placesFor(v, readout.figures);
    const text = v.toFixed(places);
    return `${Number(text) === 0 ? (0).toFixed(places) : text}${u}`;
  }
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
