/**
 * M Variables: every variable's six positions, which one each is on, the
 * conducting arrows, the marks, and snapshots of positions.
 *
 * Positions are written into the other M modules as parameters rather than
 * sent down cables — `resolveTargets` says what each module should now hold.
 * The tables start from M's own shipped presets (makePresetPositions), so a
 * fresh canvas M opens on the same positions a fresh M does.
 */

import type { JsonValue } from "../model/graph";
import { makePresetPositions } from "../../engine/variables";
import { positionFromBaton, type BatonPoint } from "../../engine/conductor";
import type { ArrowDir, ArrowState } from "../../engine/snapshot";
import type { NoteOrderMix, VelocityRange } from "../../engine/types";
import { MAX_VOICES, POSITIONS } from "./model";
import { recallSlot, type PresetList } from "./presets";

export const M_VARIABLES = [
  "patternGroup", "density", "velocityRange", "noteOrder", "transposition", "timeDistortion",
  "accent", "legato", "rhythm", "orchestration", "soundChoice",
] as const;
export type MVariable = (typeof M_VARIABLES)[number];

/** Per-voice values at each position, for the variables M Variables holds itself. */
export type VariableTables = {
  density: number[][];
  velocityRange: VelocityRange[][];
  noteOrder: NoteOrderMix[][];
  transposition: number[][];
};

export type VariablesState = {
  tables: VariableTables;
  active: Record<MVariable, number>;
  arrows: Record<MVariable, ArrowState>;
  marks: Record<MVariable, boolean[]>;
  snapshots: (Record<MVariable, number> | null)[];
};

export const SNAPSHOT_SLOTS = 26;

const byVariable = <T>(make: (variable: MVariable) => T): Record<MVariable, T> =>
  Object.fromEntries(M_VARIABLES.map((variable) => [variable, make(variable)])) as Record<MVariable, T>;

/** M's four-voice preset rows, widened to eight voices by repeating them. */
const widen = <T>(rows: T[][]): T[][] =>
  rows.map((row) => Array.from({ length: MAX_VOICES }, (_, v) => structuredClone(row[v % row.length])));

export function defaultVariables(): VariablesState {
  const m = makePresetPositions();
  const active = byVariable(() => 0);
  active.density = m.density.active;
  active.velocityRange = m.velocityRange.active;
  active.noteOrder = m.noteOrderMix.active;
  active.transposition = m.transposition.active;
  active.timeDistortion = m.timeDistort.active;
  active.orchestration = m.outputChannels.active;
  return {
    tables: {
      density: widen(m.density.slots as number[][]),
      velocityRange: widen(m.velocityRange.slots as VelocityRange[][]),
      noteOrder: widen(m.noteOrderMix.slots as NoteOrderMix[][]),
      transposition: widen(m.transposition.slots as number[][]),
    },
    active,
    arrows: byVariable(() => ({ on: false, dir: "right" as ArrowDir })),
    marks: byVariable(() => Array.from({ length: POSITIONS }, () => false)),
    snapshots: Array.from({ length: SNAPSHOT_SLOTS }, () => null),
  };
}

const clampPosition = (position: number) => Math.max(0, Math.min(POSITIONS - 1, Math.round(position)));

export function activate(state: VariablesState, variable: MVariable, position: number): VariablesState {
  return { ...state, active: { ...state.active, [variable]: clampPosition(position) } };
}

/** Arm a variable's conducting arrow along an axis, or disarm it if it already points there. */
export function toggleArrow(state: VariablesState, variable: MVariable, dir: ArrowDir): VariablesState {
  const current = state.arrows[variable];
  const next: ArrowState = current.on && current.dir === dir ? { on: false, dir } : { on: true, dir };
  return { ...state, arrows: { ...state.arrows, [variable]: next } };
}

/** The baton moved: every armed variable takes the position under it on its axis. */
export function conduct(state: VariablesState, baton: BatonPoint): VariablesState {
  const active = { ...state.active };
  for (const variable of M_VARIABLES) {
    const arrow = state.arrows[variable];
    if (arrow.on) active[variable] = positionFromBaton(baton, arrow.dir);
  }
  return { ...state, active };
}

export function storeSnapshot(state: VariablesState, slot: number): VariablesState {
  if (slot < 0 || slot >= SNAPSHOT_SLOTS) return state;
  const snapshots = [...state.snapshots];
  snapshots[slot] = { ...state.active };
  return { ...state, snapshots };
}

export function recallSnapshot(state: VariablesState, slot: number): VariablesState {
  const snapshot = state.snapshots[slot];
  return snapshot ? { ...state, active: { ...snapshot } } : state;
}

export function setTableValue<K extends keyof VariableTables>(
  state: VariablesState,
  variable: K,
  position: number,
  voice: number,
  value: VariableTables[K][number][number],
): VariablesState {
  const table = state.tables[variable].map((row) => [...row]) as VariableTables[K];
  (table[clampPosition(position)] as unknown[])[voice] = value;
  return { ...state, tables: { ...state.tables, [variable]: table } };
}

/** An M module M Variables writes into, with what it holds now. */
export type MTarget = {
  kind: "noteSeq" | "timeWarp" | "orchestra";
  nodeId: string;
  parameters: Record<string, JsonValue>;
};
export type MUpdate = { nodeId: string; values: Record<string, JsonValue> };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What each M module should hold for the current positions, given what it
 * holds now. A NoteSeq takes its own voice's column of every table, found by
 * its Voice number. Only changed parameters are returned.
 */
export function resolveTargets(state: VariablesState, targets: readonly MTarget[]): MUpdate[] {
  const { tables, active } = state;
  const updates: MUpdate[] = [];
  for (const target of targets) {
    let wanted: Record<string, JsonValue>;
    if (target.kind === "noteSeq") {
      const voice = Math.max(0, Math.min(MAX_VOICES - 1, Math.round(Number(target.parameters.voice ?? 1)) - 1));
      const range = tables.velocityRange[active.velocityRange][voice];
      // The Pattern Group position picks the NoteSeq's preset slot a–f — its
      // first six presets. A slot with a preset recalls it, once, as the slot
      // changes; an empty slot is M's own pattern group.
      const presets = (target.parameters.presets as unknown as PresetList | undefined) ?? [];
      const onSlot = Boolean(presets[active.patternGroup]);
      const recalled = onSlot && Number(target.parameters["preset-slot"] ?? -1) !== active.patternGroup
        ? recallSlot(presets, active.patternGroup)
        : null;
      const pattern: Record<string, JsonValue> = onSlot
        ? { ...(recalled ?? {}), "preset-slot": active.patternGroup }
        : { group: active.patternGroup };
      wanted = {
        ...pattern,
        density: tables.density[active.density][voice],
        "vel-low": range.low,
        "vel-high": range.high,
        "note-order": tables.noteOrder[active.noteOrder][voice] as unknown as JsonValue,
        transposition: tables.transposition[active.transposition][voice],
        "cycle-positions": { accent: active.accent, legato: active.legato, rhythm: active.rhythm },
        "warp-position": active.timeDistortion,
      };
    } else if (target.kind === "timeWarp") {
      wanted = { position: active.timeDistortion };
    } else {
      wanted = { position: active.orchestration, "sound-position": active.soundChoice };
    }
    const changed = Object.entries(wanted).filter(([id, value]) => !same(target.parameters[id], value));
    if (changed.length) updates.push({ nodeId: target.nodeId, values: Object.fromEntries(changed) });
  }
  return updates;
}
