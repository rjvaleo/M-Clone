import { describe, expect, it } from "vitest";
import {
  buildMenu,
  menuMatches,
  moduleMatches,
  normalizeQuery,
  soleMatch,
  type MenuGroupSpec,
  type MenuModule,
} from "./moduleMenu";
import { moduleRegistry } from "../registry/registry";

/** Declared in pipeline order, exactly as the component holds them. */
const GROUPS: MenuGroupSpec[] = [
  { family: "clock", label: "Clock and transport" },
  { family: "instrument", label: "Instruments" },
  { family: "audio", label: "Audio" },
];

const MODULES: MenuModule[] = [
  { type: "m.transport", label: "Transport Clock", family: "clock" },
  { type: "m.time-base", label: "Time Base", family: "clock" },
  { type: "m.percussion", label: "Percussion", family: "instrument" },
  { type: "m.audio-blackhole", label: "Blackhole", family: "audio" },
  { type: "m.audio-dp4", label: "DP/4+", family: "audio" },
  { type: "m.audio-dp4-nonlin", label: "DP/4 Non Lin", family: "audio" },
  { type: "m.audio-reverb", label: "Reverb", family: "audio" },
];

const build = (query = "") => buildMenu({ modules: MODULES, groups: GROUPS, query });

describe("Normalising what a person types", () => {
  it("ignores case and punctuation, so dp4 finds DP/4+", () => {
    expect(normalizeQuery("DP/4+")).toBe("dp4");
    expect(normalizeQuery("  Non-Lin ")).toBe("nonlin");
    expect(normalizeQuery("")).toBe("");
  });

  it("matches a module by its own name", () => {
    expect(moduleMatches(MODULES[3], "Audio", "black")).toBe(true);
    expect(moduleMatches(MODULES[3], "Audio", "reverb")).toBe(false);
  });

  it("matches a module by the name of the group it is in", () => {
    // Somebody who wants "a reverb" types the category before the product name.
    expect(moduleMatches(MODULES[4], "Audio", "audio")).toBe(true);
    expect(moduleMatches(MODULES[0], "Clock and transport", "transport")).toBe(true);
  });

  it("matches everything when nothing has been typed", () => {
    expect(moduleMatches(MODULES[0], "Clock and transport", "")).toBe(true);
    expect(moduleMatches(MODULES[0], "Clock and transport", "   ")).toBe(true);
  });
});

describe("The open menu", () => {
  it("orders groups by name, not by the order they were declared in", () => {
    // Declared clock → instrument → audio; drawn Audio first because A sorts
    // first. Predictable beats narratively ordered when you are looking for
    // something rather than reading about the system.
    expect(build().map((group) => group.label)).toEqual([
      "Audio",
      "Clock and transport",
      "Instruments",
    ]);
  });

  it("shows every module with nothing collapsed", () => {
    const menu = build();
    expect(menuMatches(menu)).toHaveLength(MODULES.length);
  });

  it("sorts items inside a group by label", () => {
    const audio = build().find((group) => group.family === "audio");
    expect(audio?.items.map((item) => item.label)).toEqual([
      "Blackhole",
      "DP/4 Non Lin",
      "DP/4+",
      "Reverb",
    ]);
  });

  it("puts the audio rack first, which is where the density is", () => {
    expect(build()[0].family).toBe("audio");
    expect(build()[0].items[0].label).toBe("Blackhole");
  });
});

describe("Filtering", () => {
  it("narrows to the matching module", () => {
    const menu = build("blackhole");
    expect(menu).toHaveLength(1);
    expect(menu[0].family).toBe("audio");
    expect(menu[0].items.map((item) => item.label)).toEqual(["Blackhole"]);
  });

  it("finds every DP/4 module from an unpunctuated query", () => {
    expect(menuMatches(build("dp4")).map((item) => item.label))
      .toEqual(["DP/4 Non Lin", "DP/4+"]);
  });

  it("drops a group with no matches rather than drawing an empty heading", () => {
    expect(build("reverb").map((group) => group.family)).toEqual(["audio"]);
  });

  it("returns nothing at all for a query that matches nothing", () => {
    const menu = build("theremin");
    expect(menu).toEqual([]);
    expect(menuMatches(menu)).toEqual([]);
    expect(soleMatch(menu)).toBeNull();
  });

  it("pulls a whole category up by its group name", () => {
    const menu = build("audio");
    expect(menu).toHaveLength(1);
    expect(menu[0].items).toHaveLength(4);
  });

  it("keeps the name ordering while filtered", () => {
    const menu = buildMenu({
      modules: [
        { type: "a", label: "Zeta", family: "instrument" },
        { type: "b", label: "Zebra", family: "audio" },
      ],
      groups: GROUPS,
      query: "ze",
    });
    expect(menu.map((group) => group.label)).toEqual(["Audio", "Instruments"]);
  });
});

describe("Enter on a query", () => {
  it("adds the module when exactly one thing matches", () => {
    expect(soleMatch(build("blackhole"))?.type).toBe("m.audio-blackhole");
  });

  it("refuses to guess between two", () => {
    // Two matches and a keystroke is how the wrong module lands on the canvas.
    expect(soleMatch(build("dp4"))).toBeNull();
  });
});

describe("Against the real registry", () => {
  const REAL_GROUPS: MenuGroupSpec[] = [
    { family: "clock", label: "Clock and transport" },
    { family: "source", label: "Pattern material" },
    { family: "transform", label: "Note transforms" },
    { family: "control", label: "Control and conducting" },
    { family: "routing", label: "Routing and output" },
    { family: "instrument", label: "Instruments" },
    { family: "audio", label: "Audio" },
  ];
  const real = (query = "") =>
    buildMenu({ modules: [...moduleRegistry.values()], groups: REAL_GROUPS, query });

  it("draws Audio first, so the rack is no longer below the fold", () => {
    // The defect this file exists for: Audio was the last of eight groups,
    // a thousand pixels down.
    expect(real()[0].label).toBe("Audio");
  });

  it("orders every real group by name", () => {
    const labels = real().map((group) => group.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  it("finds each reverb the rack actually has", () => {
    for (const [query, type] of [
      ["blackhole", "m.audio-blackhole"],
      ["dp4 reverb", "m.audio-dp4-reverb"],
      ["stereo widener", "m.audio-widener"],
      ["mixer", "m.audio-mixer"],
    ] as const) {
      expect(menuMatches(real(query)).map((item) => item.type), query).toContain(type);
    }
  });

  it("puts every registered module in exactly one drawn group", () => {
    // A module whose family is not in the list would be unreachable by any
    // route, which is the same class of bug in a quieter form.
    const drawn = menuMatches(real()).map((item) => item.type).sort();
    const registered = [...moduleRegistry.values()].map((descriptor) => descriptor.type).sort();
    expect(drawn).toEqual(registered);
  });
});
