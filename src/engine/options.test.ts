import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPTIONS,
  OPTION_IDS,
  OPTION_LABELS,
  isOptionAvailable,
  optionEntries,
  setOption,
  type OptionId,
} from "./options";

describe("the Options menu", () => {
  it("carries every option chapter 22 documents", () => {
    // Chapter 22 in TOC order, minus the two legacy serial-port Send Clock
    // entries the 2.7 body text collapses into a single Send Clock.
    expect([...OPTION_IDS].sort()).toEqual([
      "dontScrambleRests",
      "echoInBackground",
      "editorSoundWhilePlaying",
      "externalClock",
      "lockedMarkedVariables",
      "midiConduct",
      "noCyclicBlinking",
      "noZoomRects",
      "secondOrderTranspose",
      "sendClock",
      "slideshowRecordWait",
      "sustainEntersRests",
      "syncRestartsSequence",
      "tapAffectsVelocity",
      "useMetronome",
    ]);
  });

  it("labels each option the way the menu prints it", () => {
    expect(OPTION_LABELS.useMetronome).toBe("Use Metronome");
    expect(OPTION_LABELS.dontScrambleRests).toBe("Don't Scramble Rests");
    expect(OPTION_LABELS.slideshowRecordWait).toBe("Slideshow Record Wait");
    expect(OPTION_LABELS.noZoomRects).toBe("No Zoom Rects");
    expect(OPTION_LABELS.editorSoundWhilePlaying).toBe("Editor Sound While Playing");
    expect(OPTION_LABELS.externalClock).toBe("External Clock");
  });

  it("starts every option off, which is how chapter 22 shows the menu", () => {
    // "Below, all Options are shown unchecked, or Off."
    const alwaysOff = OPTION_IDS.filter((id) => id !== "slideshowRecordWait");
    for (const id of alwaysOff) {
      expect(DEFAULT_OPTIONS[id]).toBe(false);
    }
  });

  it("checks Slideshow Record Wait by default", () => {
    // "Almost everyone will want this option checked, as is the default state."
    expect(DEFAULT_OPTIONS.slideshowRecordWait).toBe(true);
  });

  it("leaves Editor Sound While Playing off by default", () => {
    // "If this option is disabled (as is the default state), the Editor Sound
    //  features will only work when the music is not going."
    expect(DEFAULT_OPTIONS.editorSoundWhilePlaying).toBe(false);
  });

  it("toggles an option without disturbing the others", () => {
    const next = setOption(DEFAULT_OPTIONS, "useMetronome", true);
    expect(next.useMetronome).toBe(true);
    expect(next.slideshowRecordWait).toBe(true);
    expect(next.noZoomRects).toBe(false);
  });

  it("does not mutate the options it is given", () => {
    const before = { ...DEFAULT_OPTIONS };
    setOption(DEFAULT_OPTIONS, "useMetronome", true);
    expect(DEFAULT_OPTIONS).toEqual(before);
  });

  it("reports availability so unbuilt options can be shown honestly", () => {
    // Everything that needs MIDI input is unavailable until that is wired.
    expect(isOptionAvailable("useMetronome")).toBe(true);
    // Was unavailable until the clock follower existed; clockinput.ts and the
    // realtime decoding in midiinput.ts make it real, so the switch is live.
    expect(isOptionAvailable("externalClock")).toBe(true);
    expect(isOptionAvailable("midiConduct")).toBe(true);
    expect(isOptionAvailable("echoInBackground")).toBe(true);
    expect(isOptionAvailable("tapAffectsVelocity")).toBe(true);
    expect(isOptionAvailable("sustainEntersRests")).toBe(true);
  });

  it("lists options in menu order with their label, state and availability", () => {
    const entries = optionEntries(DEFAULT_OPTIONS);
    expect(entries).toHaveLength(OPTION_IDS.length);
    expect(entries[0]).toEqual({
      id: "useMetronome",
      label: "Use Metronome",
      checked: false,
      available: true,
    });
    const wait = entries.find((entry) => entry.id === "slideshowRecordWait");
    expect(wait?.checked).toBe(true);
  });

  it("keeps chapter 22's printed order", () => {
    const ids = optionEntries(DEFAULT_OPTIONS).map((entry) => entry.id);
    expect(ids.slice(0, 4)).toEqual([
      "useMetronome",
      "sendClock",
      "externalClock",
      "tapAffectsVelocity",
    ] satisfies OptionId[]);
    expect(ids[ids.length - 1]).toBe("echoInBackground");
  });
});
