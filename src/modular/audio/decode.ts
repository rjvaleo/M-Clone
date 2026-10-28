// Turning dropped bytes into a pool entry.
//
// Short, but with one trap in it worth naming. `decodeAudioData` **detaches**
// the ArrayBuffer it is given: after the call the caller's view is a zero-length
// husk. The prototype never noticed because it re-read the file from disk for
// every use, but here the same bytes are needed twice — once to hash into the
// asset id, once to decode — and doing those in the wrong order yields an id
// computed over nothing. Every file would hash identically, so every sample
// would be the same asset.
//
// So the id is taken first, from the caller's own bytes, and the decoder is
// handed a copy it may destroy.

import { assetIdForBytes, type AssetRecord } from "./assets";
import { decodeAiff } from "./aiff";
import { computePeaks } from "./waveform";
import type { AudioBufferLike, SampleContext } from "./nodes";

export type DecodedAsset = {
  record: AssetRecord;
  buffer: AudioBufferLike;
  /** The file as dropped, kept so the project can be bundled with its samples. */
  source: Uint8Array;
};

export type DecodeFailure = { name: string; reason: string };

export type DecodeResult =
  | { ok: true; asset: DecodedAsset }
  | { ok: false; failure: DecodeFailure };

/** Every channel of a decoded buffer, for peak extraction. */
export const channelData = (buffer: AudioBufferLike): Float32Array[] =>
  Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));

/**
 * Decode one file into an asset record and its audio.
 *
 * Failure is returned rather than thrown: a user dropping a folder of files
 * gets the ones that worked plus a message naming the ones that did not, which
 * is more useful than one rejected promise taking the whole drop with it.
 */
export async function decodeAsset(
  context: SampleContext,
  name: string,
  bytes: Uint8Array,
): Promise<DecodeResult> {
  if (bytes.length === 0) {
    return { ok: false, failure: { name, reason: "File is empty" } };
  }
  // Identity first, from bytes that are still ours.
  const id = assetIdForBytes(bytes);
  // `slice` copies; the decoder is welcome to detach this one.
  const copy = bytes.slice().buffer;

  let buffer: AudioBufferLike;
  try {
    buffer = await context.decodeAudioData(copy);
  } catch (error) {
    // The browser first, us second. `decodeAudioData` is native and handles
    // the compressed formats nobody wants to reimplement — but Chromium ships
    // no AIFF decoder at all, and a real sample library is mostly AIFF. So a
    // refusal is a question rather than an answer: ask our own reader before
    // reporting failure.
    //
    // `bytes` rather than `copy`, because `decodeAudioData` detached `copy` on
    // its way to rejecting — the same trap this file's header warns about, one
    // step further along.
    const aiff = decodeAiff(bytes);
    if (!aiff) {
      return {
        ok: false,
        failure: {
          name,
          reason: error instanceof Error ? error.message : "Could not decode audio",
        },
      };
    }
    buffer = context.createBuffer(
      aiff.channels.length,
      aiff.channels[0].length,
      aiff.sampleRate,
    );
    for (let channel = 0; channel < aiff.channels.length; channel += 1) {
      buffer.getChannelData(channel).set(aiff.channels[channel]);
    }
  }

  return {
    ok: true,
    asset: {
      buffer,
      // The caller's array, not another copy: the decoder detached the copy,
      // and this one is the bytes the id was taken from.
      source: bytes,
      record: {
        id,
        name,
        byteLength: bytes.length,
        durationSec: buffer.length / Math.max(1, buffer.sampleRate),
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels,
        peaks: computePeaks(channelData(buffer)),
      },
    },
  };
}

/** Build a record for audio this session generated rather than decoded. */
export function describeGeneratedAsset(
  id: string,
  name: string,
  buffer: AudioBufferLike,
  generator?: string,
): AssetRecord {
  return {
    id,
    name,
    ...(generator ? { generator } : {}),
    // Generated audio has no file behind it, so its "size" is what it occupies
    // as float samples — the honest answer to how much memory it costs.
    byteLength: buffer.length * buffer.numberOfChannels * 4,
    durationSec: buffer.length / Math.max(1, buffer.sampleRate),
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    peaks: computePeaks(channelData(buffer)),
  };
}
