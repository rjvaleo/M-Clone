import { describe, expect, it } from "vitest";
import {
  MORPH_TIME,
  SCALE_SEQUENCER_PRESETS,
  SLIDER_LAWS,
  SYNTH_PRESET_LIBRARY,
  importScaleSequencerPreset,
  morphValuesAt,
  planMorph,
  touchingLfos,
  LFO_TOUCH,
} from "./synthPresets";
import { PLAYER_MODULES } from "../registry/playerModules";

const byName = (prefix: string) => SCALE_SEQUENCER_PRESETS.find((preset) => preset.name.startsWith(prefix))!;

describe("The scale sequencer's presets", () => {
  it("are all twenty of them", () => {
    expect(SCALE_SEQUENCER_PRESETS).toHaveLength(20);
    expect(SYNTH_PRESET_LIBRARY).toHaveLength(20);
    expect(SYNTH_PRESET_LIBRARY[0].name).toBe("Granfalloon Aria · 2026-04-04 16:02");
  });

  it("are stored with LFO 1 under the stale names, which is the bug being fixed", () => {
    for (const preset of SCALE_SEQUENCER_PRESETS) {
      expect(preset.state.sliders.lfoRateSlider, preset.name).toBeDefined();
      expect(preset.state.sliders.lfo1RateSlider, preset.name).toBeUndefined();
    }
  });
});

describe("Reading a preset into the synth", () => {
  it("brings LFO 1 back from the stale keys", () => {
    // Lamentable Elegy: lfoRateSlider 47, lfoDepthSlider 100, a triangle. The
    // original dropped all three and left LFO 1 at its page default.
    const values = importScaleSequencerPreset(byName("Lamentable Elegy").state);
    expect(values["lfo-a-rate"]).toBeCloseTo(0.05 * Math.pow(400, 0.47), 12);
    expect(values["lfo-a-depth"]).toBe(1);
    expect(values["lfo-a-wave"]).toBe("triangle");
    expect(values["lfo-a-rate"]).not.toBeCloseTo(1, 3);
  });

  it("lets a current LFO 1 key win over a stale one", () => {
    const values = importScaleSequencerPreset({
      sliders: { lfoRateSlider: "10", lfo1RateSlider: "90" },
      selects: { lfoWaveSelect: "triangle", lfo1WaveSelect: "sawtooth", lfoTargetSelect: "volume" },
    });
    expect(values["lfo-a-rate"]).toBeCloseTo(0.05 * Math.pow(400, 0.9), 12);
    expect(values["lfo-a-wave"]).toBe("sawtooth");
    expect(values["lfo-a-target"]).toBe("volume");
  });

  it("reads every slider through the original's law", () => {
    const values = importScaleSequencerPreset(byName("Granfalloon Aria").state);
    expect(values.tempo).toBe(143);
    expect(values.cutoff).toBeCloseTo(20 * Math.pow(1000, 0.53), 9);
    expect(values.resonance).toBeCloseTo(0.1, 12);
    expect(values["key-follow"]).toBe(1);
    expect(values.volume).toBeCloseTo(0.7 * 0.3, 12);
    expect(values["amp-attack"]).toBe(10);
    expect(values["amp-sustain"]).toBeCloseTo(0.6, 12);
    expect(values["filter-env"]).toBeCloseTo(0.5, 12);
    expect(values["osc1-width"]).toBeCloseTo(0.12, 12);
    expect(values["lfo-b-rate"]).toBeCloseTo(0.05 * Math.pow(400, 0.22), 12);
    expect(values["lfo-b-depth"]).toBeCloseTo(0.93, 12);
    expect(values["delay-feedback"]).toBeCloseTo(0.5, 12);
    expect(values["delay-wet"]).toBeCloseTo(0.45, 12);
    expect(values["delay-hicut"]).toBeCloseTo(200 * Math.pow(100, 0.75), 9);
    expect(values["osc1-wave"]).toBe("pulse");
    expect(values["delay-note"]).toBe("1/4");
  });

  it("fills what a preset never stored with what the original's page loads with", () => {
    const values = importScaleSequencerPreset({ sliders: {}, selects: {} });
    expect(values["lfo-a-target"]).toBe("filter");
    expect(values["lfo-b-target"]).toBe("pw");
    expect(values["lfo-c-target"]).toBe("none");
    expect(values["lfo-c-rate"]).toBeCloseTo(0.05 * Math.pow(400, 0.4), 12);
    expect(values["lfo-c-depth"]).toBe(0);
    expect(values.tape).toBe("7.5 IPS");
    expect(values["delay-note"]).toBe("1/8");
    expect(values.cutoff).toBeCloseTo(20 * Math.pow(1000, 0.67), 9);
    expect(values.resonance).toBeCloseTo(0.1 + 0.1 * 19.9, 12);
  });

  it("reads a menu value it does not know as the nearest sensible one", () => {
    const values = importScaleSequencerPreset({
      sliders: {},
      selects: { delayTimeSelect: "7", tapeSpeedSelect: "wire", lfo2TargetSelect: "pitch", lfo3WaveSelect: "square" },
    });
    expect(values["delay-note"]).toBe("1/8");
    expect(values.tape).toBe("7.5 IPS");
    expect(values["lfo-b-target"]).toBe("none");
    expect(values["lfo-c-wave"]).toBe("sine");
    const known = importScaleSequencerPreset({ sliders: {}, selects: { tapeSpeedSelect: "cassette", lfo3TargetSelect: "delay-wet" } });
    expect(known.tape).toBe("1⅞ IPS");
    expect(known["lfo-c-target"]).toBe("delay-wet");
  });

  it("switches the synth to the original's structure: classic, one oscillator at full level", () => {
    const values = importScaleSequencerPreset(byName("Peculiar Drift").state);
    expect(values.classic).toBe(true);
    expect(values.level).toBe(1);
    expect(values["osc1-level"]).toBe(1);
    expect(values["osc2-level"]).toBe(0);
    expect(values["osc3-level"]).toBe(0);
    expect(values["filter-amount"]).toBe(0);
  });

  it("produces only values the synth's own parameters accept", () => {
    const synth = PLAYER_MODULES.find((descriptor) => descriptor.type === "m.synth")!;
    const parameters = new Map(synth.parameters.map((parameter) => [parameter.id, parameter]));
    for (const preset of SYNTH_PRESET_LIBRARY) {
      for (const [id, value] of Object.entries(preset.values)) {
        const parameter = parameters.get(id);
        expect(parameter, `${preset.name}: ${id}`).toBeDefined();
        if (parameter!.kind === "number") {
          expect(value as number, `${preset.name}: ${id}`).toBeGreaterThanOrEqual(parameter!.minimum!);
          expect(value as number, `${preset.name}: ${id}`).toBeLessThanOrEqual(parameter!.maximum!);
        } else if (parameter!.kind === "enum") {
          expect(parameter!.options, `${preset.name}: ${id}`).toContain(value);
        } else {
          expect(typeof value, `${preset.name}: ${id}`).toBe("boolean");
        }
      }
    }
  });
});

