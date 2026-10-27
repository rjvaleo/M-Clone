// What each ported effect's display draws, as data: axes, traces, stems and
// dots, worked out by curves.ts from the kernel's own maths, with the lines of
// text above and below. Panel.tsx only turns a plot into SVG, so everything a
// display says is here, where it is tested.

import type { JsonValue, ParameterDescriptor } from "../../model/graph";
import {
  allpassTrain, boomerangRead, chamberlinResponse, combTails, convolutionWindow, decimatorTransfer, dampingResponse,
  dcResponse, dopplerPath, echoTrain, eqNode, eqResponse, fitSteady, gateSteady, leslieRotor, lengthUsed, matrixFor,
  maximizerSteady, modDelaySweep, monoCutResponse, multiTapTrain, musicalResponse, phaserResponse, pitchSwing,
  pitchTaps, pnRms, pnShape, pnSteps, rappifyRange, rappifyResponse, ringSweep, spectralBands, spectralSteady,
  tremoloGains, type Chamberlin, type CombTank, type MusicalMode, type Phaser, type PnKind,
} from "./curves";

/** The rate the displays are drawn at, as the filter bank's is. */
export const DISPLAY_RATE = 48000;

/** A colour from the look's palette: a is its main ink, b–e the others. */
export type Tone = "a" | "b" | "c" | "d" | "e";
export type Tick = { at: number; label: string };
export type Axis = { min: number; max: number; log?: boolean; ticks: Tick[] };
/** A line through points; a NaN y breaks it, where a sawtooth jumps. */
export type Trace = { tone: Tone; dash?: boolean; fill?: boolean; points: [number, number][] };
export type Stem = { tone: Tone; x: number; y: number };
export type Dot = { tone: Tone; x: number; y: number; hollow?: boolean; label?: string };
/** A marker across the pane: upright at x, or level at y. */
export type Rule = { tone: Tone; x?: number; y?: number };
/** `square` draws both axes to one scale, as a goniometer must be. */
export type Pane = { x: Axis; y: Axis; traces: Trace[]; stems?: Stem[]; dots?: Dot[]; rules?: Rule[]; title?: string; square?: boolean };
export type Plot = { panes: Pane[]; top: string; bottom: string };

export type PlotContext = { rate: number; sound?: { name: string; durationSec: number } };

/** A module's values as its kernel reads them: a choice as its index, a switch as 0 or 1. */
export function kernelValues(parameters: readonly ParameterDescriptor[], values: Record<string, JsonValue | undefined>): Record<string, number> {
  return Object.fromEntries(parameters.filter((p) => p.kind !== "string" && p.kind !== "json").map((p) => {
    const value = values[p.id] ?? p.defaultValue;
    if (p.kind === "enum") return [p.id, Math.max(0, (p.options ?? []).indexOf(String(value)))];
    if (p.kind === "boolean") return [p.id, value === true ? 1 : 0];
    return [p.id, typeof value === "number" && Number.isFinite(value) ? value : Number(p.defaultValue)];
  }));
}

// ---- text --------------------------------------------------------------------

const fixed = (v: number, places: number) => v.toFixed(places);
export function hz(v: number): string {
  if (v >= 1000) return `${fixed(v / 1000, v >= 10000 ? 1 : 2)} KHZ`;
  return `${fixed(v, v >= 100 ? 0 : v >= 10 ? 1 : 2)} HZ`;
}
export function secs(s: number): string {
  if (!Number.isFinite(s)) return "∞";
  if (s >= 120) return `${fixed(s / 60, 1)} MIN`;
  if (s >= 1) return `${fixed(s, 2)} S`;
  return `${fixed(s * 1000, s >= 0.01 ? 0 : 1)} MS`;
}
const dbText = (v: number) => (v === -Infinity ? "−∞ DB" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${fixed(Math.abs(v), 1)} DB`);
const cents = (v: number) => (v === -Infinity ? "STOPS" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${fixed(Math.abs(v), 1)}`);
const signed = (v: number) => `${v < 0 ? "−" : ""}${fixed(Math.abs(v), 2)}`;

// ---- axes --------------------------------------------------------------------

