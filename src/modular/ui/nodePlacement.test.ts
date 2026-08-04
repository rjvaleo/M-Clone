import { describe, expect, it } from "vitest";
import { isDragSurface, menuPlacement, placeNode, visibleRegion, type Box } from "./nodePlacement";

const size = { width: 200, height: 100 };
const canvas = { width: 4000, height: 2000 };
const visible: Box = { x: 0, y: 0, width: 1000, height: 600 };

const box = (x: number, y: number): Box => ({ x, y, ...size });

const place = (desired: { x: number; y: number }, existing: Box[] = [], over = {}) =>
  placeNode({ desired, size, existing, visible, canvas, ...over });

/** Does a placement satisfy the rule: fully visible and touching nothing? */
const isClear = (at: { x: number; y: number }, existing: Box[], margin = 24) => {
  const a = { ...at, ...size };
  const inside =
    a.x >= visible.x && a.y >= visible.y &&
    a.x + a.width <= visible.x + visible.width &&
    a.y + a.height <= visible.y + visible.height;
  const free = !existing.some((b) =>
    a.x < b.x + b.width + margin && a.x + a.width + margin > b.x &&
    a.y < b.y + b.height + margin && a.y + a.height + margin > b.y);
  return inside && free;
};

describe("Placing a new module", () => {
  it("honours the requested position when it is clear", () => {
    expect(place({ x: 300, y: 200 })).toEqual({ x: 300, y: 200 });
  });

  it("pulls a module back inside when asked for a spot off the edge", () => {
    // Right-clicking near the right edge used to leave most of the node
    // off-screen; it now sits fully inside with its margin.
    const placed = place({ x: 980, y: 560 });
    expect(placed.x + size.width).toBeLessThanOrEqual(visible.width - 24);
    expect(placed.y + size.height).toBeLessThanOrEqual(visible.height - 24);
    expect(isClear(placed, [])).toBe(true);
  });

  it("keeps clear of the top edge, where the toolbar sits", () => {
    const placed = place({ x: 100, y: 0 });
    expect(placed.y).toBeGreaterThanOrEqual(24);
  });

  it("moves aside rather than landing on an existing module", () => {
    const existing = [box(300, 200)];
    const placed = place({ x: 300, y: 200 }, existing);
    expect(placed).not.toEqual({ x: 300, y: 200 });
    expect(isClear(placed, existing)).toBe(true);
  });

  it("finds a gap in a busy view", () => {
    // A row of modules across the top; the new one has to go below them.
    const existing = [box(0, 0), box(250, 0), box(500, 0), box(750, 0)];
    const placed = place({ x: 250, y: 0 }, existing);
    expect(isClear(placed, existing)).toBe(true);
  });

  it("never overlaps anything across many successive spawns", () => {
    const existing: Box[] = [];
    for (let i = 0; i < 8; i++) {
      const placed = place({ x: 100, y: 100 }, existing);
      expect(isClear(placed, existing), `spawn ${i} overlapped`).toBe(true);
      existing.push({ ...placed, ...size });
    }
  });

  it("staggers instead of stacking when the view is genuinely full", () => {
    // Wall-to-wall coverage: nothing can be clear, so the fallback has to at
    // least make successive modules distinguishable.
    const existing: Box[] = [];
    for (let y = 0; y < 600; y += 40) for (let x = 0; x < 1000; x += 40) existing.push(box(x, y));
    const first = place({ x: 0, y: 0 }, existing);
    const second = place({ x: 0, y: 0 }, [...existing, { ...first, ...size }]);
    expect(first).not.toEqual(second);
  });

  it("respects the scrolled view, not the canvas origin", () => {
    const scrolled = { x: 2000, y: 900, width: 800, height: 500 };
    const placed = placeNode({
      desired: { x: 0, y: 0 },
      size, existing: [], visible: scrolled, canvas,
    });
    // Asking for the canvas origin while scrolled away still lands on screen.
    expect(placed.x).toBeGreaterThanOrEqual(scrolled.x);
    expect(placed.y).toBeGreaterThanOrEqual(scrolled.y);
  });

  it("never leaves the canvas even when the view extends past it", () => {
    const placed = placeNode({
      desired: { x: 5000, y: 5000 },
      size, existing: [],
      visible: { x: 3500, y: 1700, width: 2000, height: 2000 },
      canvas,
    });
    expect(placed.x + size.width).toBeLessThanOrEqual(canvas.width);
    expect(placed.y + size.height).toBeLessThanOrEqual(canvas.height);
  });

  it("places something rather than nothing when the window is tiny", () => {
    const placed = placeNode({
      desired: { x: 0, y: 0 },
      size, existing: [],
      visible: { x: 0, y: 0, width: 120, height: 80 },
      canvas,
    });
    expect(Number.isFinite(placed.x)).toBe(true);
    expect(Number.isFinite(placed.y)).toBe(true);
  });

  it("honours a custom margin", () => {
    expect(place({ x: 0, y: 0 }, [], { margin: 100 })).toEqual({ x: 100, y: 100 });
  });
});

