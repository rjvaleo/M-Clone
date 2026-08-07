// What the Add-module menu shows, given a query.
//
// The menu had sixty-three entries in eight groups laid out in pipeline order —
// clock, then material, then transforms, and so on down to Instruments and
// Audio last. That reads well as a description of the system and badly as a
// list you have to find something in: 1,643px of content in a 609px window put
// every audio module a thousand pixels below the fold, behind a scrollbar
// nobody had a reason to look for.
//
// Two things fix it, and neither is an accordion:
//
//   - **Groups are ordered by name.** Alphabetical is arbitrary and therefore
//     predictable, which is what a lookup wants; pipeline order is a story, and
//     a story is only useful the first time you read it. It also happens to put
//     Audio first, which is where the density is.
//   - **Everything is open.** One flat list, scanned or scrolled. A collapsed
//     group hides its contents behind a click and a guess about which heading
//     they are under, and that is the same discoverability problem in a
//     tidier-looking form.
//
// The query field stays, because scanning is the slow path once you know what
// you want.
//
// This file is the whole decision procedure, kept out of the component on the
// project's standing rule — the React faces have no automated coverage, so
// anything that can be a plain function is one, and is tested.

/** The shape the menu needs from a module descriptor. Deliberately minimal. */
export type MenuModule = {
  type: string;
  label: string;
  family: string;
};

export type MenuGroupSpec = {
  family: string;
  label: string;
};

export type MenuGroup = {
  family: string;
  label: string;
  items: MenuModule[];
};

/**
 * Case- and separator-insensitive matching.
 *
 * Module labels carry punctuation a person will not reliably type — `DP/4+`,
 * `DP/4 Non Lin` — so "dp4" has to find them. Stripping everything that is not
 * alphanumeric from both sides costs nothing and removes a whole class of
 * "I searched and it wasn't there".
 */
export const normalizeQuery = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Whether one module answers a query. Matches the group name too. */
export const moduleMatches = (
  module: MenuModule,
  groupLabel: string,
  query: string,
): boolean => {
  const needle = normalizeQuery(query);
  if (needle === "") return true;
  // The group name is searchable so "audio" finds the rack, which is what
  // somebody who does not know a module's name will type first.
  return (
    normalizeQuery(module.label).includes(needle)
    || normalizeQuery(groupLabel).includes(needle)
  );
};

export type BuildMenuOptions = {
  modules: readonly MenuModule[];
  groups: readonly MenuGroupSpec[];
  query: string;
};

/**
 * The groups to draw, ordered by name, each with its items ordered by name.
 *
 * A group with nothing in it is dropped rather than drawn empty: while a query
 * is running, an empty heading is noise that pushes the real answer down.
 */
export function buildMenu(options: BuildMenuOptions): MenuGroup[] {
  const { modules, groups, query } = options;

  return groups
    .map((group) => ({
      family: group.family,
      label: group.label,
      items: modules
        .filter((module) => module.family === group.family)
        .filter((module) => moduleMatches(module, group.label, query))
        .sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .filter((group) => group.items.length > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Every module the menu would show, flattened — for Enter-to-add. */
export const menuMatches = (groups: readonly MenuGroup[]): MenuModule[] =>
  groups.flatMap((group) => group.items);

/**
 * The one module a query unambiguously means, or null.
 *
 * Enter adds it. Only when exactly one thing matches: guessing between two is
 * how a keystroke puts the wrong module on the canvas, and the canvas is a
 * document the user then has to undo.
 */
export const soleMatch = (groups: readonly MenuGroup[]): MenuModule | null => {
  const all = menuMatches(groups);
  return all.length === 1 ? all[0] : null;
};