const hzLabel = (v: number) => (v >= 1000 ? `${v / 1000}k` : `${v}`);
function freqAxis(min = 20, max = 20000, decades = false): Axis {
  const marks = (decades ? [1, 10, 100, 1000, 10000] : [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]).filter((v) => v >= min && v <= max);
  return { min, max, log: true, ticks: marks.map((at) => ({ at, label: hzLabel(at) })) };
}
const evenAxis = (min: number, max: number, step: number, label: (v: number) => string = (v) => `${Number(v.toFixed(6))}`): Axis => ({
  min, max, ticks: Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + i * step).map((at) => ({ at, label: label(at) })),
});
const dbAxis = (min: number, max: number, step: number) => evenAxis(min, max, step);

/** A time axis to `span` seconds, with a few round ticks. */
function timeAxis(span: number): Axis {
  const steps = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];
  const step = steps.find((s) => span / s <= 4) ?? 500;
  const label = (t: number) => (t === 0 ? "0" : t < 1 ? `${Number((t * 1000).toFixed(1))}ms` : `${Number(t.toFixed(3))}s`);
  return { min: 0, max: span, ticks: Array.from({ length: Math.floor(span / step + 1e-9) + 1 }, (_, i) => ({ at: i * step, label: label(i * step) })) };
}
/** The smallest round span that holds `t`, from a list, else the last. */
const spanFor = (t: number, spans: readonly number[]) => spans.find((s) => s >= t) ?? spans[spans.length - 1];
const SPANS = [0.05, 0.1, 0.2, 0.5, 1, 2, 3, 5, 10, 20, 30];

/** Values `count + 1` evenly across an axis, log or linear. */
function across(axis: { min: number; max: number; log?: boolean }, count = 200): number[] {
  return Array.from({ length: count + 1 }, (_, i) => axis.log
    ? axis.min * Math.pow(axis.max / axis.min, i / count)
    : axis.min + ((axis.max - axis.min) * i) / count);
}
const traceOf = (axis: Axis, f: (x: number) => number, tone: Tone, more: Partial<Trace> = {}, count = 200): Trace =>
  ({ tone, ...more, points: across(axis, count).map((x) => [x, f(x)]) });

/** A sawtooth's points with a break where it jumps by more than `jump`. */
function broken(points: [number, number][], jump: number): [number, number][] {
  return points.flatMap((p, i) => (i > 0 && Math.abs(p[1] - points[i - 1][1]) > jump ? [[p[0], NaN], p] : [p]) as [number, number][]);
}

// ---- the plots ---------------------------------------------------------------

type Values = Record<string, number>;
type Builder = (v: Values, ctx: PlotContext) => Plot;

const responsePane = (curves: Trace[], rules: Rule[] = [], y = dbAxis(-24, 24, 12), x = freqAxis()): Pane =>
  ({ x, y, traces: curves, rules });

function musical(mode: MusicalMode): Builder {
  return (v, { rate }) => {
    const p = { frequency: v.frequency, bandwidth: v.bandwidth, gainDb: v.gainDb ?? 0, mix: v.mix };
    const x = freqAxis();
    return {
      panes: [responsePane([traceOf(x, (f) => musicalResponse(mode, p, f, rate), "a")], [{ tone: "b", x: v.frequency }])],
      top: `${hz(v.frequency)} · BW ${hz(v.bandwidth)} · Q ${fixed(v.frequency / Math.max(v.bandwidth, 0.1), 2)}${mode === "regalia" ? ` · ${dbText(v.gainDb)}` : ""}`,
      bottom: "",
    };
  };
}

const STAGE_TONES: Record<string, Tone> = { low: "b", band: "c", high: "d", notch: "e" };

function pn(kind: PnKind): Builder {
  return (v, { rate }) => {
    const steps = pnSteps(v.clockHz, rate);
    const x = freqAxis(Math.max(steps.perSec / 2000, 1), steps.perSec / 2);
    const rms = pnRms(kind) * v.level * v.mix;
    return {
      panes: [responsePane([traceOf(x, (f) => 10 * Math.log10(Math.max(pnShape(kind, (2 * Math.PI * f) / steps.perSec), 1e-24)), "a", { fill: true })],
        [], dbAxis(-36, 12, 12), x)],
      top: `${fixed(steps.perSec, 0)} STEPS/S · REPEATS EVERY ${secs(steps.repeatSec)}`,
      bottom: `THE STEPS' SPECTRUM TO ${hz(steps.perSec / 2)} · ${rms > 0 ? `${fixed(20 * Math.log10(rms), 1)} DBFS RMS` : "SILENT"}`,
    };
  };
}

