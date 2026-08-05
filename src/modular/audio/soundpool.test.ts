import { describe, expect, it } from "vitest";
import { channelData, decodeAsset, describeGeneratedAsset } from "./decode";
import { KIT, renderKit, renderVoice } from "./kit";
import { AuditionPlayer } from "./audition";
import { AudioEngine } from "./audioEngine";
import { assetIdForBytes } from "./assets";
import { isSilent } from "./waveform";
import { FakeAudioContext, FakeBuffer, FakeBufferSource, FakeNode } from "./testing/fakeContext";
import { ManualTransitionScheduler } from "./transitions";
import { moduleRegistry } from "../registry/registry";
import { createModularDocument, decodeModularDocument } from "../document/document";
import { decodeModularPack, encodeModularPack } from "../document/pack";
import { emptyGraph } from "../model/graph";

const sample = (length = 64): Uint8Array =>
  Uint8Array.from({ length }, (_, i) => (i * 7) % 256);

/** A minimal 16-bit mono 44.1 kHz AIFF holding the given samples. */
const aiffBytes = (samples: number[]): Uint8Array => {
  const be32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
  const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
  // 44100 as an 80-bit IEEE extended float, taken from a real file's COMM.
  const rate = [0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0];
  const comm = [0, 1, ...be32(samples.length), 0, 16, ...rate];
  const ssnd = [
    ...be32(0),
    ...be32(0),
    ...samples.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]),
  ];
  const body = [
    ...ascii("AIFF"),
    ...ascii("COMM"), ...be32(comm.length), ...comm,
    ...ascii("SSND"), ...be32(ssnd.length), ...ssnd,
  ];
  return new Uint8Array([...ascii("FORM"), ...be32(body.length), ...body]);
};

describe("Decoding a dropped file", () => {
  it("hashes the caller's bytes before handing the decoder a copy", async () => {
    // `decodeAudioData` detaches what it is given. Hashing afterwards would see
    // an empty buffer, so every file in the pool would share one id — and one
    // sample would silently stand in for all of them.
    const context = new FakeAudioContext();
    const bytes = sample();
    const expected = assetIdForBytes(bytes);
    const result = await decodeAsset(context, "kick.wav", bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.asset.record.id).toBe(expected);
    // The caller's own array is untouched, so it can still be re-used.
    expect(bytes.length).toBe(64);
    expect(context.decoded).toEqual([64]);
  });

  it("gives two different files two different ids", async () => {
    const context = new FakeAudioContext();
    const first = await decodeAsset(context, "a.wav", sample(64));
    const second = await decodeAsset(context, "b.wav", sample(65));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.asset.record.id).not.toBe(second.asset.record.id);
  });

  it("describes what it decoded", async () => {
    const context = new FakeAudioContext(48000);
    const result = await decodeAsset(context, "kick.wav", sample(4800));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.asset.record).toMatchObject({
      name: "kick.wav",
      byteLength: 4800,
      sampleRate: 48000,
      channels: 1,
    });
    expect(result.asset.record.durationSec).toBeCloseTo(0.1, 6);
    expect(result.asset.record.peaks.length).toBeGreaterThan(0);
  });

  it("decodes an AIFF the browser refuses", async () => {
    // Chromium has no AIFF decoder, and a real sample library is mostly AIFF —
    // without the fallback in `decode.ts` the pool silently rejects most of
    // what someone drops on it. The fake refuses these exactly as Chrome does.
    const context = new FakeAudioContext(44100);
    const result = await decodeAsset(context, "hit.aif", aiffBytes([0, 16384, -16384, 0]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.asset.record.channels).toBe(1);
    expect(result.asset.record.sampleRate).toBe(44100);
    expect(result.asset.buffer.getChannelData(0)[1]).toBeCloseTo(0.5, 3);
  });

  it("still hashes an AIFF from the caller's own bytes", async () => {
    // The failed `decodeAudioData` detached the copy on its way to rejecting,
    // so the fallback has to read the original — the same trap as above, one
    // step further along.
    const context = new FakeAudioContext(44100);
    const bytes = aiffBytes([0, 1000, -1000, 0]);
    const expected = assetIdForBytes(bytes);
    const result = await decodeAsset(context, "hit.aif", bytes);
    expect(result.ok && result.asset.record.id).toBe(expected);
  });

  it("reports an AIFF it genuinely cannot read rather than pretending", async () => {
    const context = new FakeAudioContext();
    const broken = aiffBytes([0, 0]);
    broken[9] = 0xff; // corrupt the FORM size, then truncate the chunks away
    const result = await decodeAsset(context, "broken.aif", broken.slice(0, 12));
    expect(result.ok).toBe(false);
  });

  it("returns a failure instead of throwing, so one bad file is not the whole drop", async () => {
    const context = new FakeAudioContext();
    const empty = await decodeAsset(context, "nothing.wav", new Uint8Array(0));
    expect(empty).toEqual({ ok: false, failure: { name: "nothing.wav", reason: "File is empty" } });

    const short = await decodeAsset(context, "truncated.wav", Uint8Array.from([1, 2]));
    expect(short.ok).toBe(false);
    if (short.ok) return;
    expect(short.failure.name).toBe("truncated.wav");
  });
});

