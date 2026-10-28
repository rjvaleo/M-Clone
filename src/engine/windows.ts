export const APP_MENU_LABELS = ["File", "Edit", "Variables", "Pattern", "Windows", "Options"] as const;

export const APP_WINDOWS = [
  { id: "patterns", label: "Patterns", permanent: true },
  { id: "conducting", label: "Conducting", permanent: true },
  { id: "variables", label: "Variables", permanent: true },
  { id: "cyclic-variables", label: "Cyclic Variables", permanent: true },
  { id: "midi", label: "Midi", permanent: false },
  { id: "snapshot", label: "Snapshot", permanent: true },
  { id: "pattern-editor", label: "Pattern Editor", permanent: false },
  { id: "cyclic-editor", label: "Cyclic Editor", permanent: false },
  { id: "midi-view", label: "Midi View", permanent: false },
  { id: "midi-assignment", label: "Midi Assignment", permanent: false },
  { id: "synth", label: "Synth", permanent: false },
  { id: "density", label: "Note Density Editor", permanent: false },
  { id: "velocityRange", label: "Velocity Range Editor", permanent: false },
  { id: "noteOrderMix", label: "Note Order Editor", permanent: false },
  { id: "transposition", label: "Transposition Editor", permanent: false },
  { id: "timeDistort", label: "Time Distortion Editor", permanent: false },
  { id: "outputChannels", label: "Orchestration Editor", permanent: false },
] as const;

export type AppWindowId = (typeof APP_WINDOWS)[number]["id"];

/** Windows the M node opens on demand rather than at the start. */
const STARTS_CLOSED: readonly AppWindowId[] = ["midi-view", "midi-assignment", "transposition", "timeDistort"];

/**
 * The M node shows every window at once, which the original's small screen
 * could not; only the ones mostly left closed start that way.
 */
export function initialAppWindows(): Set<string> {
  return new Set(APP_WINDOWS.map((window) => window.id).filter((id) => !STARTS_CLOSED.includes(id)));
}

export function openAppWindow(current: ReadonlySet<string>, id: AppWindowId): Set<string> {
  return new Set([...current, id]);
}

export function closeAppWindow(current: ReadonlySet<string>, id: AppWindowId): Set<string> {
  if (APP_WINDOWS.find((window) => window.id === id)?.permanent) return new Set(current);
  const next = new Set(current);
  next.delete(id);
  return next;
}