/** Level in, level out, both dB, with the unity line. */
function transferPane(min: number, f: (db: number) => number, rules: Rule[] = [], max = 0): Pane {
  const x = dbAxis(min, max, min <= -90 ? 30 : 12);
  return { x, y: dbAxis(min, max, min <= -90 ? 30 : 12), traces: [traceOf(x, (l) => l, "c", { dash: true }, 2), traceOf(x, f, "a", {}, 600)], rules };
}

function field(kind: "invert" | "swap" | "width" | "utility" | "matrix"): Builder {
  return (v, ctx) => {
    const m = matrixFor(kind, v);
    // Hard left, centre, hard right and out of phase, as mid (up) and side (across).
    const inputs: [string, number, number][] = [["L", 1, 0], ["C", 1, 1], ["R", 0, 1], ["±", 1, -1]];
    const ms = (l: number, r: number): [number, number] => [(l - r) / 2, (l + r) / 2];
    const out = inputs.map(([label, l, r]) => {
      const [lo, ro] = [m[0][0] * l + m[0][1] * r, m[1][0] * l + m[1][1] * r];
      return { label, from: ms(l, r), to: ms(lo, ro) };
    });
    const reach = Math.max(1, ...out.flatMap((o) => [Math.abs(o.to[0]), Math.abs(o.to[1])])) * 1.15;
    const step = reach > 4 ? Math.ceil(reach / 2) : reach > 2 ? 1 : 0.5;
    // Whole numbers only are printed, so the small screens stay legible.
    const axis = evenAxis(-Math.ceil(reach / step) * step, Math.ceil(reach / step) * step, step, (n) => (Number.isInteger(n) ? `${n}` : ""));
    const pane: Pane = {
      x: axis, y: axis, title: "MID ↑ · SIDE →", square: true,
      traces: out.map((o) => ({ tone: "b", dash: true, points: [o.from, o.to] })),
      dots: [
        ...out.map((o) => ({ tone: "c" as const, x: o.from[0], y: o.from[1], hollow: true })),
        ...out.map((o) => ({ tone: "a" as const, x: o.to[0], y: o.to[1], label: o.label })),
      ],
      rules: [{ tone: "c", x: 0 }, { tone: "c", y: 0 }],
    };
    const row = (r: readonly number[], side: string) => `${side}' = ${signed(r[0])}·L ${r[1] < 0 ? "−" : "+"} ${fixed(Math.abs(r[1]), 2)}·R`;
    const panes = [pane];
    if (kind === "matrix") {
      const x = freqAxis();
      panes.push({ ...responsePane([traceOf(x, (f) => monoCutResponse(v.monoBelowHz, f, ctx.rate), "a")], [], dbAxis(-36, 0, 12), x), title: "SIDE LOW CUT" });
    }
    return { panes, top: row(m[0], "L"), bottom: row(m[1], "R") };
  };
}

function sweepPlot(v: Values, rate: number, opts: { offset?: number; floor?: number }, depth: number): Plot {
  const span = 2 / Math.max(v.rateHz, 1e-6);
  const x = timeAxis(span);
  const p = { delayMs: v.delayMs, rateHz: v.rateHz, stereo: v.stereo ?? 0, depthMs: depth };
  const top = Math.max(modDelaySweep(p, 0.25 / v.rateHz, 0, rate, opts), v.delayMs + depth);
  const y = evenAxis(0, Math.ceil(top / 5) * 5 || 5, Math.ceil(top / 5) * 5 >= 20 ? 10 : 5, (ms) => `${ms}`);
  const { up, down } = pitchSwing(depth, v.rateHz);
  return {
    panes: [{
      x, y, title: "DELAY MS",
      traces: [traceOf(x, (t) => modDelaySweep(p, t, 0, rate, opts), "a"), traceOf(x, (t) => modDelaySweep(p, t, 1, rate, opts), "b", { dash: true })],
    }],
    top: `PITCH ${cents(up)} / ${cents(down)} CENTS`,
    bottom: `— L  - - R · 2 CYCLES, ${secs(span)}`,
  };
}

