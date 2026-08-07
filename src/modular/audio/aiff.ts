/**
 * An AIFF reader, because Chrome does not have one.
 *
 * `decodeAudioData` is the right first choice for everything — it is native,
 * fast, and handles the compressed formats nobody wants to implement. But it
 * is the *browser's* decoder, and Chromium ships no AIFF support at all: a
 * plain uncompressed `.aif` comes back as "Unable to decode audio data" while
 * the same file opens in Safari and in every audio application on the machine.
 *
 * That is not an edge case for this project. A real sample library, of the
 * kind someone has been keeping since the nineties, is mostly AIFF — the two
 * folders this was written for hold 234 of them against 36 WAVs. Without this
 * the sound pool silently refuses six files in seven.
 *
 * The format is simple enough that reading it is easier than explaining why we
 * do not. Everything here is uncompressed PCM; anything genuinely compressed
 * is refused rather than guessed at, because misreading µ-law as PCM produces
 * confident noise instead of an error.
 */

/** Planar audio, the shape everything downstream wants. */
export interface AiffAudio {
  sampleRate: number;
  /** One `Float32Array` per channel, in −1…1. */
  channels: Float32Array[];
}

const FORM = 0x464f524d; // "FORM"
const AIFF = 0x41494646; // "AIFF"
const AIFC = 0x41494643; // "AIFC" — the same container, with a compression id

const tag = (view: DataView, at: number): number => view.getUint32(at, false);

/**
 * Whether these bytes are worth handing to `decodeAiff`.
 *
 * Cheap enough to call before the browser has tried and failed, though the
 * caller does it the other way round — see `decode.ts` for why.
 */
export function looksLikeAiff(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (tag(view, 0) !== FORM) return false;
  const form = tag(view, 8);
  return form === AIFF || form === AIFC;
}

/**
 * The sample rate, stored as an 80-bit IEEE 754 extended float.
 *
 * A ten-byte format from 1988 that JavaScript has no type for, so it is
 * assembled by hand: one sign bit, fifteen exponent bits biased by 16383, and
 * a 64-bit mantissa whose leading bit is explicit rather than implied.
 */
function extendedFloat(view: DataView, at: number): number {
  const exponent = view.getUint16(at, false);
  const high = view.getUint32(at + 2, false);
  const low = view.getUint32(at + 6, false);
  if (exponent === 0 && high === 0 && low === 0) return 0;

  const sign = exponent & 0x8000 ? -1 : 1;
  const unbiased = (exponent & 0x7fff) - 16383;
  // The mantissa is explicit, so its value is `high.low` scaled down by 63 —
  // not 64 — because the leading one is part of the number rather than assumed.
  const mantissa = high * 2 ** 32 + low;
  return sign * mantissa * 2 ** (unbiased - 63);
}

/**
 * The depths this reader handles.
 *
 * A union rather than a number so `readSample` is exhaustive by construction:
 * the check that a file's depth is one of these happens once, in `decodeAiff`,
 * and there is no unreachable fallback branch left over to wonder about.
 */
export type SampleBits = 8 | 16 | 24 | 32;

const SUPPORTED_BITS: readonly number[] = [8, 16, 24, 32];

const isSupportedBits = (bits: number): bits is SampleBits => SUPPORTED_BITS.includes(bits);

/** One sample, as a float in −1…1. */
function readSample(
  view: DataView,
  at: number,
  bits: SampleBits,
  littleEndian: boolean,
): number {
  switch (bits) {
    case 8:
      // 8-bit AIFF is signed, unlike 8-bit WAV. Reading it unsigned puts
      // silence at half scale, which sounds like a DC thump on every hit.
      return view.getInt8(at) / 128;
    case 16:
      // Divided by 32768 rather than 32767 so that full-scale negative is
      // exactly −1 and no sample can exceed the range in either direction.
      return view.getInt16(at, littleEndian) / 32768;
    case 24: {
      const bytes = littleEndian
        ? [view.getUint8(at + 2), view.getUint8(at + 1), view.getUint8(at)]
        : [view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2)];
      const raw = (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
      // Sign-extend the 24-bit value into 32 bits before scaling.
      const signed = raw & 0x800000 ? raw - 0x1000000 : raw;
      return signed / 0x800000;
    }
    case 32:
      return view.getInt32(at, littleEndian) / 0x80000000;
  }
}

