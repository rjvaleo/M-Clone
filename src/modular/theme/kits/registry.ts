/**
 * The kit registry: `KitId` to its complete face.
 *
 * Kept as a plain object rather than a lazy/dynamic lookup so
 * `everyKitImplementsEveryControl` below can walk it exhaustively at test
 * time — a kit that forgot to export `stepper` fails the build here instead
 * of failing silently the first time a face tries to render one.
 */

import { KIT_IDS, type KitFace, type KitId } from "./types";
import { vintageFace } from "./faces/vintage";
import { eurorackFace } from "./faces/eurorack";
import { thinRingFace } from "./faces/thinRing";
import { flatModernFace } from "./faces/flatModern";
import { lineArtFace } from "./faces/lineArt";
import { lcdFace } from "./faces/lcd";

export const KIT_FACES: Readonly<Record<KitId, KitFace>> = {
  vintage: vintageFace,
  eurorack: eurorackFace,
  thinRing: thinRingFace,
  flatModern: flatModernFace,
  lineArt: lineArtFace,
  lcd: lcdFace,
};

export function faceFor(kit: KitId): KitFace {
  return KIT_FACES[kit];
}

/** The fourteen controls every kit's face is required to implement — the
 * vocabulary settled in `reference/panels/CATALOG.md`'s closing section. */
export const CONTROL_NAMES = [
  "knob",
  "slider",
  "fader",
  "toggle",
  "button",
  "pad",
  "selector",
  "stepper",
  "jack",
  "led",
  "meter",
  "display",
  "envelope",
  "waveform",
] as const;

/**
 * True only if every registered kit implements every control as an actual
 * function. The completeness this checks is exactly the property
 * `KIT_IDS`/`KIT_FACES` could silently lose one of: someone adds a seventh
 * kit id, forgets to add its face here, and `faceFor` would return
 * `undefined` the first time a node tried to render — at runtime, in the
 * one place nothing else would catch it.
 */
export function everyKitImplementsEveryControl(): boolean {
  return KIT_IDS.every((id) => {
    const face = KIT_FACES[id];
    /* v8 ignore next */
    if (!face) return false;
    return CONTROL_NAMES.every((name) => typeof face[name] === "function");
  });
}
