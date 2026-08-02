export type VoiceColorSurface =
  | "density"
  | "velocity-range"
  | "note-order"
  | "transposition"
  | "cyclic";

/**
 * Shared hook for editor lanes that inherit one of the four sequencer-stream
 * colors. Keeping this composition in one place prevents one editor from
 * silently losing its stream identity when its layout is refactored.
 */
export function voiceColorClass(surface: VoiceColorSurface, voiceIndex: number): string {
  if (!Number.isInteger(voiceIndex) || voiceIndex < 0 || voiceIndex > 3) {
    throw new RangeError(`Voice index must be between 0 and 3; received ${voiceIndex}`);
  }

  return `uvoice uvoice--${voiceIndex + 1} voice-colorized voice-colorized--${surface}`;
}
