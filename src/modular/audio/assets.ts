// The sound pool: what a sample *is*, and how a project refers to one.
//
// The implementation plan asks for one thing here and is specific about it —
// **stable asset IDs rather than filesystem paths** (§10). The reason is not
// tidiness. A path is a fact about one machine at one moment: it breaks when a
// file moves, it silently points at different audio when a file is replaced,
// and it leaks the user's directory layout into a document they might share.
//
// So an id is derived from the *bytes*. Three properties fall out of that, and
// each of them is a thing the prototype's filename-keyed pool could not do:
//
//   1. **Dropping the same file twice is one asset**, whatever it was called.
//   2. **Re-dropping a file after reopening a project silently re-attaches it**,
//      because the id it hashes to is the id the document is asking for.
//   3. **A renamed file is the same sample**, and an edited one is a different
//      sample. That is the correct answer to both, and a path gets both wrong.
//
// What is *not* stored is the audio itself. A document is a patch, not a
// sample library; embedding ten megabytes of drum hits in a `.idmlab` would make
// saving slow and sharing worse. So the manifest carries identity and enough
// metadata to show the row — name, duration, and the thumbnail — and an asset
// whose bytes are not in this session is `missing` until it is dropped again.

import type { WaveformPeaks } from "./waveform";
import type { AudioBufferLike } from "./nodes";

export type AssetId = string;

/**
 * What the document remembers about a sample.
 *
 * Everything here is JSON, and everything here is enough to draw the row and
 * explain what is absent — which is exactly what a project needs to reopen
 * honestly rather than pretending the sample is still there.
 */
export type AssetRecord = {
  id: AssetId;
  /** The dropped file's name. Display only — identity is the id. */
  name: string;
  byteLength: number;
  durationSec: number;
  sampleRate: number;
  channels: number;
  peaks: WaveformPeaks;
  /**
   * Set when the audio is computed rather than loaded, as `kit:kick` and so on.
   *
   * A generated sample needs no bytes stored anywhere: the recipe reproduces it
   * exactly, because the generators are deterministic. So a project bundle
   * carries this string instead of half a megabyte of pad, and a session that
   * has never seen the sample can still make it.
   */
  generator?: string;
};

export type AssetStatus = "loaded" | "missing";

export type AssetEntry = AssetRecord & {
  status: AssetStatus;
  /** Present only when the bytes are in this session. */
  buffer?: AudioBufferLike;
  /**
   * The file exactly as it was dropped, kept so a project can be bundled with
   * its samples.
   *
   * The *encoded* file, not the decoded audio: it is what the id hashes, it is
   * an order of magnitude smaller than the PCM, and it is what a future session
   * has to feed back through `decodeAudioData` to get the same result. Storing
   * decoded samples instead would be larger, lossier to re-encode, and would
   * sever the id from the thing it identifies.
   */
  source?: Uint8Array;
};

/**
 * A 64-bit content id, as sixteen hex characters.
 *
 * Two independent FNV-1a passes with different offset bases, plus the length,
 * rather than one 32-bit hash: a pool of a few hundred samples would see a
 * 32-bit collision about once in fifty thousand sessions, which is rare enough
 * to never be caught in testing and frequent enough to eventually swap someone's
 * kick for their snare. Sixty-four bits puts that beyond reach. This is not a
 * cryptographic hash and is not meant to resist a forged collision — nothing
 * here is a security boundary.
 */
export function assetIdForBytes(bytes: Uint8Array): AssetId {
  let low = 0x811c9dc5;
  let high = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    low ^= bytes[i];
    low = Math.imul(low, 0x01000193) >>> 0;
    // The second pass walks the same bytes with a different multiplier and an
    // index term, so the two hashes cannot agree by construction.
    high ^= bytes[i] + i;
    high = Math.imul(high, 0x85ebca6b) >>> 0;
  }
  high = (high ^ bytes.length) >>> 0;
  return hex(low) + hex(high);
}

/** Ids for material this session generated rather than decoded from a file. */
export const syntheticAssetId = (name: string): AssetId =>
  assetIdForBytes(new TextEncoder().encode(`synthetic:${name}`));

const hex = (value: number): string => (value >>> 0).toString(16).padStart(8, "0");

/**
 * The pool.
 *
 * Deliberately not a React state object: decoded buffers are large, they are
 * not comparable, and they must survive a re-render. The UI reads `list()`,
 * which is plain data.
 */
