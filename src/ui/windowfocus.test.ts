import { describe, expect, it, vi } from "vitest";
import { focusWindowPointerDown } from "./windowfocus";

describe("classic command-click window focus", () => {
  it("raises every click but suppresses the clicked control action for Command-click", () => {
    const bringToFront = vi.fn();
    const ordinary = { metaKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    focusWindowPointerDown(ordinary, bringToFront);
    expect(bringToFront).toHaveBeenCalledOnce();
    expect(ordinary.preventDefault).not.toHaveBeenCalled();

    const command = { metaKey: true, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    focusWindowPointerDown(command, bringToFront);
    expect(command.preventDefault).toHaveBeenCalledOnce();
    expect(command.stopPropagation).toHaveBeenCalledOnce();
  });
});
