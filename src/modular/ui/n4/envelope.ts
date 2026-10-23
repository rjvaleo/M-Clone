/**
 * An ADSR drawn as VOSM's Amp and Env panels draw one: rise to the peak, fall
 * to the sustain knee, hold, fall to zero. Attack, decay and release each get
 * a quarter of the width on a square-root scale, so short times — where the
 * ear is — get most of the travel; the hold is a fixed quarter. Three square
 * handles: the peak (attack), the knee (decay and sustain), the end (release).
 */

export type Adsr = { attack: number; decay: number; sustain: number; release: number };
export type EnvelopeLimits = { attack: number; decay: number; release: number };
export type Box = { width: number; height: number };
export type Point = { x: number; y: number };
export type EnvelopeGeometry = { start: Point; peak: Point; decay: Point; hold: Point; end: Point };
export type EnvelopeHandle = "attack" | "decay" | "release";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const span = (time: number, max: number, quarter: number) => quarter * Math.sqrt(clamp(time / max, 0, 1));
const timeOf = (dx: number, max: number, quarter: number) => Math.round(max * clamp(dx / quarter, 0, 1) ** 2);

export function envelopeGeometry(env: Adsr, { width, height }: Box, limits: EnvelopeLimits): EnvelopeGeometry {
  const q = width / 4;
  const peakX = span(env.attack, limits.attack, q);
  const kneeX = peakX + span(env.decay, limits.decay, q);
  const kneeY = height * (1 - clamp(env.sustain, 0, 1));
  const holdX = kneeX + q;
  return {
    start: { x: 0, y: height },
    peak: { x: peakX, y: 0 },
    decay: { x: kneeX, y: kneeY },
    hold: { x: holdX, y: kneeY },
    end: { x: holdX + span(env.release, limits.release, q), y: height },
  };
}

export function nearestHandle(g: EnvelopeGeometry, x: number, y: number): EnvelopeHandle {
  const handles: [EnvelopeHandle, Point][] = [["attack", g.peak], ["decay", g.decay], ["release", g.end]];
  return handles.reduce((best, h) => Math.hypot(h[1].x - x, h[1].y - y) < Math.hypot(best[1].x - x, best[1].y - y) ? h : best)[0];
}

export function dragEnvelope(env: Adsr, handle: EnvelopeHandle, x: number, y: number,
  g: EnvelopeGeometry, { width, height }: Box, limits: EnvelopeLimits): Adsr {
  const q = width / 4;
  if (handle === "attack") return { ...env, attack: timeOf(x, limits.attack, q) };
  if (handle === "release") return { ...env, release: timeOf(x - g.hold.x, limits.release, q) };
  return {
    ...env,
    decay: timeOf(x - g.peak.x, limits.decay, q),
    sustain: Math.round(clamp(1 - y / height, 0, 1) * 100) / 100,
  };
}