export class AssetLibrary {
  private readonly entries = new Map<AssetId, AssetEntry>();
  private version = 0;

  /** Bumped on every change, so a view can re-read without deep comparison. */
  get revision(): number {
    return this.version;
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Add or complete an asset.
   *
   * Adding an id that is already loaded is not an error and not a duplicate —
   * it is the same audio, so the existing entry is kept and only the name is
   * taken from the newer drop. Adding one that was `missing` re-attaches it,
   * which is what makes reopening a project and re-dropping the files work
   * without the user matching anything up by hand.
   */
  add(record: AssetRecord, buffer: AudioBufferLike, source?: Uint8Array): AssetEntry {
    const existing = this.entries.get(record.id);
    const entry: AssetEntry = existing
      ? { ...existing, ...record, name: record.name, status: "loaded", buffer }
      : { ...record, status: "loaded", buffer };
    // Never dropped by a later add: a second drop of the same file arrives with
    // the same bytes, and an add from a bundle may arrive without them.
    if (source) entry.source = source;
    this.entries.set(record.id, entry);
    this.version += 1;
    return entry;
  }

  /** Take a saved manifest, with nothing loaded until the bytes arrive. */
  hydrate(records: readonly AssetRecord[]): void {
    for (const record of records) {
      const existing = this.entries.get(record.id);
      // A session that already has the audio keeps it: reopening a project
      // must not un-load a sample that is sitting right there.
      if (existing?.status === "loaded") continue;
      this.entries.set(record.id, { ...record, status: "missing" });
    }
    this.version += 1;
  }

  get(id: AssetId): AssetEntry | undefined {
    return this.entries.get(id);
  }

  /** The decoded audio, or undefined when the asset is missing. */
  buffer(id: AssetId): AudioBufferLike | undefined {
    return this.entries.get(id)?.buffer;
  }

  remove(id: AssetId): boolean {
    const removed = this.entries.delete(id);
    if (removed) this.version += 1;
    return removed;
  }

  clear(): void {
    this.entries.clear();
    this.version += 1;
  }

  /** Every asset, ordered by name so the pool does not reshuffle on reload. */
  list(): AssetEntry[] {
    return [...this.entries.values()].sort((a, b) =>
      a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /** Ids the document refers to but this session cannot play. */
  missing(): AssetEntry[] {
    return this.list().filter((entry) => entry.status === "missing");
  }

  /** The original file for an asset, when this session still has it. */
  source(id: AssetId): Uint8Array | undefined {
    return this.entries.get(id)?.source;
  }

  /**
   * What a bundle has to carry: the samples that are neither reproducible nor
   * already inside it.
   *
   * A generated asset is deliberately absent — its record names the recipe, and
   * writing the pad's four seconds of audio into every project that uses it
   * would be storing something the code can compute.
   */
  packable(): { id: AssetId; bytes: Uint8Array }[] {
    return this.list()
      .filter((entry) => entry.source !== undefined && entry.generator === undefined)
      .map((entry) => ({ id: entry.id, bytes: entry.source as Uint8Array }));
  }

  /**
   * Assets a bundle could not include, so the UI can say so before writing one.
   *
   * This is the honest limit of "self-contained": a project opened from a
   * manifest, never given the files, and saved again cannot conjure audio it
   * has never had.
   */
  unbundlable(): AssetEntry[] {
    return this.list().filter((entry) =>
      entry.generator === undefined && entry.source === undefined);
  }

  /** What goes in the document: identity and metadata, never the audio. */
  manifest(): AssetRecord[] {
    return this.list().map(({ status, buffer, source, ...record }) => {
      void status;
      void buffer;
      void source;
      return { ...record, peaks: [...record.peaks] };
    });
  }
}

/** Whether a value read from a document is a usable asset record. */
export function isAssetRecord(value: unknown): value is AssetRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && record.id.length > 0
    && typeof record.name === "string"
    && isCount(record.byteLength)
    && isCount(record.durationSec)
    && isCount(record.sampleRate)
    && isCount(record.channels)
    && Array.isArray(record.peaks)
    && record.peaks.every((peak) => typeof peak === "number" && Number.isFinite(peak))
    && (record.generator === undefined || typeof record.generator === "string");
}

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
