import { describe, expect, it } from "vitest";
import { createEffect, EFFECT_BUILDERS } from "./effects";
import type { AudioNodeSpec } from "./audioPlan";
import { FakeAudioContext, FakeParam } from "./testing/fakeContext";
import { moduleRegistry } from "../registry/registry";
import { AUDIO_STRUCTURE_PARAMS } from "../registry/audioModules";
import type { ModuleDescriptor, ParameterDescriptor } from "../model/graph";

/**
 * One pass over every knob on every audio module.
 *
 * `runtime/processorSweep.test.ts` does this job for the event side and the
 * audio side never had a twin, which is how the DP/4, Blackhole and the reverb
 * tank landed with roughly ninety `setParameter` arms that no test had ever
 * executed — the topologies were covered, the controls were not. Turning a knob
 * ran code that had never run once.
 *
 * The list comes from the registry rather than from a hand-written table, so a
 * module added tomorrow is swept tomorrow without anyone remembering to add it.
 * That is the property worth having: the per-module tests next door prove that
 * a control does the right thing; this proves every control does *something*
 * and that none of them can throw, strand a `NaN` in a coefficient, or leave
 * the graph unusable afterwards.
 */

const audioDescriptors = (): ModuleDescriptor[] =>
  [...moduleRegistry.values()].filter((descriptor) => descriptor.family === "audio");

/** Everything a module declares that is not read once at construction. */
const rampableParams = (descriptor: ModuleDescriptor): ParameterDescriptor[] => {
  const structural = new Set(AUDIO_STRUCTURE_PARAMS[descriptor.type] ?? []);
  return (descriptor.parameters ?? []).filter(
    (parameter) => !structural.has(parameter.id) && parameter.kind === "number",
  );
};

const structureFor = (descriptor: ModuleDescriptor): Record<string, never> => {
  const structural = AUDIO_STRUCTURE_PARAMS[descriptor.type] ?? [];
  const out: Record<string, unknown> = {};
  for (const id of structural) {
    const parameter = (descriptor.parameters ?? []).find((candidate) => candidate.id === id);
    if (parameter) out[id] = parameter.defaultValue;
  }
  return out as Record<string, never>;
};

const specFor = (descriptor: ModuleDescriptor): AudioNodeSpec => {
  const parameters: Record<string, number> = {};
  for (const parameter of rampableParams(descriptor)) {
    parameters[parameter.id] = parameter.defaultValue as number;
  }
  return {
    nodeId: "swept",
    moduleType: descriptor.type,
    structure: structureFor(descriptor),
    parameters,
    bypass: false,
    wet: 0.5,
  };
};

const build = (descriptor: ModuleDescriptor) => {
  const context = new FakeAudioContext();
  const module = createEffect(context, specFor(descriptor), 0, () => "linear");
  return { context, module };
};

/**
 * Every `AudioParam` the module built, found by walking the nodes it created.
 *
 * Reaching in like this rather than asking the module is deliberate: a
 * coefficient that goes `NaN` is usually one the module does not expose.
 */
const everyParam = (context: FakeAudioContext): { owner: string; param: FakeParam }[] => {
  const found: { owner: string; param: FakeParam }[] = [];
  for (const node of context.created) {
    for (const [key, value] of Object.entries(node)) {
      if (value instanceof FakeParam) {
        found.push({ owner: `${node.constructor.name}.${key}`, param: value });
      }
    }
  }
  return found;
};

const expectAllFinite = (context: FakeAudioContext, label: string): void => {
  for (const { owner, param } of everyParam(context)) {
    expect(Number.isFinite(param.value), `${label} → ${owner}`).toBe(true);
  }
};

/**
 * The values worth trying: both ends, the middle, and well outside.
 *
 * Out-of-range matters because a parameter arrives from a document that a user
 * may have hand-edited or that an older version wrote, and every arm is
 * supposed to clamp rather than trust.
 */
const probeValues = (parameter: ParameterDescriptor): number[] => {
  const min = (parameter.minimum ?? 0) as number;
  const max = (parameter.maximum ?? 1) as number;
  return [min, max, (min + max) / 2, min - 1000, max + 1000, 0];
};

describe("Every audio module parameter", () => {
  it("has at least one module to sweep, and every one declares knobs", () => {
    // Guards the sweep itself: a filter that silently matched nothing would
    // make every test below vacuously pass.
    const descriptors = audioDescriptors();
    expect(descriptors.length).toBeGreaterThan(0);
    expect(Object.keys(EFFECT_BUILDERS).sort()).toEqual(
      descriptors.map((descriptor) => descriptor.type).sort(),
    );
    const withKnobs = descriptors.filter((descriptor) => rampableParams(descriptor).length > 0);
    expect(withKnobs.length).toBeGreaterThan(0);
  });

  it("accepts every declared value without throwing", () => {
    for (const descriptor of audioDescriptors()) {
      const { module } = build(descriptor);
      for (const parameter of rampableParams(descriptor)) {
        for (const value of probeValues(parameter)) {
          expect(
            () => module.setParameter(parameter.id, value, 0),
            `${descriptor.type}.${parameter.id} = ${value}`,
          ).not.toThrow();
        }
      }
      module.dispose();
    }
  });

  it("never lets a coefficient become NaN or infinite", () => {
    // The failure this catches is silent: a filter whose frequency goes NaN
    // outputs nothing for ever and reports no error anywhere.
    for (const descriptor of audioDescriptors()) {
      const { context, module } = build(descriptor);
      expectAllFinite(context, `${descriptor.type} at rest`);
      for (const parameter of rampableParams(descriptor)) {
        for (const value of probeValues(parameter)) {
          module.setParameter(parameter.id, value, 0);
          expectAllFinite(context, `${descriptor.type}.${parameter.id} = ${value}`);
        }
      }
      module.dispose();
    }
  });

  it("ignores a parameter it does not have rather than failing", () => {
    // Parameter changes arrive from a diff against a document that may be older
    // than the module. An unknown id is a no-op, not a crash.
    for (const descriptor of audioDescriptors()) {
      const { module } = build(descriptor);
      expect(() => module.setParameter("no-such-parameter", 0.5, 0), descriptor.type).not.toThrow();
      module.dispose();
    }
  });

  it("survives wet, bypass and disposal in any order", () => {
    for (const descriptor of audioDescriptors()) {
      const { context, module } = build(descriptor);
      for (const wet of [0, 0.5, 1, -1, 2]) module.setWet(wet, 0);
      for (const bypass of [true, false, true]) module.setBypass(bypass, 0);
      expectAllFinite(context, `${descriptor.type} after wet/bypass`);
      expect(() => module.dispose(), descriptor.type).not.toThrow();
      // Disposal runs once in the adapter, but a rebuild racing a fade has been
      // known to call it twice; it must not care.
      expect(() => module.dispose(), `${descriptor.type} twice`).not.toThrow();
    }
  });

  it("still accepts parameters after being disposed", () => {
    // A ramp already scheduled when a rebuild lands arrives after disposal.
    // Throwing here would take down the whole audio callback.
    for (const descriptor of audioDescriptors()) {
      const { module } = build(descriptor);
      module.dispose();
      for (const parameter of rampableParams(descriptor)) {
        expect(
          () => module.setParameter(parameter.id, parameter.defaultValue as number, 0),
          `${descriptor.type}.${parameter.id} after dispose`,
        ).not.toThrow();
      }
    }
  });
});
