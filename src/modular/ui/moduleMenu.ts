/**
 * What the add-module menu offers, and in what order.
 *
 * Extracted from `ModularApp.tsx` so the one property that matters here can
 * actually be tested: **every registered module is reachable**. A module can
 * be registered, declare a face, and have a working runtime processor, and
 * still be impossible to add to a patch because no menu group claims its
 * family — and nothing anywhere else in the app would notice. That is a
 * silent hole, and it was a real one: `ModuleDescriptor["family"]` has always
 * included `scene`, and the menu's group list did not.
 *
 * `FAMILY_LABELS` is typed as a total `Record` over the family union
 * specifically so that hole cannot reopen. Widening the union in `graph.ts`
 * without naming the new family here is a compile error, not a module that
 * quietly stops being addable.
 */

import type { ModuleDescriptor, ModuleTypeId } from "../model/graph";

export type ModuleFamily = ModuleDescriptor["family"];

/**
 * Every family, with the heading the menu shows for it.
 *
 * Total by construction — see the note above. Do not loosen this to
 * `Partial<Record<…>>` or to an array of pairs; the exhaustiveness is the
 * point, not the shape.
 */
export const FAMILY_LABELS: Record<ModuleFamily, string> = {
  clock: "Clock and transport",
  source: "Pattern material",
  transform: "Note transforms",
  control: "Control and conducting",
  scene: "Scenes and snapshots",
  routing: "Routing and output",
  instrument: "Instruments",
  audio: "Audio",
};

/**
 * The order the menu offers families in: the order they are wired, from the
 * clock through to the output.
 *
 * With sixty-plus modules an alphabetical list is a lookup table; grouped by
 * signal domain it is a description of the chain. Scenes sit after control
 * and before routing because a scene recalls the control state, then the
 * result goes out.
 */
export const FAMILY_ORDER: readonly ModuleFamily[] = [
  "clock",
  "source",
  "transform",
  "control",
  "scene",
  "routing",
  "instrument",
  "audio",
];

export interface ModuleMenuGroup {
  family: ModuleFamily;
  label: string;
  items: ModuleDescriptor[];
}

/**
 * The menu's groups, in signal order, each sorted by label, with empty
 * families left out entirely.
 */
export function moduleMenuGroups(
  registry: ReadonlyMap<ModuleTypeId, ModuleDescriptor>,
): ModuleMenuGroup[] {
  const groups: ModuleMenuGroup[] = [];
  for (const family of FAMILY_ORDER) {
    const items = [...registry.values()]
      .filter((descriptor) => descriptor.family === family)
      .sort((a, b) => a.label.localeCompare(b.label));
    if (items.length > 0) groups.push({ family, label: FAMILY_LABELS[family], items });
  }
  return groups;
}

/**
 * The module types no menu group would offer — always empty while the family
 * union and `FAMILY_LABELS` agree, and asserted empty against the real
 * registry in the tests.
 *
 * Kept as a runtime check as well as a type-level one because a descriptor
 * can reach the registry from data (a loaded pack, a future plugin) rather
 * than from a literal the compiler ever saw.
 */
export function unreachableModules(
  registry: ReadonlyMap<ModuleTypeId, ModuleDescriptor>,
): ModuleTypeId[] {
  const offered = new Set<string>(FAMILY_ORDER);
  return [...registry.values()]
    .filter((descriptor) => !offered.has(descriptor.family))
    .map((descriptor) => descriptor.type);
}
