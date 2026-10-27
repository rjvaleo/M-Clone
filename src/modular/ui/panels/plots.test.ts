import { describe, expect, it } from "vitest";
import { moduleRegistry } from "../../registry/registry";
import { gateSteady, musicalResponse, pnRms } from "./curves";
import { DISPLAY_RATE, PLOT_KINDS, hz, kernelValues, place, plotFor, secs, type Plot } from "./plots";

const ctx = { rate: DISPLAY_RATE };

/** A module's defaults as its kernel reads them, with some values changed. */
function values(type: string, changes: Record<string, number> = {}) {
  const module = moduleRegistry.get(`m.prism-${type}`);
  if (!module) throw new Error(type);
  return { ...kernelValues(module.parameters, {}), ...changes };
}

/** Which module each display is drawn for. */
const DRAWN_FOR: Record<string, string> = {
  "notch-response": "dattorro-notch", "resonator-response": "dattorro-resonator", "regalia-response": "regalia",
  "damping-response": "damping-filter", "chamberlin-response": "chamberlin", "eq-response": "eq",
  "pn-spectrum": "pn-noise", "pn-eq-spectrum": "pn-noise-eq", "pn-bit-spectrum": "single-bit-pn",
  "phaser-response": "phaser", "gate-curve": "gate", "fit-curve": "fit", "maximizer-curve": "maximizer",
  "spectral-curve": "spectral-dynamics", "spectral-bands": "spectral-dynamics", "quantizer": "decimator",
  "field-invert": "invert", "field-swap": "swap", "field-width": "width", "field-utility": "utility", "field-matrix": "stereo-matrix",
  "dc-response": "dc", "gain-factor": "gain", "ring-sweep": "ring", "rappify-response": "rappify", "boomerang-read": "boomerang",
  "schroeder-tail": "schroeder-reverb", "moorer-tail": "moorer-reverb", "mod-sweep": "white-chorus", "doubler-sweep": "doubler",
  "rotor": "leslie", "pitch-taps": "harmonizer", "detune-taps": "detune", "doppler-path": "doppler", "trem-cycle": "tremolo",
  "echo-train": "echo", "allpass-train": "allpass-diffuser", "tap-train": "multi-delay", "impulse-window": "convolution",
};

const plot = (kind: string, changes: Record<string, number> = {}, more: Partial<typeof ctx & { sound: { name: string; durationSec: number } }> = {}) =>
  plotFor(kind, values(DRAWN_FOR[kind], changes), { ...ctx, ...more }) as Plot;

describe("A module's values as its kernel reads them", () => {
  it("turns a choice into its index and a switch into 0 or 1, and fills in the defaults", () => {
    const module = moduleRegistry.get("m.prism-tremolo");
    const v = kernelValues(module?.parameters ?? [], { shape: "Square", rateHz: 2, mute: true, depth: Number.NaN });
    expect(v).toMatchObject({ shape: 2, rateHz: 2, mute: 1, depth: 0.5, stereo: 0 });
    expect(kernelValues(module?.parameters ?? [], { shape: "Nope" }).shape).toBe(0);
    // A sound is no number: it is left out.
    expect(Object.keys(kernelValues(moduleRegistry.get("m.prism-convolution")?.parameters ?? [], {}))).not.toContain("asset-id");
  });
});

describe("Every display", () => {
  it("draws for its module's defaults: axes the right way round, numbers or breaks, and its two lines", () => {
    for (const kind of PLOT_KINDS) {
      const drawn = plot(kind);
      expect(drawn, kind).toBeDefined();
      expect(drawn.top.length, kind).toBeGreaterThan(0);
      for (const pane of drawn.panes) {
        expect(pane.x.max, kind).toBeGreaterThan(pane.x.min);
        expect(pane.y.max, kind).toBeGreaterThan(pane.y.min);
        for (const trace of pane.traces) for (const [x, y] of trace.points) {
          expect(Number.isFinite(x), kind).toBe(true);
          expect(Number.isFinite(y) || Number.isNaN(y) || y === -Infinity, kind).toBe(true);
        }
      }
    }
  });

  it("is listed for every display this file knows, and nothing for one it does not", () => {
    expect([...PLOT_KINDS].sort()).toEqual(Object.keys(DRAWN_FOR).sort());
    expect(plotFor("nope", {}, ctx)).toBeUndefined();
  });
});

