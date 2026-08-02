import { describe, expect, it } from "vitest";
import { VARIABLE_FIELD_SIZE, noteOrderHandlePosition } from "./variablefield";

describe("variable editor field geometry", () => {
  it("uses one rectangle for numericals and Note Order handles", () => {
    expect(VARIABLE_FIELD_SIZE).toEqual({ width: 46, height: 24 });
  });

  it("keeps the wider Note Order handles inside both ends of the bar", () => {
    expect(noteOrderHandlePosition("originalEnd", 0)).toBe(
      "clamp(var(--variable-field-width), 0%, 100%)",
    );
    expect(noteOrderHandlePosition("originalEnd", 100)).toBe(
      "clamp(var(--variable-field-width), 100%, 100%)",
    );
    expect(noteOrderHandlePosition("utterlyStart", 0)).toBe(
      "clamp(0%, 0%, calc(100% - var(--variable-field-width)))",
    );
    expect(noteOrderHandlePosition("utterlyStart", 100)).toBe(
      "clamp(0%, 100%, calc(100% - var(--variable-field-width)))",
    );
  });
});