function tapsPane(ratio: number, windowMs: number, rate: number, title: string, span: number): Pane {
  const x = timeAxis(span);
  const win = pitchTaps({ ratio, windowMs }, 0, rate).win;
  const at = (t: number) => pitchTaps({ ratio, windowMs }, Math.floor(t * rate), rate);
  const y = evenAxis(0, Math.ceil(((win / rate) * 1000) / 10) * 10, Math.ceil(((win / rate) * 1000) / 10) * 5);
  return {
    x, y, title,
    traces: [
      { tone: "a", points: broken(across(x, 400).map((t) => [t, (at(t).a / rate) * 1000]), ((win / rate) * 1000) / 2) },
      { tone: "b", dash: true, points: broken(across(x, 400).map((t) => [t, (at(t).b / rate) * 1000]), ((win / rate) * 1000) / 2) },
    ],
  };
}

const PLOTS: Record<string, Builder> = {
  "notch-response": musical("notch"),
  "resonator-response": musical("resonator"),
  "regalia-response": musical("regalia"),

  "damping-response": (v, { rate }) => {
    const x = freqAxis();
    return {
      panes: [responsePane([traceOf(x, (f) => dampingResponse({ cutoffHz: v.cutoffHz, wet: v.wet, dry: v.dry }, f, rate), "a")], [{ tone: "b", x: v.cutoffHz }], dbAxis(-36, 12, 12))],
      top: `CUTOFF ${hz(v.cutoffHz)} · ONE POLE`,
      bottom: "",
    };
  },

  "chamberlin-response": (v, { rate }) => {
    const x = freqAxis();
    const stages = ["low", "band", "high", "notch"].filter((s) => v[`${s}On`] >= 0.5 && v[`${s}Amp`] > 0.0001);
    return {
      panes: [responsePane([traceOf(x, (f) => chamberlinResponse(v as Chamberlin, f, rate), "a")],
        stages.map((s) => ({ tone: STAGE_TONES[s], x: v[`${s}Freq`] })))],
      top: stages.length === 0 ? "ALL OFF · SILENT" : `${stages.map((s) => s.toUpperCase()).join(" + ")} · DRIVE ×${fixed(v.drive, 2)}`,
      bottom: "SMALL SIGNAL: THE TANH STAGES BEND IT WHEN LOUD",
    };
  },

  "eq-response": (v, { rate }) => {
    const x = freqAxis();
    const nodes = Array.from({ length: 8 }, (_, band) => ({ band, ...eqNode(v, band) })).filter((n) => n.on);
    return {
      panes: [{
        ...responsePane([traceOf(x, (f) => eqResponse(v, f, rate), "a", {}, 300)]),
        dots: nodes.map((n) => ({ tone: "b" as const, x: n.freq, y: eqResponse(v, n.freq, rate), label: String(n.band + 1) })),
      }],
      top: `${nodes.length} OF 8 NODES ON`,
      bottom: "",
    };
  },

  "pn-spectrum": pn("multibit"),
  "pn-eq-spectrum": pn("equalised"),
  "pn-bit-spectrum": pn("single"),

  "phaser-response": (v, { rate }) => {
    const x = freqAxis();
    const at = (lfo: number) => (f: number) => phaserResponse(v as Phaser, f, rate, lfo);
    return {
      panes: [responsePane([traceOf(x, at(-1), "b", { dash: true }, 300), traceOf(x, at(1), "b", { dash: true }, 300), traceOf(x, at(0), "a", {}, 300)],
        [{ tone: "c", x: v.centreHz }], dbAxis(-36, 12, 12))],
      top: `${Math.round(v.notches)} NOTCHES FROM ${hz(v.centreHz)} · ×${fixed(v.spread, 2)}`,
      bottom: `— CENTRE  - - ENDS ±${fixed(v.sweep / 2, 2)} OCT`,
    };
  },

  "gate-curve": (v) => ({
    panes: [transferPane(-90, (l) => gateSteady({ thresholdDb: v.thresholdDb, depth: v.depth }, l), [{ tone: "b", x: v.thresholdDb }])],
    top: `THRESHOLD ${dbText(v.thresholdDb)} · DEPTH ${fixed(v.depth * 100, 0)}%`,
    bottom: `STEADY · ATTACK ${secs(v.attackMs / 1000)} · REL ${secs(v.releaseMs / 1000)}`,
  }),

  "fit-curve": (v) => ({
    panes: [transferPane(-90, (l) => fitSteady({ amount: v.amount, floorDb: v.floorDb }, l), [{ tone: "b", x: v.floorDb }])],
    top: `AMOUNT ${fixed(v.amount * 100, 0)}% · FLOOR ${dbText(v.floorDb)}`,
    bottom: `STEADY · TO 0.9 FS · GRAIN ${secs(v.grainMs / 1000)}`,
  }),

  "maximizer-curve": (v) => ({
    panes: [transferPane(-60, (l) => maximizerSteady({ amount: v.amount, ceilingDb: v.ceilingDb, autoLevel: v.autoLevel, autoComp: v.autoComp }, l), [{ tone: "b", y: v.ceilingDb }])],
    top: `${fixed(Math.pow(20, v.amount), 1)}:1 · KNEE ${fixed(9 * (1 - v.amount) + 1, 1)} · CEIL ${dbText(v.ceilingDb)}`,
    bottom: `STEADY · THRESHOLD ${v.autoComp >= 0.5 ? "FOLLOWS LEVEL" : dbText(-24 * v.amount)}`,
  }),

  "spectral-curve": (v) => ({
    panes: [transferPane(-90, (l) => spectralSteady(v as never, l), [{ tone: "b", x: v.thresholdDb }], 24)],
    top: `${["GATE-DUCK", "EXPAND", "COMPRESS"][Math.trunc(v.mode)]} ${v.affect >= 0.5 ? "ABOVE" : "BELOW"} ${dbText(v.thresholdDb)} · ${v.smoothed >= 0.5 ? "SMOOTHED" : "HARD"}`,
    bottom: `ONE BAND · DB RE ${v.relativeToPeak >= 0.5 ? "FRAME PEAK" : v.useSound >= 0.5 ? "THRESHOLD SOUND" : "FULL SCALE"}`,
  }),

  "spectral-bands": (v, { rate }) => {
    const b = spectralBands({ bands: v.bands, lowHz: v.lowHz, highHz: v.highHz }, rate);
    const x = freqAxis(20, 20000);
    const edge = (bin: number) => Math.min(Math.max(bin * b.perBin, 20), 20000);
    return {
      panes: [{ x, y: evenAxis(0, 1, 1, () => ""), traces: [{ tone: "a", fill: true, points: [[edge(b.low), 1], [edge(b.high), 1]] }], rules: [{ tone: "b", x: edge(b.low) }, { tone: "b", x: edge(b.high) }] }],
      top: `BINS ${b.low}–${b.high} OF ${b.bins} · ${fixed(b.perBin, 1)} HZ EACH`,
      bottom: `${b.n}-POINT HAMMING · ${fixed(b.windowMs, 1)} MS${v.thirdOctave >= 0.5 ? " · THIRD-OCTAVE GROUPS" : ""}`,
    };
  },

  "quantizer": (v, { rate }) => {
    const axis = evenAxis(-1, 1, 0.5);
    const bits = Math.round(v.bits);
    return {
      panes: [{ x: axis, y: axis, traces: [traceOf(axis, (x) => x, "c", { dash: true }, 2), traceOf(axis, (x) => decimatorTransfer(x, { bits, mix: v.mix }), "a", {}, 1200)] }],
      top: bits >= 24 ? "24 BITS · UNTOUCHED" : `${bits} BIT${bits === 1 ? "" : "S"} · ${2 ** bits} LEVELS`,
      bottom: `SAMPLE RATE ${hz((rate * v.rate) / 100)}`,
    };
  },

  "field-invert": field("invert"),
  "field-swap": field("swap"),
  "field-width": field("width"),
  "field-utility": field("utility"),
  "field-matrix": field("matrix"),

  "dc-response": (v, { rate }) => {
    const x = freqAxis(1, 2000);
    return {
      panes: [responsePane([traceOf(x, (f) => dcResponse(v.hz, f, rate), "a")], [{ tone: "b", x: v.hz }], dbAxis(-36, 6, 6), x)],
      top: `CORNER ${hz(v.hz)}`,
      bottom: "",
    };
  },

  "gain-factor": (v) => {
    const x = evenAxis(-24, 24, 12);
    return {
      panes: [{ x, y: evenAxis(0, 1, 1, () => ""), traces: [], stems: [{ tone: "a", x: v.db, y: 1 }], rules: [{ tone: "c", x: 0 }] }],
      top: `× ${fixed(Math.pow(10, v.db / 20), 3)}`,
      bottom: "",
    };
  },

  "ring-sweep": (v, { rate }) => {
    const sweep = ringSweep({ hz: v.hz, sweep: v.sweep }, rate);
    const span = Number.isFinite(sweep.period) ? Math.min(2 * sweep.period, 60) : 2;
    const x = timeAxis(span);
    const y = freqAxis(1, 20000, true);
    return {
      panes: [{ x, y, traces: [{ tone: "a", points: broken(across(x, 400).map((t) => [t, sweep.at(t)]), Math.abs(v.sweep) * (span / 400) * 2 + 1) }] }],
      top: `${hz(v.hz)} · ${v.sweep === 0 ? "NO SWEEP" : `${v.sweep > 0 ? "+" : "−"}${fixed(Math.abs(v.sweep), 0)} HZ/S`}`,
      bottom: v.sweep === 0 ? `MIX ${fixed(v.mix * 100, 0)}%` : `AGAIN EVERY ${secs(sweep.period)}`,
    };
  },

  "rappify-response": (v, { rate }) => {
    const x = freqAxis();
    const range = rappifyRange({ amount: v.amount, hz: v.hz }, rate);
    return {
      panes: [responsePane([traceOf(x, (f) => rappifyResponse(v as never, 0, f, rate), "b", { dash: true }), traceOf(x, (f) => rappifyResponse(v as never, 1, f, rate), "a")],
        [{ tone: "c", x: range.low }, { tone: "c", x: range.high }], dbAxis(-24, 12, 12))],
      top: `${hz(range.low)} – ${hz(range.high)}`,
      bottom: "- - SHUT  — OPEN −18 DB",
    };
  },

  "boomerang-read": (v, { rate }) => {
    const read = (t: number) => boomerangRead({ throwMs: v.throwMs }, Math.floor(t * rate), rate);
    const throwSec = read(0).throwFrames / rate;
    const x = timeAxis(spanFor(throwSec, SPANS));
    const back = evenAxis(0, Math.ceil(throwSec * 10) / 10 * 1000, Math.ceil(throwSec * 10) / 10 * 500);
    return {
      panes: [
        { x, y: back, title: "READS BACK MS", traces: [{ tone: "a", points: broken(across(x, 400).map((t) => [t, (read(t).lag / rate) * 1000]), throwSec * 500) }] },
        { x, y: evenAxis(0, 1, 1), title: "FADE", traces: [traceOf(x, (t) => read(t).fade, "b", {}, 400)] },
      ],
      top: `THROW ${secs(throwSec)}`,
      bottom: `PASS ${secs(Math.ceil(read(0).throwFrames / 2) / rate)} · MIX ${fixed(v.mix * 100, 0)}%`,
    };
  },

  "schroeder-tail": (v, { rate }) => combPlot("schroeder", v, rate),
  "moorer-tail": (v, { rate }) => combPlot("moorer", v, rate),

  "mod-sweep": (v, { rate }) => sweepPlot(v, rate, {}, v.depthMs),
  "doubler-sweep": (v, { rate }) => sweepPlot(v, rate, { offset: 1.7, floor: 1 }, v.variationMs),

  "rotor": (v, { rate }) => {
    const turn = 1 / v.rateHz;
    const x = timeAxis(turn);
    const at = (ch: number) => (t: number) => leslieRotor(v as never, t, ch, rate);
    const most = Math.max(...across(x).flatMap((t) => [at(0)(t).delayMs, at(1)(t).delayMs]));
    const { up, down } = pitchSwing(v.depthMs, v.rateHz);
    return {
      panes: [
        { x, y: evenAxis(0, Math.ceil(most / 10) * 10 || 10, 10), title: "DELAY MS", traces: [traceOf(x, (t) => at(0)(t).delayMs, "a"), traceOf(x, (t) => at(1)(t).delayMs, "b", { dash: true })] },
        { x, y: evenAxis(0, 1, 0.5), title: "LEVEL", traces: [traceOf(x, (t) => at(0)(t).gain, "a"), traceOf(x, (t) => at(1)(t).gain, "b", { dash: true })] },
      ],
      top: `TURN ${secs(turn)} · ${cents(up)}/${cents(down)} CENTS`,
      bottom: "— LEFT  - - RIGHT",
    };
  },

  "pitch-taps": (v, { rate }) => {
    const ratio = Math.pow(2, v.semitones / 12);
    const period = pitchTaps({ ratio, windowMs: v.windowMs }, 0, rate).period / rate;
    const span = Number.isFinite(period) ? spanFor(2 * period, SPANS) : 1;
    return {
      panes: [tapsPane(ratio, v.windowMs, rate, "TAPS READ BACK MS", span)],
      top: `×${fixed(ratio, 3)} · SWEEP ${secs(period)}`,
      bottom: `— A  - - B · FEEDBACK ${fixed(v.feedback, 2)}`,
    };
  },

  "detune-taps": (v, { rate }) => {
    const ratio = Math.pow(2, v.cents / 1200);
    const period = pitchTaps({ ratio, windowMs: v.windowMs }, 0, rate).period / rate;
    const span = spanFor(2 * period, SPANS);
    return {
      panes: [tapsPane(ratio, v.windowMs, rate, "LEFT, UP · MS", span), tapsPane(1 / ratio, v.windowMs, rate, "RIGHT, DOWN · MS", span)],
      top: `±${fixed(v.cents, 1)} CENTS · SWEEP ${secs(period)}`,
      bottom: "— TAP A  - - TAP B",
    };
  },

  "doppler-path": (v, { rate }) => {
    const path = dopplerPath({ distanceMs: v.distanceMs, velocityMps: v.velocityMps, speedMps: v.speedMps }, rate);
    const span = spanFor(Number.isFinite(path.stopsAt) ? path.stopsAt * 1.2 : 2, SPANS);
    const x = timeAxis(span);
    const most = Math.max(path.at(0), path.at(span));
    const y = evenAxis(0, Math.ceil(most / 100) * 100, Math.ceil(most / 100) * 50);
    const pitch = path.ratio > 0 ? `${cents(1200 * Math.log2(path.ratio))} CENTS` : path.ratio === 0 ? "STANDS STILL" : "PLAYS BACKWARDS";
    return {
      panes: [{ x, y, title: "DELAY MS", traces: [traceOf(x, path.at, "a")] }],
      top: `PITCH ${pitch} · ${Number.isFinite(path.stopsAt) ? `STOPS ${secs(path.stopsAt)}` : "STILL"}`,
      bottom: "FROM WHEN THE DISTANCE IS SET",
    };
  },

  "trem-cycle": (v) => {
    const x = evenAxis(0, 1, 0.25, (f) => `${Number(((f / v.rateHz) * 1000).toFixed(0))}ms`);
    const g = (side: "left" | "right") => (f: number) => tremoloGains(v as never, f % 1)[side];
    return {
      panes: [{ x, y: evenAxis(0, 1, 0.5), traces: [traceOf(x, g("left"), "a", {}, 400), traceOf(x, g("right"), "b", { dash: true }, 400)] }],
      top: `${["SINE", "TRIANGLE", "SQUARE"][Math.round(v.shape)]} · ${fixed(v.rateHz, 2)} HZ · DEPTH ${fixed(v.depth * 100, 0)}%`,
      bottom: "— LEFT  - - RIGHT · ONE CYCLE",
    };
  },

  "echo-train": (v, { rate }) => {
    const train = echoTrain(v as never, rate);
    const x = timeAxis(spanFor(train[train.length - 1].t * 1.05, SPANS));
    const y = evenAxis(train.some((s) => s.low < 0) ? -1 : 0, 1, 0.5);
    return {
      panes: [{ x, y, traces: [], stems: train.filter((s) => s.t <= x.max).map((s) => ({ tone: "a" as const, x: s.t, y: s.low })),
        dots: train.slice(1).filter((s) => s.t <= x.max).map((s) => ({ tone: "b" as const, x: s.t, y: s.high })) }],
      top: `EVERY ${secs(v.delayMs / 1000)} · FEEDBACK ${fixed(v.feedback, 2)}`,
      bottom: "| REPEATS  • AT 4 KHZ",
    };
  },

  "allpass-train": (v, { rate }) => {
    const train = allpassTrain(v as never, rate);
    const x = timeAxis(spanFor(train[train.length - 1].t * 1.05, SPANS));
    return {
      panes: [{ x, y: evenAxis(-1, 1, 0.5), traces: [], stems: train.filter((s) => s.t <= x.max).map((s) => ({ tone: "a" as const, x: s.t, y: s.level })), rules: [{ tone: "c", y: 0 }] }],
      top: `EVERY ${secs(Math.max(v.delayMs / 1000, 1 / rate))} · G ${fixed(v.coefficient, 3)}`,
      bottom: "THE IMPULSE RESPONSE",
    };
  },

  "tap-train": (v, { rate }) => {
    const span = spanFor(Math.max(v.delay1Ms, v.delay2Ms) / 1000 * 8, SPANS);
    const train = multiTapTrain(v as never, rate, span);
    const x = timeAxis(span);
    const pane = (side: "left" | "right", tone: Tone, title: string): Pane =>
      ({ x, y: evenAxis(0, 1, 0.5), title, traces: [], stems: train.map((s) => ({ tone, x: s.t, y: s[side] })) });
    return {
      panes: [pane("left", "a", "LEFT"), pane("right", "b", "RIGHT")],
      top: `TAPS ${secs(v.delay1Ms / 1000)} / ${secs(v.delay2Ms / 1000)} · FEEDBACK ${fixed(v.feedback, 2)}`,
      bottom: "IMPULSE RESPONSE, NO DRY",
    };
  },

  "impulse-window": (v, { rate, sound }) => {
    // With no impulse yet, the length asked for: what an impulse that long gets.
    const frames = lengthUsed(v.lengthMs, rate, sound ? Math.floor(sound.durationSec * rate) : Infinity);
    const window = Math.round(v.window);
    const x = timeAxis(frames / rate);
    const shape = across(x, 300).map((t): [number, number] => [t, convolutionWindow(window, Math.min(Math.floor(t * rate), frames - 1), frames)]);
    return {
      panes: [{ x, y: evenAxis(window === 4 ? -0.5 : 0, 1, 0.5), traces: [{ tone: "a", fill: true, points: shape }] }],
      top: sound ? `${sound.name.slice(0, 12).toUpperCase()} · ${secs(frames / rate)} OF ${secs(sound.durationSec)}` : `NO IMPULSE · ${secs(frames / rate)} ASKED`,
      bottom: [v.brighten >= 0.5 ? "+6 DB/OCT" : "", v.ringModulate >= 0.5 ? "RING MOD" : ""].filter(Boolean).join(" · "),
    };
  },
};

