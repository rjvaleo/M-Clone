// The Grain Engine's cloud pad head, moved at frame rate without a render, as
// the meters are. Each rack report says where every Grain Engine is reading
// (`RackReport.heads`, its share of the file); the head sits at the sweep's
// start plus that times Scan, as MultiGrainLive's `cloudPadGeometry` adds
// `sourceFrameNow() * scan` to the head's home.
//
// What the face writes: the pad carries `data-cloud-node`, `data-cloud-start`
// (home plus Position, as a share of the file), `data-cloud-scan` and
// `data-cloud-w`; the readout carries `data-cloud-read`, the same start and
// scan, and `data-cloud-seconds`. The animator writes the pad's
// `--cloud-head` (pixels) and `data-cloud-played`, which the pad's pointer
// reads, and the readout's text.

/** What the animator needs of the page: to find the pads. */
export type CloudRoot = { querySelectorAll(selector: string): ArrayLike<CloudElement> };
type CloudElement = {
  dataset: Record<string, string | undefined>;
  style: { setProperty(name: string, value: string): void };
  textContent: string | null;
};

export type HeadSource = () => { report: { quanta: number; heads?: Record<string, number> } | null };

/** Where the head is, as a share of the file: the start, plus how far the engine has read times Scan. */
export const headAt = (start: number, scan: number, played: number): number =>
  start + (Number.isFinite(played) ? played : 0) * scan;

export class CloudAnimator {
  private frame = 0;

  constructor(private readonly root: () => CloudRoot | null, private readonly source: HeadSource) {}

  start(): void {
    const step = () => {
      this.tick();
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
  }

  tick(): void {
    const root = this.root();
    if (!root) return;
    const heads = this.source().report?.heads ?? {};
    for (const pad of Array.from(root.querySelectorAll("[data-cloud-node]"))) {
      const d = pad.dataset;
      const played = heads[d.cloudNode ?? ""] ?? Number.NaN;
      d.cloudPlayed = String(Number.isFinite(played) ? played : 0);
      pad.style.setProperty("--cloud-head", `${headAt(Number(d.cloudStart), Number(d.cloudScan), played) * Number(d.cloudW)}px`);
    }
    for (const read of Array.from(root.querySelectorAll("[data-cloud-read]"))) {
      const d = read.dataset;
      const head = headAt(Number(d.cloudStart), Number(d.cloudScan), heads[d.cloudRead ?? ""] ?? Number.NaN);
      read.textContent = `head ${(head * Number(d.cloudSeconds)).toFixed(2)}s`;
    }
  }
}
