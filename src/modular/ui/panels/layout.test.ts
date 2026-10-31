import { describe, expect, it } from "vitest";
import { coverage, groupOf, validateLayout, type PanelLayout } from "./layout";
import { PANEL_LAYOUTS, panelFor } from "./layouts";
import { PLOT_KINDS } from "./plots";
import { moduleRegistry } from "../../registry/registry";
import type { ModuleDescriptor } from "../../model/graph";

// A small module to check the checker against.
const descriptor = {
  type: "test.module",
  parameters: [
    { id: "gain", label: "Gain", kind: "number", defaultValue: 0, minimum: 0, maximum: 1 },
    { id: "on", label: "On", kind: "boolean", defaultValue: false },
    { id: "shape", label: "Shape", kind: "enum", defaultValue: "a", options: ["a", "b"] },
    { id: "asset-id", label: "Sample", kind: "string", defaultValue: "" },
  ],
} as unknown as ModuleDescriptor;

const good = (): PanelLayout => ({
  moduleType: "test.module",
  style: "strip",
  width: 200,
  height: 100,
  groups: [
    { id: "a", label: "A", x: 0, y: 0, w: 100, h: 100 },
    { id: "b", label: "B", x: 100, y: 0, w: 100, h: 100 },
  ],
  controls: [
    { param: "gain", kind: "knob", x: 10, y: 10, w: 40, h: 40 },
    { param: "on", kind: "switch", x: 60, y: 10, w: 30, h: 20 },
    { param: "shape", kind: "select", x: 110, y: 10, w: 80, h: 20 },
    { param: "asset-id", kind: "asset", x: 110, y: 40, w: 80, h: 40 },
  ],
  displays: [],
});

describe("Checking a panel against its module", () => {
  it("passes a panel that places every control once, tight and grouped", () => {
    expect(validateLayout(good(), descriptor)).toEqual([]);
  });

  it("finds a control that is missing, doubled or unknown", () => {
    const layout = good();
    layout.controls = [
      layout.controls[0],
      { ...layout.controls[0], x: 10, y: 55 },
      { param: "nope", kind: "knob", x: 60, y: 40, w: 30, h: 30 },
      layout.controls[2],
      layout.controls[3],
    ];
    const errors = validateLayout(layout, descriptor);
    expect(errors).toContain("on: not on the panel");
    expect(errors).toContain("gain: placed twice");
    expect(errors).toContain("nope: not a parameter of test.module");
  });

  it("finds a control of the wrong kind for its parameter", () => {
    const layout = good();
    layout.controls[1] = { ...layout.controls[1], kind: "knob" };
    layout.controls[3] = { ...layout.controls[3], kind: "knob" };
    expect(validateLayout(layout, descriptor)).toEqual([
      "on: a boolean needs a switch, not a knob",
      "asset-id: a sample needs an asset slot, not a knob",
    ]);
  });

  it("lets a two-way choice be a switch and a choice be a dial", () => {
    const layout = good();
    layout.controls[2] = { ...layout.controls[2], kind: "switch" };
    expect(validateLayout(layout, descriptor)).toEqual([]);
    layout.controls[2] = { ...layout.controls[2], kind: "knob", w: 28, h: 28 };
    expect(validateLayout(layout, descriptor)).toEqual([]);
  });

  it("finds a control off the panel, outside every group, or on top of another", () => {
    const layout = good();
    layout.controls[0] = { ...layout.controls[0], x: 180 };
    layout.controls[1] = { ...layout.controls[1], x: 90, y: 10 };
    layout.controls[2] = { ...layout.controls[2], x: 110, y: 45 };
    const errors = validateLayout(layout, descriptor);
    expect(errors).toContain("gain: runs off the panel");
    expect(errors).toContain("on: not inside one group");
    expect(errors).toContain("asset-id: overlaps shape");
  });

  it("lets a choice of three be a dial but not a switch, and treats an enum with no options as one", () => {
    const three = { ...descriptor, parameters: descriptor.parameters.map((p) => p.id === "shape" ? { ...p, options: ["a", "b", "c"] } : p) } as ModuleDescriptor;
    const layout = good();
    layout.controls[2] = { ...layout.controls[2], kind: "switch" };
    expect(validateLayout(layout, three)).toEqual(["shape: a choice needs a selector or a dial, not a switch"]);
    const none = { ...descriptor, parameters: descriptor.parameters.map((p) => p.id === "shape" ? { ...p, options: undefined } : p) } as ModuleDescriptor;
    expect(validateLayout(layout, none)).toEqual(["shape: a choice needs a selector or a dial, not a switch"]);
  });

  it("finds a display that runs off the panel, and counts an empty panel as unused", () => {
    const layout = good();
    layout.displays = [{ kind: "scope", x: 150, y: 90, w: 100, h: 20 }];
    expect(validateLayout(layout, descriptor)).toContain("scope display: runs off the panel");
    expect(coverage({ ...layout, width: 0, height: 0 })).toBe(0);
  });

  it("finds a display on top of a control", () => {
    const layout = good();
    layout.displays = [{ kind: "curve", x: 0, y: 0, w: 40, h: 40 }];
    expect(validateLayout(layout, descriptor)).toContain("curve display: overlaps gain");
  });

  it("finds blank space: groups and displays must cover the panel", () => {
    const layout = good();
    layout.groups = [layout.groups[0], { ...layout.groups[1], h: 50 }];
    layout.controls[3] = { ...layout.controls[3], y: 30, h: 15 };
    expect(coverage(layout)).toBeCloseTo(0.75, 2);
    expect(validateLayout(layout, descriptor)).toContain("only 75% of the panel is used; leave no blank space");
  });

  it("allows inert controls the original drew but this port has no parameter for", () => {
    const layout = good();
    layout.inert = [{ label: "delaylock", kind: "switch", x: 60, y: 60, w: 30, h: 20, why: "follows the host's tempo" }];
    expect(validateLayout(layout, descriptor)).toEqual([]);
    layout.inert = [{ label: "delaylock", kind: "switch", x: 10, y: 10, w: 30, h: 20, why: "" }];
    expect(validateLayout(layout, descriptor)).toContain("delaylock (inert): overlaps gain");
  });
});

