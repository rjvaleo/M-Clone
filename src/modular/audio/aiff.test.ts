import { describe, expect, it } from "vitest";
import { decodeAiff, looksLikeAiff } from "./aiff";

/**
 * The 80-bit IEEE extended form AIFF stores its sample rate in.
 *
 * Built with BigInt because the mantissa is 64 bits and explicit: the leading
 * one is part of the number rather than implied, which is the detail that
 * makes this different from an IEEE double. Verified against a real file —
 * 44100 encodes as 400eac44000000000000.
 */
const extended = (rate: number): number[] => {
  if (rate === 0) return new Array(10).fill(0);
  let exponent = Math.floor(Math.log2(rate));
  // Scale so the mantissa sits in [2^63, 2^64).
  let mantissa = BigInt(Math.round(rate / 2 ** exponent * 2 ** 63));
  if (mantissa >= 1n << 64n) {
    mantissa >>= 1n;
    exponent += 1;
  }
  const biased = exponent + 16383;
  const bytes = [(biased >> 8) & 0xff, biased & 0xff];
  for (let i = 7; i >= 0; i -= 1) {
    bytes.push(Number((mantissa >> BigInt(i * 8)) & 0xffn));
  }
  return bytes;
};

const chunk = (id: string, body: number[]): number[] => {
  const size = body.length;
  const padded = size % 2 === 1 ? [...body, 0] : body;
  return [
    ...[...id].map((c) => c.charCodeAt(0)),
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    ...padded,
  ];
};

type Options = {
  channels?: number;
  bits?: number;
  rate?: number;
  form?: string;
  compression?: string;
  /** Raw sample bytes, already in the file's byte order. */
  data?: number[];
  frames?: number;
  omitSsnd?: boolean;
};

const buildAiff = (options: Options = {}): Uint8Array => {
  const channels = options.channels ?? 1;
  const bits = options.bits ?? 16;
  const rate = options.rate ?? 44100;
  const data = options.data ?? [];
  const frames = options.frames ?? data.length / ((bits / 8) * channels);

  const comm = [
    (channels >> 8) & 0xff,
    channels & 0xff,
    (frames >>> 24) & 0xff,
    (frames >>> 16) & 0xff,
    (frames >>> 8) & 0xff,
    frames & 0xff,
    (bits >> 8) & 0xff,
    bits & 0xff,
    ...extended(rate),
    ...(options.compression ? [...options.compression].map((c) => c.charCodeAt(0)) : []),
  ];
  const ssnd = [0, 0, 0, 0, 0, 0, 0, 0, ...data];
  const body = [
    ...[...(options.form ?? "AIFF")].map((c) => c.charCodeAt(0)),
    ...chunk("COMM", comm),
    ...(options.omitSsnd ? [] : chunk("SSND", ssnd)),
  ];
  return new Uint8Array([
    ...[..."FORM"].map((c) => c.charCodeAt(0)),
    (body.length >>> 24) & 0xff,
    (body.length >>> 16) & 0xff,
    (body.length >>> 8) & 0xff,
    body.length & 0xff,
    ...body,
  ]);
};

/** Big-endian signed 16-bit. */
const be16 = (values: number[]): number[] =>
  values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]);

