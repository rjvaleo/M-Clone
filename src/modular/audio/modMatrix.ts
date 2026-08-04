/**
 * The modulation matrix: eight sources, twelve destinations, ninety-six amounts.
 *
 * From the AV prototype's synth design — plan §9.1 item 9. What makes a matrix
 * this size usable rather than a wall of numbers is that every cell means the
 * same thing: **an amount in −1…+1**, which the destination then scales into
 * whatever units it happens to speak. A knob at half depth is half depth
 * everywhere; only the result differs.
 *
 * ## Why the units differ at all
 *
 * A filter modulated in hertz is useless. Add 500 Hz to a cutoff at 200 Hz and
 * the sweep is enormous; add it at 12 kHz and nothing happens. Pitch has the
 * same problem and the same fix: modulate in **octaves** and **cents**, which
 * are ratios, and a sweep sounds the same wherever it starts. Pan and level are
 * genuinely linear, and are the only things treated that way.
 *
 * ## Continuous versus per-note
 *
 * Sources divide by how fast they move, and the division decides the wiring.
 * LFOs and the mod wheel keep moving while a note sounds, so they become real
 * nodes: an oscillator through a gain into an `AudioParam`, where the gain *is*
 * the amount. Velocity, note number, the random draw and the two envelope
 * amounts are fixed the moment a note begins, so they fold into the ramps the
 * voice schedules and cost nothing thereafter.
 *
 * This file is the model only. It builds no nodes and touches no context, so
 * the arithmetic can be checked without making a sound.
 */

/** Where modulation comes from. */
export const MOD_SOURCES = [
  "lfo1",
  "lfo2",
  "ampEnv",
  "filterEnv",
  "velocity",
  "note",
  "modWheel",
  "random",
] as const;

/** What modulation reaches. */
export const MOD_DESTINATIONS = [
  "osc1-pitch",
  "osc2-pitch",
  "osc3-pitch",
  "osc1-level",
  "osc2-level",
  "osc3-level",
  "filter-cutoff",
  "filter-resonance",
  "lfo1-rate",
  "lfo2-rate",
  "pan",
  "volume",
] as const;

export type ModSource = (typeof MOD_SOURCES)[number];
export type ModDestination = (typeof MOD_DESTINATIONS)[number];

/** Every source's current value, each in −1…+1. */
export type ModSourceValues = Record<ModSource, number>;

/** Amounts, indexed source-major. Treated as immutable by every function here. */
export type ModMatrix = Readonly<Record<ModSource, Readonly<Record<ModDestination, number>>>>;

/** One cell, as a document stores it. */
export type ModRouting = {
  source: ModSource;
  destination: ModDestination;
  amount: number;
};

/**
 * Sources that keep moving while a note sounds.
 *
 * These become audio-rate connections. Everything else is read once, when the
 * note starts.
 */
const CONTINUOUS: ReadonlySet<string> = new Set(["lfo1", "lfo2", "modWheel"]);

export const sourceIsContinuous = (source: ModSource): boolean => CONTINUOUS.has(source);

const isSource = (value: unknown): value is ModSource =>
  MOD_SOURCES.includes(value as ModSource);

const isDestination = (value: unknown): value is ModDestination =>
  MOD_DESTINATIONS.includes(value as ModDestination);

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

/** An amount that is not a usable number is no routing at all. */
const cleanAmount = (amount: number): number =>
  Number.isFinite(amount) ? clamp(amount, -1, 1) : 0;

/**
 * How much a full-depth routing moves a destination, and in what units.
 *
 * `depth` is the swing at amount 1: two octaves of pitch, four octaves of
 * cutoff, the whole of a pan. `min` and `max` bound the result afterwards, so
 * no stack of routings can drive a value somewhere it cannot go.
 */
export type DestinationRange = {
  unit: "cents" | "octaves" | "linear";
  depth: number;
  min: number;
  max: number;
};

