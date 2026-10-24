// Moves the second pointer on every LFO-mapped knob, at frame rate, without a
// render — the playhead's technique (see n4/playhead.ts). The rack reports each
// LFO's phase and value a few times a second; between reports the predictable
// shapes are carried forward at their rates and the random ones held.
//
// Each mapped knob carries what is needed in data attributes, written by its
// face: `data-mod-lfos` (the LFO node ids), `data-mod-base`, `data-mod-min`,
// `data-mod-max` and `data-mod-step`.

import { liveLfoValue, modulatedValue, type LfoReport } from "../modulation";

/** Past this without a report the pointer is hidden: there is no audio to follow. */
const HIDE_AFTER_SECONDS = 2;

export type LfoState = { rate: number; shape: number; amount: number };

export type ModulationSource = () => {
  /** The rack's latest report, with each LFO's `[phase, value]`. */
  report: { quanta: number; lfos?: Record<string, [number, number]> } | null;
  lfos: ReadonlyMap<string, LfoState>;
};

/** A value as a knob prints it, to the precision its step implies. */
export const liveText = (value: number, step: number): string => {
  const decimals = step >= 1 ? 0 : Math.min(4, Math.max(0, Math.ceil(-Math.log10(step))));
  return value.toFixed(decimals);
};

/** The pointer's angle for a value, as N4Knob draws its own. */
export const knobAngle = (value: number, min: number, max: number): number =>
  -135 + ((value - min) / Math.max(1e-9, max - min)) * 270;

export class ModulationAnimator {
  private readonly reports = new Map<string, LfoReport>();
  private lastQuanta = -1;
  private frame = 0;

  constructor(private readonly root: () => HTMLElement | null, private readonly source: ModulationSource) {}

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

  private tick(now: number): void {
    const root = this.root();
    if (!root) return;
    const { report, lfos } = this.source();
    if (report && report.quanta !== this.lastQuanta) {
      this.lastQuanta = report.quanta;
      for (const [id, [phase, value]] of Object.entries(report.lfos ?? {})) {
        this.reports.set(id, { phase, value, at: now });
      }
    }
    for (const element of root.querySelectorAll<HTMLElement>("[data-mod-lfos]")) {
      const min = Number(element.dataset.modMin);
      const max = Number(element.dataset.modMax);
      const base = Number(element.dataset.modBase);
      let sum = 0;
      let heard = false;
      for (const id of (element.dataset.modLfos ?? "").split(",")) {
        const reported = this.reports.get(id);
        const lfo = lfos.get(id);
        if (!reported || !lfo || now - reported.at > HIDE_AFTER_SECONDS) continue;
        heard = true;
        sum += liveLfoValue(reported, lfo, now);
      }
      const pointer = element.querySelector<SVGLineElement>(".n4-knob__mod");
      const live = element.querySelector<HTMLElement>(".n4-knob__live");
      if (!heard) {
        pointer?.setAttribute("visibility", "hidden");
        if (live) live.textContent = "";
        continue;
      }
      const value = modulatedValue(base, sum, min, max);
      pointer?.setAttribute("visibility", "visible");
      pointer?.setAttribute("transform", `rotate(${knobAngle(value, min, max)} 20 20)`);
      if (live) live.textContent = liveText(value, Number(element.dataset.modStep) || 0.01);
    }
  }
}