function combPlot(kind: "schroeder" | "moorer", v: Values, rate: number): Plot {
  const tank = combTails(kind, v as unknown as CombTank, rate);
  const x = timeAxis(spanFor(Number.isFinite(tank.rt60) ? tank.rt60 * 1.05 : 3, SPANS));
  const left = tank.combs.filter((c) => c.side === 0);
  const curve = (pass: number, gain: number) => (t: number) => {
    const start = tank.preSec + pass;
    if (t < start) return NaN;
    return gain <= 0 ? -Infinity : 20 * Math.log10(gain) * ((t - start) / pass);
  };
  const traces = left.map((c) => traceOf(x, curve(c.passSec, c.low), "a", {}, 300));
  if (kind === "moorer") traces.push(...left.map((c) => traceOf(x, curve(c.passSec, c.high), "b", { dash: true }, 300)));
  return {
    panes: [{ x, y: dbAxis(-60, 0, 15), traces, rules: [{ tone: "c", x: tank.preSec }] }],
    top: `RT60 ${v.freeze >= 0.5 ? "∞ · FROZEN" : secs(tank.rt60)} · PRE ${secs(tank.preSec)}`,
    bottom: `${left.length} COMBS L${kind === "moorer" ? "  - - 4 KHZ" : ""} · R +${fixed(v.spread * 100, 0)}%`,
  };
}

/** The display kinds the ported panels draw. */
export const PLOT_KINDS: readonly string[] = Object.keys(PLOTS);

/** What a display draws for these values, or nothing for a kind it does not know. */
export function plotFor(kind: string, values: Values, ctx: PlotContext): Plot | undefined {
  return PLOTS[kind]?.(values, ctx);
}

/** Where a value sits along an axis, 0 to 1, held to its ends. */
export function place(axis: Axis, value: number): number {
  const f = axis.log
    ? Math.log(Math.max(value, 1e-12) / axis.min) / Math.log(axis.max / axis.min)
    : (value - axis.min) / (axis.max - axis.min);
  return Math.min(Math.max(f, 0), 1);
}

