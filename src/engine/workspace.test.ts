import { describe, expect, it } from "vitest";
import {
  WORKSPACE_HEIGHT,
  WORKSPACE_WIDTH,
  clampWorkspaceZoom,
  fitWorkspaceZoom,
  logicalDragDelta,
  scaledWorkspaceSize,
} from "./workspace";

describe("workspace scaling", () => {
  it("uses the original application's 640 × 480 desktop as 100%", () => {
    expect([WORKSPACE_WIDTH, WORKSPACE_HEIGHT]).toEqual([640, 480]);
    expect(scaledWorkspaceSize(100)).toEqual({ width: 640, height: 480 });
  });

  it("scales the complete logical desktop without changing its coordinates", () => {
    expect(scaledWorkspaceSize(150)).toEqual({ width: 960, height: 720 });
    expect(scaledWorkspaceSize(50)).toEqual({ width: 320, height: 240 });
  });

  it("normalizes arbitrary values to supported 10% increments", () => {
    expect(clampWorkspaceZoom(113)).toBe(110);
    expect(clampWorkspaceZoom(116)).toBe(120);
    expect(clampWorkspaceZoom(-20)).toBe(50);
    expect(clampWorkspaceZoom(900)).toBe(200);
  });

  it("converts physical pointer movement back to logical desktop movement", () => {
    expect(logicalDragDelta(30, 150)).toBe(20);
    expect(logicalDragDelta(-10, 50)).toBe(-20);
  });

  it("fits using the largest supported increment that does not overflow", () => {
    expect(fitWorkspaceZoom(1280, 960)).toBe(200);
    expect(fitWorkspaceZoom(704, 528)).toBe(110);
    expect(fitWorkspaceZoom(639, 479)).toBe(90);
    expect(fitWorkspaceZoom(100, 100)).toBe(50);
  });
});
