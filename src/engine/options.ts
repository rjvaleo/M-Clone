// The Options menu, from manual chapter 22.
//
// "The commands in the Options Menu are settings that can be turned on and off
// by choosing them. An Option is on when the menu item shows a check mark and
// off when there's no check mark."
//
// Order below is the order chapter 22 prints them.

export const OPTION_IDS = [
  "useMetronome",
  "sendClock",
  "externalClock",
  "tapAffectsVelocity",
  "dontScrambleRests",
  "slideshowRecordWait",
  "noZoomRects",
  "sustainEntersRests",
  "midiConduct",
  "secondOrderTranspose",
  "noCyclicBlinking",
  "syncRestartsSequence",
  "editorSoundWhilePlaying",
  "lockedMarkedVariables",
  "echoInBackground",
] as const;

export type OptionId = (typeof OPTION_IDS)[number];
export type Options = Record<OptionId, boolean>;

export const OPTION_LABELS: Record<OptionId, string> = {
  useMetronome: "Use Metronome",
  sendClock: "Send Clock",
  externalClock: "External Clock",
  tapAffectsVelocity: "Tap Affects Velocity",
  dontScrambleRests: "Don't Scramble Rests",
  slideshowRecordWait: "Slideshow Record Wait",
  noZoomRects: "No Zoom Rects",
  sustainEntersRests: "Sustain Enters Rests",
  midiConduct: "Midi Conduct",
  secondOrderTranspose: "Second Order Transpose",
  noCyclicBlinking: "No Cyclic Blinking",
  syncRestartsSequence: "Sync Restarts Sequence",
  editorSoundWhilePlaying: "Editor Sound While Playing",
  lockedMarkedVariables: "Locked Marked Variables",
  echoInBackground: "Echo In Background",
};

/**
 * Options that cannot do anything yet because they act on MIDI *input*, which
 * this build does not have. They are shown, and shown disabled, rather than
 * hidden or silently inert.
 */
const NEEDS_MIDI_INPUT: ReadonlySet<OptionId> = new Set<OptionId>([
  // Empty. External Clock lived here until the clock follower existed; every
  // option now reaches something real.
]);

export function isOptionAvailable(id: OptionId): boolean {
  return !NEEDS_MIDI_INPUT.has(id);
}

/**
 * "Below, all Options are shown unchecked, or Off." — with the two exceptions
 * chapter 22 calls out by name.
 */
export const DEFAULT_OPTIONS: Options = Object.freeze(
  OPTION_IDS.reduce((acc, id) => {
    // "Almost everyone will want this option checked, as is the default state."
    acc[id] = id === "slideshowRecordWait";
    return acc;
  }, {} as Options),
);

export function setOption(options: Options, id: OptionId, on: boolean): Options {
  return { ...options, [id]: on };
}

export type OptionEntry = {
  id: OptionId;
  label: string;
  checked: boolean;
  available: boolean;
};

/** The menu's own view of itself, in printed order. */
export function optionEntries(options: Options): OptionEntry[] {
  return OPTION_IDS.map((id) => ({
    id,
    label: OPTION_LABELS[id],
    checked: options[id],
    available: isOptionAvailable(id),
  }));
}
