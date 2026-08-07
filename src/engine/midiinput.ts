import type { InsertMode, StepEvent } from "./types";

export type MidiInputUse =
  | "disabled"
  | "record"
  | "control"
  | "keyboard-transpose"
  | "echo-map";

export type MidiInputVoice = {
  sourceChannel: "all" | number;
  use: MidiInputUse;
  echo: boolean;
};

export type DecodedMidiMessage =
  | { type: "note-on" | "note-off"; channel: number; note: number; velocity: number }
  | { type: "control"; channel: number; controller: number; value: number }
  // System messages, which carry no channel. These are how an external clock
  // source drives the transport; see `clockinput.ts`.
  | { type: "clock" | "start" | "continue" | "stop" }
  | { type: "song-position"; sixteenths: number };

/** The messages that carry a channel, and so can be routed to a Voice. */
export type ChannelMidiMessage = Extract<DecodedMidiMessage, { channel: number }>;

/**
 * Split channel messages from system ones.
 *
 * A guard rather than an inline check: the system member of the union groups
 * four literals under one `type`, which narrowing by comparison does not
 * reliably eliminate, and every caller needs the same split.
 */
export function isChannelMessage(
  message: DecodedMidiMessage,
): message is ChannelMidiMessage {
  return message.type === "note-on" || message.type === "note-off"
    || message.type === "control";
}

export function decodeMidiMessage(data: ArrayLike<number>): DecodedMidiMessage | null {
  if (data.length < 1) return null;

  // System messages are checked before the length guard below: realtime
  // status bytes stand alone, so requiring three bytes would drop every one.
  switch (data[0]) {
    case 0xf8: return { type: "clock" };
    case 0xfa: return { type: "start" };
    case 0xfb: return { type: "continue" };
    case 0xfc: return { type: "stop" };
    case 0xf2:
      if (data.length < 3) return null;
      // 14 bits across two seven-bit halves, least significant first.
      return {
        type: "song-position",
        sixteenths: (data[1] & 0x7f) | ((data[2] & 0x7f) << 7),
      };
  }
  // Anything else in the system range — Active Sensing, Reset, MTC — is not
  // something this app acts on, and must not fall through to be read as a
  // channel message.
  if (data[0] >= 0xf0) return null;

  if (data.length < 3) return null;
  const status = data[0] & 0xf0;
  const channel = (data[0] & 0x0f) + 1;
  if (status === 0x90 || status === 0x80) {
    const velocity = data[2] & 0x7f;
    return {
      type: status === 0x90 && velocity > 0 ? "note-on" : "note-off",
      channel,
      note: data[1] & 0x7f,
      velocity,
    };
  }
  if (status === 0xb0) return {
    type: "control", channel, controller: data[1] & 0x7f, value: data[2] & 0x7f,
  };
  return null;
}

export function routeMidiNote(voices: readonly MidiInputVoice[], channel: number): number[] {
  return voices.flatMap((voice, index) =>
    voice.use !== "disabled"
      && (voice.sourceChannel === "all" || voice.sourceChannel === channel)
      ? [index] : []);
}

export function mapAssignedInputChannel(
  assignments: readonly { deviceId: string | null; channel: number }[],
  deviceId: string | null,
  physicalChannel: number,
): number | null {
  const configured = assignments.some((entry) => entry.deviceId !== null);
  if (!configured) return physicalChannel;
  const index = assignments.findIndex((entry) =>
    entry.deviceId === deviceId && entry.channel === physicalChannel);
  return index < 0 ? null : index + 1;
}

export function applyRecordedNotes(
  source: readonly StepEvent[],
  notes: readonly number[],
  counter: number,
  mode: InsertMode,
  maxSize: number,
): StepEvent[] {
  const at = Math.max(0, Math.min(Math.trunc(counter), source.length));
  const pitches = [...new Set(notes.map((note) => Math.max(0, Math.min(127, Math.round(note)))))]
    .sort((a, b) => a - b);
  const steps = source.map((step) => ({ pitches: [...step.pitches] }));
  if (mode === "insert") {
    if (steps.length < maxSize) steps.splice(at, 0, { pitches });
  } else if (mode === "replace") {
    if (at < maxSize) steps[at] = { pitches };
  } else if (at < maxSize) {
    const previous = steps[at]?.pitches ?? [];
    steps[at] = { pitches: [...new Set([...previous, ...pitches])].sort((a, b) => a - b) };
  }
  return steps.slice(0, maxSize);
}
