import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The host's half of Theme Studio: the studio persists nothing, so this module
 * is the only thing standing between a hand-made palette and losing it on
 * reload. Every path here is a way that can go wrong on a real machine — a
 * quota-full store, a half-written entry, private browsing with no store at all
 * — and none of them may cost the user the edit they just made.
 */

type FakeStore = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  written: Record<string, string>;
};

const fakeStorage = (seed?: string, onWrite?: () => void): FakeStore => {
  const written: Record<string, string> = {};
  return {
    written,
    getItem: () => seed ?? null,
    setItem: (key, value) => {
      onWrite?.();
      written[key] = value;
    },
  };
};

/** Import the module fresh, since it reads storage once at load. */
const freshImport = async (storage?: FakeStore) => {
  vi.resetModules();
  if (storage) {
    Object.defineProperty(globalThis, "localStorage", {
      value: storage, configurable: true, writable: true,
    });
  } else {
    Reflect.deleteProperty(globalThis as object, "localStorage");
  }
  const store = await import("./customPalettes");
  const themes = await import("./themes");
  return { ...store, ...themes };
};

afterEach(() => {
  Reflect.deleteProperty(globalThis as object, "localStorage");
  vi.resetModules();
});

describe("Loading saved palettes", () => {
  it("starts empty where there is no store at all", async () => {
    const { useCustomPalettes } = await freshImport();
    expect(useCustomPalettes.getState().palettes).toEqual([]);
  });

  it("reads what was saved and makes each one a real theme", async () => {
    const saved = JSON.stringify([
      { id: "mine", name: "Mine", colors: ["#101010", "#ff8800", "#22aacc"] },
    ]);
    const { useCustomPalettes, allThemes } = await freshImport(fakeStorage(saved));
    expect(useCustomPalettes.getState().palettes).toHaveLength(1);
    expect(allThemes().some((theme) => theme.id.includes("mine"))).toBe(true);
  });

  it("drops entries that are not palettes rather than failing to start", async () => {
    const saved = JSON.stringify([
      { id: "good", name: "Good", colors: ["#000000", "#ffffff"] },
      null,
      "a string",
      { name: "no id", colors: [] },
      { id: "no colors" },
    ]);
    const { useCustomPalettes } = await freshImport(fakeStorage(saved));
    expect(useCustomPalettes.getState().palettes.map((palette) => palette.id)).toEqual(["good"]);
  });

  it("starts empty on unreadable or unexpected stored data", async () => {
    expect((await freshImport(fakeStorage("{not json"))).useCustomPalettes.getState().palettes)
      .toEqual([]);
    expect((await freshImport(fakeStorage('{"palettes":[]}'))).useCustomPalettes.getState().palettes)
      .toEqual([]);
  });
});

describe("Saving palettes", () => {
  const palette = (id: string, readOnly = false) => ({
    id, name: id, colors: ["#000000", "#ffffff"], readOnly,
  });

  it("writes the edit and publishes it as a theme", async () => {
    const storage = fakeStorage();
    const { useCustomPalettes, allThemes } = await freshImport(storage);
    useCustomPalettes.getState().setPalettes([palette("dusk")]);

    expect(useCustomPalettes.getState().palettes.map((item) => item.id)).toEqual(["dusk"]);
    expect(storage.written["m.modular.custom-palettes.v1"]).toContain("dusk");
    expect(allThemes().some((theme) => theme.id.includes("dusk"))).toBe(true);
  });

  it("never saves a palette the host only lent it", async () => {
    const storage = fakeStorage();
    const { useCustomPalettes } = await freshImport(storage);
    useCustomPalettes.getState().setPalettes([palette("mine"), palette("shipped", true)]);

    expect(useCustomPalettes.getState().palettes.map((item) => item.id)).toEqual(["mine"]);
    expect(storage.written["m.modular.custom-palettes.v1"]).not.toContain("shipped");
  });

  it("keeps the edit when the store refuses to take it", async () => {
    // Quota exceeded, or private browsing. Losing the palette the user just
    // made because the disk is full is the wrong trade.
    const storage = fakeStorage(undefined, () => { throw new Error("QuotaExceeded"); });
    const { useCustomPalettes } = await freshImport(storage);
    expect(() => useCustomPalettes.getState().setPalettes([palette("dusk")])).not.toThrow();
    expect(useCustomPalettes.getState().palettes.map((item) => item.id)).toEqual(["dusk"]);
  });
});
