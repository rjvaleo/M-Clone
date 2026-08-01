const SYNTH_CHOICE_LABELS: Record<string, string> = {
  sine: "SIN",
  triangle: "TRI",
  sawtooth: "SAW",
  square: "SQR",
  lowpass: "LP",
  highpass: "HP",
  bandpass: "BP",
  pitch: "PITCH",
  filter: "FILT",
  amp: "AMP",
};

export function synthChoiceText(value: unknown): string {
  if (typeof value === "number" && value > 0) return `+${value}`;
  return SYNTH_CHOICE_LABELS[String(value)] ?? String(value);
}

export function synthChoiceWidthCh(options: readonly unknown[]): number {
  return Math.max(1, ...options.map((option) => synthChoiceText(option).length)) + 2;
}
