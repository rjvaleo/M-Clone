/**
 * Matching a document's samples to the engine's.
 *
 * The two sides name audio differently and both are right to. A document says
 * `assetId` — a content hash, stable across saves, machines and releases. The
 * engine says a `u32`, because that is what fits through the ABI and what a
 * `[u32; 128]` table in `sampler.rs` indexes with. This is the translation.
 *
 * The mapping is per-rack rather than global: `init` rebuilds the engine and
 * its bank together, so a slot number issued to the previous rack means
 * nothing to the new one. `reset` exists to make forgetting that impossible —
 * believing a stale number plays somebody else's sample, which is a bug that
 * sounds like a bug rather than crashing.
 */

import type { AudioPlan } from "../audioPlan";
import { PRISM_SOUND_TYPES } from "../../registry/prismModules";
import { readPercussionSlots } from "../percussionSlots";

/** Modules whose single `asset-id` names their whole source. */
const SINGLE_SOURCE: ReadonlySet<string> = new Set(["m.looper", "m.granular", "m.grain-engine", ...PRISM_SOUND_TYPES]);

/** Modules whose `slots` list names one sample per MIDI note. */
const SLOT_KIT: ReadonlySet<string> = new Set(["m.percussion"]);

/**
 * How many distinct samples one rack will hold.
 *
 * A ceiling rather than unbounded growth: a long session dropping files into
 * the pool would otherwise allocate a slot per file forever, and the audio
 * lives in WASM linear memory which never shrinks.
 */
export const MAX_SAMPLE_SLOTS = 256;

/** One module slot that wants a sample. */
export interface SampleRef {
  nodeId: string;
  /** The engine-side slot: a MIDI note for a kit, 0 for a single source. */
  slot: number;
  assetId: string;
  /** A kit pad's trim, position and choke group; absent for a single source. */
  shape?: SlotShape;
}

/** What a kit pad does to its sample beyond naming it. See `set_slot_shape`. */
export interface SlotShape {
  gain: number;
  pan: number;
  chokeGroup: number;
}

/**
 * Every sample a plan asks for.
 *
 * Reads `structure` rather than `parameters` because these are structural: the
 * plan already rebuilds a node when one changes, which is what makes it safe
 * to assign the slot once at build time.
 */
export function planSampleRefs(plan: AudioPlan): SampleRef[] {
  const refs: SampleRef[] = [];
  for (const spec of Object.values(plan.nodes)) {
    if (SINGLE_SOURCE.has(spec.moduleType)) {
      const assetId = spec.structure["asset-id"];
      if (typeof assetId === "string" && assetId !== "") {
        refs.push({ nodeId: spec.nodeId, slot: 0, assetId });
      }
      continue;
    }
    if (!SLOT_KIT.has(spec.moduleType)) continue;

    // The browser player's own reader, so a kit is the same kit on both
    // backends: a malformed slot costs its own sound and nothing else.
    for (const slot of readPercussionSlots(spec.structure["slots"])) {
      if (slot.assetId === "") continue;
      refs.push({
        nodeId: spec.nodeId,
        slot: slot.note,
        assetId: slot.assetId,
        shape: { gain: slot.gain, pan: slot.pan, chokeGroup: slot.chokeGroup },
      });
    }
  }
  return refs;
}

/** Asset hashes to engine slot numbers, and what has actually been sent. */
export class SampleSlots {
  private readonly slots = new Map<string, number>();
  private readonly loaded = new Set<string>();

  constructor(private readonly ceiling: number = MAX_SAMPLE_SLOTS) {}

  /**
   * This asset's slot, assigning one if it has none. `undefined` once the
   * ceiling is reached — the caller then skips the transfer and that sampler
   * stays silent, which is recoverable in a way a wedged rack is not.
   */
  slotFor(assetId: string): number | undefined {
    const existing = this.slots.get(assetId);
    if (existing !== undefined) return existing;
    if (this.slots.size >= this.ceiling) return undefined;
    const slot = this.slots.size;
    this.slots.set(assetId, slot);
    return slot;
  }

  /** Whether this asset's audio has actually reached the engine. */
  isLoaded(assetId: string): boolean {
    return this.loaded.has(assetId);
  }

  markLoaded(assetId: string): void {
    this.loaded.add(assetId);
  }

  /** The whole mapping, for the side that resolves a plan's asset ids. */
  table(): Record<string, number> {
    return Object.fromEntries(this.slots);
  }

  /** Forget everything. The engine's bank was rebuilt with it. */
  reset(): void {
    this.slots.clear();
    this.loaded.clear();
  }
}