describe("The synthetic starter kit", () => {
  it("renders the same audio every session", () => {
    // The prototype used Math.random, so its snare was a different snare on
    // every reload. Deterministic noise is what makes the kit a fixed point.
    const left = new Float32Array(2000);
    const right = new Float32Array(2000);
    renderVoice("snare", left, 48000);
    renderVoice("snare", right, 48000);
    expect([...left]).toEqual([...right]);
  });

  it("gives each voice its own sound", () => {
    const render = (voice: Parameters<typeof renderVoice>[0]) => {
      const channel = new Float32Array(2000);
      renderVoice(voice, channel, 48000);
      return [...channel];
    };
    expect(render("kick")).not.toEqual(render("snare"));
    expect(render("hihat")).not.toEqual(render("snare"));
    expect(render("pad")).not.toEqual(render("kick"));
  });

  it("decays, so a drum is a drum rather than a tone", () => {
    const channel = new Float32Array(24000);
    renderVoice("kick", channel, 48000);
    const energy = (from: number, to: number) => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += Math.abs(channel[i]);
      return sum;
    };
    expect(energy(0, 2400)).toBeGreaterThan(energy(21600, 24000) * 10);
  });

  it("makes four audible, describable assets", () => {
    const context = new FakeAudioContext();
    const kit = renderKit(context);
    expect(kit).toHaveLength(KIT.length);
    expect(new Set(kit.map((entry) => entry.record.id)).size).toBe(KIT.length);
    for (const entry of kit) {
      expect(isSilent(entry.record.peaks), entry.record.name).toBe(false);
      expect(entry.record.durationSec).toBeGreaterThan(0);
    }
  });

  it("keeps a kit voice's identity when it is renamed", () => {
    const context = new FakeAudioContext();
    const buffer = context.createBuffer(1, 100, 48000);
    const first = describeGeneratedAsset("fixed-id", "Kick.synth", buffer);
    const second = describeGeneratedAsset("fixed-id", "My Kick.synth", buffer);
    expect(first.id).toBe(second.id);
  });

  it("reads every channel for peaks", () => {
    expect(channelData(new FakeBuffer(2, 10, 48000))).toHaveLength(2);
  });
});

describe("Audition", () => {
  const rig = () => {
    const context = new FakeAudioContext();
    const destination = new FakeNode("master");
    return { context, destination, player: new AuditionPlayer(context, destination) };
  };
  const sources = (context: FakeAudioContext) =>
    context.created.filter((node): node is FakeBufferSource => node instanceof FakeBufferSource);

  it("plays one sample through the given destination", () => {
    const { context, destination, player } = rig();
    player.play("a", new FakeBuffer(1, 100, 48000));
    expect(player.playingAssetId).toBe("a");
    const source = sources(context)[0];
    expect(source.buffer).toBeDefined();
    expect(source.starts).toHaveLength(1);
    // Through the master chain, so a hot file cannot outrun the limiter.
    const gain = [...source.outgoing][0];
    expect((gain as FakeNode).outgoing.has(destination)).toBe(true);
  });

  it("stops the previous preview when a new one starts", () => {
    // Clicking down a list otherwise stacks every sample on top of the last.
    const { context, player } = rig();
    player.play("a", new FakeBuffer(1, 100, 48000));
    player.play("b", new FakeBuffer(1, 100, 48000));
    expect(player.playingAssetId).toBe("b");
    expect(sources(context)[0].stops).toHaveLength(1);
  });

  it("fades rather than cutting", () => {
    const { context, player } = rig();
    context.currentTime = 5;
    player.play("a", new FakeBuffer(1, 100, 48000));
    player.stop();
    // The source stops *after* the ramp, or the fade would be decorative.
    expect(sources(context)[0].stops[0]).toBeGreaterThan(5);
    expect(player.playingAssetId).toBeNull();
  });

  it("reports a natural finish, but not for a voice already replaced", () => {
    const { context, player } = rig();
    let ended = 0;
    player.play("a", new FakeBuffer(1, 100, 48000), () => { ended += 1; });
    sources(context)[0].finish();
    expect(ended).toBe(1);
    expect(player.playingAssetId).toBeNull();

    let secondEnded = 0;
    player.play("b", new FakeBuffer(1, 100, 48000), () => { secondEnded += 1; });
    // The retired first voice must not clear the second one's state.
    sources(context)[0].finish();
    expect(secondEnded).toBe(0);
    expect(player.playingAssetId).toBe("b");
  });

  it("survives stopping when nothing is playing, and stopping twice", () => {
    const { player } = rig();
    expect(() => player.stop()).not.toThrow();
    player.play("a", new FakeBuffer(1, 100, 48000));
    player.stop();
    expect(() => player.stop()).not.toThrow();
    expect(() => player.dispose()).not.toThrow();
  });
});

