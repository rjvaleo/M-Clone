// The Grain Engine's cloud pad and Cloud presets, as MultiGrainLive has them
// (`ui/app.js`: `cloudPadGeometry`, `wireCloudPad`, `grainSnapshot`,
// `applyGrain`; `docs/SECTION-PRESETS.md`, "A cloud").
//
// The pad is the source across, start to end, and pitch offset up and down.
// The box is the read head: where it sits, how far grains are thrown from it,
// and how far their pitch scatters. Dragging inside the box moves the head;
// dragging outside it spreads it, in time and in pitch.

import type { JsonValue } from "../../model/graph";

/** The least the pad's pitch axis spans either way, in semitones (`CLOUD_PITCH_FLOOR`). */
export const CLOUD_PITCH_FLOOR = 4;

const num = (value: JsonValue | undefined, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

export type CloudGeometry = {
  w: number;
  h: number;
  /** The head, as a share of the file across. */
  head: number;
  /** Where the sweep begins: the start going forwards, the end going backwards. */
  home: number;
  /** How far the sweep has carried the head, as a share of the file. */
  sweep: number;
  /** The pitch axis's reach either way, in semitones. */
  semis: number;
  halfW: number;
  halfH: number;
};

/**
 * Where the box is. `played` is how far through the file the engine is
 * reading, as a share of it (the module's report); the sweep is that times
 * Scan, as `sourceFrameNow() * scan` is. `seconds` is the file's length.
 */
export function cloudGeometry(values: Record<string, JsonValue>, seconds: number, w: number, h: number, played = 0): CloudGeometry {
  const scan = num(values.scan, 1);
  const position = num(values.position, 0);
  const spray = num(values["position-jitter"], 0);
  const jitter = num(values["pitch-jitter"], 0);
  const drift = num(values["pitch-drift"], 0);
  const home = scan < 0 ? 1 : 0;
  const sweep = (Number.isFinite(played) ? played : 0) * scan;
  // A quarter more than the scatter reaches, so the box sits inside the plot.
  const semis = Math.max(CLOUD_PITCH_FLOOR, (jitter + drift) * 1.25);
  return {
    w, h, home, sweep, semis,
    head: home + position + sweep,
    halfW: seconds > 0 ? ((spray / 1000) / seconds) * w : 0,
    halfH: (jitter / semis) * (h / 2 - 8),
  };
}

/** Whether a press at (px, py) takes hold of the box rather than the air around it. */
export function insideBox(geo: CloudGeometry, px: number, py: number): boolean {
  const bx = geo.head * geo.w;
  return Math.abs(px - bx) <= Math.max(geo.halfW, 5) && Math.abs(py - geo.h / 2) <= Math.max(geo.halfH, 5);
}

/** The head moved to the pointer: `event_at` solved backwards for Position. */
export function moveTo(geo: CloudGeometry, px: number): { position: number } {
  return { position: Math.max(-1, Math.min(1, px / geo.w - geo.home - geo.sweep)) };
}

/** The head spread to the pointer: Position jitter across, Pitch jitter up and down. */
export function spreadTo(geo: CloudGeometry, px: number, py: number, seconds: number): { "position-jitter": number; "pitch-jitter": number } {
  const spray = (Math.abs(px - geo.head * geo.w) / geo.w) * seconds * 1000;
  const semis = (Math.abs(py - geo.h / 2) / (geo.h / 2 - 8)) * geo.semis;
  return {
    "position-jitter": Math.max(0, Math.min(500, spray)),
    "pitch-jitter": Math.max(0, Math.min(24, semis)),
  };
}

// ---- Cloud presets ---------------------------------------------------------------

/**
 * The grain section and nothing else: `GRAIN_DEFAULTS`'s keys, in idMLab's
 * names. Not the seed (it stays with the patch) and not the window (it is the
 * engine's, in Time and pitch).
 */
export const CLOUD_KEYS: readonly string[] = [
  "grain-rate", "density", "overlap", "size-jitter", "position-jitter", "pitch-jitter", "pitch-drift", "drift-rate",
  "layers", "scan", "reverse", "envelope", "size-range", "wrap", "layer-spread", "link-jitter", "drift-step",
  "pan-spread", "position", "layer-scatter", "layer-scatter-ms",
];

type Store = Pick<Storage, "getItem" | "setItem">;
type Clouds = Record<string, Record<string, JsonValue>>;

const KEY = "idmlab.grain-clouds";

function read(store: Store): Clouds {
  try {
    const parsed = JSON.parse(store.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Clouds : {};
  } catch {
    return {};
  }
}

/** Every saved cloud's name, in the order they were saved. */
export const listClouds = (store: Store): string[] => Object.keys(read(store));

/** The grain section of these values. */
export function cloudSnapshot(values: Record<string, JsonValue>): Record<string, JsonValue> {
  return Object.fromEntries(CLOUD_KEYS.filter((key) => values[key] !== undefined).map((key) => [key, values[key]]));
}

/** Keep a cloud under a name; the name it was kept under, or null for no name. */
export function saveCloud(store: Store, name: string, values: Record<string, JsonValue>): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const clouds = read(store);
  clouds[trimmed] = cloudSnapshot(values);
  try { store.setItem(KEY, JSON.stringify(clouds)); } catch { return null; }
  return trimmed;
}

export function deleteCloud(store: Store, name: string): void {
  const clouds = read(store);
  delete clouds[name];
  try { store.setItem(KEY, JSON.stringify(clouds)); } catch { /* private mode */ }
}

/**
 * A cloud put back over the defaults: every grain control the cloud names, of
 * the right kind, and every other one at its default. Nothing else is touched.
 */
export function recallCloud(store: Store, name: string, defaults: Record<string, JsonValue>): Record<string, JsonValue> | null {
  const cloud = read(store)[name];
  if (!cloud || typeof cloud !== "object") return null;
  return Object.fromEntries(CLOUD_KEYS.map((key) =>
    [key, typeof cloud[key] === typeof defaults[key] ? cloud[key] : defaults[key]]));
}
