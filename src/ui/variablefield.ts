export const VARIABLE_FIELD_SIZE = { width: 46, height: 24 } as const;

export type NoteOrderHandleBoundary = "originalEnd" | "utterlyStart";

/** Keep each full-width Note Order handle inside its probability bar. */
export function noteOrderHandlePosition(
  boundary: NoteOrderHandleBoundary,
  percent: number,
): string {
  return boundary === "originalEnd"
    ? `clamp(var(--variable-field-width), ${percent}%, 100%)`
    : `clamp(0%, ${percent}%, calc(100% - var(--variable-field-width)))`;
}