const RANGES: Readonly<Record<ModDestination, DestinationRange>> = {
  // Pitch in cents: ±2 octaves, which covers vibrato and dive-bombs alike.
  "osc1-pitch": { unit: "cents", depth: 2400, min: -4800, max: 4800 },
  "osc2-pitch": { unit: "cents", depth: 2400, min: -4800, max: 4800 },
  "osc3-pitch": { unit: "cents", depth: 2400, min: -4800, max: 4800 },
  "osc1-level": { unit: "linear", depth: 1, min: 0, max: 1 },
  "osc2-level": { unit: "linear", depth: 1, min: 0, max: 1 },
  "osc3-level": { unit: "linear", depth: 1, min: 0, max: 1 },
  // Four octaves is the classic filter sweep, and the range stops where a
  // BiquadFilter does.
  "filter-cutoff": { unit: "octaves", depth: 4, min: 20, max: 20000 },
  "filter-resonance": { unit: "linear", depth: 20, min: 0.1, max: 30 },
  // Rate in octaves too: doubling and halving a speed is what is heard.
  "lfo1-rate": { unit: "octaves", depth: 4, min: 0.01, max: 40 },
  "lfo2-rate": { unit: "octaves", depth: 4, min: 0.01, max: 40 },
  pan: { unit: "linear", depth: 1, min: -1, max: 1 },
  volume: { unit: "linear", depth: 1, min: 0, max: 1 },
};

export const destinationRange = (destination: ModDestination): DestinationRange =>
  RANGES[destination];

/** A matrix with nothing routed. */
export function emptyMatrix(): ModMatrix {
  const matrix = {} as Record<ModSource, Record<ModDestination, number>>;
  for (const source of MOD_SOURCES) {
    const row = {} as Record<ModDestination, number>;
    for (const destination of MOD_DESTINATIONS) row[destination] = 0;
    matrix[source] = row;
  }
  return matrix;
}

/** A new matrix with one cell changed. The original is untouched. */
export function setRouting(
  matrix: ModMatrix,
  source: ModSource,
  destination: ModDestination,
  amount: number,
): ModMatrix {
  if (!isSource(source) || !isDestination(destination)) return matrix;
  return {
    ...matrix,
    [source]: { ...matrix[source], [destination]: cleanAmount(amount) },
  };
}

type ReadMatrix = {
  (matrix: ModMatrix, source: ModSource, destination: ModDestination): number;
  /** Rebuild a matrix from what a document stored, dropping what it cannot read. */
  fromJson(stored: unknown): ModMatrix;
  /** Only the cells that are routed, so a saved patch is not 96 zeroes. */
  toJson(matrix: ModMatrix): ModRouting[];
};

const read = ((matrix, source, destination) => {
  if (!isSource(source) || !isDestination(destination)) return 0;
  return matrix[source]?.[destination] ?? 0;
}) as ReadMatrix;

read.fromJson = (stored: unknown): ModMatrix => {
  if (!Array.isArray(stored)) return emptyMatrix();
  let matrix = emptyMatrix();
  for (const entry of stored) {
    if (typeof entry !== "object" || entry === null) continue;
    const { source, destination, amount } = entry as Partial<ModRouting>;
    if (!isSource(source) || !isDestination(destination)) continue;
    matrix = setRouting(matrix, source, destination, Number(amount));
  }
  return matrix;
};

read.toJson = (matrix: ModMatrix): ModRouting[] => {
  const routings: ModRouting[] = [];
  for (const source of MOD_SOURCES) {
    for (const destination of MOD_DESTINATIONS) {
      const amount = matrix[source][destination];
      if (amount !== 0) routings.push({ source, destination, amount });
    }
  }
  return routings;
};

export const readMatrix = read;

/**
 * What every routing into one destination adds up to, in that destination's
 * units.
 *
 * The total is clamped to one full depth in either direction: four sources at
 * full amount is emphasis, not four times the range.
 */
export function modulate(
  matrix: ModMatrix,
  destination: ModDestination,
  sources: ModSourceValues,
): number {
  const range = destinationRange(destination);
  let total = 0;
  for (const source of MOD_SOURCES) {
    const amount = matrix[source][destination];
    if (amount === 0) continue;
    const value = sources[source];
    if (!Number.isFinite(value)) continue;
    total += amount * clamp(value, -1, 1);
  }
  return clamp(total, -1, 1) * range.depth;
}

/**
 * Apply a modulation total to a base value.
 *
 * Cents and octaves are ratios and multiply; linear units add. The result is
 * held inside the destination's own range, because the value goes straight to
 * an `AudioParam` that has opinions about what it will accept.
 */
export function applyRoutings(
  destination: ModDestination,
  base: number,
  amount: number,
): number {
  const range = destinationRange(destination);
  if (amount === 0) return clamp(base, range.min, range.max);
  const modulated = range.unit === "cents"
    ? base + amount
    : range.unit === "octaves"
      ? base * Math.pow(2, amount)
      : base + amount;
  return clamp(modulated, range.min, range.max);
}
