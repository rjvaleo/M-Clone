import { describe, expect, it } from "vitest";
import { clampZoom, zoomScrollPosition } from "./viewport";

describe("modular canvas viewport", () => {
  it("clamps zoom to the documented canvas range", () => {
    expect(clampZoom(0.1)).toBe(0.4);
    expect(clampZoom(0.75)).toBe(0.75);
    expect(clampZoom(2)).toBe(1.1);
  });

  it("keeps the graph point beneath the pointer stationary", () => {
    const next = zoomScrollPosition({
      scrollLeft: 200,
      scrollTop: 100,
      pointerX: 300,
      pointerY: 250,
      oldZoom: 0.5,
      newZoom: 1,
    });
    expect(next).toEqual({ left: 700, top: 450 });
    expect((next.left + 300) / 1).toBe((200 + 300) / 0.5);
    expect((next.top + 250) / 1).toBe((100 + 250) / 0.5);
  });
});
