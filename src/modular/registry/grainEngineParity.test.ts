// No control of MultiGrainLive's granular tray is missing from the Grain Engine.
//
// The inventory below was taken from MultiGrainLive itself (branch
// `open-world`), not from memory:
//   - `ui/app.js` `renderStretchParams` (the engine picker, its switch row,
//     Time and pitch, each engine's own controls and its extended groups) and
//     `renderGrainParams` (Grain shape, Pitch movement, Scan, Shape, Layer
//     scatter, Randomness), every `param(...)` with its range, step, default
//     and whether it is logarithmic; the `GRAIN_DEFAULTS`, `WSOLA_DEFAULTS`,
//     `VOCODER_DEFAULTS`, `PVSOLA_DEFAULTS` and `HYBRID_DEFAULTS` tables;
//   - `gkLayout`, `gkKnob`, `gkPack` and `GK_VIEWS` (the cloud column, knobs,
//     banks, Show: All / Standard / Extended);
//   - `docs/DESIGN-CRITIQUE.md`, "The granular engine";
//   - `tests/ui/fixtures/controls-baseline.json`, the five `grain/stretch/*`
//     views, which list the same controls by name.
// `prism_grain`'s parameter structs (`Grain`, `WsolaParams`, `VocoderParams`,
// `PvsolaParams`, `HybridParams`) give the same defaults, and the Rust tests
// hold the module to the crate.
//
// And the pitch row's last two places: the tuning menu ("free ▾": the 81
// scales of `prism_grain::tuning`, or a grid) and Keys (`openScaleMenu`,
// `pickScale`, `NOTE_KEYS`, `noteSemitones`).

import { describe, expect, it } from "vitest";
import { moduleRegistry } from "./registry";
import { isMappable } from "../modulationTargets";
import { PARAM_INDICES } from "../audio/wasm/engineBridge";
import { grainFace, GRAIN_FACE_WIDTH, GRAIN_PAGES } from "../ui/panels/layouts/grainCabinet";
import { validateLayout, type PanelLayout } from "../ui/panels/layout";
import type { JsonValue } from "../model/graph";
import { GRAIN_SCALES } from "./grainTuning.generated";

type Knob = { kind: "knob"; id: string; label: string; min: number; max: number; step: number; def: number; log?: true; round?: true; detent?: number };
type Switch = { kind: "switch"; id: string; label: string; def: boolean };
type Choice = { kind: "choice"; id: string; label: string; options: string[]; def: string };
type Control = Knob | Switch | Choice;

const knob = (id: string, label: string, min: number, max: number, step: number, def: number, more: { log?: true; round?: true; detent?: number } = {}): Knob =>
  ({ kind: "knob", id, label, min, max, step, def, ...more });
const sw = (id: string, label: string, def: boolean): Switch => ({ kind: "switch", id, label, def });
const choice = (id: string, label: string, options: string[], def: string): Choice => ({ kind: "choice", id, label, options, def });

// ---- the controls, as `app.js` builds them -----------------------------------

