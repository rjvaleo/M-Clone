/**
 * The scale sequencer's presets, read into `m.synth`, and its preset morph.
 *
 * ## What a preset becomes
 *
 * The original stores a preset as the raw positions of its sliders and menus.
 * Each slider has a law — the cutoff is `20 · 1000^(x/100)`, an LFO's rate
 * `0.05 · 400^(x/100)` — and `SLIDER_LAWS` restates every one, so a stored
 * position turns into the value the original would have played. The synth
 * parameters a preset does not mention take the original's own defaults
 * (what its page loads with), and the import switches the synth to *classic*
 * with one oscillator at full level, which is the original's structure.
 *
 * ## The LFO 1 fix
 *
 * The shipped `presets.json` was written before the LFOs were numbered: its
 * LFO 1 is stored as `lfoRateSlider`, `lfoDepthSlider` and `lfoWaveSelect`,
 * names the page no longer has, so loading a preset there silently left LFO 1
 * wherever it was. The import reads those keys as LFO 1's. A current key wins
 * if a preset carries both.
 *
 * ## The morph
 *
 * `morphToPreset` moves every slider from where it is to where the preset has
 * it over the morph time, in *slider* space — so a cutoff morphs
 * logarithmically, as the knob would turn — and each frame lands on a whole
 * slider position, because a range input rounds to its step. Menus change at
 * the start. `planMorph` and `morphValuesAt` are that, over parameters.
 */

import type { JsonValue } from "../model/graph";
import {
  DELAY_NOTES,
  LFO_TARGETS,
  LFO_WAVES,
  TAPE_SPEEDS,
} from "./synthLaws";
import { SCALE_SEQUENCER_PRESETS, type ScaleSequencerPresetState } from "./synthPresetLibrary";

export { SCALE_SEQUENCER_PRESETS };

/** One of the original's sliders: its range and the law that reads it. */
export type SliderLaw = {
  slider: string;
  min: number;
  max: number;
  /** The original's slider default, for a preset that does not store it. */
  initial: number;
  toValue: (position: number) => number;
  toSlider: (value: number) => number;
};

const linear = (slider: string, min: number, max: number, initial: number, scale = 1): SliderLaw => ({
  slider, min, max, initial,
  toValue: (position) => position * scale,
  toSlider: (value) => value / scale,
});

const logarithmic = (slider: string, base: number, span: number, initial: number): SliderLaw => ({
  slider, min: 0, max: 100, initial,
  toValue: (position) => base * Math.pow(span, position / 100),
  toSlider: (value) => (100 * Math.log(value / base)) / Math.log(span),
});

/**
 * Every synth parameter the original has a slider for, by parameter id.
 *
 * Ranges and initial positions are the page's `<input type="range">`s; the
 * laws are `updateEnv`, `updateVol`, `updateFilter`, `updateKeyFollow`,
 * `updateFilterADSR`, `updateLFO`, `updatePW` and `updateDelay`. Volume is
 * the original's master, `volume · 0.3`, which is what `volume` means here.
 */
