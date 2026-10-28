// The Grain Engine in the Cabinet style, after the Minimoog and Diva panels in
// CleanRoom: wood cheeks, black panel, cream lettering, sections under
// bracketed titles, and an amber screen.
//
// Six groups in the order the sound flows: Sample, Engine, Grains on top;
// Motion, Cloud, Play beneath. The screen shows the sample with the read
// position and the spray either side of it.

import type { PanelLayout } from "../layout";

const knob = (param: string, label: string, x: number, y: number, w: number, h: number, size?: "big" | "small") =>
  ({ param, kind: "knob" as const, label, x, y, w, h, ...(size ? { size } : {}) });

export const GRAIN_CABINET: PanelLayout = {
  moduleType: "m.grain-engine",
  style: "cabinet",
  width: 720,
  height: 300,
  groups: [
    { id: "sample", label: "Sample", x: 14, y: 0, w: 236, h: 150 },
    { id: "engine", label: "Engine", x: 250, y: 0, w: 190, h: 150 },
    { id: "grains", label: "Grains", x: 440, y: 0, w: 266, h: 150 },
    { id: "motion", label: "Motion", x: 14, y: 150, w: 430, h: 150 },
    { id: "cloud", label: "Cloud", x: 444, y: 150, w: 110, h: 150 },
    { id: "play", label: "Play", x: 554, y: 150, w: 152, h: 150 },
  ],
  controls: [
    { param: "asset-id", kind: "asset", label: "Sample", x: 20, y: 124, w: 224, h: 22 },
    knob("level", "Level", 196, 22, 48, 66),

    { param: "engine", kind: "select", label: "Engine", x: 256, y: 20, w: 178, h: 30 },
    knob("stretch", "Stretch", 256, 54, 58, 90, "big"),
    knob("semitones", "Transpose", 316, 54, 58, 90, "big"),
    knob("window-ms", "Window", 376, 54, 58, 90),

    // Zero takes the rate from the window and the overlap, as MultiGrainLive does.
    { ...knob("grain-rate", "Rate", 446, 18, 84, 64), zero: "AUTO" },
    knob("overlap", "Overlap", 532, 18, 84, 64),
    knob("size-jitter", "Size jit", 618, 18, 84, 64),
    knob("position-jitter", "Spray", 446, 84, 84, 64),
    knob("layers", "Layers", 532, 84, 84, 64),
    knob("envelope", "Envelope", 618, 84, 84, 64),

    knob("position", "Position", 20, 170, 90, 124, "big"),
    knob("scan", "Scan", 114, 168, 104, 62),
    { param: "reverse", kind: "switch", label: "Reverse", x: 222, y: 168, w: 104, h: 62 },
    knob("pitch-jitter", "Pitch jit", 330, 168, 108, 62),
    knob("pitch-drift", "Drift", 114, 232, 104, 62),
    knob("drift-rate", "Drift rate", 222, 232, 104, 62),
    knob("pan-spread", "Spread", 330, 232, 108, 62),

    { param: "cloud", kind: "switch", label: "Cloud", x: 450, y: 170, w: 98, h: 40 },
    knob("cloud-mix", "Mix", 450, 214, 98, 80),

    { param: "root", kind: "readout", label: "Root", x: 560, y: 170, w: 140, h: 34 },
    { param: "free-run", kind: "switch", label: "Free run", x: 560, y: 254, w: 68, h: 40 },
    { param: "mute", kind: "switch", label: "Mute", x: 632, y: 254, w: 68, h: 40 },
  ],
  displays: [
    { kind: "cheek", x: 0, y: 0, w: 14, h: 300 },
    { kind: "cheek", x: 706, y: 0, w: 14, h: 300 },
    { kind: "grain-screen", x: 20, y: 20, w: 170, h: 100 },
    { kind: "root-keys", x: 560, y: 208, w: 140, h: 42 },
  ],
};