const TIME_AND_PITCH = [
  knob("stretch", "Stretch", 0.01, 100, 0.01, 1, { log: true }),
  // Continuous with no tuning chosen: `scaleStep()` is 0.001 when the grid is "free".
  knob("semitones", "Pitch", -48, 48, 0.001, 0),
  knob("window-ms", "Window", 5, 2000, 1, 40, { log: true }),
];
const GRAIN_SHAPE = [
  knob("position", "Position", -1, 1, 0.001, 0),
  knob("grain-rate", "Rate", 0, 500, 1, 0),
  knob("density", "Density", 0, 500, 1, 0),
  knob("layers", "Layers", 1, 64, 1, 1),
  knob("overlap", "Overlap", 1, 8, 0.1, 2),
  knob("size-jitter", "Size jitter", 0, 1, 0.01, 0),
  knob("position-jitter", "Position jitter", 0, 500, 1, 0),
];
const PITCH_MOVEMENT = [
  knob("pitch-jitter", "Pitch jitter", 0, 24, 0.1, 0),
  knob("pitch-drift", "Pitch drift", 0, 24, 0.1, 0),
  knob("drift-rate", "Drift rate", 0.01, 10, 0.01, 0.5),
];
const SCAN = [knob("scan", "Scan", -2, 2, 0.01, 1), sw("reverse", "Reverse grains", false), sw("wrap", "Wrap positions", false)];
const SHAPE = [
  knob("envelope", "Envelope", 0, 1, 0.01, 0.5, { detent: 0.5 }),
  knob("size-range", "Size range", 1, 8, 0.05, 1),
  knob("layer-spread", "Layer spread", 0, 4, 0.01, 1),
  knob("pan-spread", "Pan spread", 0, 1, 0.01, 0),
];
const LAYER_SCATTER = [knob("layer-scatter", "Scatter", 0, 1, 0.01, 0), knob("layer-scatter-ms", "Range", 1, 2000, 1, 120, { log: true })];
// The seed's range is what `Re-roll`'s generator reaches: `% 2147483647`.
const RANDOMNESS = [sw("link-jitter", "Link jitter", false), sw("drift-step", "Step the drift", false), knob("seed", "Seed", 0, 2147483646, 1, 1)];

const PRESERVE = sw("preserve-transients", "Preserve transients", false);
const DETECTOR = knob("detector", "Detector", 0, 1, 0.01, 0.5);
const SPLICE = [
  knob("search-ms", "Search", 0, 200, 0.5, 10),
  choice("splice", "Pick", ["best", "worst", "loud"], "best"),
  choice("window-shape", "Window", ["hann", "tri", "rect"], "hann"),
  knob("stride", "Stride", 1, 128, 1, 4),
];
const TRANSIENTS = [knob("floor", "Floor", 0, 2, 0.01, 1), knob("guard", "Guard", 1, 16, 0.1, 3)];
const ANALYSIS = knob("analysis-ms", "Analysis window", 5, 500, 1, 46, { log: true });
const PHASE_LOCK = sw("phase-lock", "Phase lock", true);
const SPECTRUM = [knob("freeze", "Freeze", 0, 1, 0.01, 0), knob("blur", "Blur", 0, 1, 0.01, 0), knob("gate", "Gate", 0, 1, 0.01, 0)];
const PHASE = [
  knob("freq-trust", "Freq trust", 0, 4, 0.01, 1),
  knob("phase-spread", "Phase spread", 0, 4, 0.01, 1),
  knob("peak-width", "Peak width", 1, 16, 1, 2),
  knob("lock-width", "Lock width", 0, 4, 0.01, 1),
  sw("link-stereo", "Link stereo", false),
];
const ANCHOR = [knob("anchor-search-ms", "Search", 0, 200, 0.5, 10), knob("blend", "Blend", 0, 1, 0.01, 0.5)];
const REANCHOR = knob("re-anchor", "Re-anchor", 1, 64, 1, 6);
const LEVELS = [knob("tone", "Tone", 0, 2, 0.01, 1), knob("hits", "Hits", 0, 2, 0.01, 1), knob("air", "Air", 0, 2, 0.01, 1)];
const REMAKE = sw("remake-noise", "Remake noise", true);
const SEPARATION = [
  knob("hold", "Hold", 3, 101, 2, 17),
  knob("spread", "Spread", 3, 101, 2, 17),
  knob("margin", "Margin", 1, 8, 0.05, 2),
  // Its handler rounds what the slider gives: `h.fftSize = Math.round(x)`.
  knob("resolution", "Resolution", 256, 8192, 256, 2048, { log: true, round: true }),
];
const GRAIN_CLOUD = sw("cloud", "Grain cloud", false);
const CLOUD_MIX = knob("cloud-mix", "Cloud", 0, 1, 0.01, 0.5);

type Bank = { name: string; side: "standard" | "extended"; controls: Control[] };
type View = { engine: string; values: Record<string, JsonValue>; switches: Control[]; banks: Bank[] };

