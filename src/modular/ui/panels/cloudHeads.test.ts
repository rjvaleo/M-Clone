import { describe, expect, it } from "vitest";
import { CloudAnimator, headAt } from "./cloudHeads";

const element = (dataset: Record<string, string>) => {
  const style = new Map<string, string>();
  return { dataset: { ...dataset } as Record<string, string | undefined>, style: { setProperty: (k: string, v: string) => { style.set(k, v); } }, styles: style, textContent: "" as string | null };
};

describe("The cloud pad's head", () => {
  it("sits at its start plus how far the engine has read, times Scan", () => {
    expect(headAt(0.25, 0.5, 0.4)).toBeCloseTo(0.45, 12);
    // Backwards from the end.
    expect(headAt(1, -1, 0.3)).toBeCloseTo(0.7, 12);
    // Silent: where it would start.
    expect(headAt(0.25, 1, Number.NaN)).toBe(0.25);
  });

  it("is moved from the rack's report, and tells the pad where it is", () => {
    const pad = element({ cloudNode: "g", cloudStart: "0", cloudScan: "1", cloudW: "200" });
    const read = element({ cloudRead: "g", cloudStart: "0", cloudScan: "1", cloudSeconds: "4" });
    const root = { querySelectorAll: (selector: string) => (selector === "[data-cloud-node]" ? [pad] : [read]) };
    const animator = new CloudAnimator(() => root, () => ({ report: { quanta: 1, heads: { g: 0.5 } } }));
    animator.tick();
    expect(pad.styles.get("--cloud-head")).toBe("100px");
    expect(pad.dataset.cloudPlayed).toBe("0.5");
    expect(read.textContent).toBe("head 2.00s");
  });
});
