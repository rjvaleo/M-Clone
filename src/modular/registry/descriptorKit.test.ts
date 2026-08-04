import { describe, expect, it } from "vitest";
import {
  defineModule,
  noteSignal,
  numberParam,
  output,
  PRESET_SLOTS,
  presetParams,
  presetSlots,
  section,
} from "./descriptorKit";
import { validateModuleDescriptor } from "./registry";

/**
 * The kit is what makes every descriptor in the registry consistent, so its
 * defaults are load-bearing: a module that forgets to say `layout` still has to
 * come out looking like every other compact module.
 */
describe("Module defaults", () => {
  const minimal = () => defineModule({
    type: "m.test",
    label: "Test",
    family: "routing",
    ports: [output("notes-out", "Notes", noteSignal())],
    face: [section("main", "Main", [])],
  });

  it("fills in the parts a spec leaves out", () => {
    const descriptor = minimal();
    expect(descriptor.layout).toBe("compact");
    // A module that does not choose a colour takes its family's.
    expect(descriptor.colorToken).toBe("routing");
    expect(descriptor.parameters).toEqual([]);
    expect(descriptor.commands).toEqual([]);
    expect(descriptor.version).toBe(1);
    expect(validateModuleDescriptor(descriptor)).toEqual([]);
  });

  it("keeps the choices a spec does make", () => {
    const descriptor = defineModule({
      type: "m.test",
      label: "Test",
      family: "routing",
      layout: "editor",
      colorToken: "audio",
      ports: [],
      parameters: [numberParam("gain", "Gain", 1, 0, 2)],
      face: [section("main", "Main", [{ kind: "parameter", parameterId: "gain" }])],
    });
    expect(descriptor.layout).toBe("editor");
    expect(descriptor.colorToken).toBe("audio");
    expect(descriptor.parameters).toHaveLength(1);
  });

  it("carries a feedback break only when one is declared", () => {
    expect("feedbackBreak" in minimal()).toBe(false);
    const breaker = defineModule({
      type: "m.test",
      label: "Test",
      family: "routing",
      ports: [],
      face: [section("main", "Main", [])],
      feedbackBreak: { minDelayTicks: 960 },
    });
    expect(breaker.feedbackBreak).toEqual({ minDelayTicks: 960 });
  });
});

describe("Preset storage", () => {
  it("pads a bank out to sixteen slots, empty ones included", () => {
    const slots = presetSlots([1, 2, 3]) as unknown[];
    expect(slots).toHaveLength(PRESET_SLOTS);
    expect(slots.slice(0, 3)).toEqual([1, 2, 3]);
    expect(slots[15]).toBeNull();
  });

  it("ignores anything past the sixteenth slot", () => {
    const slots = presetSlots(Array.from({ length: 40 }, (_, i) => i)) as unknown[];
    expect(slots).toHaveLength(PRESET_SLOTS);
    expect(slots[15]).toBe(15);
  });

  it("pads a bank given as a list, and leaves other shapes alone", () => {
    const [padded] = presetParams("Presets", [1, 2]);
    expect(padded.defaultValue).toHaveLength(PRESET_SLOTS);

    // A default that is not a list is one value shared by every slot — a grid,
    // for instance — and padding it would corrupt it.
    const [whole] = presetParams("Presets", { shape: "grid" } as never);
    expect(whole.defaultValue).toEqual({ shape: "grid" });
  });

  it("puts the active position in range and out of the way of morphing", () => {
    const [, active] = presetParams("Presets", [], 3);
    expect(active.id).toBe("active-position");
    expect(active.defaultValue).toBe(3);
    expect(active.kind === "number" && active.maximum).toBe(PRESET_SLOTS - 1);
    // Recalling a slot mid-step would land half of a preset on one step.
    expect(active.morph).toBe("step-end");
    expect(active.smoothing).toBe("none");
  });
});
