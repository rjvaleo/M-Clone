/**
 * Drum kits: a small manifest per kit, and how one maps onto m.percussion's
 * slots and the Drum Sequencer's rows.
 *
 * The audio itself never enters the repository. The sample library (`Audio -
 * Archival LIBRARY/`, gitignored) lives beside the checkout on RJ's machine,
 * so a kit is only a list of file names in one of its folders. It reaches the
 * sound pool one of two ways:
 *
 *   - **From the library**, in the dev app: `vite.library.ts` serves the
 *     library's audio at `/__library/<folder>/<file>`, so the Percussion face
 *     and the sound pool can fetch a kit with one click. The route looks for
 *     the library in `$IDMLAB_LIBRARY`, then in this checkout, then — when
 *     this checkout is a git worktree — in the main checkout it was cut from.
 *   - **From a folder** the user picks, anywhere: every file whose name the
 *     kit lists is taken, in whatever subfolder and whatever case. This is the
 *     way that works in a built app, where there is no dev server.
 *
 * Either way the files go through the pool's ordinary decode, so they get
 * content-hash ids like any dropped file, and a saved project refers to them
 * by those ids, not by these names.
 */

import type { PercussionSlot } from "../audio/players";
import type { DrumRow } from "./drumSeq";

export type KitPad = {
  note: number;
  name: string;
  /** The file this pad plays, one of the kit's `files`. */
  file: string;
  chokeGroup: number;
  pan: number;
  gain: number;
};

export type DrumKit = {
  id: string;
  name: string;
  /** The kit's folder inside the sample library. */
  folder: string;
  /** Mapped onto the first rows and the slots, in order. */
  pads: KitPad[];
  /** Everything the kit brings into the pool: the pads' files first, then the alternatives. */
  files: string[];
};