export const SLIDER_LAWS: Readonly<Record<string, SliderLaw>> = {
  tempo: linear("bpmSlider", 40, 240, 120),
  "amp-attack": linear("atkSlider", 1, 500, 10),
  "amp-decay": linear("decSlider", 1, 500, 80),
  "amp-sustain": linear("susSlider", 0, 100, 60, 0.01),
  "amp-release": linear("relSlider", 1, 2000, 200),
  volume: linear("volSlider", 0, 100, 70, 0.003),
  cutoff: logarithmic("cutoffSlider", 20, 1000, 67),
  resonance: {
    slider: "resSlider", min: 0, max: 100, initial: 10,
    toValue: (position) => 0.1 + (position / 100) * 19.9,
    toSlider: (value) => ((value - 0.1) / 19.9) * 100,
  },
  "key-follow": linear("keyFollowSlider", 0, 100, 0, 0.01),
  "filter-attack": linear("fatkSlider", 1, 500, 10),
  "filter-decay": linear("fdecSlider", 1, 500, 150),
  "filter-sustain": linear("fsusSlider", 0, 100, 30, 0.01),
  "filter-release": linear("frelSlider", 1, 2000, 300),
  "filter-env": linear("famtSlider", -100, 100, 50, 0.01),
  "lfo-a-rate": logarithmic("lfo1RateSlider", 0.05, 400, 50),
  "lfo-a-depth": linear("lfo1DepthSlider", 0, 100, 20, 0.01),
  "lfo-b-rate": logarithmic("lfo2RateSlider", 0.05, 400, 40),
  "lfo-b-depth": linear("lfo2DepthSlider", 0, 100, 25, 0.01),
  "lfo-c-rate": logarithmic("lfo3RateSlider", 0.05, 400, 40),
  "lfo-c-depth": linear("lfo3DepthSlider", 0, 100, 0, 0.01),
  "osc1-width": linear("pwSlider", 5, 95, 50, 0.01),
  "delay-feedback": linear("delayFbSlider", 0, 95, 35, 0.01),
  "delay-wet": linear("delayWetSlider", 0, 100, 25, 0.01),
  "delay-spread": linear("delaySpreadSlider", 0, 100, 100, 0.01),
  "delay-hicut": logarithmic("delayHiCutSlider", 200, 100, 75),
};

/** The original's menus, by parameter id, with what its page loads with. */
const MENUS: Readonly<Record<string, { select: string; initial: string }>> = {
  "osc1-wave": { select: "waveSelect", initial: "sine" },
  "lfo-a-wave": { select: "lfo1WaveSelect", initial: "sine" },
  "lfo-a-target": { select: "lfo1TargetSelect", initial: "filter" },
  "lfo-b-wave": { select: "lfo2WaveSelect", initial: "sine" },
  "lfo-b-target": { select: "lfo2TargetSelect", initial: "pw" },
  "lfo-c-wave": { select: "lfo3WaveSelect", initial: "sine" },
  "lfo-c-target": { select: "lfo3TargetSelect", initial: "" },
  "delay-note": { select: "delayTimeSelect", initial: "0.5" },
  tape: { select: "tapeSpeedSelect", initial: "studio75" },
};

/** `presets.json`'s LFO 1, under the names it was saved with. */
const STALE_KEYS: Readonly<Record<string, string>> = {
  lfoRateSlider: "lfo1RateSlider",
  lfoDepthSlider: "lfo1DepthSlider",
  lfoWaveSelect: "lfo1WaveSelect",
  lfoTargetSelect: "lfo1TargetSelect",
};

/** Rename the stale keys, letting a current key win over its stale twin. */
function withCurrentKeys(stored: Readonly<Record<string, string>>): Record<string, string> {
  const renamed: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored)) {
    const current = STALE_KEYS[key];
    if (current === undefined) renamed[key] = value;
    else if (stored[current] === undefined) renamed[current] = value;
  }
  return renamed;
}

/** A menu value as the option the synth's own menu names it by. */
function menuValue(id: string, raw: string): string {
  switch (id) {
    case "delay-note": {
      const beats = Number.parseFloat(raw);
      return (DELAY_NOTES.find((note) => Math.abs(note.beats - beats) < 1e-6) ?? DELAY_NOTES[3]).label;
    }
    case "tape":
      return (TAPE_SPEEDS.find((speed) => speed.key === raw) ?? TAPE_SPEEDS[2]).label;
    case "lfo-a-target":
    case "lfo-b-target":
    case "lfo-c-target":
      return (LFO_TARGETS as readonly string[]).includes(raw) ? raw : "none";
    case "osc1-wave":
      return raw;
    default:
      return (LFO_WAVES as readonly string[]).includes(raw) ? raw : "sine";
  }
}

/**
 * The synth parameters a stored preset plays as.
 *
 * Everything the original's synth has, read through its laws; everything it
 * lacks set so the superset is out of the way — one oscillator at full level,
 * no octave envelope, centred, and the classic shared filter.
 */
