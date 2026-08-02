import { describe, expect, it } from "vitest";
import { classicCyclicSideLayout } from "./cycliclayout";

describe("classicCyclicSideLayout", () => {
  it("reserves enough room for the wrapped descriptor and five value rows", () => {
    const layout = classicCyclicSideLayout();

    expect(layout.gridTemplateRows).toBe("48px repeat(3, 93px)");
    expect(layout["--cyclic-value-row-height"]).toBe("18px");
    expect(layout["--cyclic-value-box-width"]).toBe("34px");
    expect(layout["--cyclic-position-row-height"]).toBe("10px");
    expect(layout["--cyclic-selector-outer"]).toBe(
      "polygon(0 0, 92px 0, 59px 26px, 0 26px)",
    );
    expect(layout["--cyclic-selector-inner"]).toBe(
      "polygon(1px 1px, 89px 1px, 58px 25px, 1px 25px)",
    );
    expect("--cyclic-selector-outline" in layout).toBe(false);
    expect(48 + (93 * 3)).toBeLessThanOrEqual(328);
    expect(2 + (18 * 5)).toBeLessThanOrEqual(93);
    expect(26 + 2 + (10 * 6) + 2).toBeLessThanOrEqual(93);
  });
});
