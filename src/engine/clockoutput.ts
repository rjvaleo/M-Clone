export function metronomeInterval(tempo: number, ratio: number): number {
  return 240 / Math.max(1, tempo) / Math.max(1, ratio);
}

export function clockPulseInterval(tempo: number, ratio: number): number {
  return metronomeInterval(tempo, ratio) / 24;
}
