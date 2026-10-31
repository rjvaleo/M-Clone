import { describe, expect, it } from "vitest";
import { CLOUD_KEYS, cloudGeometry, deleteCloud, insideBox, listClouds, moveTo, recallCloud, saveCloud, spreadTo } from "./grainCloud";
import { moduleRegistry } from "../../registry/registry";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
};

describe("The cloud pad, as MultiGrainLive's", () => {
  const W = 200, H = 120, SECONDS = 4;

  it("draws the box at the head, as wide as the spray and as tall as the pitch jitter", () => {
    const geo = cloudGeometry({ position: 0.25, "position-jitter": 400, "pitch-jitter": 8, "pitch-drift": 0, scan: 0 }, SECONDS, W, H);
    expect(geo.head * W).toBe(50);
    // 400 ms of a four-second file across 200 px.
    expect(geo.halfW).toBeCloseTo(20, 9);
    // Eight semitones of an axis reaching ten (8 × 1.25), over the plot's half-height less its margin.
    expect(geo.semis).toBe(10);
    expect(geo.halfH).toBeCloseTo(0.8 * (H / 2 - 8), 9);
  });

  it("starts the sweep at the end going backwards, and carries it by Scan", () => {
    expect(cloudGeometry({ scan: -1 }, SECONDS, W, H).home).toBe(1);
    const geo = cloudGeometry({ scan: 0.5, position: 0.1 }, SECONDS, W, H, 0.4);
    expect(geo.head).toBeCloseTo(0.1 + 0.2, 12);
  });

  it("moves the head from inside the box and spreads it from outside", () => {
    const values = { position: 0.25, "position-jitter": 200, "pitch-jitter": 4, scan: 0 };
    const geo = cloudGeometry(values, SECONDS, W, H);
    expect(insideBox(geo, 52, H / 2 + 3)).toBe(true);
    expect(insideBox(geo, 150, 10)).toBe(false);
    expect(moveTo(geo, 100).position).toBeCloseTo(0.5, 12);
    // Held to the range, as `Math.max(-1, Math.min(1, …))`.
    expect(moveTo(cloudGeometry({ scan: -1, position: 0 }, SECONDS, W, H), -400).position).toBe(-1);
    const spread = spreadTo(geo, 50 + 25, H / 2 - (H / 2 - 8) / 2, SECONDS);
    expect(spread["position-jitter"]).toBeCloseTo(500, 9);
    expect(spread["pitch-jitter"]).toBeCloseTo(geo.semis / 2, 9);
    expect(spreadTo(geo, 199, 0, SECONDS)["position-jitter"]).toBe(500);
  });
});

describe("Cloud presets, as MultiGrainLive's", () => {
  const module = moduleRegistry.get("m.grain-engine")!;
  const defaults = Object.fromEntries(module.parameters.map((p) => [p.id, p.defaultValue]));

  it("hold the grain section and nothing else: not the seed, not the window", () => {
    expect(CLOUD_KEYS).toHaveLength(21);
    for (const key of CLOUD_KEYS) expect(module.parameters.some((p) => p.id === key), key).toBe(true);
    expect(CLOUD_KEYS).not.toContain("seed");
    expect(CLOUD_KEYS).not.toContain("window-ms");
  });

  it("save under a name, list, put back over the defaults and delete", () => {
    const store = memory();
    expect(saveCloud(store, "  ", defaults)).toBeNull();
    expect(saveCloud(store, "Wash", { ...defaults, layers: 8, seed: 99, "window-ms": 400 })).toBe("Wash");
    expect(listClouds(store)).toEqual(["Wash"]);
    const back = recallCloud(store, "Wash", defaults)!;
    expect(back.layers).toBe(8);
    expect(back).not.toHaveProperty("seed");
    expect(back).not.toHaveProperty("window-ms");
    deleteCloud(store, "Wash");
    expect(listClouds(store)).toEqual([]);
    expect(recallCloud(store, "Wash", defaults)).toBeNull();
  });

  it("leave a stored value of the wrong kind at its default", () => {
    const store = memory();
    store.setItem("idmlab.grain-clouds", JSON.stringify({ Odd: { layers: "eight", reverse: true } }));
    const back = recallCloud(store, "Odd", defaults)!;
    expect(back.layers).toBe(1);
    expect(back.reverse).toBe(true);
  });
});
