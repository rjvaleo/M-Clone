// Browser file I/O for the File menu.
//
// Deliberately thin: every decision about *what* a project contains lives in
// engine/document.ts, and every decision about state lives in the store. This
// file only moves bytes between the page and the user's disk, which is why it
// sits outside the coverage gate along with the other browser-only wiring.

import { useM } from "../state/store";
import { encodeMovieAsSmf, movieFileName } from "../engine/movie";

const EXTENSION = ".mclone.json";
const DEFAULT_NAME = `Untitled${EXTENSION}`;

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

/** File ▸ Save / Save As — writes the document out as a download. */
export function saveProject(saveAs = false): void {
  const state = useM.getState();
  let name = state.documentName ?? DEFAULT_NAME;

  if (saveAs || !state.documentName) {
    const chosen = window.prompt("Save project as:", name);
    if (chosen === null) return; // cancelled
    name = chosen.trim() || DEFAULT_NAME;
    if (!name.toLowerCase().endsWith(".json")) name += EXTENSION;
  }

  const json = JSON.stringify(state.exportDocument(), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);

  state.markSaved(name);
}

/** File ▸ Open — picks a JSON file and imports it. */
export function openProject(): void {
  if (!confirmDiscard("Open another project")) return;

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
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
