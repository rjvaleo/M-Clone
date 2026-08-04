import { describe, expect, it } from "vitest";
import { createNode, moduleRegistry, validateModuleDescriptor } from "./registry";
import type { ModuleDescriptor } from "../model/graph";
import { MODULE_ACCENT_SLOTS } from "../theme/moduleAccents";
import { PRESET_SLOTS } from "./descriptorKit";

describe("Modular module registry", () => {
  it("keeps every registered parameter and command visible on the node face", () => {
    for (const descriptor of moduleRegistry.values()) {
      expect(validateModuleDescriptor(descriptor), descriptor.type).toEqual([]);
    }
  });

  it("creates independent nodes from descriptor defaults", () => {
    const first = createNode("m.note-editor", "first", { x: 0, y: 0 });
    const second = createNode("m.note-editor", "second", { x: 10, y: 20 });
    first.parameters["output-length"] = 32;
    expect(second.parameters["output-length"]).toBe(16);
    expect(second.position).toEqual({ x: 10, y: 20 });
  });

  it("gives every module the same sixteen-slot preset store", () => {
    // One pad, two rows of eight, on every module that has presets — so the
    // store is the pad's size everywhere rather than each module's own.
    const editor = createNode("m.note-editor", "editor", { x: 0, y: 0 });
    expect(editor.parameters["preset-values"]).toHaveLength(PRESET_SLOTS);
    for (const descriptor of moduleRegistry.values()) {
      if (!descriptor.parameters.some((parameter) => parameter.id === "preset-values")) continue;
      const node = createNode(descriptor.type, "n", { x: 0, y: 0 });
      expect(node.parameters["preset-values"], descriptor.type).toHaveLength(PRESET_SLOTS);
    }
  });

  it("declares what a preset captures wherever a pad is shown", () => {
    // The pad is identical everywhere; the captured parameters are the only
    // thing that varies, so an undeclared list is a pad that recalls nothing.
    for (const descriptor of moduleRegistry.values()) {
      for (const element of descriptor.face.flatMap((section) => section.elements)) {
        if (element.kind !== "custom" || !element.captures) continue;
        for (const id of element.captures) {
          expect(descriptor.parameters.map((parameter) => parameter.id), `${descriptor.type}.${id}`)
            .toContain(id);
        }
      }
    }
  });

  it("embeds eight presets in the per-stream density gate", () => {
    const processor = moduleRegistry.get("m.note-density");
    expect(moduleRegistry.has("m.density-presets")).toBe(false);
    expect(processor?.ports.find((port) => port.id === "density-in")?.signal)
      .toEqual({ kind: "control", value: "number" });
    expect(processor?.parameters.find((parameter) => parameter.id === "preset-values")?.defaultValue)
      .toHaveLength(8);
    expect(processor?.face.flatMap((section) => section.elements))
      .toContainEqual(expect.objectContaining({ kind: "custom", id: "density-slider" }));
    expect(processor?.face.flatMap((section) => section.elements))
      .toContainEqual(expect.objectContaining({ kind: "custom", id: "embedded-number-presets" }));
  });

  it("uses the same preset contract for one-stream Note Order", () => {
    const order = createNode("m.note-order", "order", { x: 0, y: 0 });
    expect(order.parameters["preset-values"]).toHaveLength(PRESET_SLOTS);
    expect(order.parameters).toMatchObject({ original: 50, cyclic: 4, utterly: 46 });
    expect(moduleRegistry.get("m.note-order")?.ports.find((port) => port.id === "pattern-in")?.signal)
      .toEqual({ kind: "pattern-data" });
  });

  it("assigns variable processors to one uniform compact layout", () => {
    expect(moduleRegistry.get("m.note-density")?.layout).toBe("compact");
    expect(moduleRegistry.get("m.note-order")?.layout).toBe("compact");
  });

  it("registers the clock-domain half of a stream as single-stream nodes", () => {
    const timeBase = createNode("m.time-base", "tb", { x: 0, y: 0 });
    const phase = createNode("m.phase", "ph", { x: 0, y: 0 });
    expect(moduleRegistry.get("m.time-base")?.layout).toBe("compact");
    expect(moduleRegistry.get("m.phase")?.layout).toBe("compact");
    expect(timeBase.parameters["preset-values"]).toHaveLength(PRESET_SLOTS);
    expect(phase.parameters["preset-values"]).toHaveLength(PRESET_SLOTS);
    expect(timeBase.parameters).toMatchObject({ numerator: 1, denominator: 16 });
    // Phase is in ticks, because ticks are the only canonical musical time.
    expect(moduleRegistry.get("m.phase")?.parameters
      .find((parameter) => parameter.id === "offset-ticks")?.unit).toBe("ticks");
  });

  it("requires the inputs a clock-domain node cannot run without", () => {
    const required = (type: string, portId: string) =>
      moduleRegistry.get(type)?.ports.find((port) => port.id === portId)?.required;
    expect(required("m.time-base", "transport-in")).toBe(true);
    expect(required("m.phase", "clock-in")).toBe(true);
    expect(required("m.note-order", "clock-in")).toBe(true);
    expect(required("m.note-order", "pattern-in")).toBe(true);
    expect(required("m.step-to-notes", "steps-in")).toBe(true);
  });

  it("declares merge policy for every many-input port", () => {
    for (const descriptor of moduleRegistry.values()) {
      for (const port of descriptor.ports) {
        if (port.direction !== "input" || port.cardinality !== "many") continue;
        expect(port.mergePolicy, `${descriptor.type}:${port.id}`).toBeDefined();
      }
    }
  });

  it("bridges step events to note events with an explicit converter", () => {
    const converter = moduleRegistry.get("m.step-to-notes");
    expect(converter?.ports.find((port) => port.id === "steps-in")?.signal)
      .toEqual({ kind: "step-event" });
    expect(converter?.ports.find((port) => port.id === "notes-out")?.signal)
      .toEqual({ kind: "note-event" });
    // A utility, not a Classic Variable, so it carries no preset strip.
    expect(converter?.layout).toBe("utility");
    expect(converter?.parameters.some((parameter) => parameter.id === "preset-values")).toBe(false);
  });

  it("registers cyclic core modules with the standard clock/control contracts", () => {
    const accent = moduleRegistry.get("m.cyclic-accent");
    const legato = moduleRegistry.get("m.cyclic-legato");
    const rhythm = moduleRegistry.get("m.cyclic-rhythm");

    expect(accent?.ports.find((port) => port.id === "clock-in")?.required).toBe(true);
    expect(legato?.ports.find((port) => port.id === "clock-in")?.required).toBe(true);
    expect(rhythm?.ports.find((port) => port.id === "clock-in")?.required).toBe(true);

    expect(accent?.ports.find((port) => port.id === "reset-in")?.cardinality).toBe("many");
    expect(legato?.ports.find((port) => port.id === "reset-in")?.cardinality).toBe("many");
    expect(rhythm?.ports.find((port) => port.id === "reset-in")?.cardinality).toBe("many");

    expect(accent?.ports.find((port) => port.id === "accent-out")?.signal)
      .toEqual({ kind: "control", value: "number" });
    expect(legato?.ports.find((port) => port.id === "legato-out")?.signal)
      .toEqual({ kind: "control", value: "number" });
    expect(rhythm?.ports.find((port) => port.id === "clock-out")?.signal)
      .toEqual({ kind: "step-clock" });
  });

  it("registers stage-4 shaping consumers for accent and legato control streams", () => {
    const velocity = moduleRegistry.get("m.velocity-range");
    const legato = moduleRegistry.get("m.legato-processor");

    expect(velocity?.ports.find((port) => port.id === "accent-in")?.signal)
      .toEqual({ kind: "control", value: "number" });
    expect(velocity?.ports.find((port) => port.id === "notes-in")?.signal)
      .toEqual({ kind: "note-event" });
    expect(velocity?.parameters.find((parameter) => parameter.id === "preset-values")?.defaultValue)
      .toHaveLength(8);

    expect(legato?.ports.find((port) => port.id === "legato-in")?.signal)
      .toEqual({ kind: "control", value: "number" });
    expect(legato?.ports.find((port) => port.id === "notes-in")?.signal)
      .toEqual({ kind: "note-event" });
    expect(legato?.parameters.find((parameter) => parameter.id === "preset-values")?.defaultValue)
      .toHaveLength(8);
  });

  it("registers stage-5 note-path modules", () => {
    const playEnable = moduleRegistry.get("m.play-enable");
    const transposition = moduleRegistry.get("m.transposition");

    expect(playEnable?.ports.find((port) => port.id === "play-enabled-in")?.signal)
      .toEqual({ kind: "control", value: "boolean" });
    expect(playEnable?.ports.find((port) => port.id === "notes-in")?.signal)
      .toEqual({ kind: "note-event" });
    expect(playEnable?.parameters.find((parameter) => parameter.id === "preset-values")?.defaultValue)
      .toHaveLength(8);

    expect(transposition?.ports.find((port) => port.id === "transposition-in")?.signal)
      .toEqual({ kind: "control", value: "number" });
    expect(transposition?.ports.find((port) => port.id === "scale-context-in")?.signal)
      .toEqual({ kind: "control", value: "index" });
    expect(transposition?.parameters.find((parameter) => parameter.id === "preset-values")?.defaultValue)
      .toHaveLength(8);
  });

  it("registers stage-6 stream compound surface", () => {
    const stream = moduleRegistry.get("m.stream");
    expect(stream?.ports.find((port) => port.id === "transport-in")?.required).toBe(true);
    expect(stream?.ports.find((port) => port.id === "notes-out")?.signal)
      .toEqual({ kind: "note-event" });
    expect(stream?.commands.find((command) => command.id === "expand-stream")?.label).toBe("Expand");
  });

  it("gives every module an identity colour the theme actually defines", () => {
    // Only the derived identity tokens exist per theme; a module using anything
    // else falls back to the Density colour and quietly loses its identity.
    const themed = new Set<string>(MODULE_ACCENT_SLOTS);
    for (const descriptor of moduleRegistry.values()) {
      expect(themed.has(descriptor.colorToken), `${descriptor.type} uses ${descriptor.colorToken}`)
        .toBe(true);
    }
  });

  it("gives every module a unique type and a distinct label", () => {
    const types = [...moduleRegistry.values()].map((descriptor) => descriptor.type);
    const labels = [...moduleRegistry.values()].map((descriptor) => descriptor.label);
    expect(new Set(types).size).toBe(types.length);
    expect(new Set(labels).size).toBe(labels.length);
    for (const type of types) expect(type.startsWith("m.")).toBe(true);
  });

  it("declares a merge policy on every input that accepts more than one cable", () => {
    // Fan-in without a stated policy is how a graph becomes order-dependent.
    for (const descriptor of moduleRegistry.values()) {
      for (const port of descriptor.ports) {
        if (port.direction !== "input" || port.cardinality !== "many") continue;
        expect(port.mergePolicy, `${descriptor.type}.${port.id}`).toBeDefined();
      }
    }
  });

  it("names every telemetry port as telemetry and nothing else", () => {
    for (const descriptor of moduleRegistry.values()) {
      for (const port of descriptor.ports) {
        const isTelemetry = port.signal.kind === "telemetry";
        expect(port.id.endsWith("-telemetry"), `${descriptor.type}.${port.id}`).toBe(isTelemetry);
      }
    }
  });

  it("refuses a feedback break that cannot actually break feedback", () => {
    const base = moduleRegistry.get("m.note-density") as ModuleDescriptor;
    const withBreak = (feedbackBreak: ModuleDescriptor["feedbackBreak"]): ModuleDescriptor =>
      ({ ...base, feedbackBreak });
    // A break that does not advance time is a hang wearing a label.
    expect(validateModuleDescriptor(withBreak({ minDelayTicks: 0 })))
      .toContain("Feedback break must delay at least one whole tick");
    expect(validateModuleDescriptor(withBreak({ minDelayTicks: 0.5 })))
      .toContain("Feedback break must delay at least one whole tick");
    // A break that can boost is a runaway waiting for the right patch.
    expect(validateModuleDescriptor(withBreak({ minDelayTicks: 1, maxGain: 1.2 })))
      .toContain("Feedback break gain must be bounded to (0, 1]");
    expect(validateModuleDescriptor(withBreak({ minDelayTicks: 1, maxGain: 0 })))
      .toContain("Feedback break gain must be bounded to (0, 1]");
    expect(validateModuleDescriptor(withBreak({ minDelayTicks: 1, maxGain: 0.7 }))).toEqual([]);
    expect(validateModuleDescriptor(withBreak({ minDelayTicks: 960 }))).toEqual([]);
  });

  it("enforces merge-policy and telemetry port naming rules", () => {
    const base = moduleRegistry.get("m.note-density") as ModuleDescriptor;
    const badManyInput: ModuleDescriptor = {
      ...base,
      ports: base.ports.map((port) =>
        port.id === "notes-in" ? { ...port, mergePolicy: undefined, cardinality: "many" } : port),
    };
    expect(validateModuleDescriptor(badManyInput))
      .toContain("Many-input port missing merge policy: notes-in");

    const badTelemetryName: ModuleDescriptor = {
      ...base,
      ports: base.ports.map((port) =>
        port.signal.kind === "telemetry" ? { ...port, id: "rejected-out" } : port),
    };
    expect(validateModuleDescriptor(badTelemetryName))
      .toContain("Telemetry port id must end with -telemetry: rejected-out");

    const singleInputWithPolicy: ModuleDescriptor = {
      ...base,
      ports: base.ports.map((port) =>
        port.id === "notes-in" ? { ...port, cardinality: "one", mergePolicy: "sum" } : port),
    };
    expect(validateModuleDescriptor(singleInputWithPolicy))
      .toContain("Only many-cardinality ports may declare merge policy: notes-in");

    const musicalPortNamedTelemetry: ModuleDescriptor = {
      ...base,
      ports: base.ports.map((port) =>
        port.id === "notes-out" ? { ...port, id: "notes-telemetry" } : port),
    };
    expect(validateModuleDescriptor(musicalPortNamedTelemetry))
      .toContain("Only telemetry ports may use -telemetry suffix: notes-telemetry");
  });

  it("refuses a face that names something the module does not have", () => {
    // The complete-face rule runs both ways: every control must be on the face,
    // and the face may only name controls that exist.
    const base = moduleRegistry.get("m.note-density") as ModuleDescriptor;
    const section = (elements: ModuleDescriptor["face"][number]["elements"]) =>
      ({ ...base, face: [{ id: "s", label: "S", elements }] });

    expect(validateModuleDescriptor(section([{ kind: "parameter", parameterId: "invented" }])))
      .toContain("Unknown face parameter: invented");
    expect(validateModuleDescriptor(section([{ kind: "command", id: "invented", label: "Invented" }])))
      .toContain("Unknown face command: invented");
    expect(validateModuleDescriptor(section([
      { kind: "custom", id: "c", label: "C", parameterIds: ["invented"] },
    ]))).toContain("Unknown custom-face parameter: invented");
    // A custom element that names nothing is legal — it is a drawing, not a control.
    expect(validateModuleDescriptor(section([{ kind: "custom", id: "c", label: "C" }])))
      .not.toContain("Unknown custom-face parameter: undefined");
  });

  it("refuses a control or command that no face shows", () => {
    const base = moduleRegistry.get("m.note-density") as ModuleDescriptor;
    expect(validateModuleDescriptor({ ...base, face: [] }).join(" "))
      .toContain("Parameter is hidden from node face");

    const withCommand: ModuleDescriptor = {
      ...base,
      commands: [{ id: "poke", label: "Poke" }],
    };
    expect(validateModuleDescriptor(withCommand))
      .toContain("Command is hidden from node face: poke");
  });

  it("refuses a descriptor that says the same thing twice", () => {
    const base = moduleRegistry.get("m.note-density") as ModuleDescriptor;
    expect(validateModuleDescriptor({ ...base, ports: [...base.ports, base.ports[0]] }))
      .toContain("Duplicate port id");
    expect(validateModuleDescriptor({ ...base, parameters: [...base.parameters, base.parameters[0]] }))
      .toContain("Duplicate parameter id");
    expect(validateModuleDescriptor({
      ...base,
      commands: [{ id: "poke", label: "Poke" }, { id: "poke", label: "Poke again" }],
      face: [...base.face, {
        id: "cmds", label: "Commands",
        elements: [{ kind: "command", id: "poke", label: "Poke" }],
      }],
    })).toContain("Duplicate command id");
  });

  it("refuses to build a node from a module type it does not have", () => {
    expect(() => createNode("m.imaginary", "n", { x: 0, y: 0 }))
      .toThrow("Unknown module type: m.imaginary");
  });
});
