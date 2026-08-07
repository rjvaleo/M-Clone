import { describe, expect, it } from "vitest";
import type { ParameterDescriptor } from "../model/graph";
import { moduleRegistry } from "../registry/registry";
import { STEPPER_MAX_SPAN, parameterControlKind, selectorVariant } from "./parameterControl";

const param = (over: Partial<ParameterDescriptor>): ParameterDescriptor => ({
  id: "p",
  label: "P",
  kind: "number",
  defaultValue: 0,
  smoothing: "none",
  morph: "immediate",
  automation: "none",
  ...over,
});

describe("parameterControlKind", () => {
  it("gives a boolean a toggle", () => {
    expect(parameterControlKind(param({ kind: "boolean", defaultValue: false }))).toBe("toggle");
  });

  it("gives an enum a selector", () => {
    expect(parameterControlKind(param({ kind: "enum", defaultValue: "a", options: ["a", "b"] }))).toBe("selector");
  });

  it("gives free text a plain field", () => {
    expect(parameterControlKind(param({ kind: "string", defaultValue: "" }))).toBe("text");
  });

  it("draws nothing for json, which has no control", () => {
    expect(parameterControlKind(param({ kind: "json", defaultValue: null }))).toBe("none");
  });

  it("gives a bounded number a knob by default", () => {
    // The knob is the default continuous control on every hardware panel in
    // the catalogue and most of the software ones. A parameter with a range
    // and no other signal is a knob.
    expect(parameterControlKind(param({ minimum: 0, maximum: 100, step: 0.1 }))).toBe("knob");
  });

  it("gives anything measured in decibels a fader", () => {
    // Levels are the one continuous parameter panels consistently do *not*
    // give a knob: a mixer channel is a fader, and dB is what says so.
    expect(parameterControlKind(param({ minimum: -60, maximum: 6, step: 0.1, unit: "dB" }))).toBe("fader");
  });

  it("lets a descriptor ask for a specific control outright", () => {
    // The rules below are defaults, not law. A module that knows its
    // parameter wants a slider says so, and nothing here second-guesses it.
    expect(parameterControlKind(param({ minimum: 0, maximum: 1, control: "slider" }))).toBe("slider");
    expect(parameterControlKind(param({ kind: "boolean", defaultValue: false, control: "button" }))).toBe("button");
  });

  it("gives a short integer range a stepper", () => {
    // A `− 3 +` stepper is how every panel in the catalogue shows octave,
    // division and pattern length: a handful of discrete positions where
    // hitting an exact one matters more than sweeping between them.
    expect(parameterControlKind(param({ minimum: -4, maximum: 4, step: 1 }))).toBe("stepper");
  });

  it("switches to a knob once the integer range is too long to step through", () => {
    const justInside = param({ minimum: 0, maximum: STEPPER_MAX_SPAN, step: 1 });
    const justOutside = param({ minimum: 0, maximum: STEPPER_MAX_SPAN + 1, step: 1 });
    expect(parameterControlKind(justInside)).toBe("stepper");
    expect(parameterControlKind(justOutside)).toBe("knob");
  });

  it("keeps a fractional step off the stepper however short its range", () => {
    // A stepper walks one step per press; a range of 1 in steps of 0.01 is a
    // hundred presses, which is a sweep pretending to be a stepper.
    expect(parameterControlKind(param({ minimum: 0, maximum: 1, step: 0.01 }))).toBe("knob");
  });

  it("falls back to a number field when the range is open-ended", () => {
    // A knob or slider has to know where its travel ends. Without both
    // bounds there is nothing to draw, and a typed number is honest.
    expect(parameterControlKind(param({ minimum: 0 }))).toBe("number");
    expect(parameterControlKind(param({ maximum: 100 }))).toBe("number");
    expect(parameterControlKind(param({}))).toBe("number");
  });

  it("falls back to a number field for a non-finite or inverted range", () => {
    expect(parameterControlKind(param({ minimum: 0, maximum: Number.POSITIVE_INFINITY }))).toBe("number");
    expect(parameterControlKind(param({ minimum: 100, maximum: 0 }))).toBe("number");
  });

  it("treats a zero-width range as a number field, not a dead slider", () => {
    expect(parameterControlKind(param({ minimum: 5, maximum: 5, step: 1 }))).toBe("number");
  });
});

describe("selectorVariant", () => {
  it("lays a few short options out side by side", () => {
    // Three two-character options fit in a node row, and showing them all
    // means the alternatives are readable without clicking.
    expect(selectorVariant(["LP", "BP", "HP"])).toBe("segmented");
  });

  it("cycles once there are too many options to show at once", () => {
    expect(selectorVariant(["1/2", "1/4", "1/8", "1/16", "1/32"])).toBe("cycle");
  });

  it("cycles when the options are too long to sit in a row", () => {
    expect(selectorVariant(["Mono retrigger", "Mono legato"])).toBe("cycle");
  });

  it("cycles rather than showing an empty row for no options", () => {
    expect(selectorVariant([])).toBe("cycle");
  });
});

describe("every registered parameter maps to a control", () => {
  const known = new Set([
    "toggle", "selector", "knob", "slider", "fader", "stepper", "button", "number", "text", "none",
  ]);

  it("classifies every parameter in the registry as something known", () => {
    const unclassified: string[] = [];
    for (const descriptor of moduleRegistry.values()) {
      for (const parameter of descriptor.parameters) {
        const kind = parameterControlKind(parameter);
        if (!known.has(kind)) unclassified.push(`${descriptor.type}.${parameter.id} -> ${kind}`);
      }
    }
    expect(unclassified).toEqual([]);
  });

  it("actually reaches the kit controls across the real registry", () => {
    // A mapping that answered "number" for everything would pass every test
    // above and still leave the app looking exactly as it did. These four are
    // the ones that put a kit control on screen.
    const kinds = new Set<string>();
    for (const descriptor of moduleRegistry.values()) {
      for (const parameter of descriptor.parameters) kinds.add(parameterControlKind(parameter));
    }
    expect(kinds).toContain("toggle");
    expect(kinds).toContain("selector");
    expect(kinds).toContain("knob");
    expect(kinds).toContain("fader");
    expect(kinds).toContain("stepper");
  });
});
