// Extra note windows. The original M had one Pattern Editor; here a track can
// have its own, so a drum track's lanes and a melody's keyboard sit side by
// side. The first Pattern Editor is "pattern-editor"; extras are numbered from 2.

export type NoteWindow = { id: string; voice: number };

/** Note windows open at once, counting the first Pattern Editor. */
export const NOTE_WINDOW_LIMIT = 4;

export function openNoteWindow(list: readonly NoteWindow[], voice: number): NoteWindow[] {
  if (list.length >= NOTE_WINDOW_LIMIT - 1) return [...list];
  const taken = new Set(list.map((w) => w.id));
  let n = 2;
  while (taken.has(`pattern-editor-${n}`)) n += 1;
  return [...list, { id: `pattern-editor-${n}`, voice }];
}

export function closeNoteWindow(list: readonly NoteWindow[], id: string): NoteWindow[] {
  return list.filter((w) => w.id !== id);
}

export function setNoteWindowVoice(list: readonly NoteWindow[], id: string, voice: number): NoteWindow[] {
  return list.map((w) => (w.id === id ? { ...w, voice } : w));
}
