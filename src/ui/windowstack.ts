const MAIN_WINDOW_IDS = [
  "patterns", "conducting", "variables", "cyclic-variables", "midi", "snapshot",
] as const;

export type MainWindowId = (typeof MAIN_WINDOW_IDS)[number];

export function windowBackShortcut(event: {
  key: string;
  metaKey: boolean;
  altKey: boolean;
}): MainWindowId | null {
  if (!event.metaKey || !event.altKey) return null;
  const index = Number(event.key) - 1;
  return Number.isInteger(index) ? MAIN_WINDOW_IDS[index] ?? null : null;
}

export function draggableIdForMainWindow(id: MainWindowId): string {
  if (id === "conducting") return "untitled";
  if (id === "cyclic-variables") return "cyclic";
  return id;
}
