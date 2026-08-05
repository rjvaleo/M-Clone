import { describe, expect, it } from "vitest";
import type { ModuleDescriptor } from "../model/graph";
import { moduleRegistry } from "../registry/registry";
import { FAMILY_LABELS, FAMILY_ORDER, moduleMenuGroups, unreachableModules } from "./moduleMenu";

const descriptor = (type: string, family: ModuleDescriptor["family"], label: string): ModuleDescriptor => ({
  type,
  family,
  label,
  version: 1,
  layout: "utility",
  colorToken: family,
  ports: [],
  parameters: [],
  commands: [],
  face: [],
});

const registryOf = (...items: ModuleDescriptor[]) =>
  new Map(items.map((item) => [item.type, item] as const));

describe("FAMILY_ORDER", () => {
  it("names every family exactly once", () => {
    // The ordering array and the label record have to describe the same set.
    // If they drift, a family gets a label but never a position — which looks
    // exactly like the module not existing.
    expect([...FAMILY_ORDER].sort()).toEqual(Object.keys(FAMILY_LABELS).sort());
    expect(new Set(FAMILY_ORDER).size).toBe(FAMILY_ORDER.length);
  });

  it("runs in signal order, clock first and audio last", () => {
    expect(FAMILY_ORDER[0]).toBe("clock");
    expect(FAMILY_ORDER[FAMILY_ORDER.length - 1]).toBe("audio");
  });
});

describe("moduleMenuGroups", () => {
  it("groups modules under their family's label", () => {
    const groups = moduleMenuGroups(registryOf(descriptor("m.a", "clock", "Alpha")));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ family: "clock", label: FAMILY_LABELS.clock });
    expect(groups[0].items.map((item) => item.type)).toEqual(["m.a"]);
  });

  it("returns groups in FAMILY_ORDER, not registry order", () => {
    const groups = moduleMenuGroups(
      registryOf(descriptor("m.z", "audio", "Zeta"), descriptor("m.a", "clock", "Alpha")),
    );
    expect(groups.map((group) => group.family)).toEqual(["clock", "audio"]);
  });

  it("sorts within a group by label", () => {
    const groups = moduleMenuGroups(
      registryOf(descriptor("m.b", "clock", "Zeta"), descriptor("m.a", "clock", "Alpha")),
    );
    expect(groups[0].items.map((item) => item.label)).toEqual(["Alpha", "Zeta"]);
  });

  it("omits a family with nothing in it", () => {
    const groups = moduleMenuGroups(registryOf(descriptor("m.a", "clock", "Alpha")));
    expect(groups.map((group) => group.family)).not.toContain("audio");
  });

  it("puts every module in exactly one group", () => {
    const groups = moduleMenuGroups(moduleRegistry);
    const listed = groups.flatMap((group) => group.items.map((item) => item.type));
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.length).toBe(moduleRegistry.size);
  });
});

describe("unreachableModules", () => {
  it("is empty for the real registry — every module can be added from the menu", () => {
    // The guard this whole module exists for. A module can be registered,
    // have a face, have a runtime processor, and still be impossible to add
    // to a patch because no menu group claims its family. Nothing else in
    // the app would notice.
    expect(unreachableModules(moduleRegistry)).toEqual([]);
  });

  it("names a module whose family no group offers", () => {
    const orphan = { ...descriptor("m.ghost", "clock", "Ghost"), family: "nowhere" } as unknown as ModuleDescriptor;
    expect(unreachableModules(registryOf(orphan))).toEqual(["m.ghost"]);
  });
});
