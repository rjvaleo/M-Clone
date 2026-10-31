// The Grain Engine in the Cabinet style, after the Minimoog and Diva panels in
// CleanRoom (wood cheeks, black panel, cream lettering, bracketed titles, an
// amber screen), laid out as MultiGrainLive's granular tray
// (`docs/DESIGN-CRITIQUE.md`, "The granular engine"):
//
//   - the cloud pad leads, in a column of its own on the left with the engine
//     picker and its switches, the pad's readout and the Cloud presets;
//   - every group is a bank of knobs, the engine's own banks only, as
//     `reflectEngine` builds them for the engine chosen;
//   - extended banks draw in amber;
//   - switches keep their full words;
//   - Show: All / Standard / Extended are the panel's pages, and each page is
//     as tall as what it shows, as the tray's dock fits it; the width is fixed.
//
// The banks are packed as `gkPack` packs them: Time and pitch and the
// engine's own bank lead, then the other standard banks, largest first, into
// the first line with room; the extended banks start their own lines the same
// way. Each line is then spread across the width, so nothing is left empty.

import type { JsonValue } from "../../../model/graph";
import type { PanelControl, PanelDisplay, PanelGroup, PanelLayout, PanelPage } from "../layout";
import { pitchText, quantise, scaleOf } from "../../../registry/grainTuning";

export const GRAIN_FACE_WIDTH = 800;
export const GRAIN_PAGES: PanelPage[] = [{ id: "all", label: "All" }, { id: "std", label: "Standard" }, { id: "ext", label: "Extended" }];

const CHEEK = 14;
const LEFT_X = CHEEK;
const LEFT_W = 224;
const BANK_X = LEFT_X + LEFT_W;
const BANK_W = GRAIN_FACE_WIDTH - CHEEK - BANK_X;
const HEAD = 18;
const CELL_H = 64;
const BANK_H = HEAD + CELL_H + 4;
/** The tallest a knob grows on a page with room to spare. */
const CELL_MAX = 96;
const KNOB_W = 60;
const SWITCH_W = 92;
const CHOICE_W = 126;
const SEED_W = 76;
/** Pitch's reading is the longest ("+12.00 st · +1200¢"), so its column is wider. */
const PITCH_W = 124;

// ---- how each value reads: MultiGrainLive's own format functions ------------

const pct = (x: number) => `${Math.round(x * 100)}%`;
const times = (x: number) => `${x.toFixed(2)}×`;

