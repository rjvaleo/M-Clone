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

/**
 * A pack with a manifest we chose, rather than one the encoder would write.
 *
 * Corrupting a real pack in place is unreliable — patching text inside a binary
 * changes its length — so the header is written here directly. This is the only
 * way to exercise what happens when a file arrives with a manifest the encoder
 * would never have produced, which is exactly the case the decoder exists for.
 */
const packWithManifest = (manifestText: string, ...blobs: Uint8Array[]): Uint8Array => {
  const manifest = new TextEncoder().encode(manifestText);
  const payload = blobs.reduce((total, blob) => total + blob.length, 0);
  const out = new Uint8Array(16 + manifest.length + payload);
  const view = new DataView(out.buffer);
  for (let i = 0; i < PACK_MAGIC.length; i++) out[i] = PACK_MAGIC.charCodeAt(i);
  view.setUint32(8, PACK_VERSION, true);
  view.setUint32(12, manifest.length, true);
  out.set(manifest, 16);
  let at = 16 + manifest.length;
  for (const blob of blobs) {
    out.set(blob, at);
    at += blob.length;
  }
  return out;
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
    const decoded = decodeModularPack(packWithManifest("{not json at all"));
    expect(decoded).toEqual({ ok: false, error: "Pack manifest is not valid JSON" });
  });

  it("rejects a manifest that parses but is not a manifest", () => {
    expect(decodeModularPack(packWithManifest('"a string"')))
      .toEqual({ ok: false, error: "Pack manifest is malformed" });
    expect(decodeModularPack(packWithManifest("null")))
      .toEqual({ ok: false, error: "Pack manifest is malformed" });
    expect(decodeModularPack(packWithManifest('{"document":{},"blobs":"lots"}')))
      .toEqual({ ok: false, error: "Pack manifest is malformed" });
  });

  it("passes on the reason the document inside will not open", () => {
    expect(decodeModularPack(packWithManifest('{"document":{},"blobs":[]}')))
      .toEqual({ ok: false, error: "Not an idMLab document" });
  });

  it("falls back to the raw id when the document does not name the sample", () => {
    // A blob the document knows nothing about: there is no filename to use, so
    // the warning has to say the id rather than say nothing.
    const decoded = decodeModularPack(packWithManifest(JSON.stringify({
      document: createModularDocument(emptyGraph()),
      blobs: [{ id: "0123456789abcdef", offset: 0, length: 64 }],
    })));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.warnings.join(" ")).toContain("0123456789abcdef is truncated");
  });

  it("ignores a malformed entry without losing the good ones", () => {
    // One entry with a negative offset and one with a length that is not a
    // whole number, either side of a good one.
    const good = audio(5, 16);
    const document = createModularDocument(emptyGraph(), [record(good, "Good.wav")]);
    const id = assetIdForBytes(good);
    const bytes = packWithManifest(JSON.stringify({
      document,
      blobs: [
        { id: 17, offset: 0, length: 16 },
        { id, offset: -1, length: 16 },
        { id, offset: 0, length: 1.5 },
        { id, offset: 0, length: 16 },
      ],
    }), good);

    const decoded = decodeModularPack(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.pack.blobs).toHaveLength(1);
    expect(decoded.pack.blobs[0].bytes).toEqual(good);
    expect(decoded.warnings.filter((line) => line.includes("malformed"))).toHaveLength(3);
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
