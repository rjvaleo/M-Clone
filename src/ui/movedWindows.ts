// Where M windows were dragged to by hand, remembered per window across
// reloads. A window with no entry here stays in the M node's arrangement;
// Tidy empties the map and puts every window back.

import type { Point } from "./mLayout";

export type MovedWindows = Readonly<Record<string, Point>>;
type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export const MOVED_WINDOWS_KEY = "mclone.mnode.moved.v1";

const browserStorage = (): Storage | undefined =>
  typeof localStorage === "undefined" ? undefined : localStorage;

export function moveWindowTo(moved: MovedWindows, id: string, at: Point): MovedWindows {
  return { ...moved, [id]: { x: Math.max(0, Math.round(at.x)), y: Math.max(0, Math.round(at.y)) } };
}

export function tidyWindows(): MovedWindows {
  return {};
}

const isPoint = (value: unknown): value is Point =>
  typeof value === "object" && value !== null
  && Number.isFinite((value as Point).x) && Number.isFinite((value as Point).y);

export function loadMovedWindows(storage: Storage | undefined = browserStorage()): MovedWindows {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(MOVED_WINDOWS_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, at]) => isPoint(at)));
  } catch {
    return {};
  }
}

export function saveMovedWindows(moved: MovedWindows, storage: Storage | undefined = browserStorage()): void {
  try {
    storage?.setItem(MOVED_WINDOWS_KEY, JSON.stringify(moved));
  } catch {
    // Private mode or blocked storage: the moves last until reload.
  }
}
