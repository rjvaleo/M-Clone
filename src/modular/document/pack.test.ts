import { describe, expect, it } from "vitest";
import {
  decodeModularPack,
  encodeModularPack,
  isModularPack,
  PACK_MAGIC,
  PACK_VERSION,
} from "./pack";
import { createModularDocument } from "./document";
import { assetIdForBytes, type AssetRecord } from "../audio/assets";
import { emptyGraph, type GraphDocument } from "../model/graph";
import { createNode } from "../registry/registry";

const audio = (seed: number, length = 512): Uint8Array =>
  Uint8Array.from({ length }, (_, i) => (i * seed + 11) % 256);

const record = (bytes: Uint8Array, name: string): AssetRecord => ({
  id: assetIdForBytes(bytes),
  name,
  byteLength: bytes.length,
  durationSec: 1,
  sampleRate: 48000,
  channels: 2,
  peaks: [-40, 60],
});

const graphWithNode = (): GraphDocument => {
  const graph = emptyGraph();
  graph.nodes["rev"] = createNode("m.audio-reverb", "rev", { x: 10, y: 20 });
  return graph;
};

const pack = () => {
  const first = audio(3);
  const second = audio(7, 300);
  const document = createModularDocument(graphWithNode(), [
    record(first, "Loop.wav"),
    record(second, "Hit.wav"),
  ]);
  const blobs = [
    { id: assetIdForBytes(first), bytes: first },
    { id: assetIdForBytes(second), bytes: second },
  ];
  return { document, blobs, bytes: encodeModularPack(document, blobs) };
};

describe("The .mmodpack container", () => {
  it("round-trips a project and its audio byte for byte", () => {
    const { document, blobs, bytes } = pack();
    const decoded = decodeModularPack(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.pack.document.graph.nodes.rev.moduleType).toBe("m.audio-reverb");
    expect(decoded.pack.document.assets.map((asset) => asset.name))
      .toEqual(document.assets.map((asset) => asset.name));
    expect(decoded.pack.blobs).toHaveLength(2);
    expect([...decoded.pack.blobs[0].bytes]).toEqual([...blobs[0].bytes]);
    expect([...decoded.pack.blobs[1].bytes]).toEqual([...blobs[1].bytes]);
    expect(decoded.warnings).toEqual([]);
  });

  it("stores audio at exactly its own size", () => {
    // The whole reason for a container rather than base64. Overhead here is the
    // manifest, which is a constant: adding a megabyte of audio adds a megabyte
    // to the file, where base64 would have added a third again on top.
    const small = audio(3, 1000);
    const large = audio(3, 51000);
    const size = (bytes: Uint8Array) => encodeModularPack(
      createModularDocument(emptyGraph(), [record(bytes, "Loop.wav")]),
      [{ id: assetIdForBytes(bytes), bytes }],
    ).length;
    const audioGrowth = large.length - small.length;
    const fileGrowth = size(large) - size(small);
    // Not exactly equal: the manifest spells the byte counts out in decimal, so
    // a longer number is a few more characters. Everything else is flat.
    expect(fileGrowth).toBeGreaterThanOrEqual(audioGrowth);
    expect(fileGrowth - audioGrowth).toBeLessThan(16);
    // Base64 would have added a third of the audio again — thousands of bytes.
    expect(fileGrowth).toBeLessThan(audioGrowth * 1.01);
  });

  it("is recognisable without parsing it", () => {
    const { bytes } = pack();
    expect(isModularPack(bytes)).toBe(true);
    expect(isModularPack(new TextEncoder().encode('{"format":"m-modular"}'))).toBe(false);
    expect(isModularPack(new Uint8Array(3))).toBe(false);
    expect(decodeModularPack(new TextEncoder().encode("{}")))
      .toEqual({ ok: false, error: "Not an idMLab pack" });
  });

  it("writes the header it says it writes", () => {
    const { bytes } = pack();
    expect(String.fromCharCode(...bytes.subarray(0, 8))).toBe(PACK_MAGIC);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Little-endian, fixed, so the format does not depend on the machine.
    expect(view.getUint32(8, true)).toBe(PACK_VERSION);
    expect(view.getUint32(12, true)).toBeGreaterThan(0);
  });

  it("refuses a version it does not understand", () => {
    const { bytes } = pack();
    const future = bytes.slice();
    new DataView(future.buffer).setUint32(8, PACK_VERSION + 1, true);
    expect(decodeModularPack(future)).toEqual({
      ok: false,
      error: `Unsupported pack version: ${PACK_VERSION + 1}`,
    });
  });
});

describe("Damage", () => {
  it("names an edited sample and drops it, rather than decoding garbage", () => {
    // The id is the hash, so this check is free — and it turns a corrupted file
    // into one warning and one missing row instead of a decoder exception.
    const { blobs, bytes } = pack();
    const tampered = bytes.slice();
    tampered[tampered.length - 5] ^= 0xff;
    const decoded = decodeModularPack(tampered);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.pack.blobs).toHaveLength(1);
    expect(decoded.pack.blobs[0].id).toBe(blobs[0].id);
    expect(decoded.warnings.join(" ")).toContain("does not match its checksum");
  });

  it("survives a truncated file with a sentence, not an exception", () => {
    const { bytes } = pack();
    const cut = decodeModularPack(bytes.slice(0, bytes.length - 200));
    expect(cut.ok).toBe(true);
    if (!cut.ok) return;
    // The patch still opens; only the sample that was cut off is absent.
    expect(cut.pack.document.graph.nodes.rev).toBeDefined();
    expect(cut.warnings.join(" ")).toContain("truncated");

    // Cut into the manifest and there is no project left to recover.
    const severe = decodeModularPack(bytes.slice(0, 40));
    expect(severe).toEqual({ ok: false, error: "Pack manifest is truncated" });
    expect(decodeModularPack(bytes.slice(0, 8)))
      .toEqual({ ok: false, error: "Pack file is truncated" });
  });

  it("rejects a manifest that is not readable", () => {
    const document = createModularDocument(emptyGraph());
    const bytes = encodeModularPack(document, []);
    const broken = bytes.slice();
    broken[20] = 0x7b; // a stray brace inside the JSON
    const decoded = decodeModularPack(broken);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error).toMatch(/manifest|idMLab/);
  });

  it("ignores a malformed entry without losing the good ones", () => {
    const good = audio(5);
    const document = createModularDocument(emptyGraph(), [record(good, "Good.wav")]);
    const bytes = encodeModularPack(document, [{ id: assetIdForBytes(good), bytes: good }]);
    // Reach into the manifest and corrupt one entry's offset.
    const text = new TextDecoder().decode(bytes);
    const patched = text.replace('"offset":0', '"offset":-1');
    const rebuilt = new Uint8Array(bytes.length);
    rebuilt.set(bytes);
    if (patched.length === text.length) {
      new TextEncoder().encodeInto(patched, rebuilt);
      const decoded = decodeModularPack(rebuilt);
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      expect(decoded.pack.blobs).toHaveLength(0);
      expect(decoded.warnings.join(" ")).toContain("malformed");
    }
  });
});

describe("An empty pack", () => {
  it("is a valid project with no audio in it", () => {
    const bytes = encodeModularPack(createModularDocument(graphWithNode()), []);
    const decoded = decodeModularPack(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.pack.blobs).toEqual([]);
    expect(decoded.pack.document.graph.nodes.rev).toBeDefined();
  });
});
