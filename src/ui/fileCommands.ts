// Browser file I/O for the File menu.
//
// Deliberately thin: every decision about *what* a project contains lives in
// engine/document.ts, and every decision about state lives in the store. This
// file only moves bytes between the page and the user's disk, which is why it
// sits outside the coverage gate along with the other browser-only wiring.

import { useM } from "../state/store";
import { encodeMovieAsSmf, movieFileName } from "../engine/movie";

const EXTENSION = ".mclone";
const DEFAULT_NAME = `Untitled${EXTENSION}`;

type ProjectWritable = {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
};

type ProjectFileHandle = {
  name: string;
  createWritable: () => Promise<ProjectWritable>;
};

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<ProjectFileHandle>;
};

let projectFileHandle: ProjectFileHandle | null = null;

export function hasProjectSavePicker(): boolean {
  return typeof (window as SavePickerWindow).showSaveFilePicker === "function";
}

export function needsDownloadName(
  saveAs: boolean,
  documentName: string | null,
  hasPicker = hasProjectSavePicker(),
): boolean {
  return !hasPicker && (saveAs || documentName === null);
}

/** Ask before throwing away unsaved music. Returns false to cancel. */
function confirmDiscard(action: string): boolean {
  const { isDirty, documentName } = useM.getState();
  if (!isDirty) return true;
  const what = documentName ?? "this project";
  return window.confirm(
    `${what} has unsaved changes.\n\n${action} anyway and lose them?`,
  );
}

/** File ▸ New. */
export function newProject(): void {
  if (!confirmDiscard("Start a new project")) return;
  useM.getState().newDocument();
}

/** File ▸ Save / Save As — writes through the picker or a download fallback. */
export async function saveProject(
  saveAs = false,
  explicitName?: string,
): Promise<"saved" | "cancelled" | "needs-name"> {
  const state = useM.getState();
  let name = state.documentName ?? DEFAULT_NAME;
  const json = JSON.stringify(state.exportDocument(), null, 2);
  const showSaveFilePicker = (window as SavePickerWindow).showSaveFilePicker;

  if (showSaveFilePicker && explicitName === undefined) {
    try {
      if (saveAs || !projectFileHandle) {
        projectFileHandle = await showSaveFilePicker.call(window, {
          suggestedName: name,
          types: [{
            description: "M-Clone project",
            accept: {
              "application/x-mclone": [EXTENSION],
              "application/json": [".json"],
            },
          }],
        });
      }
      const writable = await projectFileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      state.markSaved(projectFileHandle.name);
      return "saved";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // Some embedded browsers expose the picker but reject it. The download
      // path below still gives Save and Save As a working local result.
    }
  }

  if (explicitName !== undefined) {
    name = explicitName.trim() || DEFAULT_NAME;
    if (/\.mclone\.json$/i.test(name)) name = name.slice(0, -5);
    else if (/\.json$/i.test(name)) name = name.slice(0, -5) + EXTENSION;
    else if (!name.toLowerCase().endsWith(EXTENSION)) name += EXTENSION;
  } else if (saveAs || !state.documentName) {
    // Page prompts are suppressed by some embedded browsers. Let App render
    // an accessible filename dialog instead of silently keeping "Untitled".
    return "needs-name";
  }

  const link = document.querySelector<HTMLAnchorElement>("#mclone-project-download");
  if (!link) throw new Error("Project download anchor is unavailable");
  link.href = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  link.download = name;
  // A download has no completion callback. Record the chosen document name
  // before dispatching it because embedded browsers may transfer control to
  // their download UI before the remaining handler statements run.
  state.markSaved(name);
  link.click();
  return "saved";
}

/** File ▸ Open — picks a .mclone or legacy JSON project and imports it. */
export function openProject(): void {
  if (!confirmDiscard("Open another project")) return;

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".mclone,.json,application/x-mclone,application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      window.alert(`${file.name} isn't valid JSON.`);
      return;
    }
    const result = useM.getState().importDocument(parsed, file.name);
    if (!result.ok) {
      window.alert(`Could not open ${file.name}.\n\n${result.error}`);
      return;
    }
    if (result.warnings.length > 0) {
      // Opening still succeeded — say what had to be repaired rather than
      // pretending the file was pristine.
      window.alert(
        `Opened ${file.name} with repairs:\n\n• ${result.warnings.join("\n• ")}`,
      );
    }
  };
  input.click();
}

/** File ▸ Save Movie As Midi File — exports the last completed performance. */
export function saveMovieAsMidiFile(): void {
  const state = useM.getState();
  const movie = state.movieRecorder.movie;
  if (!movie) return;
  const bytes = encodeMovieAsSmf(movie);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const url = URL.createObjectURL(new Blob([buffer], { type: "audio/midi" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = movieFileName(state.documentName);
  link.click();
  URL.revokeObjectURL(url);
}
