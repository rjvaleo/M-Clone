// The mixer in the Engineering-strip style: eight channel strips side by side,
// each its two sends, its pan, an upright fader, and its mute and solo, then a
// column for the sends' masters — each send's pre-fader switch and its return —
// and the module's mute. One fixed width, every strip the same.

import type { PanelLayout } from "../layout";
import { fill, knob, mute, toggle, type GroupSpec } from "./grid";

const INSET = { top: 22, pad: 4, gap: 2 };
const STRIP = 58;
const MASTERS = 80;
const HEIGHT = 300;

const channel = (n: number, x: number): GroupSpec => ({
  id: `channel-${n}`, label: `${n}`, tint: n % 2 === 0 ? "even" : "odd", x, y: 0, w: STRIP, h: HEIGHT,
  rows: [
    [knob(`send-a-${n}`, "Send A")],
    [knob(`send-b-${n}`, "Send B")],
    [knob(`pan-${n}`, "Pan")],
    [{ param: `level-${n}`, label: "Level", kind: "vslider" }],
    [toggle(`mute-${n}`, "M"), toggle(`solo-${n}`, "S")],
  ],
  heights: [44, 44, 44, 84, 38],
});

function mixer(): PanelLayout {
  const strips = Array.from({ length: 8 }, (_, i) => channel(i + 1, i * STRIP));
  const masters: GroupSpec = {
    id: "sends", label: "Sends", tint: "out", x: 8 * STRIP, y: 0, w: MASTERS, h: HEIGHT,
    rows: [
      [toggle("send-a-pre", "A pre")],
      [knob("return-a", "Return A")],
      [toggle("send-b-pre", "B pre")],
      [knob("return-b", "Return B")],
      [mute()],
    ],
    heights: [38, 68, 38, 68, 52],
  };
  const { groups, controls } = fill([...strips, masters], INSET);
  return {
    moduleType: "m.audio-mixer",
    style: "strip",
    readout: { figures: 3 },
    width: 8 * STRIP + MASTERS,
    height: HEIGHT,
    groups,
    controls,
    displays: [],
  };
}

export const MIXER_STRIP = mixer();