describe("Visible region", () => {
  it("converts the scroll box into canvas units", () => {
    expect(visibleRegion({ left: 200, top: 100, width: 800, height: 600 }, 0.5))
      .toEqual({ x: 400, y: 200, width: 1600, height: 1200 });
  });

  it("treats a nonsense zoom as unscaled", () => {
    expect(visibleRegion({ left: 10, top: 10, width: 100, height: 100 }, 0))
      .toEqual({ x: 10, y: 10, width: 100, height: 100 });
  });
});

/**
 * The suite runs without a DOM, and `isDragSurface` needs only `closest`, so
 * this is a two-property stand-in rather than a reason to pull in jsdom.
 * `matches` covers the shapes the real selector uses: tag names and
 * `[attr='value']`.
 */
function fakeElement(
  tag: string,
  attributes: Record<string, string> = {},
  parent: Element | null = null,
): Element {
  const node = {
    tagName: tag.toUpperCase(),
    matches(selector: string): boolean {
      return selector.split(",").some((part) => {
        const one = part.trim();
        const attribute = one.match(/^\[([\w-]+)='([^']*)'\]$/);
        if (attribute) return attributes[attribute[1]] === attribute[2];
        return one.toUpperCase() === node.tagName;
      });
    },
    closest(selector: string): Element | null {
      let current: typeof node | null = node;
      while (current) {
        if (current.matches(selector)) return current as unknown as Element;
        current = current.parentNode as typeof node | null;
      }
      return null;
    },
    parentNode: parent,
  };
  return node as unknown as Element;
}

describe("Deciding what starts a drag", () => {
  it("drags from plain surfaces", () => {
    expect(isDragSurface(fakeElement("div"))).toBe(true);
    expect(isDragSurface(fakeElement("section"))).toBe(true);
    expect(isDragSurface(fakeElement("h2"))).toBe(true);
  });

  it("stands aside for every control on the face", () => {
    // Otherwise turning a knob would move the module instead.
    for (const tag of ["button", "input", "select", "textarea", "label", "a"]) {
      expect(isDragSurface(fakeElement(tag)), tag).toBe(false);
    }
    expect(isDragSurface(fakeElement("div", { role: "slider" }))).toBe(false);
    expect(isDragSurface(fakeElement("div", { contenteditable: "true" }))).toBe(false);
  });

  it("stands aside for anything inside a control", () => {
    const button = fakeElement("button");
    expect(isDragSurface(fakeElement("span", {}, button))).toBe(false);
  });

  it("drags from a plain element nested in plain elements", () => {
    const section = fakeElement("section");
    expect(isDragSurface(fakeElement("span", {}, section))).toBe(true);
  });

  it("ignores a missing target", () => {
    expect(isDragSurface(null)).toBe(false);
  });
});

describe("Keeping a pop-up menu on screen", () => {
  const window = { left: 0, top: 0, width: 1000, height: 800 };
  const menu = { width: 200, height: 400 };

  it("opens at the pointer when there is room", () => {
    expect(menuPlacement({ x: 100, y: 100 }, menu, window)).toEqual({ x: 100, y: 100 });
  });

  it("flips to the other side of the pointer near an edge", () => {
    // Flipping rather than clamping keeps the pointer beside the items instead
    // of halfway across them.
    expect(menuPlacement({ x: 950, y: 100 }, menu, window).x).toBe(750);
    expect(menuPlacement({ x: 100, y: 700 }, menu, window).y).toBe(300);
  });

  it("clamps when flipping is not enough either", () => {
    const tall = { width: 200, height: 900 };
    const placed = menuPlacement({ x: 100, y: 700 }, tall, window);
    expect(placed.y).toBe(8);
  });

  it("respects a scrolled window, because the menu lives in canvas space", () => {
    const scrolled = { left: 2000, top: 500, width: 1000, height: 800 };
    const placed = menuPlacement({ x: 2950, y: 600 }, menu, scrolled);
    expect(placed.x).toBe(2750);
    expect(placed.y).toBe(600);
    // Never above or left of what is actually visible.
    expect(placed.x).toBeGreaterThanOrEqual(2008);
    expect(placed.y).toBeGreaterThanOrEqual(508);
  });

  it("never places the menu off the near edge", () => {
    expect(menuPlacement({ x: 0, y: 0 }, menu, window)).toEqual({ x: 8, y: 8 });
  });
});
