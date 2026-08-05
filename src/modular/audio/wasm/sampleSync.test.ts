import { describe, expect, it } from "vitest";
import type { AudioPlan, AudioNodeSpec } from "../audioPlan";
import type { JsonValue } from "../../model/graph";
import { SampleSlots, planSampleRefs } from "./sampleSync";

const node = (
  nodeId: string,
  moduleType: string,
  structure: Record<string, JsonValue> = {},
): AudioNodeSpec => ({
  nodeId,
  moduleType,
  structure,
  parameters: {},
  bypass: false,
  wet: 1,
});

const plan = (nodes: AudioNodeSpec[]): AudioPlan => ({
  generation: 1,
  nodes: Object.fromEntries(nodes.map((spec) => [spec.nodeId, spec])),
  connections: [],
});

describe("planSampleRefs", () => {
  it("finds the looper's single source", () => {
    const refs = planSampleRefs(plan([node("l", "m.looper", { "asset-id": "sha-1" })]));
    expect(refs).toEqual([{ nodeId: "l", slot: 0, assetId: "sha-1" }]);
  });

  it("finds the grain cloud's source", () => {
    const refs = planSampleRefs(plan([node("g", "m.granular", { "asset-id": "sha-2" })]));
    expect(refs).toEqual([{ nodeId: "g", slot: 0, assetId: "sha-2" }]);
  });

  it("finds every percussion slot, keyed by its MIDI note", () => {
    // The slot number *is* the note, which is what lets the Rust sampler index
    // its table directly.
    const refs = planSampleRefs(
      plan([
        node("p", "m.percussion", {
          slots: [
            { note: 36, assetId: "kick" },
            { note: 38, assetId: "snare" },
          ],
        }),
      ]),
    );
    expect(refs).toEqual([
      { nodeId: "p", slot: 36, assetId: "kick" },
      { nodeId: "p", slot: 38, assetId: "snare" },
    ]);
  });

  it("skips a slot with no sample in it", () => {
    // Half a kit filled is the normal case.
    const refs = planSampleRefs(
      plan([
        node("p", "m.percussion", {
          slots: [{ note: 36, assetId: "kick" }, { note: 38, assetId: "" }, { note: 40 }],
        }),
      ]),
    );
    expect(refs).toEqual([{ nodeId: "p", slot: 36, assetId: "kick" }]);
  });

  it("ignores modules that do not read samples", () => {
    expect(planSampleRefs(plan([node("g", "m.audio-gain")]))).toEqual([]);
  });

  it("survives a malformed slot list rather than throwing on a saved document", () => {
    for (const slots of [null, "nonsense", 42, [null, 7, { note: "x", assetId: "y" }]] as JsonValue[]) {
      expect(() => planSampleRefs(plan([node("p", "m.percussion", { slots })]))).not.toThrow();
    }
  });

  it("finds references across several nodes at once", () => {
    const refs = planSampleRefs(
      plan([
        node("l", "m.looper", { "asset-id": "a" }),
        node("g", "m.granular", { "asset-id": "b" }),
      ]),
    );
    expect(refs.map((ref) => ref.assetId).sort()).toEqual(["a", "b"]);
  });
});

describe("SampleSlots", () => {
  it("gives each asset a stable number", () => {
    const slots = new SampleSlots();
    const first = slots.slotFor("sha-a");
    expect(slots.slotFor("sha-a")).toBe(first);
    expect(slots.slotFor("sha-b")).not.toBe(first);
  });

  it("counts an asset as unsent until it is marked", () => {
    // The engine addresses samples by number; the document names them by
    // content hash. Nothing may assume a number is loaded just because it has
    // been assigned.
    const slots = new SampleSlots();
    slots.slotFor("sha-a");
    expect(slots.isLoaded("sha-a")).toBe(false);
    slots.markLoaded("sha-a");
    expect(slots.isLoaded("sha-a")).toBe(true);
  });

  it("reports the mapping the worklet needs to resolve a plan", () => {
    const slots = new SampleSlots();
    slots.slotFor("sha-a");
    slots.slotFor("sha-b");
    expect(slots.table()).toEqual({ "sha-a": 0, "sha-b": 1 });
  });

  it("forgets everything on reset, because the engine's bank went with it", () => {
    // `init` rebuilds the rack and its bank; ids the old one issued mean
    // nothing to the new one, and believing otherwise plays the wrong sample.
    const slots = new SampleSlots();
    slots.slotFor("sha-a");
    slots.markLoaded("sha-a");
    slots.reset();
    expect(slots.isLoaded("sha-a")).toBe(false);
    expect(slots.slotFor("sha-a")).toBe(0);
  });

  it("stops assigning past its ceiling rather than growing without limit", () => {
    // A long session dropping hundreds of files must not allocate a slot per
    // file forever; past the ceiling the transfer is refused and the sampler
    // stays silent, which is recoverable.
    const slots = new SampleSlots(2);
    expect(slots.slotFor("a")).toBe(0);
    expect(slots.slotFor("b")).toBe(1);
    expect(slots.slotFor("c")).toBeUndefined();
    // An already-known asset still resolves after the ceiling is reached.
    expect(slots.slotFor("a")).toBe(0);
  });
});