describe("A pad, which places two controls", () => {
  const two = {
    type: "test.pad",
    parameters: [
      { id: "x", label: "X", kind: "number", defaultValue: 0, minimum: 0, maximum: 1 },
      { id: "y", label: "Y", kind: "number", defaultValue: 0, minimum: 0, maximum: 1 },
      { id: "on", label: "On", kind: "boolean", defaultValue: false },
    ],
  } as unknown as ModuleDescriptor;
  const padLayout = (): PanelLayout => ({
    moduleType: "test.pad", style: "platinum", width: 100, height: 100,
    groups: [{ id: "all", label: "", x: 0, y: 0, w: 100, h: 100 }],
    controls: [
      { param: "x", paramY: "y", kind: "pad", x: 0, y: 0, w: 80, h: 80 },
      { param: "on", kind: "switch", x: 0, y: 82, w: 40, h: 16 },
    ],
    displays: [],
  });

  it("places its X and its Y", () => {
    expect(validateLayout(padLayout(), two)).toEqual([]);
  });

  it("needs a Y that is a number on the module", () => {
    const layout = padLayout();
    layout.controls[0] = { ...layout.controls[0], paramY: "on" };
    expect(validateLayout(layout, two)).toContain("on: a pad's Y must be a number");
    layout.controls[0] = { ...layout.controls[0], paramY: "nope" };
    expect(validateLayout(layout, two)).toContain("nope: not a parameter of test.pad");
    layout.controls[0] = { ...layout.controls[0], paramY: undefined };
    expect(validateLayout(layout, two)).toContain("x: a pad needs a Y");
  });

  it("lets a number be a text field", () => {
    const layout = padLayout();
    layout.controls = [
      { param: "x", kind: "field", x: 0, y: 0, w: 40, h: 20 },
      { param: "y", kind: "field", x: 50, y: 0, w: 40, h: 20 },
      layout.controls[1],
    ];
    expect(validateLayout(layout, two)).toEqual([]);
  });
});

describe("A panel with pages", () => {
  const paged = (): PanelLayout => ({
    ...good(),
    pages: [{ id: "one", label: "One" }, { id: "two", label: "Two" }],
    controls: [
      { param: "gain", kind: "knob", page: "one", x: 10, y: 10, w: 40, h: 40 },
      { param: "on", kind: "switch", page: "two", x: 10, y: 10, w: 40, h: 40 },
      { param: "gain", kind: "knob", page: "two", alias: true, x: 60, y: 10, w: 30, h: 30 },
      { param: "shape", kind: "select", x: 110, y: 10, w: 80, h: 20 },
      { param: "asset-id", kind: "asset", x: 110, y: 40, w: 80, h: 40 },
    ],
  });

  it("lets controls on different pages share a place", () => {
    expect(validateLayout(paged(), descriptor)).toEqual([]);
  });

  it("lets a control appear again as an alias, as the Lexicon soft row does", () => {
    const layout = paged();
    layout.controls[2] = { ...layout.controls[2], alias: false };
    expect(validateLayout(layout, descriptor)).toContain("gain: placed twice");
  });

  it("still finds an alias of nothing, a page that does not exist, and overlaps on one page", () => {
    const layout = paged();
    layout.controls.push({ param: "nope", kind: "knob", alias: true, page: "one", x: 60, y: 60, w: 20, h: 20 });
    layout.controls.push({ param: "shape", kind: "select", alias: true, page: "three", x: 110, y: 85, w: 20, h: 10 });
    layout.controls.push({ param: "on", kind: "switch", alias: true, page: "one", x: 20, y: 20, w: 10, h: 10 });
    const errors = validateLayout(layout, descriptor);
    expect(errors).toContain("nope: not a parameter of test.module");
    expect(errors).toContain("shape: on a page the panel does not have");
    expect(errors).toContain("on: overlaps gain");
  });

  it("finds an alias that is the only placing of its control", () => {
    const layout = paged();
    layout.controls[1] = { ...layout.controls[1], alias: true };
    expect(validateLayout(layout, descriptor)).toContain("on: not on the panel");
  });
});

