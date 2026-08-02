export type InputControlCode =
  | "snapshot" | "time-base-1" | "time-base-2" | "time-base-3" | "time-base-4"
  | "pattern-group" | "ordering" | "sound-choice" | "orchestration" | "transposition"
  | "velocity-range" | "density" | "duration" | "accent" | "legato"
  | "play-slideshow" | "record-slideshow";

export type InputControlAction =
  | { type: "start" | "stop" | "sync" | "hold-do" | "stop-slideshow" | "tap-tempo"
      | "tap-conduct" | "freeze-tempo" | "accelerando" | "decelerando" | "edit-snapshot" }
  | { type: "toggle-voice" | "clear-pattern" | "step-voice"; voice: number }
  | { type: "step-all" };

const WHITE_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);

export function whiteKeyValue(note: number): number | null {
  if (!WHITE_PITCH_CLASSES.has(((note % 12) + 12) % 12) || note < 36) return null;
  let value = 0;
  for (let pitch = 36; pitch < note; pitch++) {
    if (WHITE_PITCH_CLASSES.has(pitch % 12)) value++;
  }
  return value;
}

const CODES: Record<number, InputControlCode> = {
  37: "snapshot", 39: "time-base-1", 42: "time-base-2", 44: "time-base-3",
  46: "time-base-4", 49: "pattern-group", 51: "ordering", 54: "sound-choice",
  56: "orchestration", 58: "transposition", 61: "velocity-range", 63: "density",
  66: "duration", 68: "accent", 70: "legato", 73: "snapshot",
  75: "play-slideshow", 78: "record-slideshow",
};

export function inputControlCode(note: number): InputControlCode | null {
  return CODES[note] ?? null;
}

const VOICE_FOR_STEP: Record<number, number> = {
  50: 0, 52: 0, 55: 1, 57: 1, 67: 2, 69: 2, 74: 3, 76: 3,
};

export function decodeInputControl(note: number): InputControlAction | null {
  if ([36, 38, 40, 41].includes(note)) return { type: "toggle-voice", voice: [36, 38, 40, 41].indexOf(note) };
  if ([43, 45, 47, 48].includes(note)) return { type: "clear-pattern", voice: [43, 45, 47, 48].indexOf(note) };
  if (note in VOICE_FOR_STEP) return { type: "step-voice", voice: VOICE_FOR_STEP[note] };
  if (note === 62 || note === 64) return { type: "step-all" };
  const named: Record<number, InputControlAction["type"]> = {
    53: "tap-tempo", 59: "stop", 60: "start", 65: "sync", 71: "hold-do",
    77: "stop-slideshow", 79: "decelerando", 80: "edit-snapshot", 81: "freeze-tempo",
    83: "accelerando", 84: "tap-conduct",
  };
  return named[note] ? { type: named[note] } as InputControlAction : null;
}