const std = (name: string, controls: Control[]): Bank => ({ name, side: "standard", controls });
const ext = (name: string, controls: Control[]): Bank => ({ name, side: "extended", controls });
const EVERY_ENGINE_STD = [std("Grain shape", GRAIN_SHAPE), std("Pitch movement", PITCH_MOVEMENT)];
const EVERY_ENGINE_EXT = [ext("Scan", SCAN), ext("Shape", SHAPE), ext("Layer scatter", LAYER_SCATTER), ext("Randomness", RANDOMNESS)];

/**
 * Each engine's tray as `reflectEngine` builds it. A bank's controls are in
 * the order they are appended; Detector and Transients appear with Preserve
 * transients (always on the hybrid, which holds preservation on), the Cloud
 * mix with the grain cloud.
 */
const VIEWS: View[] = [
  { engine: "Grains", values: {}, switches: [], banks: [std("Time and pitch", TIME_AND_PITCH), ...EVERY_ENGINE_STD, ...EVERY_ENGINE_EXT] },
  { engine: "WSOLA", values: {}, switches: [PRESERVE, GRAIN_CLOUD], banks: [
    std("Time and pitch", TIME_AND_PITCH), ...EVERY_ENGINE_STD, ext("Splice", SPLICE), ...EVERY_ENGINE_EXT] },
  { engine: "WSOLA", values: { "preserve-transients": true, cloud: true }, switches: [PRESERVE, GRAIN_CLOUD], banks: [
    std("Time and pitch", TIME_AND_PITCH), std("This engine", [CLOUD_MIX, DETECTOR]), ...EVERY_ENGINE_STD,
    ext("Splice", SPLICE), ext("Transients", TRANSIENTS), ...EVERY_ENGINE_EXT] },
  { engine: "Vocoder", values: {}, switches: [PHASE_LOCK, GRAIN_CLOUD], banks: [
    std("Time and pitch", TIME_AND_PITCH), std("This engine", [ANALYSIS]), ...EVERY_ENGINE_STD,
    ext("Spectrum", SPECTRUM), ext("Phase", PHASE), ...EVERY_ENGINE_EXT] },
  { engine: "PVSOLA", values: {}, switches: [PHASE_LOCK, GRAIN_CLOUD], banks: [
    std("Time and pitch", TIME_AND_PITCH), std("This engine", [REANCHOR, ANALYSIS]), ...EVERY_ENGINE_STD,
    ext("Anchor", ANCHOR), ext("Spectrum", SPECTRUM), ext("Phase", PHASE), ...EVERY_ENGINE_EXT] },
  { engine: "Hybrid", values: {}, switches: [GRAIN_CLOUD], banks: [
    std("Time and pitch", TIME_AND_PITCH), std("This engine", [...LEVELS, REMAKE, ANALYSIS, PHASE_LOCK, DETECTOR]), ...EVERY_ENGINE_STD,
    ext("Separation", SEPARATION), ext("Spectrum", SPECTRUM), ext("Phase", PHASE), ext("Splice", SPLICE), ext("Transients", TRANSIENTS),
    ...EVERY_ENGINE_EXT] },
];

const EVERY_CONTROL = new Map<string, Control>();
for (const view of VIEWS) for (const c of [...view.switches, ...view.banks.flatMap((b) => b.controls)]) EVERY_CONTROL.set(c.id, c);

const module = moduleRegistry.get("m.grain-engine")!;
const parameter = (id: string) => module.parameters.find((p) => p.id === id);

const faceFor = (view: View): PanelLayout => grainFace({ ...Object.fromEntries(module.parameters.map((p) => [p.id, p.defaultValue])), engine: view.engine, ...view.values });

