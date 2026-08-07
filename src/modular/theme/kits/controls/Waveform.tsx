import { useKit } from "../KitContext";
import { faceFor } from "../registry";
import type { WaveformProps } from "../types";

export function Waveform(props: WaveformProps) {
  return faceFor(useKit()).waveform(props);
}