describe("The pool on the engine", () => {
  const rig = (starterKit = true) => {
    const context = new FakeAudioContext();
    const engine = new AudioEngine(context, moduleRegistry, {
      scheduler: new ManualTransitionScheduler(),
      starterKit,
    });
    return { context, engine };
  };

  it("starts with the kit loaded, or empty when asked", () => {
    expect(rig().engine.library.size).toBe(KIT.length);
    expect(rig(false).engine.library.size).toBe(0);
  });

  it("adds what decodes and names what does not", async () => {
    const { engine } = rig(false);
    const result = await engine.addFiles([
      { name: "good.wav", bytes: sample() },
      { name: "bad.wav", bytes: Uint8Array.from([1]) },
    ]);
    expect(result.added).toHaveLength(1);
    expect(result.failed.map((entry) => entry.name)).toEqual(["bad.wav"]);
    expect(engine.library.size).toBe(1);
  });

  it("previews a loaded sample and refuses a missing one", () => {
    const { engine } = rig(false);
    engine.hydrateAssets([{
      id: "ghost",
      name: "Gone.wav",
      byteLength: 10,
      durationSec: 1,
      sampleRate: 48000,
      channels: 1,
      peaks: [-5, 5],
    }]);
    expect(engine.playAsset("ghost")).toBe(false);
    expect(engine.auditioningAssetId).toBeNull();

    const kick = rig().engine;
    const id = kick.library.list()[0].id;
    expect(kick.playAsset(id)).toBe(true);
    expect(kick.auditioningAssetId).toBe(id);
    kick.stopAudition();
    expect(kick.auditioningAssetId).toBeNull();
  });

  it("stops a preview when the engine panics or is disposed", () => {
    const { engine } = rig();
    engine.playAsset(engine.library.list()[0].id);
    engine.panic();
    expect(engine.auditioningAssetId).toBeNull();

    const second = rig().engine;
    second.playAsset(second.library.list()[0].id);
    second.dispose();
    expect(second.auditioningAssetId).toBeNull();
    expect(second.library.size).toBe(0);
  });
});