describe("The Grain Engine has every control of MultiGrainLive's granular tray", () => {
  it("as a parameter with MultiGrainLive's range, step and default", () => {
    const wrong: string[] = [];
    for (const c of EVERY_CONTROL.values()) {
      const p = parameter(c.id);
      if (!p) { wrong.push(`${c.id}: missing`); continue; }
      if (p.label !== c.label) wrong.push(`${c.id}: labelled ${p.label}, not ${c.label}`);
      if (c.kind === "knob") {
        const have = [p.kind, p.minimum, p.maximum, p.step, p.defaultValue];
        const want = ["number", c.min, c.max, c.step, c.def];
        if (JSON.stringify(have) !== JSON.stringify(want)) wrong.push(`${c.id}: ${JSON.stringify(have)} against ${JSON.stringify(want)}`);
      } else if (c.kind === "switch") {
        if (p.kind !== "boolean" || p.defaultValue !== c.def) wrong.push(`${c.id}: ${p.kind} ${String(p.defaultValue)}`);
      } else if (p.kind !== "enum" || JSON.stringify(p.options) !== JSON.stringify(c.options) || p.defaultValue !== c.def) {
        wrong.push(`${c.id}: ${JSON.stringify(p.options)} ${String(p.defaultValue)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("each reaching the Rust engine, and each number mappable by an LFO", () => {
    const indices = PARAM_INDICES["m.grain-engine"];
    const missing = [...EVERY_CONTROL.keys()].filter((id) => indices[id] === undefined);
    expect(missing).toEqual([]);
    const unmappable = [...EVERY_CONTROL.values()].filter((c) => c.kind === "knob" && !isMappable("m.grain-engine", c.id)).map((c) => c.id);
    expect(unmappable).toEqual([]);
  });

  it("with the engine's own banks on each engine, in MultiGrainLive's groups and order", () => {
    for (const view of VIEWS) {
      const face = faceFor(view);
      const name = `${view.engine} ${JSON.stringify(view.values)}`;
      for (const bank of view.banks) {
        const group = face.groups.find((g) => g.label.toUpperCase() === bank.name.toUpperCase() && g.page === "all");
        expect(group, `${name}: ${bank.name}`).toBeDefined();
        const inside = face.controls.filter((c) => c.page === "all" && c.x >= group!.x && c.y >= group!.y
          && c.x + c.w <= group!.x + group!.w && c.y + c.h <= group!.y + group!.h);
        // Reading order: a column at a time, a stacked pair top first.
        inside.sort((a, b) => a.x - b.x || a.y - b.y);
        expect(inside.map((c) => c.param), `${name}: ${bank.name}`).toEqual(bank.controls.map((c) => c.id));
        // Extended knobs are drawn in amber.
        expect(group!.tint, `${name}: ${bank.name}`).toBe(bank.side === "extended" ? "extended" : undefined);
      }
      const labels = face.groups.filter((g) => g.page === "all").map((g) => g.label.toUpperCase());
      const banks = labels.filter((l) => !["SAMPLE", "CLOUD", "PLAY", "ENGINE", "SWITCHES"].includes(l));
      expect(banks.sort(), name).toEqual(view.banks.map((b) => b.name.toUpperCase()).sort());
      // The switch row: every switch in its own words, in fixed places.
      const row = face.controls.filter((c) => c.kind === "switch" && view.switches.some((s) => s.id === c.param) && c.page === undefined);
      expect(row.map((c) => c.param).sort(), name).toEqual(view.switches.map((s) => s.id).sort());
      for (const c of row) expect(c.label ?? parameter(c.param)?.label, name).toBe(EVERY_CONTROL.get(c.param)!.label);
    }
  });

  it("with Show: All, Standard and Extended as pages, each side on its own page", () => {
    expect(GRAIN_PAGES.map((p) => p.label)).toEqual(["All", "Standard", "Extended"]);
    for (const view of VIEWS) {
      const face = faceFor(view);
      const on = (page: string) => face.groups.filter((g) => g.page === page).map((g) => g.label.toUpperCase());
      const side = (s: Bank["side"]) => view.banks.filter((b) => b.side === s).map((b) => b.name.toUpperCase()).sort();
      expect(on("std").filter((l) => side("standard").includes(l) || side("extended").includes(l)).sort()).toEqual(side("standard"));
      expect(on("ext").filter((l) => side("standard").includes(l) || side("extended").includes(l)).sort()).toEqual(side("extended"));
    }
  });

  it("with the log laws and the Envelope detent MultiGrainLive's sliders have", () => {
    for (const view of VIEWS) {
      const face = faceFor(view);
      for (const c of face.controls.filter((x) => x.kind === "knob")) {
        const want = EVERY_CONTROL.get(c.param);
        if (!want || want.kind !== "knob") continue;
        expect(c.travel, c.param).toEqual(want.log ? { log: 1000, ...(want.round ? { round: true } : {}) } : undefined);
        expect(c.detent, c.param).toBe(want.detent);
      }
    }
  });

  it("led by the cloud pad, with its readout and the Cloud presets beside it, at one width", () => {
    for (const view of VIEWS) {
      const face = faceFor(view);
      expect(face.width).toBe(GRAIN_FACE_WIDTH);
      const pad = face.displays.find((d) => d.kind === "cloud-pad")!;
      expect(pad, view.engine).toBeDefined();
      // On the left, ahead of every bank.
      const banks = face.groups.filter((g) => g.tint !== undefined || view.banks.some((b) => b.name.toUpperCase() === g.label.toUpperCase()));
      for (const g of banks) expect(g.x).toBeGreaterThanOrEqual(pad.x + pad.w);
      expect(face.displays.some((d) => d.kind === "cloud-presets")).toBe(true);
      expect(face.displays.some((d) => d.kind === "cloud-readout")).toBe(true);
    }
  });

  it("and every face passes the panel checks, holding only what its engine uses", () => {
    for (const view of VIEWS) {
      const face = faceFor(view);
      const used = new Set(face.controls.flatMap((c) => [c.param, ...(c.also ?? [])]));
      const shown = { ...module, parameters: module.parameters.filter((p) => used.has(p.id)) };
      expect(validateLayout(face, shown), view.engine).toEqual([]);
    }
    // Across the engines, every parameter is somewhere.
    const anywhere = new Set(VIEWS.flatMap((view) => faceFor(view).controls.flatMap((c) => [c.param, ...(c.also ?? [])])));
    expect(module.parameters.map((p) => p.id).filter((id) => !anywhere.has(id))).toEqual([]);
  });

  it("with the pitch row's tuning menu and Keys in the switch row's last two places", () => {
    // Every scale of the crate, in its order, after "free": the order is the wire value.
    expect(parameter("scale")?.options).toEqual(["free", ...GRAIN_SCALES.map((s) => s.name)]);
    expect(parameter("scale")?.defaultValue).toBe("free");
    // MultiGrainLive's server holds the grid to 0–12; the menu offers 0, 1 and ½.
    expect([parameter("pitch-step")?.minimum, parameter("pitch-step")?.maximum, parameter("pitch-step")?.defaultValue]).toEqual([0, 12, 0]);
    for (const view of VIEWS) {
      const face = faceFor(view);
      const tuning = face.controls.find((c) => c.kind === "tuning")!;
      expect(tuning.param, view.engine).toBe("scale");
      expect(tuning.also).toEqual(["pitch-step"]);
      expect(tuning.page).toBeUndefined();
      // Slot 4, beside it, on every page.
      for (const page of GRAIN_PAGES) {
        const keys = face.displays.find((d) => d.kind === "keys" && d.page === page.id)!;
        expect(keys.y).toBe(tuning.y);
        expect(keys.x).toBeGreaterThan(tuning.x);
      }
      // Pitch reads and snaps to the tuning.
      const pitch = grainFace({ ...Object.fromEntries(module.parameters.map((p) => [p.id, p.defaultValue])), engine: view.engine, scale: "Major Pentatonic" })
        .controls.find((c) => c.param === "semitones" && c.page === "all")!;
      expect(pitch.snap?.(3.3)).toBe(4);
      expect(pitch.text?.(4)).toBe("+4.00 st · +400¢");
    }
  });
});
