// Stereo Widener — mid/side width, with the bass left alone.
//
// `MODULAR_IMPLEMENTATION_PLAN.md` §9.2 puts this in tier 5 of the effect rack;
// `AUDIO_ENGINE_SPEC.md` §13 says what it has to do that a naive one does not:
// "frequency-dependent width" and a "mono-compatible low end below a
// configurable crossover".
//
// ## The matrix
//
// Mid/side is a change of basis and nothing more:
//
//     M = (L + R) / 2          L = M + S
//     S = (L − R) / 2          R = M − S
//
// Scaling S by `width` on the way back is the whole effect. At 1 the transform
// is its own inverse and the two cancel exactly; below 1 the image narrows to
// mono at 0; above 1 it widens, and past about 1.6 it starts to sound hollow
// because the centre is being spent on the sides.
//
//     in ─► split ─┬─► mid ────────────────────────────────┬──► merge L
//                  │                                       │
//                  └─► side ─► highpass ─► width ─┬────────┘
//                                                 └─► (−1) ─► merge R
//
// ## Why the highpass, and why it is not a bypassable nicety
//
// Widening low frequencies is how a mix stops surviving a mono fold-down: the
// side component of a bass note is what cancels when the two channels are
// summed, and a club system or a phone speaker sums them. So the side path is
// high-passed and the band below the corner stays centred by construction —
// there is no setting of `width` that can move it.
//
// The consequence is worth stating plainly rather than hiding: **this module is
// not a null at width 1.** It mono's the bass whatever the width is, because
// that is the feature. A patch that wants a true bypass sets the module's mix
// to zero, exactly as the rest of the rack does.

import type { AudioNodeSpec } from "./audioPlan";
import type { AudioNodeLike } from "./graphAdapter";
import type { EffectContext } from "./nodes";
import { rampParam } from "./params";
import { clamp, fixedGain, numberOr, setNow } from "./reverbTank";

/** Past this the centre starts audibly hollowing out. */
export const MAX_WIDTH = 2;

/** Bass below this stays mono. The default is a common mastering choice. */
export const DEFAULT_CROSSOVER_HZ = 120;

export const WIDENER_DEFAULTS = { width: 1, crossover: DEFAULT_CROSSOVER_HZ } as const;

export type WidenerCore = {
  input: AudioNodeLike;
  output: AudioNodeLike;
  owned: readonly AudioNodeLike[];
  setWidth(value: number, atSec: number): void;
  setCrossoverHz(value: number, atSec: number): void;
  /** For tests and telemetry: the side gain actually in force. */
  readonly widthValue: number;
};

export function createWidener(
  context: EffectContext,
  spec: AudioNodeSpec,
  atSec: number,
): WidenerCore {
  const width = clamp(numberOr(spec.parameters.width, WIDENER_DEFAULTS.width), 0, MAX_WIDTH);
  const crossover = clamp(
    numberOr(spec.parameters.crossover, WIDENER_DEFAULTS.crossover),
    20,
    500,
  );

  const input = context.createGain();
  const splitter = context.createChannelSplitter(2);
  const merger = context.createChannelMerger(2);

  // M = (L + R)/2 — both sides summed into one node, halved once.
  const mid = fixedGain(context, 0.5, atSec);
  // S = (L − R)/2 — the right side inverted before the same sum.
  const side = fixedGain(context, 0.5, atSec);
  const invertRight = fixedGain(context, -1, atSec);

  const sideHighpass = context.createBiquadFilter();
  sideHighpass.type = "highpass";
  setNow(sideHighpass.frequency, crossover, atSec);
  setNow(sideHighpass.Q, 0.7071, atSec);

  const widthGain = fixedGain(context, width, atSec);
  const invertSide = fixedGain(context, -1, atSec);

  input.connect(splitter);
  splitter.connect(mid, 0);
  splitter.connect(mid, 1);
  splitter.connect(side, 0);
  splitter.connect(invertRight, 1);
  invertRight.connect(side);

  side.connect(sideHighpass);
  sideHighpass.connect(widthGain);
  widthGain.connect(invertSide);

  // L = M + S·w, R = M − S·w.
  mid.connect(merger, 0, 0);
  mid.connect(merger, 0, 1);
  widthGain.connect(merger, 0, 0);
  invertSide.connect(merger, 0, 1);

  let widthValue = width;

  return {
    input,
    output: merger,
    owned: [input, splitter, merger, mid, side, invertRight, sideHighpass, widthGain, invertSide],
    get widthValue() {
      return widthValue;
    },
    setWidth(value: number, at: number) {
      widthValue = clamp(value, 0, MAX_WIDTH);
      // One ramp moves both halves of the reconstruction: `widthGain` feeds the
      // left merger input directly and the right one through the inverter, so
      // the two sides cannot drift apart mid-gesture and swing the image.
      rampParam(widthGain.gain, widthValue, at, "linear");
    },
    setCrossoverHz(value: number, at: number) {
      rampParam(sideHighpass.frequency, clamp(value, 20, 500), at, "linear");
    },
  };
}