/** Compression ids that mean "these are ordinary samples". */
const UNCOMPRESSED = new Set(["NONE", "sowt", "twos", "in24", "in32", "\0\0\0\0", "    "]);
/** …of which these are little-endian rather than the format's usual big. */
const BYTE_SWAPPED = new Set(["sowt", "in24", "in32"]);

/**
 * Decode an uncompressed AIFF or AIFC.
 *
 * `null` rather than a throw for every refusal — a malformed or compressed
 * file is a normal thing to be handed when someone drops a folder, and the
 * caller reports it alongside the files that worked.
 */
export function decodeAiff(bytes: Uint8Array): AiffAudio | null {
  if (!looksLikeAiff(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let channelCount = 0;
  let frameCount = 0;
  let bits = 0;
  let sampleRate = 0;
  let compression = "NONE";
  let soundAt = -1;
  let soundBytes = 0;

  // Walk the chunk list rather than assuming an order. Real files carry
  // markers, instrument and application chunks in whatever order the writer
  // felt like, and a reader that stopped at the first unfamiliar one would
  // decode almost nothing.
  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const id = tag(view, at);
    const size = view.getUint32(at + 4, false);
    const body = at + 8;

    if (id === 0x434f4d4d && body + 18 <= bytes.byteLength) {
      // "COMM"
      channelCount = view.getInt16(body, false);
      frameCount = view.getUint32(body + 2, false);
      bits = view.getInt16(body + 6, false);
      sampleRate = Math.round(extendedFloat(view, body + 8));
      if (size >= 22 && body + 22 <= bytes.byteLength) {
        compression = String.fromCharCode(
          view.getUint8(body + 18),
          view.getUint8(body + 19),
          view.getUint8(body + 20),
          view.getUint8(body + 21),
        );
      }
    } else if (id === 0x53534e44) {
      // "SSND". The first eight bytes are an offset and a block size, both
      // almost always zero; the samples start after them.
      const offset = body + 8 <= bytes.byteLength ? view.getUint32(body, false) : 0;
      soundAt = body + 8 + offset;
      soundBytes = Math.max(0, size - 8 - offset);
    }

    // Chunks are padded to an even length, and the pad byte is not counted in
    // the declared size. Missing this walks into the middle of the next chunk.
    at = body + size + (size % 2);
  }

  if (channelCount <= 0 || frameCount <= 0 || soundAt < 0) return null;
  if (!isSupportedBits(bits)) return null;
  if (!UNCOMPRESSED.has(compression)) return null;

  const bytesPerSample = bits / 8;
  const frameBytes = bytesPerSample * channelCount;
  // Trust the smaller of what the header claims and what is actually present,
  // so a truncated file yields the audio it has rather than reading past the
  // end of the buffer.
  const available = Math.min(soundBytes, bytes.byteLength - soundAt);
  const frames = Math.min(frameCount, Math.floor(available / frameBytes));
  if (frames <= 0) return null;

  const littleEndian = BYTE_SWAPPED.has(compression);
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
  for (let frame = 0; frame < frames; frame += 1) {
    const base = soundAt + frame * frameBytes;
    for (let channel = 0; channel < channelCount; channel += 1) {
      channels[channel][frame] = readSample(
        view,
        base + channel * bytesPerSample,
        bits,
        littleEndian,
      );
    }
  }

  return { sampleRate: sampleRate > 0 ? sampleRate : 44100, channels };
}
