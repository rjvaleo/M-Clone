// The menu bar, from manual chapters 19-22.
//
// The engine owns *what is in each menu*; the UI owns what each item does. The
// UI looks a handler up by id, and any item without one renders disabled — so
// an unbuilt feature shows in its proper place, greyed, instead of vanishing.
// That also means this file is the single place the menu inventory can drift
// from the manual, and the tests pin it to the printed order.

export type MenuItemSpec =
  | "separator"
  | { id: string; label: string; hint?: string };

export const MENU_TITLES = [
  "File", "Edit", "Variables", "Pattern", "Windows", "Options",
] as const;

export type MenuTitle = (typeof MENU_TITLES)[number];

/** Chapter 19. No Close: M only ever had one document open. */
export const FILE_MENU_ITEMS: MenuItemSpec[] = [
  { id: "new", label: "New", hint: "Bring the program back to its startup state" },
  { id: "open", label: "Open…", hint: "Open a saved project" },
  { id: "openMidiFile", label: "Open Midi File…", hint: "Import a MIDI file into a Pattern or as a Sequence" },
  "separator",
  { id: "save", label: "Save", hint: "Save the project" },
  { id: "saveAs", label: "Save As…", hint: "Save under a new name" },
  { id: "saveMovieAsMidiFile", label: "Save Movie As Midi File…", hint: "Write a captured performance out as a MIDI file" },
  { id: "saveStateAsStartup", label: "Save State As Startup", hint: "Make the current screen the startup state" },
  "separator",
  { id: "midiAssignment", label: "Midi Assignment…", hint: "Map Input and Output Channels to MIDI devices" },
  { id: "midiSetup", label: "Midi Setup…", hint: "Configure the MIDI system" },
  "separator",
  { id: "quit", label: "Quit" },
];

/**
 * Chapter 20, plus Undo and Redo.
 *
 * The original shipped Undo dead — chapter 5 says plainly "Undo is
 * unimplemented" — and this build restores it rather than reproducing the gap.
 */
export const EDIT_MENU_ITEMS: MenuItemSpec[] = [
  { id: "undo", label: "Undo" },
  { id: "redo", label: "Redo" },
  "separator",
  { id: "cut", label: "Cut" },
  { id: "copy", label: "Copy" },
  { id: "paste", label: "Paste" },
  { id: "pasteNotes", label: "Paste Notes" },
  // Labelled "Paste at End" when a whole Pattern is selected; the UI swaps the
  // text, so both spellings share one id.
  { id: "insertPaste", label: "Insert Paste" },
  "separator",
  { id: "clear", label: "Clear" },
  { id: "changeToRests", label: "Change to Rests" },
  { id: "fillWithRests", label: "Fill With Rests" },
  "separator",
  { id: "eraseSnapshot", label: "Erase Snapshot" },
];

/** Chapter 21. Every command here modifies the Pattern permanently. */
export const PATTERN_MENU_ITEMS: MenuItemSpec[] = [
  { id: "openPatternEditor", label: "Edit…", hint: "Open the Pattern Editor" },
  "separator",
  { id: "transposeUpHalf", label: "Transpose Up Half-Step" },
  { id: "transposeUpOctave", label: "Transpose Up Octave" },
  { id: "transposeDownHalf", label: "Transpose Down Half-Step" },
  { id: "transposeDownOctave", label: "Transpose Down Octave" },
  "separator",
  { id: "reScramble", label: "ReScramble", hint: "Generate a new Cyclic Random ordering" },
  { id: "originalToScrambled", label: "Original → Scrambled", hint: "Copy the Original list to the Cyclic Random list" },
  { id: "swapScrambledAndOriginal", label: "Swap Scrambled and Original" },
  "separator",
  { id: "rotateForward", label: "Rotate Forward" },
  { id: "rotateBackward", label: "Rotate Backward" },
  { id: "reverseOrder", label: "Reverse Order" },
  "separator",
  { id: "doubleWithRests", label: "Double with Rests" },
  { id: "tripleWithRests", label: "Triple with Rests" },
  { id: "eliminateChords", label: "Eliminate Chords" },
  { id: "eliminateRests", label: "Eliminate Rests" },
];

/**
 * Chapter 21.
 *
 * "The commands of this menu open each Variable's Edit Window, with the
 * currently active Position displayed for editing." Order follows the
 * Variables Window and then the Cyclic Variables Window, with the two Midi
 * Window variables last, then the Voice colours.
 */
export const VARIABLES_MENU_ITEMS: MenuItemSpec[] = [
  { id: "var.patternGroup", label: "Pattern Group" },
  { id: "var.noteDensity", label: "Note Density" },
  { id: "var.velocityRange", label: "Velocity Range" },
  { id: "var.noteOrder", label: "Note Order" },
  { id: "var.transposition", label: "Transposition" },
  { id: "var.timeDistortion", label: "Time Distortion" },
  "separator",
  { id: "var.rhythm", label: "Rhythm" },
  { id: "var.phrasing", label: "Phrasing" },
  { id: "var.accents", label: "Accents" },
  "separator",
  { id: "var.orchestration", label: "Orchestration" },
  { id: "var.soundChoice", label: "Sound Choice" },
  "separator",
  { id: "voiceColor.0", label: "Voice 1 Color…" },
  { id: "voiceColor.1", label: "Voice 2 Color…" },
  { id: "voiceColor.2", label: "Voice 3 Color…" },
  { id: "voiceColor.3", label: "Voice 4 Color…" },
];

/**
 * Chapter 21. The rest of this menu is the live window list, which "will vary
 * as you open and close edit windows", so the UI appends it.
 */
export const WINDOWS_MENU_ITEMS: MenuItemSpec[] = [
  { id: "closeEditWindows", label: "Close Edit Windows" },
];

export function menuItemIds(items: readonly MenuItemSpec[]): string[] {
  return items.flatMap((item) => (item === "separator" ? [] : [item.id]));
}

export function menuItemLabels(items: readonly MenuItemSpec[]): string[] {
  return items.flatMap((item) => (item === "separator" ? [] : [item.label]));
}
