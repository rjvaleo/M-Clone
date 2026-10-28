import { describe, expect, it } from "vitest";
import { CLASSIC_WINDOW_SIZES } from "./classicWindows";
import {
  M_FITTED_WINDOW_IDS, M_LAYOUT_ORIGINS, M_MAIN_WINDOW_IDS, M_SIDE_WIDTH, M_TITLE_HEIGHT, M_WINDOW_IDS,
  defaultMWindowSize, layoutMNode, type MWindowId, type Rect,
} from "./mLayout";

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function overlappingPairs(rects: Record<string, Rect>, open: Iterable<string> = Object.keys(rects)): string[] {
  const ids = [...open];
  const pairs: string[] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    if (overlaps(rects[ids[i]], rects[ids[j]])) pairs.push(`${ids[i]} × ${ids[j]}`);
  }
  return pairs;
}

const bottom = (r: Rect) => r.y + r.height;
const right = (r: Rect) => r.x + r.width;
const allBut = (...closed: string[]) => new Set<string>(M_WINDOW_IDS.filter((id) => !closed.includes(id)));

const VARIABLE_EDITORS = [
  "variable-editor-density", "variable-editor-velocityRange", "variable-editor-noteOrderMix",
  "variable-editor-transposition", "variable-editor-timeDistort",
] as const;