const TEXT: Record<string, (v: number) => string> = {
  stretch: (v) => (v >= 10 ? `${v.toFixed(0)}×` : v >= 1 ? `${v.toFixed(2)}×` : `${v.toFixed(3)}×`),
  "window-ms": (v) => `${Math.round(v)} ms`,
  position: (v) => `${(v * 100).toFixed(1)}%`,
  "grain-rate": (v) => (v <= 0 ? "off" : `${Math.round(v)}/s`),
  density: (v) => (v <= 0 ? "auto" : `${Math.round(v)}/s`),
  layers: (v) => `${Math.round(v)}×`,
  overlap: (v) => `${v.toFixed(1)}×`,
  "size-jitter": pct,
  "position-jitter": (v) => `${Math.round(v)} ms`,
  "pitch-jitter": (v) => `±${v.toFixed(1)} st`,
  "pitch-drift": (v) => `±${v.toFixed(1)} st`,
  "drift-rate": (v) => `${v.toFixed(2)} Hz`,
  scan: (v) => (Math.abs(v) < 0.005 ? "frozen" : `${v.toFixed(2)}×`),
  envelope: (v) => (Math.abs(v - 0.5) < 0.005 ? "symmetric" : v < 0.5 ? "percussive" : "swelling"),
  "size-range": times,
  "layer-spread": (v) => (v <= 0.005 ? "stacked" : times(v)),
  "pan-spread": (v) => (v <= 0 ? "centred" : pct(v)),
  "layer-scatter": (v) => (v <= 0 ? "stacked" : pct(v)),
  "layer-scatter-ms": (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`),
  "cloud-mix": pct,
  detector: pct,
  "search-ms": (x) => (x <= 0 ? "plain OLA" : `${x.toFixed(1)} ms`),
  stride: (x) => `${Math.round(x)} fr`,
  floor: (x) => (x <= 0 ? "none" : times(x)),
  guard: (x) => `${x.toFixed(1)} hop`,
  "analysis-ms": (x) => `${Math.round(x)} ms`,
  freeze: (x) => (x >= 0.999 ? "held" : pct(x)),
  blur: pct,
  gate: (x) => (x <= 0 ? "off" : pct(x)),
  "freq-trust": (x) => (x <= 0.001 ? "to bins" : times(x)),
  "phase-spread": times,
  "peak-width": (x) => `${Math.round(x)} bin`,
  "lock-width": times,
  "re-anchor": (x) => `${Math.round(x)} fr`,
  "anchor-search-ms": (x) => (x <= 0 ? "no search" : `${x.toFixed(1)} ms`),
  blend: (x) => (x <= 0 ? "butt join" : pct(x)),
  tone: (x) => (x <= 0 ? "out" : times(x)),
  hits: (x) => (x <= 0 ? "out" : times(x)),
  air: (x) => (x <= 0 ? "out" : times(x)),
  hold: (x) => `${Math.round(x) | 1} fr`,
  spread: (x) => `${Math.round(x) | 1} bin`,
  margin: (x) => (x <= 1.001 ? "no air" : times(x)),
  resolution: (x) => `${Math.round(x)}`,
};

/** MultiGrainLive's logarithmic sliders: 1000 ticks, Resolution rounded by its handler. */
const LOG: Record<string, PanelControl["travel"]> = {
  stretch: { log: 1000 },
  "window-ms": { log: 1000 },
  "analysis-ms": { log: 1000 },
  "layer-scatter-ms": { log: 1000 },
  resolution: { log: 1000, round: true },
};

// ---- the banks, as `reflectEngine` and `renderGrainParams` build them --------

type Item = { param: string; kind: "knob" | "switch" | "choice" | "seed" };
type Bank = { id: string; label: string; side: "standard" | "extended"; items: Item[] };

const k = (param: string): Item => ({ param, kind: "knob" });
const s = (param: string): Item => ({ param, kind: "switch" });
const c = (param: string): Item => ({ param, kind: "choice" });

const bank = (id: string, label: string, side: Bank["side"], items: Item[]): Bank => ({ id, label, side, items });

const flag = (values: Record<string, JsonValue>, id: string) => values[id] === true;

/** Which banks the tray shows for these settings, in its order. */
export function grainBanks(values: Record<string, JsonValue>): Bank[] {
  const engine = String(values.engine ?? "Grains");
  const cloud = engine !== "Grains" && flag(values, "cloud");
  const own: Item[] = cloud ? [k("cloud-mix")] : [];
  const extended: Bank[] = [];
  const vocoder = (inPanel: boolean) => {
    own.push(k("analysis-ms"));
    if (inPanel) own.push(s("phase-lock"));
    extended.push(bank("spectrum", "Spectrum", "extended", [k("freeze"), k("blur"), k("gate")]));
    extended.push(bank("phase", "Phase", "extended", [k("freq-trust"), k("phase-spread"), k("peak-width"), k("lock-width"), s("link-stereo")]));
  };
  const wsola = (forced: boolean) => {
    const detecting = forced || flag(values, "preserve-transients");
    if (detecting) own.push(k("detector"));
    extended.push(bank("splice", "Splice", "extended", [k("search-ms"), c("splice"), c("window-shape"), k("stride")]));
    if (detecting) extended.push(bank("transients", "Transients", "extended", [k("floor"), k("guard")]));
  };
  if (engine === "Vocoder") vocoder(false);
  if (engine === "WSOLA") wsola(false);
  if (engine === "PVSOLA") {
    own.push(k("re-anchor"));
    extended.push(bank("anchor", "Anchor", "extended", [k("anchor-search-ms"), k("blend")]));
    vocoder(false);
  }
  if (engine === "Hybrid") {
    own.push(k("tone"), k("hits"), k("air"), s("remake-noise"));
    extended.push(bank("separation", "Separation", "extended", [k("hold"), k("spread"), k("margin"), k("resolution")]));
    vocoder(true);
    wsola(true);
  }
  return [
    bank("time", "Time and pitch", "standard", [k("stretch"), k("semitones"), k("window-ms")]),
    ...(own.length ? [bank("own", "This engine", "standard", own)] : []),
    bank("grain-shape", "Grain shape", "standard",
      [k("position"), k("grain-rate"), k("density"), k("layers"), k("overlap"), k("size-jitter"), k("position-jitter")]),
    bank("pitch", "Pitch movement", "standard", [k("pitch-jitter"), k("pitch-drift"), k("drift-rate")]),
    ...extended,
    bank("scan", "Scan", "extended", [k("scan"), s("reverse"), s("wrap")]),
    bank("shape", "Shape", "extended", [k("envelope"), k("size-range"), k("layer-spread"), k("pan-spread")]),
    bank("scatter", "Layer scatter", "extended", [k("layer-scatter"), k("layer-scatter-ms")]),
    bank("random", "Randomness", "extended", [s("link-jitter"), s("drift-step"), { param: "seed", kind: "seed" }]),
  ];
}

/** The switches on the row under the engine picker: two fixed places, as the tray's slots 1 and 2. */
function switchRow(values: Record<string, JsonValue>): [string | undefined, string | undefined] {
  const engine = String(values.engine ?? "Grains");
  const own = engine === "WSOLA" ? "preserve-transients" : engine === "Vocoder" || engine === "PVSOLA" ? "phase-lock" : undefined;
  return [own, engine === "Grains" ? undefined : "cloud"];
}

// ---- columns: a knob, a switch (two in a row stack), a pair of choices ------

type Column = { w: number; items: Item[] };

function columns(items: Item[]): Column[] {
  const out: Column[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const next = items[i + 1];
    if ((item.kind === "switch" || item.kind === "choice") && next?.kind === item.kind) {
      out.push({ w: item.kind === "switch" ? SWITCH_W : CHOICE_W, items: [item, next] });
      i += 1;
    } else {
      const knobW = item.param === "semitones" ? PITCH_W : KNOB_W;
      out.push({ w: item.kind === "knob" ? knobW : item.kind === "seed" ? SEED_W : item.kind === "switch" ? SWITCH_W : CHOICE_W, items: [item] });
    }
  }
  return out;
}

const natural = (b: Bank) => columns(b.items).reduce((w, col) => w + col.w, 0) + 8;

/** `gkPack`: lines of banks, the lead first, each side largest first into the first line with room. */
function pack(banks: Bank[]): Bank[][] {
  const lines: { used: number; banks: Bank[] }[] = [];
  const place = (group: Bank[], first: Bank[]) => {
    const start = lines.length;
    for (const b of first) {
      const line = lines.slice(start).find((l) => l.used + natural(b) <= BANK_W);
      if (line) { line.used += natural(b); line.banks.push(b); } else lines.push({ used: natural(b), banks: [b] });
    }
    for (const b of [...group].sort((x, y) => natural(y) - natural(x))) {
      const line = lines.slice(start).find((l) => l.used + natural(b) <= BANK_W);
      if (line) { line.used += natural(b); line.banks.push(b); } else lines.push({ used: natural(b), banks: [b] });
    }
  };
  const lead = banks.filter((b) => b.id === "time" || b.id === "own");
  place(banks.filter((b) => b.side === "standard" && !lead.includes(b)), lead);
  place(banks.filter((b) => b.side === "extended"), []);
  return lines.map((l) => l.banks);
}

/** One page's banks, placed: its groups and controls, and the height it takes. */
function placeBanks(banks: Bank[], page: string, alias: boolean, height: (h: number) => number, values: Record<string, JsonValue>) {
  // Pitch reads and snaps to the tuning chosen, as MultiGrainLive's server snaps it.
  const scale = scaleOf(values.scale);
  const step = typeof values["pitch-step"] === "number" ? values["pitch-step"] : 0;
  const pitch: Partial<PanelControl> = { text: (v) => pitchText(v, scale, step), snap: (v) => quantise(v, scale, step) };
  const groups: PanelGroup[] = [];
  const controls: PanelControl[] = [];
  const lines = pack(banks);
  const total = height(lines.length * BANK_H);
  // A page whose banks are shorter than the cloud column shares the height
  // out among its lines, and their knobs grow, up to a limit, in the middle.
  const rowH = Math.floor(total / lines.length);
  const cellH = Math.min(rowH - HEAD - 4, CELL_MAX);
  const drop = Math.floor((rowH - HEAD - 4 - cellH) / 2);
  lines.forEach((line, row) => {
    const y = row * rowH;
    // The last line reaches the foot of the page, so nothing under it is bare.
    const h = row === lines.length - 1 ? total - y : rowH;
    const spare = BANK_W - line.reduce((w, b) => w + natural(b), 0);
    let x = BANK_X;
    line.forEach((b, i) => {
      // The line's spare width shared out, the last bank taking the rounding.
      const w = i === line.length - 1 ? BANK_X + BANK_W - x : natural(b) + Math.floor(spare / line.length);
      groups.push({ id: `${b.id}-${page}`, label: b.label, x, y, w, h, page, ...(b.side === "extended" ? { tint: "extended" } : {}) });
      const cols = columns(b.items);
      const gap = (w - 8 - cols.reduce((sum, col) => sum + col.w, 0)) / cols.length;
      let cx = x + 4 + gap / 2;
      for (const col of cols) {
        const left = Math.round(cx);
        col.items.forEach((item, n) => {
          const half = col.items.length === 2;
          const top = y + HEAD + drop + (half ? n * (cellH / 2) : 0);
          const base = { param: item.param, page, ...(alias ? { alias: true } : {}) };
          if (item.kind === "knob") {
            controls.push({ ...base, kind: "knob", x: left, y: top, w: col.w, h: cellH,
              ...(TEXT[item.param] ? { text: TEXT[item.param] } : {}),
              ...(item.param === "semitones" ? pitch : {}),
              ...(LOG[item.param] ? { travel: LOG[item.param] } : {}),
              ...(item.param === "envelope" ? { detent: 0.5 } : {}) });
          } else if (item.kind === "seed") {
            controls.push({ ...base, kind: "reroll", x: left, y: top, w: col.w, h: cellH });
          } else if (item.kind === "switch") {
            controls.push({ ...base, kind: "switch", x: left, y: top + (half ? 2 : (cellH - 30) / 2), w: col.w, h: half ? 28 : 30 });
          } else {
            controls.push({ ...base, kind: "select", caption: true, x: left, y: top + (half ? 2 : (cellH - 30) / 2), w: col.w, h: half ? 28 : 30 });
          }
        });
        cx += col.w + gap;
      }
      x += w;
    });
  });
  return { groups, controls, height: total };
}

// ---- the cloud column -----------------------------------------------------------

/** The column's height above and below the pad, which takes what the page leaves. */
const COLUMN_FIXED = 326;
const PAD_MIN = 132;
const COLUMN_H = COLUMN_FIXED + PAD_MIN;

function cloudColumn(page: string, height: number) {
  const x = LEFT_X;
  const padH = height - COLUMN_FIXED;
  const groups: PanelGroup[] = [
    { id: `sample-${page}`, label: "Sample", x, y: 0, w: LEFT_W, h: 72, page },
    { id: `engine-${page}`, label: "Engine", x, y: 72, w: LEFT_W, h: 108, page },
    { id: `cloud-${page}`, label: "Cloud", x, y: 180, w: LEFT_W, h: 86 + padH, page },
    { id: `play-${page}`, label: "Play", x, y: 266 + padH, w: LEFT_W, h: height - 266 - padH, page },
  ];
  const displays: PanelDisplay[] = [
    // Slot 4: Keys, which opens a window rather than setting a value.
    { kind: "keys", x: x + 114, y: 150, w: 104, h: 26, page },
    { kind: "cloud-pad", x: x + 6, y: 198, w: LEFT_W - 12, h: padH, page },
    { kind: "cloud-readout", x: x + 6, y: 200 + padH, w: LEFT_W - 12, h: 14, page },
    { kind: "cloud-presets", x: x + 6, y: 216 + padH, w: LEFT_W - 12, h: 22, page },
    { kind: "page-nav", x: x + 6, y: 240 + padH, w: LEFT_W - 12, h: 22, page },
  ];
  // Play sits under the pad, which grows with the page, so it is placed on
  // each page; the rest of the column is where it is on every page.
  const own = page === "all" ? {} : { alias: true };
  const play: PanelControl[] = [
    { param: "root", kind: "readout", label: "Root", x: x + 6, y: 286 + padH, w: 94, h: 34, page, ...own },
    { param: "free-run", kind: "switch", label: "Free run", x: x + 104, y: 286 + padH, w: 64, h: 34, page, ...own },
    { param: "mute", kind: "switch", label: "Mute", x: x + 172, y: 286 + padH, w: 46, h: 34, page, ...own },
  ];
  return { groups, displays, play };
}

/**
 * The top of the column: the sample, the engine picker and its row of four
 * fixed places, as the tray's — 1 the engine's own switch, 2 the grain cloud,
 * 3 the tuning, 4 Keys. An engine with nothing for a place leaves it empty, so
 * nothing moves when the engine changes.
 */
function columnHead(values: Record<string, JsonValue>): PanelControl[] {
  const x = LEFT_X;
  const [slot1, slot2] = switchRow(values);
  return [
    { param: "asset-id", kind: "asset", label: "Sample", x: x + 6, y: 24, w: 152, h: 26 },
    { param: "level", kind: "knob", label: "Level", x: x + 164, y: 18, w: 54, h: 52 },
    { param: "engine", kind: "select", label: "Engine", x: x + 6, y: 92, w: LEFT_W - 12, h: 24 },
    ...(slot1 ? [{ param: slot1, kind: "switch" as const, x: x + 6, y: 120, w: 104, h: 26 }] : []),
    ...(slot2 ? [{ param: slot2, kind: "switch" as const, x: x + 114, y: 120, w: 104, h: 26 }] : []),
    { param: "scale", kind: "tuning", also: ["pitch-step"], label: "Tuning", x: x + 6, y: 150, w: 104, h: 26 },
  ];
}

/** The panel for these settings: the engine's banks on three pages, the cloud column on each. */
export function grainFace(values: Record<string, JsonValue>): PanelLayout {
  const banks = grainBanks(values);
  const sides: Record<string, Bank[]> = {
    all: banks,
    std: banks.filter((b) => b.side === "standard"),
    ext: banks.filter((b) => b.side === "extended"),
  };
  const groups: PanelGroup[] = [];
  const controls: PanelControl[] = columnHead(values);
  const displays: PanelDisplay[] = [];
  const pages: PanelPage[] = [];
  for (const page of GRAIN_PAGES) {
    const placed = placeBanks(sides[page.id], page.id, page.id !== "all", (h) => Math.max(h, COLUMN_H), values);
    const column = cloudColumn(page.id, placed.height);
    groups.push(...column.groups, ...placed.groups);
    controls.push(...placed.controls, ...column.play);
    displays.push(...column.displays,
      { kind: "cheek", x: 0, y: 0, w: CHEEK, h: placed.height, page: page.id },
      { kind: "cheek", x: GRAIN_FACE_WIDTH - CHEEK, y: 0, w: CHEEK, h: placed.height, page: page.id });
    pages.push({ ...page, height: placed.height });
  }
  return {
    moduleType: "m.grain-engine",
    style: "cabinet",
    width: GRAIN_FACE_WIDTH,
    height: pages[0].height ?? COLUMN_H,
    groups,
    controls,
    displays,
    pages,
  };
}