describe("A control's group", () => {
  it("is the group it sits inside", () => {
    expect(groupOf(good(), good().controls[2])?.id).toBe("b");
    expect(groupOf(good(), { x: 90, y: 0, w: 30, h: 10 })).toBeUndefined();
  });
});

describe("Every panel in the app", () => {
  it("is drawn for a module that exists", () => {
    for (const layout of PANEL_LAYOUTS) {
      expect(moduleRegistry.get(layout.moduleType), layout.moduleType).toBeDefined();
    }
  });

  it("places every control of its module once, tight, grouped and on the panel", () => {
    for (const layout of PANEL_LAYOUTS) {
      const module = moduleRegistry.get(layout.moduleType);
      if (!module) continue;
      expect(validateLayout(layout, module), layout.moduleType).toEqual([]);
    }
  });

  it("finds a module's panel by its type", () => {
    expect(panelFor("m.grain-engine")?.style).toBe("cabinet");
    expect(panelFor("m.synth")).toBeUndefined();
  });

  it("covers every panel built so far", () => {
    const types = PANEL_LAYOUTS.map((layout) => layout.moduleType);
    expect(new Set(types).size).toBe(types.length);
    expect(types.filter((type) => type.startsWith("m.prism-hp-"))).toHaveLength(30);
    expect(types.filter((type) => type.startsWith("m.prism-sh-"))).toHaveLength(9);
    expect(types.filter((type) => type.startsWith("m.prism-lxp-"))).toHaveLength(4);
    expect(types).toEqual(expect.arrayContaining([
      "m.grain-engine", "m.prism-compressor", "m.prism-dattorro-filter-bank", "m.prism-dattorro-plate", "m.audio-mixer",
    ]));
    expect(types).toHaveLength(88);
  });

  it("draws the last forty effects in the four new looks, each where it belongs", () => {
    const looks: Record<PanelLayout["style"], string[]> = {
      night: ["schroeder-reverb", "moorer-reverb", "white-chorus", "flanger", "vibrato", "leslie", "harmonizer", "detune",
        "doubler", "doppler", "phaser", "allpass-diffuser", "echo", "multi-delay", "tremolo", "convolution"],
      strip: ["eq", "dattorro-notch", "dattorro-resonator", "regalia", "chamberlin", "damping-filter", "pn-noise", "pn-noise-eq", "single-bit-pn"],
      graph: ["gate", "maximizer", "spectral-dynamics", "fit"],
      cabinet: ["invert", "swap", "width", "dc", "ring", "rappify", "boomerang", "gain", "utility", "decimator", "stereo-matrix"],
      soundhack: [], lexicon: [], platinum: [],
    };
    for (const [style, ids] of Object.entries(looks)) {
      for (const id of ids) expect(panelFor(`m.prism-${id}`)?.style, id).toBe(style);
    }
    // Every prism effect now has a panel.
    const missing = [...moduleRegistry.values()].filter((m) => m.type.startsWith("m.prism-") && !panelFor(m.type)).map((m) => m.type);
    expect(missing).toEqual([]);
  });

  it("draws every display a panel names", () => {
    const known = new Set([...PLOT_KINDS, "cheek", "grain-screen", "root-keys", "plate-tail", "transfer", "levels", "bank-response",
      "page-nav", "page-title", "lxp-logo", "lxp-title", "lxp-meters", "lxp-rtv", "hp-x-axis", "hp-y-axis", "hp-values"]);
    for (const layout of PANEL_LAYOUTS) {
      for (const display of layout.displays) expect(known.has(display.kind), `${layout.moduleType}: ${display.kind}`).toBe(true);
    }
  });
});

describe("The mixer's panel", () => {
  const layout = panelFor("m.audio-mixer")!;

  it("is a panel of strips, one fixed width, that places every control", () => {
    expect(layout).toBeDefined();
    expect(layout.style).toBe("strip");
    expect(validateLayout(layout, moduleRegistry.get("m.audio-mixer")!)).toEqual([]);
  });

  it("gives every channel the same strip, in order, then the sends' masters", () => {
    const strips = layout.groups.filter((g) => g.id.startsWith("channel-"));
    expect(strips.map((g) => g.label)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(new Set(strips.map((g) => g.w)).size).toBe(1);
    expect(strips.map((g) => g.x)).toEqual(strips.map((_, i) => i * strips[0].w));
    const masters = layout.groups.find((g) => g.id === "sends")!;
    expect(masters.x).toBe(strips.length * strips[0].w);
    expect(layout.width).toBe(masters.x + masters.w);
  });

  it("draws each fader upright, and each channel's sends above its pan", () => {
    for (let channel = 1; channel <= 8; channel += 1) {
      const at = (param: string) => layout.controls.find((c) => c.param === param)!;
      expect(at(`level-${channel}`).kind).toBe("vslider");
      expect(at(`send-a-${channel}`).y).toBeLessThan(at(`pan-${channel}`).y);
      expect(at(`send-b-${channel}`).y).toBeLessThan(at(`pan-${channel}`).y);
    }
  });
});
