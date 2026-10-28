import { describe, expect, it } from "vitest";
import {
  AssetLibrary,
  assetIdForBytes,
  isAssetRecord,
  syntheticAssetId,
  type AssetRecord,
} from "./assets";
import { FakeBuffer } from "./testing/fakeContext";

const bytes = (...values: number[]) => Uint8Array.from(values);

const record = (overrides: Partial<AssetRecord> = {}): AssetRecord => ({
  id: assetIdForBytes(bytes(1, 2, 3, 4)),
  name: "Kick.wav",
  byteLength: 4,
  durationSec: 0.5,
  sampleRate: 48000,
  channels: 1,
  peaks: [-10, 20],
  ...overrides,
});

const buffer = () => new FakeBuffer(1, 24000, 48000);

describe("Content-addressed asset ids", () => {
  it("is the same id for the same bytes and a different one otherwise", () => {
    expect(assetIdForBytes(bytes(1, 2, 3))).toBe(assetIdForBytes(bytes(1, 2, 3)));
    expect(assetIdForBytes(bytes(1, 2, 3))).not.toBe(assetIdForBytes(bytes(1, 2, 4)));
    // Order is part of the content, not just the multiset of bytes.
    expect(assetIdForBytes(bytes(1, 2))).not.toBe(assetIdForBytes(bytes(2, 1)));
    // Length is mixed in, so a prefix is not the same asset.
    expect(assetIdForBytes(bytes(1, 2))).not.toBe(assetIdForBytes(bytes(1, 2, 0)));
  });

  it("is sixteen hex characters", () => {
    expect(assetIdForBytes(bytes(9))).toMatch(/^[0-9a-f]{16}$/);
    expect(assetIdForBytes(new Uint8Array(0))).toMatch(/^[0-9a-f]{16}$/);
  });

  it("spreads across a realistic pool without collisions", () => {
    // Sixty-four bits is chosen precisely so a pool of a few hundred samples
    // never sees the swapped-kick-for-snare failure a 32-bit id would allow.
    const ids = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      ids.add(assetIdForBytes(Uint8Array.from([i & 255, (i >> 8) & 255, i & 7, 200 - (i % 100)])));
    }
    expect(ids.size).toBe(4000);
  });

  it("gives generated material a stable id of its own", () => {
    expect(syntheticAssetId("kick")).toBe(syntheticAssetId("kick"));
    expect(syntheticAssetId("kick")).not.toBe(syntheticAssetId("snare"));
  });
});

describe("The asset library", () => {
  it("treats the same bytes dropped twice as one asset", () => {
    const library = new AssetLibrary();
    library.add(record({ name: "kick.wav" }), buffer());
    library.add(record({ name: "kick-copy.wav" }), buffer());
    expect(library.size).toBe(1);
    // The newer drop's name wins: it is what the user just called it.
    expect(library.list()[0].name).toBe("kick-copy.wav");
  });

  it("re-attaches a missing asset when its file comes back", () => {
    // The point of hashing the content: reopening a project and dropping the
    // same files restores them with no manual matching.
    const library = new AssetLibrary();
    library.hydrate([record()]);
    expect(library.missing()).toHaveLength(1);
    expect(library.buffer(record().id)).toBeUndefined();

    library.add(record(), buffer());
    expect(library.missing()).toHaveLength(0);
    expect(library.get(record().id)?.status).toBe("loaded");
    expect(library.buffer(record().id)).toBeDefined();
  });

  it("does not un-load audio the session already has", () => {
    const library = new AssetLibrary();
    library.add(record(), buffer());
    library.hydrate([record()]);
    expect(library.get(record().id)?.status).toBe("loaded");
  });

  it("keeps a stable order, so the pool does not reshuffle", () => {
    const library = new AssetLibrary();
    library.add(record({ id: "b", name: "Snare.wav" }), buffer());
    library.add(record({ id: "a", name: "Kick.wav" }), buffer());
    expect(library.list().map((entry) => entry.name)).toEqual(["Kick.wav", "Snare.wav"]);
  });

  it("puts identity and metadata in the manifest, and never the audio", () => {
    const library = new AssetLibrary();
    library.add(record(), buffer());
    const manifest = library.manifest();
    expect(manifest).toHaveLength(1);
    expect(manifest[0]).not.toHaveProperty("buffer");
    expect(manifest[0]).not.toHaveProperty("status");
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
    // A copy, so mutating the manifest cannot reach into the library.
    manifest[0].peaks.push(1);
    expect(library.manifest()[0].peaks).toEqual([-10, 20]);
  });

  it("survives a round trip through the manifest", () => {
    const library = new AssetLibrary();
    library.add(record(), buffer());
    const reopened = new AssetLibrary();
    reopened.hydrate(library.manifest());
    expect(reopened.list().map((entry) => entry.id)).toEqual([record().id]);
    expect(reopened.list()[0].status).toBe("missing");
    // The thumbnail survives, which is what makes a missing row still useful.
    expect(reopened.list()[0].peaks).toEqual([-10, 20]);
  });

  it("moves its revision on every change, and only on a change", () => {
    const library = new AssetLibrary();
    const start = library.revision;
    library.add(record(), buffer());
    expect(library.revision).toBeGreaterThan(start);
    const afterAdd = library.revision;
    expect(library.remove("not-here")).toBe(false);
    expect(library.revision).toBe(afterAdd);
    expect(library.remove(record().id)).toBe(true);
    expect(library.revision).toBeGreaterThan(afterAdd);
  });
});

describe("Reading an asset record from a document", () => {
  it("accepts a well-formed record", () => {
    expect(isAssetRecord(record())).toBe(true);
  });

  it("rejects anything that would break a row", () => {
    expect(isAssetRecord(null)).toBe(false);
    expect(isAssetRecord({ ...record(), id: "" })).toBe(false);
    expect(isAssetRecord({ ...record(), peaks: ["x"] })).toBe(false);
    expect(isAssetRecord({ ...record(), durationSec: -1 })).toBe(false);
    expect(isAssetRecord({ ...record(), durationSec: Number.NaN })).toBe(false);
    expect(isAssetRecord({ ...record(), name: 7 })).toBe(false);
  });
});