describe("What the displays say", () => {
  it("draws the filters' own responses and marks their centres", () => {
    const notch = plot("notch-response");
    const [f, db] = notch.panes[0].traces[0].points[100];
    expect(db).toBeCloseTo(musicalResponse("notch", { frequency: 1000, bandwidth: 200, gainDb: 0, mix: 1 }, f, DISPLAY_RATE), 9);
    expect(notch.panes[0].rules).toEqual([{ tone: "b", x: 1000 }]);
    expect(plot("regalia-response").top).toContain("+6.0 DB");
  });

  it("names the Chamberlin's stages, and says so when none is on", () => {
    expect(plot("chamberlin-response").top).toBe("LOW · DRIVE ×1.00");
    expect(plot("chamberlin-response", { lowOn: 0 }).top).toBe("ALL OFF · SILENT");
  });

  it("dots each EQ node that is on", () => {
    expect(plot("eq-response").panes[0].dots?.map((d) => d.label)).toEqual(["1", "2", "3", "7"]);
  });

  it("gives the noise's steps, period and level", () => {
    const noise = plot("pn-spectrum");
    expect(noise.top).toBe("48000 STEPS/S · REPEATS EVERY 5.8 MIN");
    expect(noise.bottom).toContain(`${(20 * Math.log10(pnRms("multibit") * 0.1 * 0.25)).toFixed(1)} DBFS RMS`);
    expect(plot("pn-bit-spectrum", { level: 0 }).bottom).toContain("SILENT");
  });

  it("draws a gate's held curve with its threshold", () => {
    const gate = plot("gate-curve");
    const [l, out] = gate.panes[0].traces[1].points[300];
    expect(out).toBe(gateSteady({ thresholdDb: -40, depth: 1 }, l));
    expect(gate.panes[0].rules).toEqual([{ tone: "b", x: -40 }]);
  });

  it("says where the Maximizer's threshold sits", () => {
    expect(plot("maximizer-curve").bottom).toContain("FOLLOWS LEVEL");
    expect(plot("maximizer-curve", { autoComp: 0 }).bottom).toContain("−12.0 DB");
  });

  it("says what a spectral band's level is measured from", () => {
    expect(plot("spectral-curve").bottom).toContain("FULL SCALE");
    expect(plot("spectral-curve", { relativeToPeak: 1 }).bottom).toContain("FRAME PEAK");
    expect(plot("spectral-curve", { useSound: 1, affect: 1, smoothed: 1 }).bottom).toContain("THRESHOLD SOUND");
    expect(plot("spectral-bands").top).toBe("BINS 0–512 OF 513 · 46.9 HZ EACH");
    expect(plot("spectral-bands", { thirdOctave: 1 }).bottom).toContain("THIRD-OCTAVE");
  });

  it("counts the decimator's levels", () => {
    expect(plot("quantizer").top).toBe("24 BITS · UNTOUCHED");
    expect(plot("quantizer", { bits: 1 }).top).toBe("1 BIT · 2 LEVELS");
    expect(plot("quantizer", { bits: 4, rate: 10 }).bottom).toBe("HELD AT 4.80 KHZ");
  });

  it("moves each stereo input to where the matrix puts it", () => {
    const swap = plot("field-swap").panes[0];
    // Hard left lands hard right: side +½ becomes −½.
    expect(swap.dots?.find((d) => d.label === "L")).toMatchObject({ x: -0.5, y: 0.5 });
    expect(plot("field-swap").top).toBe("L' = 0.00·L + 1.00·R");
    expect(plot("field-invert").bottom).toBe("R' = 0.00·L − 1.00·R");
    expect(plot("field-matrix").panes).toHaveLength(2);
    // A loud utility widens the axes to hold its points.
    expect(plot("field-utility", { gainDb: 24 }).panes[0].x.max).toBeGreaterThan(16);
    expect(plot("field-utility", { gainDb: 12 }).panes[0].x.max).toBe(6);
    expect(plot("field-width", { width: 2 }).panes[0].x.max).toBe(3);
    // A goniometer draws to one scale, and prints whole numbers only.
    expect(swap.square).toBe(true);
    expect(swap.x.ticks.map((t) => t.label)).toEqual(["", "-1", "", "0", "", "1", ""]);
  });

  it("says the gain as a factor", () => {
    expect(plot("gain-factor", { db: 6 }).top).toBe("× 1.995");
    expect(plot("gain-factor").bottom).toBe("0.0 DB");
  });

  it("follows the ring modulator's sweep, or says there is none", () => {
    expect(plot("ring-sweep").top).toBe("220 HZ · NO SWEEP");
    expect(plot("ring-sweep").bottom).toBe("MIX 100%");
    expect(plot("ring-sweep", { sweep: 2000 }).top).toBe("220 HZ · +2000 HZ/S");
    expect(plot("ring-sweep", { sweep: 2000 }).bottom).toMatch(/^AGAIN EVERY 10\.\d+ S$/);
    expect(plot("ring-sweep", { sweep: -2000 }).top).toBe("220 HZ · −2000 HZ/S");
  });

  it("gives Rappify's swing and Boomerang's passes", () => {
    expect(plot("rappify-response").top).toBe("174 HZ – 919 HZ");
    expect(plot("boomerang-read").top).toBe("THROW 400 MS");
    expect(plot("boomerang-read").bottom).toBe("PASS 200 MS · MIX 50%");
  });

  it("gives the reverbs' RT60, and a frozen tank none", () => {
    expect(plot("schroeder-tail").top).toMatch(/^RT60 \d/);
    expect(plot("moorer-tail", { freeze: 1 }).top).toBe("RT60 ∞ · FROZEN · PRE 0.0 MS");
    expect(plot("moorer-tail").panes[0].traces).toHaveLength(12);
    const silent = plot("schroeder-tail", { decay: 0 }).panes[0].traces[0].points;
    expect(silent.filter(([, y]) => y === -Infinity).length).toBeGreaterThan(0);
  });

  it("gives the swept delays' pitch", () => {
    expect(plot("mod-sweep").top).toMatch(/^PITCH \+\d/);
    expect(plot("doubler-sweep").bottom).toContain("2 CYCLES");
    expect(plot("rotor").top).toMatch(/^TURN 833 MS · \+/);
  });

  it("gives the pitch shifters' ratio and sweep", () => {
    expect(plot("pitch-taps").top).toBe("×1.498 · SWEEP 120 MS");
    expect(plot("pitch-taps", { semitones: 0 }).top).toBe("×1.000 · SWEEP ∞");
    expect(plot("detune-taps").panes).toHaveLength(2);
    // A tap's sawtooth breaks where it jumps.
    const taps = plot("pitch-taps").panes[0].traces[0].points;
    expect(taps.some(([, y]) => Number.isNaN(y))).toBe(true);
  });

  it("says how the Doppler's source moves", () => {
    expect(plot("doppler-path").top).toBe("PITCH 0.0 CENTS · STILL");
    expect(plot("doppler-path", { velocityMps: 34.3 }).top).toMatch(/^PITCH −182\.4 CENTS · STOPS 19\.\d+ S$/);
    expect(plot("doppler-path", { velocityMps: 150, speedMps: 150 }).top).toMatch(/^PITCH STANDS STILL/);
    expect(plot("doppler-path", { velocityMps: 150, speedMps: 20 }).top).toMatch(/^PITCH PLAYS BACKWARDS/);
    expect(plot("doppler-path", { velocityMps: -150, speedMps: 20 }).top).toMatch(/^PITCH \+3705\.0 CENTS · STOPS/);
  });

  it("names the tremolo's shape", () => {
    expect(plot("trem-cycle", { shape: 2 }).top).toBe("SQUARE · 4.00 HZ · DEPTH 50%");
  });

  it("draws the echoes, below the line when the feedback is negative", () => {
    expect(plot("echo-train").panes[0].y.min).toBe(0);
    expect(plot("echo-train", { feedback: -0.5 }).panes[0].y.min).toBe(-1);
    expect(plot("allpass-train").panes[0].stems?.[0]).toEqual({ tone: "a", x: 0, y: -0.625 });
    expect(plot("tap-train").panes.map((p) => p.title)).toEqual(["LEFT", "RIGHT"]);
  });

  it("draws the convolution's window over the impulse used", () => {
    // With no impulse, the length asked for.
    expect(plot("impulse-window").top).toBe("NO IMPULSE · 100 MS ASKED");
    expect(plot("impulse-window").panes[0].x.max).toBeCloseTo(0.1, 12);
    const sounded = plot("impulse-window", { brighten: 1, ringModulate: 1, window: 4 }, { sound: { name: "Room", durationSec: 2 } });
    expect(sounded.top).toBe("ROOM · 100 MS OF 2.00 S");
    expect(sounded.bottom).toBe("SINC · +6 DB/OCT · RING MOD");
    expect(sounded.panes[0].y.min).toBe(-0.5);
  });
});