describe("Recognising an AIFF", () => {
  it("accepts a FORM/AIFF header", () => {
    expect(looksLikeAiff(buildAiff({ data: be16([0]) }))).toBe(true);
  });

  it("accepts AIFC, which is the same container", () => {
    expect(
      looksLikeAiff(buildAiff({ form: "AIFC", compression: "NONE", data: be16([0]) })),
    ).toBe(true);
  });

  it("rejects a WAV, which the browser can decode itself", () => {
    const wav = new Uint8Array([...[..."RIFF"].map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);
    expect(looksLikeAiff(wav)).toBe(false);
  });

  it("rejects something too short to have a header", () => {
    expect(looksLikeAiff(new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe("Decoding an AIFF", () => {
  it("reads 16-bit mono at full scale", () => {
    // The extremes matter: 32767 and -32768 are not symmetric, and dividing by
    // the wrong one either clips the negative peak or never reaches +1.
    const decoded = decodeAiff(buildAiff({ data: be16([0, 32767, -32768]) }))!;
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.channels).toHaveLength(1);
    expect(decoded.channels[0][0]).toBeCloseTo(0, 5);
    expect(decoded.channels[0][1]).toBeCloseTo(1, 4);
    expect(decoded.channels[0][2]).toBeCloseTo(-1, 4);
  });

  it("splits interleaved stereo into separate channels", () => {
    // AIFF interleaves; every consumer here wants planar, and getting this
    // backwards sounds like a sample playing at double speed in one ear.
    const decoded = decodeAiff(
      buildAiff({ channels: 2, data: be16([1000, -1000, 2000, -2000]) }),
    )!;
    expect(decoded.channels).toHaveLength(2);
    expect(decoded.channels[0][0]).toBeCloseTo(1000 / 32768, 4);
    expect(decoded.channels[1][0]).toBeCloseTo(-1000 / 32768, 4);
    expect(decoded.channels[0][1]).toBeCloseTo(2000 / 32768, 4);
    expect(decoded.channels[1][1]).toBeCloseTo(-2000 / 32768, 4);
  });

  it("reads 24-bit, which most of a real library is", () => {
    const sample = (v: number) => [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
    const decoded = decodeAiff(
      buildAiff({ bits: 24, data: [...sample(0x7fffff), ...sample(0x800000)] }),
    )!;
    expect(decoded.channels[0][0]).toBeCloseTo(1, 4);
    expect(decoded.channels[0][1]).toBeCloseTo(-1, 4);
  });

  it("reads 8-bit", () => {
    const decoded = decodeAiff(buildAiff({ bits: 8, data: [0, 127, 0x80] }))!;
    expect(decoded.channels[0][0]).toBeCloseTo(0, 5);
    // Signed 8-bit tops out at 127, which is one step short of full scale —
    // dividing by 128 keeps −128 at exactly −1 rather than overshooting it.
    expect(decoded.channels[0][1]).toBeCloseTo(127 / 128, 5);
    expect(decoded.channels[0][2]).toBeCloseTo(-1, 4);
  });

  it("reads 32-bit", () => {
    const be32 = (v: number) => [
      (v >>> 24) & 0xff,
      (v >>> 16) & 0xff,
      (v >>> 8) & 0xff,
      v & 0xff,
    ];
    const decoded = decodeAiff(buildAiff({ bits: 32, data: [...be32(0x7fffffff)] }))!;
    expect(decoded.channels[0][0]).toBeCloseTo(1, 4);
  });

  it("reads a byte-swapped AIFC, where the samples are little-endian", () => {
    // `sowt` is what a Mac DAW writes when it does not want to swap on save.
    // Read as big-endian it is loud noise rather than a wrong level, so it has
    // to be honoured rather than assumed.
    const decoded = decodeAiff(
      buildAiff({
        form: "AIFC",
        compression: "sowt",
        // 0x0100 little-endian is 0x0001 big-endian: a tiny positive value.
        data: [0x01, 0x00],
      }),
    )!;
    expect(decoded.channels[0][0]).toBeCloseTo(1 / 32768, 6);
  });

  it("reads byte-swapped 24-bit, which is what in24 means", () => {
    // The 24-bit path assembles its bytes by hand rather than asking DataView,
    // so its endianness is its own code and needs its own test.
    const decoded = decodeAiff(
      buildAiff({ form: "AIFC", compression: "in24", bits: 24, data: [0x00, 0x00, 0x7f] }),
    )!;
    // 0x7f0000 read the other way round: just under full scale, not near zero.
    expect(decoded.channels[0][0]).toBeCloseTo(0x7f0000 / 0x800000, 5);
  });

  it("reads the sample rate out of its 80-bit extended field", () => {
    for (const rate of [8000, 22050, 44100, 48000, 96000]) {
      const decoded = decodeAiff(buildAiff({ rate, data: be16([0]) }))!;
      expect(decoded.sampleRate).toBe(rate);
    }
  });

  it("stops at the frame count the header declares", () => {
    // A file whose SSND is padded past its frames would otherwise decode the
    // padding as a click on the end of every sample.
    const decoded = decodeAiff(
      buildAiff({ frames: 2, data: be16([100, 200, 300, 400]) }),
    )!;
    expect(decoded.channels[0]).toHaveLength(2);
  });

  it("returns null for a compression it cannot read rather than guessing", () => {
    // Reading µ-law as PCM produces something, and that something is noise.
    expect(decodeAiff(buildAiff({ form: "AIFC", compression: "ulaw", data: [0, 0] }))).toBeNull();
  });

  it("returns null when there is no sound chunk", () => {
    expect(decodeAiff(buildAiff({ omitSsnd: true }))).toBeNull();
  });

  it("returns null for a bit depth it does not know", () => {
    expect(decodeAiff(buildAiff({ bits: 12, data: [0, 0, 0] }))).toBeNull();
  });

  it("returns null for something that is not an AIFF at all", () => {
    expect(decodeAiff(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it("returns null for a header that claims no channels", () => {
    expect(decodeAiff(buildAiff({ channels: 0, data: be16([0]) }))).toBeNull();
  });

  it("survives a truncated file rather than reading past the end", () => {
    // A partly-copied file is a real thing to be handed, and it must fail as a
    // refusal rather than as an exception out of a decoder.
    const full = buildAiff({ data: be16([1000, 2000, 3000, 4000]) });
    expect(() => decodeAiff(full.slice(0, full.length - 5))).not.toThrow();
  });

  it("ignores chunks it does not care about", () => {
    // Real files carry markers, instrument chunks and application data, and a
    // reader that stopped at the first unknown chunk would decode almost none
    // of a real library.
    const withExtra = buildAiff({ data: be16([1000]) });
    const marker = new Uint8Array(chunk("MARK", [1, 2, 3]));
    // Splice the unknown chunk in front of COMM, after FORM's 12-byte header.
    const spliced = new Uint8Array(withExtra.length + marker.length);
    spliced.set(withExtra.subarray(0, 12), 0);
    spliced.set(marker, 12);
    spliced.set(withExtra.subarray(12), 12 + marker.length);
    const decoded = decodeAiff(spliced)!;
    expect(decoded.channels[0][0]).toBeCloseTo(1000 / 32768, 4);
  });
});
