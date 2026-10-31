import { describe, expect, it } from "vitest";
import { grainFace } from "./grainCabinet";

// Every knob's reading, gathered from the faces of all five engines.
const text = new Map<string, (v: number) => string>();
for (const engine of ["Grains", "Vocoder", "WSOLA", "PVSOLA", "Hybrid"]) {
  for (const control of grainFace({ engine, cloud: true, "preserve-transients": true }).controls) {
    if (control.text && control.page === "all") text.set(control.param, control.text);
  }
}
const reads = (param: string, value: number) => {
  const read = text.get(param);
  if (!read) throw new Error(`${param} has no reading`);
  return read(value);
};

describe("The Grain Engine's knobs read as MultiGrainLive's tray prints them", () => {
  it("prints the time and the grain shape", () => {
    expect(reads("stretch", 12)).toBe("12×");
    expect(reads("stretch", 2.5)).toBe("2.50×");
    expect(reads("stretch", 0.5)).toBe("0.500×");
    expect(reads("window-ms", 99.6)).toBe("100 ms");
    expect(reads("position", 0.125)).toBe("12.5%");
    expect(reads("grain-rate", 0)).toBe("off");
    expect(reads("grain-rate", 20.4)).toBe("20/s");
    expect(reads("density", 0)).toBe("auto");
    expect(reads("density", 8)).toBe("8/s");
    expect(reads("layers", 3)).toBe("3×");
    expect(reads("overlap", 2)).toBe("2.0×");
    expect(reads("size-jitter", 0.25)).toBe("25%");
    expect(reads("position-jitter", 40)).toBe("40 ms");
  });

  it("prints the pitch movement, the scan and the shape", () => {
    expect(reads("pitch-jitter", 1.5)).toBe("±1.5 st");
    expect(reads("pitch-drift", 0.5)).toBe("±0.5 st");
    expect(reads("drift-rate", 0.25)).toBe("0.25 Hz");
    expect(reads("scan", 0)).toBe("frozen");
    expect(reads("scan", -1)).toBe("-1.00×");
    expect(reads("envelope", 0.5)).toBe("symmetric");
    expect(reads("envelope", 0.2)).toBe("percussive");
    expect(reads("envelope", 0.8)).toBe("swelling");
    expect(reads("size-range", 2)).toBe("2.00×");
    expect(reads("layer-spread", 0)).toBe("stacked");
    expect(reads("layer-spread", 1.5)).toBe("1.50×");
    expect(reads("pan-spread", 0)).toBe("centred");
    expect(reads("pan-spread", 0.5)).toBe("50%");
    expect(reads("layer-scatter", 0)).toBe("stacked");
    expect(reads("layer-scatter", 0.3)).toBe("30%");
    expect(reads("layer-scatter-ms", 1500)).toBe("1.50 s");
    expect(reads("layer-scatter-ms", 250)).toBe("250 ms");
  });

  it("prints each engine's own controls", () => {
    expect(reads("cloud-mix", 0.4)).toBe("40%");
    expect(reads("detector", 0.6)).toBe("60%");
    expect(reads("search-ms", 0)).toBe("plain OLA");
    expect(reads("search-ms", 12)).toBe("12.0 ms");
    expect(reads("stride", 2)).toBe("2 fr");
    expect(reads("floor", 0)).toBe("none");
    expect(reads("floor", 1.5)).toBe("1.50×");
    expect(reads("guard", 2)).toBe("2.0 hop");
    expect(reads("analysis-ms", 46.4)).toBe("46 ms");
    expect(reads("freeze", 1)).toBe("held");
    expect(reads("freeze", 0.5)).toBe("50%");
    expect(reads("blur", 0.1)).toBe("10%");
    expect(reads("gate", 0)).toBe("off");
    expect(reads("gate", 0.2)).toBe("20%");
    expect(reads("freq-trust", 0)).toBe("to bins");
    expect(reads("freq-trust", 1)).toBe("1.00×");
    expect(reads("phase-spread", 0.5)).toBe("0.50×");
    expect(reads("peak-width", 3)).toBe("3 bin");
    expect(reads("lock-width", 1)).toBe("1.00×");
    expect(reads("re-anchor", 4)).toBe("4 fr");
    expect(reads("anchor-search-ms", 0)).toBe("no search");
    expect(reads("anchor-search-ms", 5)).toBe("5.0 ms");
    expect(reads("blend", 0)).toBe("butt join");
    expect(reads("blend", 0.75)).toBe("75%");
  });

  it("prints Hybrid's separation, its odd sizes always odd", () => {
    for (const part of ["tone", "hits", "air"]) {
      expect(reads(part, 0)).toBe("out");
      expect(reads(part, 1)).toBe("1.00×");
    }
    expect(reads("hold", 4)).toBe("5 fr");
    expect(reads("spread", 7)).toBe("7 bin");
    expect(reads("margin", 1)).toBe("no air");
    expect(reads("margin", 2)).toBe("2.00×");
    expect(reads("resolution", 2048.4)).toBe("2048");
  });
});