describe("The preset morph", () => {
  it("glides the numbers and sets everything else at once", () => {
    const plan = planMorph(
      { cutoff: 500, "osc2-level": 0.2, "lfo-a-wave": "sine" },
      { cutoff: 2000, "osc2-level": 0.6, "lfo-a-wave": "triangle", classic: true, tempo: 120 },
    );
    expect(plan.immediate).toEqual({ "lfo-a-wave": "triangle", classic: true, tempo: 120 });
    expect(plan.ramps.map((ramp) => ramp.id)).toEqual(["cutoff", "osc2-level"]);
    expect(plan.ramps[0].law).toBe(SLIDER_LAWS.cutoff);
    expect(plan.ramps[1].law).toBeUndefined();
  });

  it("moves a slider in its own space, so a cutoff morphs logarithmically", () => {
    const law = SLIDER_LAWS.cutoff;
    const plan = planMorph({ cutoff: law.toValue(20) }, { cutoff: law.toValue(80) });
    expect(morphValuesAt(plan, 0.5).cutoff).toBeCloseTo(20 * Math.pow(1000, 0.5), 9);
    expect(morphValuesAt(plan, 0).cutoff).toBeCloseTo(law.toValue(20), 9);
  });

  it("lands each frame on a whole slider step, rounding ties up as a range input does", () => {
    const attack = planMorph({ "amp-attack": 10 }, { "amp-attack": 15 });
    expect(morphValuesAt(attack, 0.5)["amp-attack"]).toBe(13);
    expect(morphValuesAt(attack, 0.3)["amp-attack"]).toBe(12);
    const amount = planMorph({ "filter-env": -0.1 }, { "filter-env": -0.15 });
    expect(morphValuesAt(amount, 0.5)["filter-env"]).toBeCloseTo(-0.12, 12);
  });

  it("reads resonance on its own linear slider, 0.1 to 20", () => {
    const plan = planMorph({ resonance: 0.1 }, { resonance: 20 });
    expect(morphValuesAt(plan, 0.5).resonance).toBeCloseTo(0.1 + 0.5 * 19.9, 12);
    expect(SLIDER_LAWS.resonance.toSlider(2.09)).toBeCloseTo(10, 12);
  });

  it("moves a number the original had no slider for in a straight line", () => {
    const plan = planMorph({ "osc2-level": 0.2 }, { "osc2-level": 0.6 });
    expect(morphValuesAt(plan, 0.25)["osc2-level"]).toBeCloseTo(0.3, 12);
  });

  it("ends exactly on the preset, whatever the steps", () => {
    const plan = planMorph({ cutoff: 777, "osc2-level": 0.2 }, { cutoff: 1234.5, "osc2-level": 0.6 });
    expect(morphValuesAt(plan, 1)).toEqual({ cutoff: 1234.5, "osc2-level": 0.6 });
    expect(morphValuesAt(plan, 7)).toEqual({ cutoff: 1234.5, "osc2-level": 0.6 });
    expect(morphValuesAt(plan, -1).cutoff).toBeCloseTo(SLIDER_LAWS.cutoff.toValue(Math.round(SLIDER_LAWS.cutoff.toSlider(777))), 9);
  });

  it("takes the original's morph time", () => {
    expect(MORPH_TIME).toEqual({ min: 0.5, max: 30, step: 0.5, initial: 5 });
  });
});

describe("Touching the LFOs", () => {
  it("counts each preset load and morph frame, as the original fires its LFO sliders' handlers", () => {
    expect(LFO_TOUCH).toBe("lfo-touch");
    expect(touchingLfos({ cutoff: 500 }, {})).toEqual({ cutoff: 500, "lfo-touch": 1 });
    expect(touchingLfos({}, { "lfo-touch": 4 })).toEqual({ "lfo-touch": 5 });
    expect(touchingLfos({}, { "lfo-touch": "x" as never })).toEqual({ "lfo-touch": 1 });
  });
});
