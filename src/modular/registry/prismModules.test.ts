import { describe, expect, it } from "vitest";
import { PRISM_CATALOG } from "./prismCatalog.generated";
import {
  PRISM_FADE_KEY,
  PRISM_MODULES,
  PRISM_PARAM_INDICES,
  PRISM_STRUCTURE_PARAMS,
  prismLabel,
  prismType,
} from "./prismModules";
import { moduleRegistry } from "./registry";

/**
 * The shared effects as idMLab modules.
 *
 * Everything a face shows — ranges, defaults, choices, groups — comes from
 * the crate through the generated catalogue, so these check the translation,
 * not the values.
 */
describe("The prism modules", () => {
  it("registers every effect in the catalogue as an audio module", () => {
    expect(PRISM_MODULES).toHaveLength(PRISM_CATALOG.length);
    for (const effect of PRISM_CATALOG) {
      const descriptor = moduleRegistry.get(prismType(effect.id));
      expect(descriptor?.label).toBe(prismLabel(effect));
      expect(descriptor?.family).toBe("audio");
      const audio = descriptor?.ports.filter((port) => port.signal.kind === "audio") ?? [];
      expect(audio.map((port) => [port.direction, port.signal])).toEqual([
        ["input", { kind: "audio", channels: 2 }],
        ["output", { kind: "audio", channels: 2 }],
      ]);
    }
  });

  it("takes each control's range, default and kind from the crate", () => {
    for (const effect of PRISM_CATALOG) {
      const descriptor = moduleRegistry.get(prismType(effect.id))!;
      for (const param of effect.params.filter((p) => !p.inert)) {
        const control = descriptor.parameters.find((p) => p.id === param.key)!;
        expect(control, `${effect.id}.${param.key}`).toBeDefined();
        if (param.kind === "choice") {
          expect(control.kind).toBe("enum");
          expect(control.options).toEqual(param.choices);
          expect(control.defaultValue).toBe(param.choices![param.default]);
        } else if (param.kind === "toggle") {
          expect(control.kind).toBe("boolean");
          expect(control.defaultValue).toBe(param.default >= (param.min + param.max) / 2);
        } else {
          expect([control.minimum, control.maximum, control.defaultValue]).toEqual([param.min, param.max, param.default]);
          if (param.kind === "int") expect(control.step).toBe(1);
        }
      }
    }
  });

  it("puts each control at its position in the crate, and the fade after", () => {
    for (const effect of PRISM_CATALOG) {
      const indices = PRISM_PARAM_INDICES[prismType(effect.id)];
      effect.params.forEach((param, index) => expect(indices[param.key]).toBe(param.inert ? undefined : index));
      expect(indices[PRISM_FADE_KEY]).toBe(effect.params.length);
    }
  });

  it("names MultiGrainLive's rack effects apart from idMLab's own", () => {
    expect(moduleRegistry.get(prismType("gain"))?.label).toBe("MultiGrainLive Gain");
    expect(moduleRegistry.get(prismType("eq"))?.label).toBe("MultiGrainLive EQ");
    expect(moduleRegistry.get(prismType("compressor"))?.label).toBe("MultiGrainLive Compressor");
    expect(moduleRegistry.get("m.audio-compressor")?.label).toBe("Compressor");
    expect(moduleRegistry.get(prismType("dattorro-plate"))?.label).toBe("Dattorro plate");
  });

  it("leaves a control the original never read off the module, and its index unused", () => {
    const inert = PRISM_CATALOG.flatMap((effect) => effect.params.filter((p) => p.inert).map((p) => [effect.id, p.key]));
    expect(inert).toEqual([
      ["dattorro-notch", "gainDb"],
      ["dattorro-resonator", "gainDb"],
    ]);
    for (const [id, key] of inert) {
      const descriptor = moduleRegistry.get(prismType(id))!;
      expect(descriptor.parameters.some((p) => p.id === key), `${id}.${key}`).toBe(false);
      expect(PRISM_PARAM_INDICES[prismType(id)][key]).toBeUndefined();
    }
  });

  it("gives MultiGrainLive's switches as switches", () => {
    const bank = moduleRegistry.get(prismType("dattorro-filter-bank"))!;
    for (const key of ["notchOn", "resonatorOn", "regaliaOn", "dampingOn"]) {
      expect(bank.parameters.find((p) => p.id === key)?.kind, key).toBe("boolean");
    }
  });

  it("lays the face out in the original's groups", () => {
    const tremolo = moduleRegistry.get(prismType("tremolo"))!;
    expect(tremolo.face.map((section) => section.label)).toEqual(["LFO", "Amount", "State"]);
  });

  it("gives an effect that takes a sound a sample slot, filed as structure", () => {
    const convolution = moduleRegistry.get(prismType("convolution"))!;
    expect(convolution.parameters.some((p) => p.id === "asset-id")).toBe(true);
    const slots = convolution.face.flatMap((section) => section.elements).filter((e) => e.kind === "custom");
    expect(slots.map((e) => e.kind === "custom" && e.parameterIds)).toEqual([["asset-id"]]);
    expect(PRISM_STRUCTURE_PARAMS[prismType("convolution")]).toEqual(["asset-id"]);
    expect(PRISM_STRUCTURE_PARAMS[prismType("tremolo")]).toBeUndefined();
  });
});

describe("The grain engine", () => {
  it("is an instrument that takes notes and a sample, with MultiGrainLive's five engines", () => {
    const engine = moduleRegistry.get("m.grain-engine")!;
    expect(engine.family).toBe("instrument");
    expect(engine.ports.map((p) => [p.direction, p.signal.kind])).toEqual([["input", "note-event"], ["output", "audio"]]);
    expect(engine.parameters.find((p) => p.id === "engine")?.options).toEqual(["WSOLA", "Vocoder", "Grains", "PVSOLA", "Hybrid"]);
    expect(engine.parameters.find((p) => p.id === "engine")?.defaultValue).toBe("Grains");
    expect(engine.parameters.find((p) => p.id === "root")?.defaultValue).toBe(60);
    expect(engine.parameters.find((p) => p.id === "free-run")?.defaultValue).toBe(false);
  });
});