describe("Bundling a project with its samples", () => {
  const engineWith = async (files: { name: string; bytes: Uint8Array }[]) => {
    const context = new FakeAudioContext();
    const engine = new AudioEngine(context, moduleRegistry, {
      scheduler: new ManualTransitionScheduler(),
    });
    await engine.addFiles(files);
    return { context, engine };
  };

  it("carries dropped files and leaves generated ones to be recomputed", async () => {
    // The kit is four assets and none of them is in the bundle: a recipe
    // reproduces them exactly, so storing the pad's four seconds would be
    // writing down something the code can work out.
    const { engine } = await engineWith([{ name: "loop.wav", bytes: sample(256) }]);
    expect(engine.library.size).toBe(KIT.length + 1);
    const blobs = engine.packBlobs();
    expect(blobs).toHaveLength(1);
    expect(blobs[0].bytes).toHaveLength(256);
    expect(engine.library.unbundlable()).toEqual([]);
  });

  it("bundles the file exactly as it was dropped", async () => {
    // The encoded original, not the decoded audio: it is what the id hashes,
    // and it is what a future session has to decode to get the same result.
    const bytes = sample(128);
    const { engine } = await engineWith([{ name: "loop.wav", bytes }]);
    const blob = engine.packBlobs()[0];
    expect([...blob.bytes]).toEqual([...bytes]);
    expect(blob.id).toBe(assetIdForBytes(bytes));
  });

  it("names what it cannot bundle instead of quietly dropping it", async () => {
    // A project opened from a manifest and never given the files cannot conjure
    // audio it has never had, and saying so beats a bundle with holes in it.
    const { engine } = await engineWith([]);
    engine.hydrateAssets([{
      id: "ghost",
      name: "Borrowed.wav",
      byteLength: 10,
      durationSec: 1,
      sampleRate: 48000,
      channels: 1,
      peaks: [-5, 5],
    }]);
    expect(engine.packBlobs()).toHaveLength(0);
    expect(engine.library.unbundlable().map((entry) => entry.name)).toEqual(["Borrowed.wav"]);
  });

  it("restores a bundle into a session that has never seen the audio", async () => {
    const bytes = sample(256);
    const { engine } = await engineWith([{ name: "loop.wav", bytes }]);
    const manifest = engine.library.manifest();
    const packed = encodeModularPack(createModularDocument(emptyGraph(), manifest), engine.packBlobs());

    const decoded = decodeModularPack(packed);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    const fresh = new AudioEngine(new FakeAudioContext(), moduleRegistry, {
      scheduler: new ManualTransitionScheduler(),
      starterKit: false,
    });
    const result = await fresh.loadPack(decoded.pack.document.assets, decoded.pack.blobs);
    expect(result.failed).toEqual([]);
    expect(result.loaded).toBe(1);
    // The kit came back from its recipe, not from the file.
    expect(result.generated).toBe(KIT.length);
    expect(fresh.library.missing()).toEqual([]);
    expect(fresh.library.list().map((entry) => entry.name).sort())
      .toEqual([...KIT.map((entry) => entry.name), "loop.wav"].sort());
    // And it is playable, which is the whole point of self-contained.
    expect(fresh.playAsset(assetIdForBytes(bytes))).toBe(true);
  });

  it("keeps the name and thumbnail the project was saved with", async () => {
    const bytes = sample(256);
    const { engine } = await engineWith([{ name: "loop.wav", bytes }]);
    const manifest = engine.library.manifest()
      .map((entry) => (entry.name === "loop.wav" ? { ...entry, name: "Renamed.wav" } : entry));
    const fresh = new AudioEngine(new FakeAudioContext(), moduleRegistry, {
      scheduler: new ManualTransitionScheduler(),
      starterKit: false,
    });
    await fresh.loadPack(manifest, engine.packBlobs());
    expect(fresh.library.get(assetIdForBytes(bytes))?.name).toBe("Renamed.wav");
  });

  it("leaves a sample missing when the bundle dropped it, and says why", async () => {
    const bytes = sample(256);
    const { engine } = await engineWith([{ name: "loop.wav", bytes }]);
    const fresh = new AudioEngine(new FakeAudioContext(), moduleRegistry, {
      scheduler: new ManualTransitionScheduler(),
      starterKit: false,
    });
    // What a checksum failure upstream leaves behind: the record, no bytes.
    const result = await fresh.loadPack(engine.library.manifest(), []);
    expect(result.loaded).toBe(0);
    expect(fresh.library.missing().map((entry) => entry.name)).toEqual(["loop.wav"]);
  });

  it("reports an unknown generator rather than refusing to open", async () => {
    // A project from a newer version may name a recipe this one lacks; one
    // missing row is the right cost, not a project that will not open.
    const fresh = new AudioEngine(new FakeAudioContext(), moduleRegistry, {
      scheduler: new ManualTransitionScheduler(),
      starterKit: false,
    });
    const result = await fresh.loadPack([{
      id: "future",
      name: "Wavetable.synth",
      byteLength: 0,
      durationSec: 1,
      sampleRate: 48000,
      channels: 1,
      peaks: [0, 0],
      generator: "wavetable:saw",
    }], []);
    expect(result.failed).toEqual([
      { name: "Wavetable.synth", reason: "Unknown generator: wavetable:saw" },
    ]);
    expect(fresh.library.missing()).toHaveLength(1);
  });
});

describe("Assets in the document", () => {
  it("saves the manifest and reads it back", () => {
    const context = new FakeAudioContext();
    const engine = new AudioEngine(context, moduleRegistry, {
      scheduler: new ManualTransitionScheduler(),
    });
    const saved = JSON.parse(JSON.stringify(
      createModularDocument(emptyGraph(), engine.library.manifest()),
    )) as unknown;
    const decoded = decodeModularDocument(saved);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.document.assets).toHaveLength(KIT.length);
    expect(decoded.document.assets[0].peaks.length).toBeGreaterThan(0);
  });

  it("drops an unreadable asset entry with a warning, and keeps the patch", () => {
    // A malformed thumbnail costs a row, not the project.
    const document = createModularDocument(emptyGraph());
    const raw = JSON.parse(JSON.stringify(document)) as { assets: unknown[] };
    raw.assets = [{ id: "ok", name: "a", byteLength: 1, durationSec: 1, sampleRate: 1, channels: 1, peaks: [] },
      { id: 5 }];
    const decoded = decodeModularDocument(raw);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.document.assets).toHaveLength(1);
    expect(decoded.warnings.join(" ")).toContain("unreadable asset");
  });

  it("still refuses a document whose assets are not JSON at all", () => {
    const raw = JSON.parse(JSON.stringify(createModularDocument(emptyGraph()))) as Record<string, unknown>;
    raw.assets = "not a list";
    expect(decodeModularDocument(raw).ok).toBe(false);
  });
});
