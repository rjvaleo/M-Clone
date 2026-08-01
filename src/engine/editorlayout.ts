export const EDITOR_NATIVE_SIZES = {
  density: [145, 90], velocityRange: [165, 81], noteOrderMix: [199, 149],
  transposition: [143, 95], cyclic: [275, 222], timeDistort: [185, 155],
  outputChannels: [155, 80],
} as const;

export const EDITOR_CONTENT_SCALES = {
  patternEditor: 0.72,
  cyclicContent: 0.625,
} as const;

export const PATTERN_GRID_CELL_SIZE = [10, 8] as const;