export function importScaleSequencerPreset(state: ScaleSequencerPresetState): Record<string, JsonValue> {
  const sliders = withCurrentKeys(state.sliders);
  const selects = withCurrentKeys(state.selects);
  const values: Record<string, JsonValue> = {
    classic: true,
    level: 1,
    "osc1-level": 1,
    "osc1-detune": 0,
    "osc2-level": 0,
    "osc3-level": 0,
    "filter-amount": 0,
    pan: 0,
  };
  for (const [id, law] of Object.entries(SLIDER_LAWS)) {
    const stored = Number.parseFloat(sliders[law.slider] ?? "");
    values[id] = law.toValue(Number.isFinite(stored) ? stored : law.initial);
  }
  for (const [id, menu] of Object.entries(MENUS)) {
    values[id] = menuValue(id, selects[menu.select] ?? menu.initial);
  }
  return values;
}

/** The twenty presets, each read into synth parameters. */
export const SYNTH_PRESET_LIBRARY: readonly { name: string; values: Record<string, JsonValue> }[] =
  SCALE_SEQUENCER_PRESETS.map((preset) => ({ name: preset.name, values: importScaleSequencerPreset(preset.state) }));

/**
 * The parameter a preset load or a morph frame moves to say the original's
 * LFOs were touched.
 *
 * Loading a preset fires every slider's handler and each morph frame fires
 * them again, LFO sliders included, so the original rescales each LFO to the
 * volume and wet of that moment even when its own values do not change — and
 * a volume or wet LFO swings around the level it was last touched at. A
 * document only carries values that changed, so the face says so with this.
 */
export const LFO_TOUCH = "lfo-touch";

/** `values`, plus a touch of the LFOs: one more than `current` had. */
export function touchingLfos(
  values: Readonly<Record<string, JsonValue>>,
  current: Readonly<Record<string, JsonValue | undefined>>,
): Record<string, JsonValue> {
  const last = current[LFO_TOUCH];
  return { ...values, [LFO_TOUCH]: (typeof last === "number" && Number.isFinite(last) ? last : 0) + 1 };
}

/** The original's morph time: 0.5–30 s in half seconds, five by default. */
export const MORPH_TIME = { min: 0.5, max: 30, step: 0.5, initial: 5 } as const;

/** One number moving, and the slider it moves on, if the original had one. */
export type MorphRamp = { id: string; from: number; to: number; law?: SliderLaw };

/** What a morph does at once, and what it moves. */
export type MorphPlan = { immediate: Record<string, JsonValue>; ramps: MorphRamp[] };

/**
 * Split a morph into what changes at once and what glides.
 *
 * A number that has a number to glide from glides; anything else — a menu, a
 * switch, a value the module does not have yet — is set at the start, as the
 * original applies its menus before the first frame.
 */
export function planMorph(
  current: Readonly<Record<string, JsonValue | undefined>>,
  target: Readonly<Record<string, JsonValue>>,
): MorphPlan {
  const immediate: Record<string, JsonValue> = {};
  const ramps: MorphRamp[] = [];
  for (const [id, to] of Object.entries(target)) {
    const from = current[id];
    if (typeof to === "number" && typeof from === "number") {
      ramps.push({ id, from, to, law: SLIDER_LAWS[id] });
    } else {
      immediate[id] = to;
    }
  }
  return { immediate, ramps };
}

/**
 * Every gliding value at `t` (0–1) through the morph.
 *
 * On a slider the position is interpolated and rounded to a whole step, as a
 * range input rounds what it is given — so the original's morph moves in its
 * sliders' steps, and so does this. The last frame lands exactly on the
 * target.
 */
export function morphValuesAt(plan: MorphPlan, t: number): Record<string, number> {
  const progress = Math.max(0, Math.min(1, t));
  const values: Record<string, number> = {};
  for (const ramp of plan.ramps) {
    if (progress >= 1) {
      values[ramp.id] = ramp.to;
    } else if (ramp.law) {
      const from = ramp.law.toSlider(ramp.from);
      const position = from + (ramp.law.toSlider(ramp.to) - from) * progress;
      values[ramp.id] = ramp.law.toValue(Math.round(position - ramp.law.min) + ramp.law.min);
    } else {
      values[ramp.id] = ramp.from + (ramp.to - ramp.from) * progress;
    }
  }
  return values;
}
