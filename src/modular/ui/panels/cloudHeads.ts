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

import { grainCloud } from "../../audio/grainClouds";
import { GRAIN_FIELDS, type GrainCloud } from "../../audio/wasm/grainJobs";

/** What the animator needs of the page: to find the pads. */
export type CloudRoot = { querySelectorAll(selector: string): ArrayLike<CloudElement> };
type CloudElement = {
  dataset: Record<string, string | undefined>;
  style: { setProperty(name: string, value: string): void };
  textContent: string | null;
};

export type HeadSource = () => { report: { quanta: number; heads?: Record<string, number> } | null };

/** MultiGrainLive's `grainColour`: warm for up and bright, cool for down and dark. */
export function grainColour(pitchOffset: number, brightness: number, alpha: number): string {
  const p = Math.max(-1, Math.min(1, pitchOffset / 9));
  const br = Math.max(0, Math.min(1, brightness * 4));
  const t = Math.max(-1, Math.min(1, p * 0.55 + (br - 0.4) * 1.4));
  const hue = t >= 0 ? 30 - t * 10 : 250 + t * 30;
  const chroma = 0.10 + Math.abs(t) * 0.16;
  const light = 66 + Math.abs(t) * 14;
  return `oklch(${light}% ${chroma} ${hue} / ${alpha})`;
}

/** One grain as `drawCloudPad` places it: at the middle of what it reads, by its pitch from the cloud's. */
export function grainDot(
  grain: { out: number; src: number; size: number; pitch: number; bright: number },
  view: { w: number; h: number; frames: number; sampleRate: number; pitch: number; semis: number; playFrame: number },
): { x: number; y: number; r: number; colour: string } {
  // A grain is a span: it reads forward through size × rate frames.
  const mid = grain.src + (grain.size * Math.pow(2, grain.pitch / 12)) / 2;
  const dt = (grain.out - view.playFrame) / view.sampleRate;
  // What is sounding now is drawn brightest.
  const near = Math.max(0, 1 - Math.abs(dt) / 2.5);
  const alpha = 0.08 + near * near * 0.72;
  return {
    x: (mid / view.frames) * view.w,
    y: view.h / 2 - ((grain.pitch - view.pitch) / view.semis) * (view.h / 2 - 8),
    r: 0.6 + Math.min(1.1, (grain.size / view.sampleRate) * 8),
    colour: grainColour(grain.pitch - view.pitch, grain.bright, alpha),
  };
}

/** The readout under the pad (`drawCloudPad`): the grains and where the head is. */
export function cloudReadout(total: number | undefined, headSeconds: number): string {
  if (!total) return "no cloud — raise Density or Layers";
  return `${total.toLocaleString("en-US")} grains · head ${headSeconds.toFixed(2)}s`;
}

/** Where the head is, as a share of the file: the start, plus how far the engine has read times Scan. */
export const headAt = (start: number, scan: number, played: number): number =>
  start + (Number.isFinite(played) ? played : 0) * scan;

type GrainCanvas = {
  dataset: Record<string, string | undefined>;
  width: number;
  height: number;
  getContext?(kind: "2d"): CanvasRenderingContext2D | null;
};

export class CloudAnimator {
  private frame = 0;

  constructor(
    private readonly root: () => CloudRoot | null,
    private readonly source: HeadSource,
    private readonly clouds: (nodeId: string) => GrainCloud | undefined = grainCloud,
  ) {}

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
      read.textContent = cloudReadout(this.clouds(d.cloudRead ?? "")?.total, head * Number(d.cloudSeconds));
    }
    for (const canvas of Array.from(root.querySelectorAll("[data-cloud-canvas]"))) {
      this.drawGrains(canvas as unknown as GrainCanvas, heads);
    }
  }

  /** Every grain of the cloud, what is sounding now brightest (`drawCloudPad`). */
  private drawGrains(canvas: GrainCanvas, heads: Record<string, number>): void {
    const d = canvas.dataset;
    const cloud = this.clouds(d.cloudCanvas ?? "");
    const c = canvas.getContext?.("2d");
    if (!c) return;
    c.clearRect(0, 0, canvas.width, canvas.height);
    if (!cloud || !cloud.count) return;
    const played = heads[d.cloudCanvas ?? ""];
    const view = {
      w: canvas.width, h: canvas.height, frames: cloud.frames, sampleRate: cloud.sampleRate,
      pitch: Number(d.cloudPitch), semis: Number(d.cloudSemis),
      // The output frame now, at the file's rate: how far the engine has read, through the stretch.
      playFrame: (Number.isFinite(played) ? played : 0) * cloud.frames * Number(d.cloudRatio),
    };
    const g = cloud.grains;
    for (let i = 0; i < cloud.count; i += 1) {
      const at = i * GRAIN_FIELDS;
      const dot = grainDot({ out: g[at] * 65_536 + g[at + 1], src: g[at + 2], size: g[at + 3], pitch: g[at + 4], bright: g[at + 6] }, view);
      c.fillStyle = dot.colour;
      c.beginPath();
      c.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
      c.fill();
    }
  }
}
