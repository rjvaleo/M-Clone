import { describe, expect, it } from "vitest";
import {
  DRUM_KITS,
  KIT_909,
  LIBRARY_DIR,
  LIBRARY_ROUTE,
  findKit,
  isLibraryAudio,
  kitFileUrl,
  kitSlots,
  libraryRequestPath,
  libraryRoots,
  pickKitFiles,
  rowsFromKit,
} from "./drumKits";
import { DRUM_ROW_DEFAULTS, defaultDrumRows, setRowField } from "./drumSeq";
import { readPercussionSlots } from "../audio/players";

describe("the TR-909 starter kit", () => {
  it("brings every one-shot in rj_s 909, pads first", () => {
    expect(KIT_909.folder).toBe("rj_s 909");
    expect(KIT_909.files).toHaveLength(36);
    expect(new Set(KIT_909.files.map((f) => f.toLowerCase())).size).toBe(36);
    for (const name of ["909ki1.wav", "909ki6.wav", "909k7.wav", "909sn4.wav", "909clh4.wav", "909oph4.wav", "909clp.wav", "909rim.wav", "909ride1.wav", "909lotm3.wav", "909mitm5.wav", "909hitm5.wav"]) {
      expect(KIT_909.files, name).toContain(name);
    }
    expect(KIT_909.files.slice(0, KIT_909.pads.length)).toEqual(KIT_909.pads.map((pad) => pad.file));
  });

  it("puts its ten pads on the drum sequencer's first ten rows, note for note", () => {
    expect(KIT_909.pads.map((pad) => pad.note)).toEqual(DRUM_ROW_DEFAULTS.slice(0, 10).map((row) => row.note));
    expect(KIT_909.pads.map((pad) => pad.name)).toEqual(DRUM_ROW_DEFAULTS.slice(0, 10).map((row) => row.name));
  });

  it("chokes the open hat with the closed one, as the 909 does", () => {
    const group = (name: string) => KIT_909.pads.find((pad) => pad.name === name)!.chokeGroup;
    expect(group("C.Hat")).toBeGreaterThan(0);
    expect(group("O.Hat")).toBe(group("C.Hat"));
    expect(KIT_909.pads.filter((pad) => pad.chokeGroup > 0)).toHaveLength(2);
  });

  it("is found by id", () => {
    expect(DRUM_KITS).toContain(KIT_909);
    expect(findKit(KIT_909.id)).toBe(KIT_909);
    expect(findKit("nope")).toBeUndefined();
  });
});

describe("mapping a loaded kit onto m.percussion's slots", () => {
  it("gives each pad its note, its sample by id, its choke, pan and gain", () => {
    const ids = new Map(KIT_909.files.map((file, i) => [file.toLowerCase(), `id-${i}`]));
    const slots = kitSlots(KIT_909, ids);
    expect(slots).toHaveLength(10);
    expect(slots[0]).toEqual({ note: 36, assetId: "id-0", chokeGroup: 0, gain: 1, pan: 0 });
    // What the player reads back is exactly what was written.
    expect(readPercussionSlots(slots)).toEqual(slots);
  });

  it("matches file names whatever their case, and leaves a pad empty when its file did not load", () => {
    const slots = kitSlots(KIT_909, new Map([["909ki1.wav", "kick"], ["909sn1.wav", "snare"]]));
    expect(slots.map((slot) => slot.assetId)).toEqual(["kick", "snare", "", "", "", "", "", "", "", ""]);
  });
});

describe("mapping a kit onto the drum sequencer's rows", () => {
  it("names and renotes the first rows after the pads, keeping every step", () => {
    const rows = setRowField(defaultDrumRows(), 0, { name: "Thud", note: 35 });
    const mapped = rowsFromKit(KIT_909, rows);
    expect(mapped[0]).toMatchObject({ name: "Kick", note: 36, on: rows[0].on });
    expect(mapped[10]).toBe(rows[10]);
  });
});

describe("loading a kit from a folder the user picks", () => {
  it("takes the kit's files from anywhere in the folder, by name, whatever their case", () => {
    const picked = pickKitFiles(KIT_909, ["rj_s 909/909KI1.WAV", "rj_s 909/.DS_Store", "other/notes.txt", "909sn1.wav", "deep/er/909clp.wav"]);
    expect(picked).toEqual([
      { index: 0, file: "909ki1.wav" },
      { index: 3, file: "909sn1.wav" },
      { index: 4, file: "909clp.wav" },
    ]);
  });

  it("takes one copy of a file that appears twice", () => {
    expect(pickKitFiles(KIT_909, ["a/909ki1.wav", "b/909ki1.wav"])).toEqual([{ index: 0, file: "909ki1.wav" }]);
  });
});

describe("the dev server's library route", () => {
  it("fetches a kit file by folder and name, escaped", () => {
    expect(kitFileUrl(KIT_909, "909ki1.wav")).toBe(`${LIBRARY_ROUTE}/rj_s%20909/909ki1.wav`);
  });

  it("reads a request back into a folder and a file", () => {
    expect(libraryRequestPath("/rj_s%20909/909ki1.wav")).toEqual({ folder: "rj_s 909", file: "909ki1.wav" });
    expect(libraryRequestPath("/rj_s%20909/909ki1.wav?t=1")).toEqual({ folder: "rj_s 909", file: "909ki1.wav" });
  });

  it("refuses anything that could leave the library or is not one audio file in one folder", () => {
    for (const url of [
      "/../secret/x.wav", "/rj_s%20909/..%2F..%2Fx.wav", "/%2E%2E/x.wav", "/rj_s 909/sub/x.wav", "/x.wav", "/",
      "/rj_s%20909/", "/rj_s%20909/notes.txt", "/rj_s%20909/a%5Cb.wav", "/rj_s%20909/a%00.wav", "/rj_s%20909/%E0%A4%A.wav",
      "/./x.wav", "/.hidden/x.wav", "/rj_s%20909/.x.wav",
    ]) {
      expect(libraryRequestPath(url), url).toBeNull();
    }
  });

  it("serves audio only", () => {
    for (const name of ["a.wav", "a.WAV", "a.aif", "a.aiff", "a.flac", "a.mp3", "a.ogg"]) expect(isLibraryAudio(name), name).toBe(true);
    for (const name of ["a.txt", "a", "a.wav.js"]) expect(isLibraryAudio(name), name).toBe(false);
  });

  it("looks for the library in the env setting, the checkout, then the main checkout of a worktree", () => {
    const root = "/Users/rj/M Clone-drums";
    expect(libraryRoots(root, undefined, "gitdir: /Users/rj/M Clone/.git/worktrees/M Clone-drums\n")).toEqual([
      `${root}/${LIBRARY_DIR}`,
      `/Users/rj/M Clone/${LIBRARY_DIR}`,
    ]);
    expect(libraryRoots("/Users/rj/M Clone", "/Volumes/Samples", undefined)).toEqual([
      "/Volumes/Samples",
      `/Users/rj/M Clone/${LIBRARY_DIR}`,
    ]);
    // A .git file that is not a worktree pointer adds nothing.
    expect(libraryRoots("/r", "", "gitdir: /elsewhere/modules/sub")).toEqual([`/r/${LIBRARY_DIR}`]);
  });
});
