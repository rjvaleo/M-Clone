// The panels' level meters, moved at frame rate without a render, as the
// modulation animator moves the LFO pointers. The Rust engine keeps each
// metered module's loudest input and output sample, and every rack report
// carries them (`RackReport.levels`); a bar shows the louder of the last peak
// and the bar falling at 20 dB a second, as a peak meter does.
//
// What the face writes: a bar carries `data-level-node` and `data-level-side`
// ("in" or "out") and fills to its `--pnl-level`; a curve's live dot carries
// `data-level-dot` and its axes' pixel span and dB range (`data-x0`, `data-xw`,
// `data-xmin`, `data-xmax`, and the same for y). The animator writes
// `data-live` ("on" while reported) and `data-clip` ("on" for a second after a
// full-scale sample).

/** The bottom of every meter. */
export const METER_FLOOR_DB = -60;
/** How fast a bar falls from a peak. */
const RELEASE_DB_PER_SEC = 20;
/** Past this without a report a meter goes dark: there is no audio to follow. */
const DARK_AFTER_SECONDS = 2;
/** How long a full-scale sample keeps the clip light on. */
const CLIP_SECONDS = 1;

/** A peak in dB, held to the floor; silence and nonsense read as the floor. */
export const peakDb = (peak: number): number =>
  peak > 0 ? Math.max(20 * Math.log10(peak), METER_FLOOR_DB) : METER_FLOOR_DB;

/** How far up its bar a level sits. */
export const meterFraction = (db: number): number => (Math.min(Math.max(db, METER_FLOOR_DB), 0) - METER_FLOOR_DB) / -METER_FLOOR_DB;

/** A peak and when it was taken. */
export type Held = { db: number; at: number };

/** Where a bar is at `now`, falling from its last peak. */
export const falling = (peak: Held, now: number): number =>
  Math.max(peak.db - RELEASE_DB_PER_SEC * (now - peak.at), METER_FLOOR_DB);

/** A new peak: the louder of what was reported and where the bar has fallen to. */
export const held = (previous: Held | undefined, db: number, now: number): Held =>
  ({ db: previous ? Math.max(db, falling(previous, now)) : db, at: now });

type Meter = { in: Held; out: Held; peaks: [number, number]; heard: number; clippedAt: [number, number] };

/** What the animator needs of the panel's root: to find its meters. */
export type MeterRoot = { querySelectorAll(selector: string): ArrayLike<MeterElement> };
type MeterElement = {
  dataset: Record<string, string | undefined>;
  style: { setProperty(name: string, value: string): void };
  setAttribute(name: string, value: string): void;
};

export type LevelSource = () => { report: { quanta: number; levels?: Record<string, [number, number]> } | null };

export class MeterAnimator {
  private readonly meters = new Map<string, Meter>();
  private lastQuanta = -1;
  private frame = 0;

  constructor(private readonly root: () => MeterRoot | null, private readonly source: LevelSource) {}

  start(): void {
    const step = (time: number) => {
      this.tick(time / 1000);
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
  }

  /** One frame at `now` seconds: take a new report if there is one, then draw. */
  tick(now: number): void {
    const root = this.root();
    if (!root) return;
    const { report } = this.source();
    if (report && report.quanta !== this.lastQuanta) {
      this.lastQuanta = report.quanta;
      for (const [id, peaks] of Object.entries(report.levels ?? {})) {
        const before = this.meters.get(id);
        const clipped = (side: 0 | 1) => (peaks[side] >= 1 ? now : before?.clippedAt[side] ?? -Infinity);
        this.meters.set(id, {
          in: held(before?.in, peakDb(peaks[0]), now),
          out: held(before?.out, peakDb(peaks[1]), now),
          peaks,
          heard: now,
          clippedAt: [clipped(0), clipped(1)],
        });
      }
    }
    const live = (id: string | undefined) => {
      const meter = id === undefined ? undefined : this.meters.get(id);
      return meter && now - meter.heard <= DARK_AFTER_SECONDS ? meter : undefined;
    };
    for (const bar of Array.from(root.querySelectorAll("[data-level-side]"))) {
      const meter = live(bar.dataset.levelNode);
      const side = bar.dataset.levelSide === "in" ? 0 : 1;
      bar.dataset.live = meter ? "on" : "off";
      bar.dataset.clip = meter && now - meter.clippedAt[side] <= CLIP_SECONDS ? "on" : "off";
      bar.style.setProperty("--pnl-level", String(meter ? meterFraction(falling(side === 0 ? meter.in : meter.out, now)) : 0));
    }
    for (const dot of Array.from(root.querySelectorAll("[data-level-dot]"))) {
      const meter = live(dot.dataset.levelNode);
      dot.setAttribute("visibility", meter ? "visible" : "hidden");
      if (!meter) continue;
      // The pair as reported, not as the bars fall: a curve's point is where
      // the effect was, in and out together.
      const d = dot.dataset;
      const along = (db: number, min: string | undefined, max: string | undefined) =>
        Math.min(Math.max((db - Number(min)) / (Number(max) - Number(min)), 0), 1);
      dot.setAttribute("cx", String(Number(d.x0) + along(peakDb(meter.peaks[0]), d.xmin, d.xmax) * Number(d.xw)));
      dot.setAttribute("cy", String(Number(d.y0) + Number(d.yh) - along(peakDb(meter.peaks[1]), d.ymin, d.ymax) * Number(d.yh)));
    }
  }
}
