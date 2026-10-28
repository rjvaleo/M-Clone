/**
 * Each M module's preset manager: up to 99 named snapshots of the whole
 * module. The first six are the slots a–f on its face; reorder the list to
 * choose which six those are. Clicking a slot recalls it, and M Variables'
 * Pattern Group switches a NoteSeq's slot, so M's six positions are six
 * chosen snapshots.
 */

import type { JsonValue } from "../model/graph";

export const MAX_PRESETS = 99;
export const PRESET_SLOTS = 6;

export type Preset = { name: string; values: Record<string, JsonValue> };
export type PresetList = (Preset | null)[];

/** What a snapshot leaves out: the header, the view, and the presets themselves. */
export const NOT_IN_PRESETS: ReadonlySet<string> = new Set([
  "comment", "collapsed", "advanced", "presets", "preset-slot", "scroll", "pitch-view",
  // The Drum Sequencer's view: which lane is shown under the grid, for which row.
  "edit-lane", "edit-row",
]);

export function snapshotOf(params: Readonly<Record<string, JsonValue>>): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(params)
    .filter(([id]) => !NOT_IN_PRESETS.has(id))
    .map(([id, value]) => [id, structuredClone(value)]));
}

const padded = (presets: PresetList, length: number): PresetList =>
  Array.from({ length: Math.max(length, presets.length) }, (_, i) => presets[i] ?? null);

/** Drop trailing empty places so a list never grows past what it holds. */
const trimmed = (presets: PresetList): PresetList => {
  let end = presets.length;
  while (end > 0 && !presets[end - 1]) end--;
  return presets.slice(0, end);
};

export function storePreset(presets: PresetList, index: number, name: string, values: Record<string, JsonValue>): PresetList {
  if (index < 0 || index >= MAX_PRESETS) return presets;
  const next = padded(presets, index + 1);
  next[index] = { name, values: structuredClone(values) };
  return next;
}

export function renamePreset(presets: PresetList, index: number, name: string): PresetList {
  const preset = presets[index];
  if (!preset) return presets;
  const next = [...presets];
  next[index] = { ...preset, name };
  return next;
}

export function deletePreset(presets: PresetList, index: number): PresetList {
  if (!presets[index]) return presets;
  const next = [...presets];
  next[index] = null;
  return next;
}

/** Take the preset at `from` out and put it in at `to`; everything between moves along one place. */
export function movePreset(presets: PresetList, from: number, to: number): PresetList {
  if (from === to || from < 0 || to < 0 || from >= MAX_PRESETS || to >= MAX_PRESETS) return presets;
  const next = padded(presets, Math.max(from, to) + 1);
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return trimmed(next.slice(0, MAX_PRESETS));
}

/** The lowest number with nothing stored, or -1 when all 99 are used. */
export function firstFree(presets: PresetList): number {
  for (let i = 0; i < MAX_PRESETS; i++) if (!presets[i]) return i;
  return -1;
}

/** What slot a–f (0–5) recalls: the preset in that place, or null. */
export function recallSlot(presets: PresetList, slot: number): Record<string, JsonValue> | null {
  if (slot < 0 || slot >= PRESET_SLOTS) return null;
  const preset = presets[slot];
  return preset ? structuredClone(preset.values) : null;
}
