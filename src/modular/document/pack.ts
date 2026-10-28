// `.idmlabpack` — a project and its samples in one file.
//
// A `.idmlab` is a patch: JSON, readable, small, and it describes the samples it
// uses without carrying them. That is the right default for a working file and
// the wrong one for handing a project to somebody else, so this is the other
// format — the same document with the audio appended.
//
// ## Why a container rather than base64 in the JSON
//
// Base64 would have been about twenty lines. It also costs a third more bytes
// and, worse, forces the whole file through `JSON.parse` as a single string:
// a project with a few hundred megabytes of loops stops being slow and starts
// being impossible. Appending the bytes raw means the size on disk is the size
// of the audio, the manifest is parsed on its own, and a reader can seek to one
// sample without materialising the rest.
//
// ## Layout
//
//   magic        8 bytes   "MMODPACK"
//   version      uint32    little-endian
//   manifestLen  uint32    little-endian, bytes of UTF-8 JSON
//   manifest     JSON      { document, blobs: [{ id, offset, length }] }
//   blobs        raw       concatenated, offsets relative to the blob region
//
// Little-endian because every platform this runs on is, and fixing the byte
// order is what keeps the format from depending on the machine that wrote it.
//
// ## What makes it trustworthy
//
// Every blob is verified on read: its bytes are hashed and checked against the
// id claiming them. That is not ceremony — the id *is* the hash, so the check
// is free, and it turns the two realistic failures (a truncated download, an
// edited file) into a named warning and a missing sample rather than a decoder
// throwing on garbage. It is an integrity check, not a security boundary: the
// hash is not cryptographic and a deliberate forgery is not in scope.

import { assetIdForBytes } from "../audio/assets";
import { decodeModularDocument, type ModularDocument } from "./document";

export const PACK_MAGIC = "MMODPACK";
export const PACK_VERSION = 1;

const MAGIC_BYTES = 8;
const HEADER_BYTES = MAGIC_BYTES + 4 + 4;

export type PackBlob = { id: string; bytes: Uint8Array };

export type ModularPack = {
  document: ModularDocument;
  blobs: PackBlob[];
};

export type PackDecodeResult =
  | { ok: true; pack: ModularPack; warnings: string[] }
  | { ok: false; error: string };

type PackManifest = {
  document: unknown;
  blobs: { id: string; offset: number; length: number }[];
};

/** Write a project and its samples as one file. */
export function encodeModularPack(
  document: ModularDocument,
  blobs: readonly PackBlob[],
): Uint8Array {
  const index: PackManifest["blobs"] = [];
  let offset = 0;
  for (const blob of blobs) {
    index.push({ id: blob.id, offset, length: blob.bytes.length });
    offset += blob.bytes.length;
  }

  const manifest = new TextEncoder().encode(JSON.stringify({ document, blobs: index }));
  const total = HEADER_BYTES + manifest.length + offset;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  for (let i = 0; i < MAGIC_BYTES; i++) out[i] = PACK_MAGIC.charCodeAt(i);
  view.setUint32(MAGIC_BYTES, PACK_VERSION, true);
  view.setUint32(MAGIC_BYTES + 4, manifest.length, true);
  out.set(manifest, HEADER_BYTES);

  // Written by position rather than by looking the id back up, so two entries
  // that somehow share an id cannot land on the same offset.
  const blobStart = HEADER_BYTES + manifest.length;
  blobs.forEach((blob, i) => out.set(blob.bytes, blobStart + index[i].offset));
  return out;
}

/** Whether a file is a pack, decided without parsing any of it. */
export function isModularPack(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC_BYTES) return false;
  for (let i = 0; i < MAGIC_BYTES; i++) {
    if (bytes[i] !== PACK_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Read a pack.
 *
 * Every length is checked against what is actually there before it is used,
 * because a truncated file is the ordinary case — a download that stopped, a
 * copy that ran out of disk — and it must produce a sentence rather than an
 * exception from deep inside a decoder.
 */
export function decodeModularPack(bytes: Uint8Array): PackDecodeResult {
  if (!isModularPack(bytes)) return { ok: false, error: "Not an idMLab pack" };
  if (bytes.length < HEADER_BYTES) return { ok: false, error: "Pack file is truncated" };

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(MAGIC_BYTES, true);
  if (version !== PACK_VERSION) {
    return { ok: false, error: `Unsupported pack version: ${version}` };
  }
  const manifestLength = view.getUint32(MAGIC_BYTES + 4, true);
  const blobStart = HEADER_BYTES + manifestLength;
  if (blobStart > bytes.length) return { ok: false, error: "Pack manifest is truncated" };

  let manifest: PackManifest;
  try {
    manifest = JSON.parse(
      new TextDecoder().decode(bytes.subarray(HEADER_BYTES, blobStart)),
    ) as PackManifest;
  } catch {
    return { ok: false, error: "Pack manifest is not valid JSON" };
  }
  if (typeof manifest !== "object" || manifest === null || !Array.isArray(manifest.blobs)) {
    return { ok: false, error: "Pack manifest is malformed" };
  }

  const decoded = decodeModularDocument(manifest.document);
  if (!decoded.ok) return { ok: false, error: decoded.error };

  const warnings = [...decoded.warnings];
  const blobs: PackBlob[] = [];
  // A warning that names `f33c961178bad95b` tells the reader nothing. The
  // document already knows what each id was called, so say that instead.
  const names = new Map(decoded.document.assets.map((asset) => [asset.id, asset.name]));
  const describe = (id: string) => names.get(id) ?? id;
  for (const entry of manifest.blobs) {
    if (typeof entry?.id !== "string"
      || !Number.isInteger(entry.offset) || entry.offset < 0
      || !Number.isInteger(entry.length) || entry.length < 0) {
      warnings.push("Ignored a malformed pack entry");
      continue;
    }
    const from = blobStart + entry.offset;
    const to = from + entry.length;
    if (to > bytes.length) {
      warnings.push(`${describe(entry.id)} is truncated and was not loaded`);
      continue;
    }
    const blob = bytes.slice(from, to);
    // The id is the hash, so verifying costs one pass and catches the two
    // failures that actually happen: a truncated copy and an edited file.
    if (assetIdForBytes(blob) !== entry.id) {
      warnings.push(`${describe(entry.id)} does not match its checksum and was not loaded`);
      continue;
    }
    blobs.push({ id: entry.id, bytes: blob });
  }

  return { ok: true, pack: { document: decoded.document, blobs }, warnings };
}