describe("M node layout", () => {
  it("gives the main screen M's own size: the original body plus a title bar", () => {
    expect(defaultMWindowSize("patterns")).toEqual({
      width: CLASSIC_WINDOW_SIZES.patterns.width,
      height: CLASSIC_WINDOW_SIZES.patterns.height + M_TITLE_HEIGHT,
    });
    expect(defaultMWindowSize("variable-editor-timeDistort").height)
      .toBe(CLASSIC_WINDOW_SIZES.timeDistortion.height + M_TITLE_HEIGHT);
  });

  it("puts the main screen where M puts it", () => {
    const rects = layoutMNode({});
    for (const id of M_MAIN_WINDOW_IDS) expect(rects[id]).toMatchObject(M_LAYOUT_ORIGINS[id]);
    expect(rects.untitled.x).toBeGreaterThan(right(rects.patterns));
    expect(rects.snapshot.x).toBeGreaterThan(right(rects.untitled));
    expect(rects.midi.y).toBeGreaterThan(bottom(rects.variables));
  });

  it("lays every window out with nothing overlapping", () => {
    expect(overlappingPairs(layoutMNode({}))).toEqual([]);
  });

  it("stacks the variable editors under Variables, in its row order, at its width", () => {
    const rects = layoutMNode({});
    const { variables, midi } = rects;
    expect(rects[VARIABLE_EDITORS[0]].y).toBe(bottom(midi) + 8);
    VARIABLE_EDITORS.forEach((id, i) => {
      expect(rects[id]).toMatchObject({ x: variables.x, width: variables.width });
      if (i > 0) expect(rects[id].y).toBe(bottom(rects[VARIABLE_EDITORS[i - 1]]) + 8);
    });
  });

  it("stacks the Cyclic Editor and Orchestration under Cyclic Variables, out to Snapshot's right edge", () => {
    const rects = layoutMNode({});
    const { cyclic, snapshot, midi } = rects;
    const width = right(snapshot) - cyclic.x;
    expect(rects["cyclic-editor"]).toMatchObject({ x: cyclic.x, y: bottom(midi) + 8, width });
    expect(rects["variable-editor-outputChannels"]).toMatchObject({
      x: cyclic.x, y: bottom(rects["cyclic-editor"]) + 8, width,
    });
  });

  it("puts the Pattern Editor at the top of a side column right of Snapshot, then Midi View, Synth and Midi Assignment", () => {
    const rects = layoutMNode({});
    const x = right(rects.snapshot) + 8;
    expect(rects["pattern-editor"]).toMatchObject({ x, y: rects.patterns.y, width: M_SIDE_WIDTH });
    const order = ["pattern-editor", "midi-view", "synth", "midi-assignment"] as MWindowId[];
    order.slice(1).forEach((id, i) => {
      expect(rects[id]).toMatchObject({ x, width: M_SIDE_WIDTH, y: bottom(rects[order[i]]) + 8 });
    });
  });

  it("fits the editors to their column whatever width they were measured at", () => {
    const rects = layoutMNode({
      "variable-editor-density": { width: 145, height: 70 },
      "cyclic-editor": { width: 275, height: 240 },
      "midi-assignment": { width: 470, height: 318 },
    });
    expect(rects["variable-editor-density"]).toMatchObject({ width: rects.variables.width, height: 70 });
    expect(rects["cyclic-editor"]).toMatchObject({ width: right(rects.snapshot) - rects.cyclic.x, height: 240 });
    expect(rects["midi-assignment"]).toMatchObject({ width: M_SIDE_WIDTH, height: 318 });
    expect(M_FITTED_WINDOW_IDS.has("pattern-editor")).toBe(false);
  });

  it("gives a closed window no space: the windows after it in its column close up", () => {
    const all = layoutMNode({});
    const open = allBut("variable-editor-velocityRange", "midi-view");
    const rects = layoutMNode({}, [], open);
    expect(rects["variable-editor-noteOrderMix"].y).toBe(bottom(rects["variable-editor-density"]) + 8);
    expect(rects.synth.y).toBe(bottom(rects["pattern-editor"]) + 8);
    expect(rects["cyclic-editor"]).toEqual(all["cyclic-editor"]);
    expect(overlappingPairs(rects, open)).toEqual([]);
  });

  it("starts the editor columns right under Variables and Cyclic Variables when Midi is closed", () => {
    const rects = layoutMNode({}, [], allBut("midi"));
    expect(rects["variable-editor-density"].y).toBe(bottom(rects.variables) + 8);
    expect(rects["cyclic-editor"].y).toBe(Math.max(bottom(rects.cyclic), bottom(rects.snapshot)) + 8);
  });

  it("leaves the usual closed windows (Midi Assignment, Time Distortion, Transposition) at the column ends", () => {
    const rects = layoutMNode({});
    expect(rects["variable-editor-timeDistort"].y).toBeGreaterThan(rects["variable-editor-noteOrderMix"].y);
    expect(rects["variable-editor-transposition"].y).toBeGreaterThan(rects["variable-editor-noteOrderMix"].y);
    expect(rects["midi-assignment"].y).toBeGreaterThan(rects.synth.y);
  });

  it("moves only what is below the Pattern Editor when it grows; the rest stays put", () => {
    const base = layoutMNode({});
    const pe = base["pattern-editor"];
    const rects = layoutMNode({ "pattern-editor": { width: pe.width + 300, height: pe.height + 200 } });
    expect(overlappingPairs(rects)).toEqual([]);
    expect(rects["pattern-editor"]).toMatchObject({ x: pe.x, y: pe.y });
    expect(rects["midi-view"].y).toBe(base["midi-view"].y + 200);
    for (const id of [...M_MAIN_WINDOW_IDS, ...VARIABLE_EDITORS, "cyclic-editor"] as MWindowId[]) {
      expect(rects[id]).toEqual(base[id]);
    }
  });

  it("pushes the editors below a taller one down its column", () => {
    const base = layoutMNode({});
    const rects = layoutMNode({ "variable-editor-density": { width: 100, height: 200 } });
    const grew = 200 - base["variable-editor-density"].height;
    expect(rects["variable-editor-velocityRange"].y).toBe(base["variable-editor-velocityRange"].y + grew);
    expect(overlappingPairs(rects)).toEqual([]);
  });

  it("puts extra note windows side by side after the first, with the side column below the tallest", () => {
    const rects = layoutMNode(
      { "pattern-editor-2": { width: 380, height: 700 } },
      ["pattern-editor-2", "pattern-editor-3"],
    );
    const first = rects["pattern-editor"], second = rects["pattern-editor-2"], third = rects["pattern-editor-3"];
    expect(second).toMatchObject({ x: right(first) + 8, y: first.y, width: 380, height: 700 });
    expect(third).toMatchObject({ x: right(second) + 8, y: first.y, ...defaultMWindowSize("pattern-editor") });
    expect(rects["midi-view"].y).toBe(first.y + 700 + 8);
    expect(overlappingPairs(rects)).toEqual([]);
  });

  it("lines the extra note windows up from the side column's edge when the first is closed", () => {
    const open = new Set<string>([...allBut("pattern-editor"), "pattern-editor-2"]);
    const rects = layoutMNode({}, ["pattern-editor-2"], open);
    expect(rects["pattern-editor-2"].x).toBe(right(rects.snapshot) + 8);
    expect(overlappingPairs(rects, open)).toEqual([]);
  });

  it("is stable: laying out its own result again changes nothing", () => {
    const once = layoutMNode({ "pattern-editor": { width: 520, height: 300 } });
    const sizes = Object.fromEntries(Object.entries(once).map(([id, r]) => [id, { width: r.width, height: r.height }]));
    expect(layoutMNode(sizes)).toEqual(once);
  });

  describe("windows moved by hand", () => {
    it("puts a moved window exactly where it was dropped, at the size it had in its column", () => {
      const base = layoutMNode({});
      const rects = layoutMNode({}, [], undefined, { "variable-editor-velocityRange": { x: 1200, y: 40 } });
      expect(rects["variable-editor-velocityRange"]).toEqual({
        x: 1200, y: 40,
        width: base["variable-editor-velocityRange"].width, height: base["variable-editor-velocityRange"].height,
      });
    });

    it("takes a moved window out of its column, which closes up behind it", () => {
      const rects = layoutMNode({}, [], undefined, { "variable-editor-velocityRange": { x: 1200, y: 40 } });
      expect(rects["variable-editor-noteOrderMix"].y).toBe(bottom(rects["variable-editor-density"]) + 8);
    });

    it("never pushes a moved window, and never pushes the others out of its way", () => {
      const base = layoutMNode({});
      const drop = { x: base.variables.x + 20, y: base.variables.y + 20 };
      const rects = layoutMNode({}, [], undefined, { synth: drop });
      expect(rects.synth).toMatchObject(drop);
      expect(rects.variables).toEqual(base.variables);
      expect(rects["midi-view"].y).toBe(bottom(rects["pattern-editor"]) + 8);
    });

    it("lets a moved main window go anywhere, and the editor columns follow what is left", () => {
      const rects = layoutMNode({}, [], undefined, { midi: { x: 1300, y: 900 } });
      expect(rects.midi).toMatchObject({ x: 1300, y: 900 });
      expect(rects["variable-editor-density"].y).toBe(bottom(rects.variables) + 8);
    });

    it("lines the extra note windows up from the side column when the first has been moved away", () => {
      const rects = layoutMNode({}, ["pattern-editor-2"], undefined, { "pattern-editor": { x: 40, y: 1000 } });
      expect(rects["pattern-editor-2"]).toMatchObject({ x: right(rects.snapshot) + 8, y: rects.patterns.y });
    });
  });
});