const range = (prefix: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}.wav`);

const PADS_909: KitPad[] = [
  { note: 36, name: "Kick", file: "909ki1.wav", chokeGroup: 0, pan: 0, gain: 1 },
  { note: 38, name: "Snare", file: "909sn1.wav", chokeGroup: 0, pan: -0.1, gain: 1 },
  // The two hats share a choke group: the closed hat cuts the open one off.
  { note: 42, name: "C.Hat", file: "909clh1.wav", chokeGroup: 1, pan: 0.35, gain: 1 },
  { note: 46, name: "O.Hat", file: "909oph1.wav", chokeGroup: 1, pan: 0.35, gain: 0.9 },
  { note: 39, name: "Clap", file: "909clp.wav", chokeGroup: 0, pan: -0.05, gain: 1 },
  { note: 37, name: "Rim", file: "909rim.wav", chokeGroup: 0, pan: -0.2, gain: 1 },
  { note: 51, name: "Ride", file: "909ride1.wav", chokeGroup: 0, pan: -0.4, gain: 0.8 },
  { note: 41, name: "Lo Tom", file: "909lotm1.wav", chokeGroup: 0, pan: -0.3, gain: 1 },
  { note: 45, name: "Mid Tom", file: "909mitm1.wav", chokeGroup: 0, pan: 0, gain: 1 },
  { note: 48, name: "Hi Tom", file: "909hitm1.wav", chokeGroup: 0, pan: 0.25, gain: 1 },
];

const ALL_909 = [
  ...range("909ki", 1, 6), "909k7.wav", ...range("909sn", 1, 4), ...range("909clh", 1, 4), ...range("909oph", 1, 4),
  "909clp.wav", "909rim.wav", "909ride1.wav", "909kn1.wav",
  ...range("909lotm", 1, 3), ...range("909mitm", 1, 5), ...range("909hitm", 1, 5),
];

/** RJ's TR-909 one-shots: kicks 1–7, snares, closed and open hats, clap, rim, ride, three toms. */
export const KIT_909: DrumKit = {
  id: "rj-909",
  name: "TR-909",
  folder: "rj_s 909",
  pads: PADS_909,
  files: [...PADS_909.map((pad) => pad.file), ...ALL_909.filter((file) => !PADS_909.some((pad) => pad.file === file))],
};

export const DRUM_KITS: readonly DrumKit[] = [KIT_909];

export const findKit = (id: string): DrumKit | undefined => DRUM_KITS.find((kit) => kit.id === id);

/**
 * The slots a loaded kit gives m.percussion. `assetIds` maps each loaded
 * file's name, lower-cased, to its pool id; a pad whose file did not load is
 * left empty rather than dropped, so the row is still there to drag onto.
 */
export const kitSlots = (kit: DrumKit, assetIds: ReadonlyMap<string, string>): PercussionSlot[] =>
  kit.pads.map((pad) => ({
    note: pad.note,
    assetId: assetIds.get(pad.file.toLowerCase()) ?? "",
    chokeGroup: pad.chokeGroup,
    gain: pad.gain,
    pan: pad.pan,
  }));

/** The first rows take the kit's notes and names, and keep their steps. */
export const rowsFromKit = (kit: DrumKit, rows: readonly DrumRow[]): DrumRow[] =>
  rows.map((row, i) => (kit.pads[i] ? { ...row, name: kit.pads[i].name, note: kit.pads[i].note } : row));

/**
 * From the paths of a picked folder's files, the ones this kit lists: each
 * path's index and the kit's own spelling of its name. A file met twice is
 * taken once.
 */
export function pickKitFiles(kit: DrumKit, paths: readonly string[]): { index: number; file: string }[] {
  const wanted = new Map(kit.files.map((file) => [file.toLowerCase(), file]));
  const picked: { index: number; file: string }[] = [];
  paths.forEach((path, index) => {
    const file = wanted.get((path.split("/").pop() as string).toLowerCase());
    if (!file) return;
    wanted.delete(file.toLowerCase());
    picked.push({ index, file });
  });
  return picked;
}

/* ===== The dev server's library route ===== */

/** Where `vite.library.ts` serves the library. */
export const LIBRARY_ROUTE = "/__library";
/** The library's folder name beside a checkout. */
export const LIBRARY_DIR = "Audio - Archival LIBRARY";

export const kitFileUrl = (kit: DrumKit, file: string): string =>
  `${LIBRARY_ROUTE}/${encodeURIComponent(kit.folder)}/${encodeURIComponent(file)}`;

export const isLibraryAudio = (name: string): boolean => /\.(wav|aiff?|flac|mp3|ogg)$/i.test(name);

/**
 * A request under the route, as `folder/file` — or null for anything that is
 * not exactly one audio file in one folder. Split before decoding, so an
 * escaped slash cannot make a third segment; no segment may start with a dot,
 * which rules out `..` and hidden files alike.
 */
export function libraryRequestPath(url: string): { folder: string; file: string } | null {
  const segments = url.split("?")[0].split("/").filter((segment) => segment !== "");
  if (segments.length !== 2) return null;
  let decoded: string[];
  try {
    decoded = segments.map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  if (decoded.some((part) => part.startsWith(".") || /[/\\\0]/.test(part))) return null;
  const [folder, file] = decoded;
  return isLibraryAudio(file) ? { folder, file } : null;
}

/**
 * Where to look for the library, in order: `$IDMLAB_LIBRARY`, this checkout,
 * and — when this checkout is a worktree, whose `.git` is a file naming
 * `<main>/.git/worktrees/<name>` — the main checkout.
 */
export function libraryRoots(projectRoot: string, env: string | undefined, gitFile: string | undefined): string[] {
  const roots = [env ?? "", `${projectRoot}/${LIBRARY_DIR}`];
  const main = /^gitdir:\s*(.+)\/\.git\/worktrees\/[^/]+\s*$/m.exec(gitFile ?? "");
  if (main) roots.push(`${main[1]}/${LIBRARY_DIR}`);
  return roots.filter((root) => root !== "");
}