describe("The displays' numbers and scales", () => {
  it("prints hertz and seconds at a sensible size", () => {
    expect([hz(5), hz(50), hz(500), hz(5000), hz(15000)]).toEqual(["5.00 HZ", "50.0 HZ", "500 HZ", "5.00 KHZ", "15.0 KHZ"]);
    expect([secs(0.0042), secs(0.042), secs(4.2), secs(420), secs(Infinity)]).toEqual(["4.2 MS", "42 MS", "4.20 S", "7.0 MIN", "∞"]);
  });

  it("places a value along a log or a linear axis, held to its ends", () => {
    expect(place({ min: 20, max: 20000, log: true, ticks: [] }, 632.4555)).toBeCloseTo(0.5, 5);
    expect(place({ min: -1, max: 1, ticks: [] }, 0)).toBe(0.5);
    expect(place({ min: -1, max: 1, ticks: [] }, -Infinity)).toBe(0);
    expect(place({ min: -1, max: 1, ticks: [] }, 5)).toBe(1);
  });

  it("finds a time scale for a very long span", () => {
    expect(plot("mod-sweep", { rateHz: 0.001 }).panes[0].x.ticks[1].label).toBe("500s");
    expect(plot("mod-sweep", { rateHz: 0.55 }).panes[0].x.ticks.map((t) => t.label)).toEqual(["0", "1s", "2s", "3s"]);
    expect(plot("allpass-train").panes[0].x.ticks.map((t) => t.label)).toEqual(["0", "50ms", "100ms", "150ms", "200ms"]);
    expect(plot("trem-cycle", { rateHz: 4 }).panes[0].x.ticks[4].label).toBe("250ms");
  });
});
