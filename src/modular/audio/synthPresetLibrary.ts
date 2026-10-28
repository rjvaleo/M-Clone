/**
 * The scale sequencer's twenty presets, as its `presets.json` ships them.
 *
 * Only the parts a synth reads are kept: each preset's name, its sliders and
 * its menus, exactly as stored (strings, slider positions). The step grid and
 * the scale belong to the sequencer, not the instrument. The keys are the
 * original's own, stale LFO 1 names included — `importScaleSequencerPreset`
 * reads both, which is the fix for LFO 1 going missing on load.
 */

export type ScaleSequencerPresetState = {
  sliders: Readonly<Record<string, string>>;
  selects: Readonly<Record<string, string>>;
};

export type ScaleSequencerPreset = { name: string; state: ScaleSequencerPresetState };

export const SCALE_SEQUENCER_PRESETS: readonly ScaleSequencerPreset[] = [
  {
    name: "Granfalloon Aria · 2026-04-04 16:02",
    state: {
      sliders: { "bpmSlider": "143", "stepsSlider": "12", "atkSlider": "10", "decSlider": "80", "susSlider": "60", "relSlider": "200", "volSlider": "70", "cutoffSlider": "53", "resSlider": "0", "keyFollowSlider": "100", "fatkSlider": "10", "fdecSlider": "150", "fsusSlider": "30", "frelSlider": "300", "famtSlider": "50", "lfoRateSlider": "6", "lfoDepthSlider": "0", "pwSlider": "12", "lfo2RateSlider": "22", "lfo2DepthSlider": "93", "delayFbSlider": "50", "delayWetSlider": "45", "delaySpreadSlider": "100", "delayHiCutSlider": "75" },
      selects: { "dirSelect": "rand", "stepLenSelect": "0.5", "waveSelect": "pulse", "rootSelect": "2", "octaveSelect": "2", "lfoWaveSelect": "sine", "lfo2WaveSelect": "sine", "delayTimeSelect": "1" },
    },
  },
  {
    name: "Lamentable Elegy · 2026-04-04 15:57",
    state: {
      sliders: { "bpmSlider": "168", "stepsSlider": "15", "atkSlider": "10", "decSlider": "80", "susSlider": "60", "relSlider": "420", "volSlider": "70", "cutoffSlider": "68", "resSlider": "2", "keyFollowSlider": "96", "fatkSlider": "10", "fdecSlider": "150", "fsusSlider": "30", "frelSlider": "300", "famtSlider": "50", "lfoRateSlider": "47", "lfoDepthSlider": "100", "pwSlider": "32", "lfo2RateSlider": "29", "lfo2DepthSlider": "87", "delayFbSlider": "52", "delayWetSlider": "42", "delaySpreadSlider": "100", "delayHiCutSlider": "75" },
      selects: { "dirSelect": "ping", "stepLenSelect": "0.5", "waveSelect": "pulse", "rootSelect": "4", "octaveSelect": "3", "lfoWaveSelect": "triangle", "lfo2WaveSelect": "sine", "delayTimeSelect": "1.5" },
    },
  },
  {
    name: "Bokonist Schmaltz · 2026-04-04 15:43",
    state: {
      sliders: { "bpmSlider": "116", "stepsSlider": "12", "atkSlider": "10", "decSlider": "80", "susSlider": "60", "relSlider": "200", "volSlider": "70", "cutoffSlider": "20", "resSlider": "0", "keyFollowSlider": "56", "fatkSlider": "10", "fdecSlider": "150", "fsusSlider": "30", "frelSlider": "300", "famtSlider": "50", "lfoRateSlider": "18", "lfoDepthSlider": "20", "pwSlider": "20", "lfo2RateSlider": "17", "lfo2DepthSlider": "83", "delayFbSlider": "74", "delayWetSlider": "66", "delaySpreadSlider": "70", "delayHiCutSlider": "55" },
      selects: { "dirSelect": "rand", "stepLenSelect": "0.5", "waveSelect": "pulse", "rootSelect": "9", "octaveSelect": "4", "lfoWaveSelect": "sine", "lfo2WaveSelect": "sine", "delayTimeSelect": "0.75" },
    },
  },
  {
    name: "Dresden Broadcast · 2026-04-04 15:41",
    state: {
      sliders: { "bpmSlider": "153", "stepsSlider": "10", "atkSlider": "10", "decSlider": "80", "susSlider": "60", "relSlider": "200", "volSlider": "70", "cutoffSlider": "70", "resSlider": "0", "keyFollowSlider": "56", "fatkSlider": "10", "fdecSlider": "150", "fsusSlider": "30", "frelSlider": "300", "famtSlider": "50", "lfoRateSlider": "50", "lfoDepthSlider": "20", "pwSlider": "20", "lfo2RateSlider": "17", "lfo2DepthSlider": "83", "delayFbSlider": "74", "delayWetSlider": "60", "delaySpreadSlider": "70", "delayHiCutSlider": "55" },
      selects: { "dirSelect": "fwd", "stepLenSelect": "0.5", "waveSelect": "pulse", "rootSelect": "9", "octaveSelect": "4", "lfoWaveSelect": "sine", "lfo2WaveSelect": "sine", "delayTimeSelect": "1" },
    },
  },
  {
    name: "Parabolic Drift · 2026-04-04 15:38",
    state: {
      sliders: { "bpmSlider": "118", "stepsSlider": "15", "atkSlider": "10", "decSlider": "80", "susSlider": "60", "relSlider": "200", "volSlider": "70", "cutoffSlider": "29", "resSlider": "10", "keyFollowSlider": "72", "fatkSlider": "10", "fdecSlider": "150", "fsusSlider": "30", "frelSlider": "300", "famtSlider": "50", "lfoRateSlider": "50", "lfoDepthSlider": "20", "pwSlider": "20", "lfo2RateSlider": "17", "lfo2DepthSlider": "83", "delayFbSlider": "65", "delayWetSlider": "44", "delaySpreadSlider": "100", "delayHiCutSlider": "75" },
      selects: { "dirSelect": "fwd", "stepLenSelect": "0.5", "waveSelect": "pulse", "rootSelect": "9", "octaveSelect": "4", "lfoWaveSelect": "sine", "lfo2WaveSelect": "sine", "delayTimeSelect": "0.75" },
    },
  },
  {
    name: "Sinooká Signal · 2026-04-04 15:38",
    state: {
      sliders: { "bpmSlider": "140", "stepsSlider": "15", "atkSlider": "10", "decSlider": "80", "susSlider": "60", "relSlider": "810", "volSlider": "70", "cutoffSlider": "44", "resSlider": "35", "keyFollowSlider": "54", "fatkSlider": "1", "fdecSlider": "307", "fsusSlider": "37", "frelSlider": "1429", "famtSlider": "50", "lfoRateSlider": "34", "lfoDepthSlider": "58", "pwSlider": "20", "lfo2RateSlider": "17", "lfo2DepthSlider": "83", "delayFbSlider": "60", "delayWetSlider": "55", "delaySpreadSlider": "100", "delayHiCutSlider": "75" },
      selects: { "dirSelect": "rand", "stepLenSelect": "0.5", "waveSelect": "pulse", "rootSelect": "0", "octaveSelect": "3", "lfoWaveSelect": "sine", "lfo2WaveSelect": "sine", "delayTimeSelect": "1.5" },
    },
  },
  {
    name: "Listless Tremolo · 2026-04-04 15:36",
    state: {
      sliders: { "bpmSlider": "140", "stepsSlider": "15", "atkSlider": "10", "decSlider": "80", "susSlider": "60", "relSlider": "200", "volSlider": "70", "cutoffSlider": "22", "resSlider": "10", "keyFollowSlider": "72", "fatkSlider": "10", "fdecSlider": "150", "fsusSlider": "30", "frelSlider": "300", "famtSlider": "50", "lfoRateSlider": "50", "lfoDepthSlider": "20", "pwSlider": "20", "lfo2RateSlider": "17", "lfo2DepthSlider": "83", "delayFbSlider": "65", "delayWetSlider": "44", "delaySpreadSlider": "100", "delayHiCutSlider": "75" },
      selects: { "dirSelect": "fwd", "stepLenSelect": "0.25", "waveSelect": "pulse", "rootSelect": "9", "octaveSelect": "4", "lfoWaveSelect": "sine", "lfo2WaveSelect": "sine", "delayTimeSelect": "0.75" },
    },
  },
  {
    name: "Ice-Nine Fugue · 2026-04-04 15:27",
    state: {
      sliders: { "bpmSlider": "149", "stepsSlider": "15", "atkSlider": "10", "decSlider": "80", "susSlider": "60", "relSlider": "420", "volSlider": "70", "cutoffSlider": "29", "resSlider": "2", "keyFollowSlider": "96", "fatkSlider": "10", "fdecSlider": "150", "fsusSlider": "30", "frelSlider": "300", "famtSlider": "50", "lfoRateSlider": "47", "lfoDepthSlider": "100", "pwSlider": "32", "lfo2RateSlider": "29", "lfo2DepthSlider": "87", "delayFbSlider": "59", "delayWetSlider": "48", "delaySpreadSlider": "100", "delayHiCutSlider": "48" },
      selects: { "dirSelect": "rand", "stepLenSelect": "0.5", "waveSelect": "pulse", "rootSelect": "4", "octaveSelect": "3", "lfoWaveSelect": "triangle", "lfo2WaveSelect": "sine", "delayTimeSelect": "1.33333" },
    },
  },
  {
    name: "Sardonic Bop · 2026-04-04 15:27",
    state: {
      sliders: { "bpmSlider": "168", "stepsSlider": "15", "atkSlider": "10", "decSlider": "80", "susSlider": "60", "relSlider": "420", "volSlider": "70", "cutoffSlider": "29", "resSlider": "2", "keyFollowSlider": "96", "fatkSlider": "10", "fdecSlider": "150", "fsusSlider": "30", "frelSlider": "300", "famtSlider": "50", "lfoRateSlider": "47", "lfoDepthSlider": "100", "pwSlider": "32", "lfo2RateSlider": "29", "lfo2DepthSlider": "87", "delayFbSlider": "52", "delayWetSlider": "42", "delaySpreadSlider": "100", "delayHiCutSlider": "75" },
      selects: { "dirSelect": "fwd", "stepLenSelect": "1", "waveSelect": "pulse", "rootSelect": "4", "octaveSelect": "3", "lfoWaveSelect": "triangle", "lfo2WaveSelect": "sine", "delayTimeSelect": "1.5" },
    },
  },
  {
    name: "Wampeterian March · 2026-04-04 15:25",
    state: {
      sliders: { "bpmSlider": "168", "stepsSlider": "15", "atkSlider": "10", "decSlider": "80", "susSlider": "60", "relSlider": "420", "volSlider": "70", "cutoffSlider": "37", "resSlider": "2", "keyFollowSlider": "96", "fatkSlider": "10", "fdecSlider": "150", "fsusSlider": "30", "frelSlider": "300", "famtSlider": "50", "lfoRateSlider": "47", "lfoDepthSlider": "100", "pwSlider": "32", "lfo2RateSlider": "29", "lfo2DepthSlider": "87", "delayFbSlider": "52", "delayWetSlider": "42", "delaySpreadSlider": "100", "delayHiCutSlider": "75" },
      selects: { "dirSelect": "fwd", "stepLenSelect": "0.5", "waveSelect": "pulse", "rootSelect": "4", "octaveSelect": "3", "lfoWaveSelect": "triangle", "lfo2WaveSelect": "sine", "delayTimeSelect": "1.5" },
    },
  },
  {
    name: "Aberrant Fantasia · 2026-04-04 15:24",
    state: {
      sliders: { "bpmSlider": "139", "stepsSlider": "14", "atkSlider": "10", "decSlider": "80", "susSlider": "60", "relSlider": "420", "volSlider": "70", "cutoffSlider": "37", "resSlider": "2", "keyFollowSlider": "96", "fatkSlider": "10", "fdecSlider": "150", "fsusSlider": "30", "frelSlider": "300", "famtSlider": "50", "lfoRateSlider": "47", "lfoDepthSlider": "100", "pwSlider": "32", "lfo2RateSlider": "29", "lfo2DepthSlider": "87", "delayFbSlider": "52", "delayWetSlider": "42", "delaySpreadSlider": "100", "delayHiCutSlider": "75" },
      selects: { "dirSelect": "rand", "stepLenSelect": "0.5", "waveSelect": "pulse", "rootSelect": "4", "octaveSelect": "3", "lfoWaveSelect": "triangle", "lfo2WaveSelect": "sine", "delayTimeSelect": "1.5" },
    },
  },
  {
    name: "Deadeye Transmission · 2026-04-04 15:24",
    state: {
      sliders: { "bpmSlider": "139", "stepsSlider": "14", "atkSlider": "10", "decSlider": "80", "susSlider": "60", "relSlider": "420", "volSlider": "70", "cutoffSlider": "37", "resSlider": "2", "keyFollowSlider": "96", "fatkSlider": "10", "fdecSlider": "150", "fsusSlider": "30", "frelSlider": "300", "famtSlider": "50", "lfoRateSlider": "47", "lfoDepthSlider": "100", "pwSlider": "32", "lfo2RateSlider": "29", "lfo2DepthSlider": "87", "delayFbSlider": "52", "delayWetSlider": "42", "delaySpreadSlider": "100", "delayHiCutSlider": "75" },
      selects: { "dirSelect": "rand", "stepLenSelect": "0.5", "waveSelect": "pulse", "rootSelect": "9", "octaveSelect": "4", "lfoWaveSelect": "triangle", "lfo2WaveSelect": "sine", "delayTimeSelect": "1.5" },
    },
  },
  {
    name: "Wakefield Fugue · 2026-04-04 15:23",
    state: {
      sliders: { "bpmSlider": "139", "stepsSlider": "14", "atkSlider": "10", "decSlider": "80", "susSlider": "60", "relSlider": "200", "volSlider": "70", "cutoffSlider": "25", "resSlider": "10", "keyFollowSlider": "87", "fatkSlider": "10", "fdecSlider": "150", "fsusSlider": "30", "frelSlider": "300", "famtSlider": "50", "lfoRateSlider": "42", "lfoDepthSlider": "88", "pwSlider": "50", "lfo2RateSlider": "40", "lfo2DepthSlider": "25", "delayFbSlider": "52", "delayWetSlider": "42", "delaySpreadSlider": "100", "delayHiCutSlider": "75" },
      selects: { "dirSelect": "rand", "stepLenSelect": "0.5", "waveSelect": "pulse", "rootSelect": "9", "octaveSelect": "4", "lfoWaveSelect": "sine", "lfo2WaveSelect": "sine", "delayTimeSelect": "1.5" },
    },
  },
  {
    name: "Tralfamadorian Sérénade · 2026-04-04 15:23",
    state: {
      sliders: { "bpmSlider": "139", "stepsSlider": "14", "atkSlider": "10", "decSlider": "80", "susSlider": "60", "relSlider": "200", "volSlider": "70", "cutoffSlider": "25", "resSlider": "10", "keyFollowSlider": "87", "fatkSlider": "10", "fdecSlider": "150", "fsusSlider": "30", "frelSlider": "300", "famtSlider": "50", "lfoRateSlider": "42", "lfoDepthSlider": "88", "pwSlider": "50", "lfo2RateSlider": "40", "lfo2DepthSlider": "25", "delayFbSlider": "52", "delayWetSlider": "42", "delaySpreadSlider": "100", "delayHiCutSlider": "75" },
      selects: { "dirSelect": "rand", "stepLenSelect": "0.25", "waveSelect": "pulse", "rootSelect": "9", "octaveSelect": "5", "lfoWaveSelect": "sine", "lfo2WaveSelect": "sine", "delayTimeSelect": "1.5" },
    },
  },
  {
    name: "Unglued Soliloquy · 2026-04-04 15:18",
    state: {
      sliders: { "bpmSlider": "143", "stepsSlider": "14", "atkSlider": "10", "decSlider": "80", "susSlider": "60", "relSlider": "200", "volSlider": "70", "cutoffSlider": "34", "resSlider": "35", "keyFollowSlider": "80", "fatkSlider": "10", "fdecSlider": "150", "fsusSlider": "30", "frelSlider": "300", "famtSlider": "50", "lfoRateSlider": "50", "lfoDepthSlider": "20", "pwSlider": "50", "lfo2RateSlider": "40", "lfo2DepthSlider": "25", "delayFbSlider": "35", "delayWetSlider": "25", "delaySpreadSlider": "100", "delayHiCutSlider": "75" },
      selects: { "dirSelect": "ping", "stepLenSelect": "0.5", "waveSelect": "pulse", "rootSelect": "9", "octaveSelect": "2", "lfoWaveSelect": "sine", "lfo2WaveSelect": "sine", "delayTimeSelect": "0.75" },
    },
  },
  {
    name: "Pilgrim Lullaby · 2026-04-04 15:12",
    state: {
      sliders: { "bpmSlider": "95", "stepsSlider": "14", "atkSlider": "22", "decSlider": "25", "susSlider": "62", "relSlider": "420", "volSlider": "81", "cutoffSlider": "19", "resSlider": "27", "keyFollowSlider": "0", "fatkSlider": "10", "fdecSlider": "150", "fsusSlider": "30", "frelSlider": "220", "famtSlider": "50", "lfoRateSlider": "50", "lfoDepthSlider": "20", "pwSlider": "50", "lfo2RateSlider": "40", "lfo2DepthSlider": "25", "delayFbSlider": "35", "delayWetSlider": "25", "delaySpreadSlider": "100", "delayHiCutSlider": "75" },
      selects: { "dirSelect": "ping", "stepLenSelect": "0.25", "waveSelect": "pulse", "rootSelect": "9", "octaveSelect": "4", "lfoWaveSelect": "sine", "lfo2WaveSelect": "sine", "delayTimeSelect": "0.75" },
    },
  },
  {
    name: "Earnest Nocturne · 2026-04-04 15:11",
    state: {
      sliders: { "bpmSlider": "143", "stepsSlider": "14", "atkSlider": "10", "decSlider": "80", "susSlider": "60", "relSlider": "200", "volSlider": "70", "cutoffSlider": "25", "resSlider": "10", "keyFollowSlider": "0", "fatkSlider": "10", "fdecSlider": "150", "fsusSlider": "30", "frelSlider": "300", "famtSlider": "50", "lfoRateSlider": "50", "lfoDepthSlider": "20", "pwSlider": "50", "lfo2RateSlider": "40", "lfo2DepthSlider": "25", "delayFbSlider": "35", "delayWetSlider": "25", "delaySpreadSlider": "100", "delayHiCutSlider": "75" },
      selects: { "dirSelect": "fwd", "stepLenSelect": "0.5", "waveSelect": "pulse", "rootSelect": "9", "octaveSelect": "2", "lfoWaveSelect": "sine", "lfo2WaveSelect": "sine", "delayTimeSelect": "0.75" },
    },
  },
  {
    name: "Chronosynclastic Groove · 2026-04-04 15:10",
    state: {
      sliders: { "bpmSlider": "120", "stepsSlider": "14", "atkSlider": "10", "decSlider": "80", "susSlider": "60", "relSlider": "200", "volSlider": "70", "cutoffSlider": "25", "resSlider": "36", "keyFollowSlider": "51", "fatkSlider": "1", "fdecSlider": "202", "fsusSlider": "49", "frelSlider": "490", "famtSlider": "73", "lfoRateSlider": "50", "lfoDepthSlider": "20", "pwSlider": "50", "lfo2RateSlider": "40", "lfo2DepthSlider": "25", "delayFbSlider": "49", "delayWetSlider": "44", "delaySpreadSlider": "100", "delayHiCutSlider": "88" },
      selects: { "dirSelect": "ping", "stepLenSelect": "0.25", "waveSelect": "pulse", "rootSelect": "4", "octaveSelect": "3", "lfoWaveSelect": "triangle", "lfo2WaveSelect": "sine", "delayTimeSelect": "0.75" },
    },
  },
  {
    name: "Parabolic Threshold · 2026-04-04 15:09",
    state: {
      sliders: { "bpmSlider": "120", "stepsSlider": "14", "atkSlider": "10", "decSlider": "80", "susSlider": "60", "relSlider": "200", "volSlider": "70", "cutoffSlider": "25", "resSlider": "10", "keyFollowSlider": "0", "fatkSlider": "10", "fdecSlider": "150", "fsusSlider": "30", "frelSlider": "300", "famtSlider": "50", "lfoRateSlider": "50", "lfoDepthSlider": "20", "pwSlider": "50", "lfo2RateSlider": "40", "lfo2DepthSlider": "25", "delayFbSlider": "35", "delayWetSlider": "25", "delaySpreadSlider": "100", "delayHiCutSlider": "75" },
      selects: { "dirSelect": "ping", "stepLenSelect": "0.25", "waveSelect": "pulse", "rootSelect": "9", "octaveSelect": "2", "lfoWaveSelect": "sine", "lfo2WaveSelect": "sine", "delayTimeSelect": "0.75" },
    },
  },
  {
    name: "Peculiar Drift · 2026-04-04 15:09",
    state: {
      sliders: { "bpmSlider": "120", "stepsSlider": "14", "atkSlider": "10", "decSlider": "80", "susSlider": "60", "relSlider": "200", "volSlider": "70", "cutoffSlider": "25", "resSlider": "10", "keyFollowSlider": "0", "fatkSlider": "10", "fdecSlider": "150", "fsusSlider": "30", "frelSlider": "300", "famtSlider": "50", "lfoRateSlider": "50", "lfoDepthSlider": "20", "pwSlider": "50", "lfo2RateSlider": "40", "lfo2DepthSlider": "25", "delayFbSlider": "35", "delayWetSlider": "25", "delaySpreadSlider": "100", "delayHiCutSlider": "75" },
      selects: { "dirSelect": "fwd", "stepLenSelect": "0.5", "waveSelect": "pulse", "rootSelect": "9", "octaveSelect": "2", "lfoWaveSelect": "sine", "lfo2WaveSelect": "sine", "delayTimeSelect": "0.75" },
    },
  },
];
