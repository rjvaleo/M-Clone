import { describe, expect, it } from "vitest";
import {
  LIMITER_SETTINGS,
  MasterChain,
  type CompressorNodeLike,
  type GainNodeLike,
  type MasterChainContext,
} from "./masterChain";
import type { AudioParamLike } from "./params";
import type { AudioNodeLike } from "./graphAdapter";

class FakeParam implements AudioParamLike {
  value = 0;
  readonly calls: { method: string; value?: number; time?: number }[] = [];
  setValueAtTime(value: number, time: number) { this.calls.push({ method: "setValueAtTime", value, time }); this.value = value; }
  linearRampToValueAtTime(value: number, time: number) { this.calls.push({ method: "linearRamp", value, time }); }
  exponentialRampToValueAtTime(value: number, time: number) { this.calls.push({ method: "expRamp", value, time }); }
  setTargetAtTime(value: number, time: number) { this.calls.push({ method: "setTarget", value, time }); }
  cancelScheduledValues(time: number) { this.calls.push({ method: "cancel", time }); }
}

class FakeNode implements AudioNodeLike {
  readonly connected: AudioNodeLike[] = [];
  disconnected = 0;
  connect(destination: AudioNodeLike) { this.connected.push(destination); }
  disconnect() { this.disconnected += 1; }
}

class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam();
}

class FakeCompressor extends FakeNode implements CompressorNodeLike {
  readonly threshold = new FakeParam();
  readonly knee = new FakeParam();
  readonly ratio = new FakeParam();
  readonly attack = new FakeParam();
  readonly release = new FakeParam();
  reduction = -3;
}

class FakeContext implements MasterChainContext {
  currentTime = 0;
  readonly destination = new FakeNode();
  gains: FakeGain[] = [];
  compressors: FakeCompressor[] = [];
  createGain(): GainNodeLike {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createDynamicsCompressor(): CompressorNodeLike {
    const compressor = new FakeCompressor();
    this.compressors.push(compressor);
    return compressor;
  }
}

describe("Master chain", () => {
  it("routes gain into the limiter into the destination", () => {
    // Gain before the limiter: turning down reduces what the limiter must
    // catch, rather than attenuating an already-limited signal.
    const context = new FakeContext();
    const chain = new MasterChain(context);
    const [gain] = context.gains;
    const [limiter] = context.compressors;
    expect(gain.connected).toEqual([limiter]);
    expect(limiter.connected).toEqual([context.destination]);
    expect(chain.input).toBe(gain);
  });

  it("configures the limiter as a brick wall", () => {
    const context = new FakeContext();
    new MasterChain(context);
    const [limiter] = context.compressors;
    expect(limiter.threshold.value).toBe(LIMITER_SETTINGS.thresholdDb);
    expect(limiter.knee.value).toBe(LIMITER_SETTINGS.kneeDb);
    expect(limiter.ratio.value).toBe(LIMITER_SETTINGS.ratio);
    expect(limiter.attack.value).toBe(LIMITER_SETTINGS.attackSec);
    expect(limiter.release.value).toBe(LIMITER_SETTINGS.releaseSec);
    // Fast enough to catch a transient rather than pass its first millisecond.
    expect(LIMITER_SETTINGS.attackSec).toBeLessThanOrEqual(0.002);
    expect(LIMITER_SETTINGS.thresholdDb).toBeLessThan(0);
  });

  it("sets even its one-time values through the scheduled writer", () => {
    const context = new FakeContext();
    new MasterChain(context);
    const [limiter] = context.compressors;
    // No direct assignment anywhere, including at construction.
    expect(limiter.ratio.calls.map((call) => call.method))
      .toEqual(["cancel", "setValueAtTime", "setValueAtTime"]);
  });

  it("ramps the master volume rather than stepping it", () => {
    const context = new FakeContext();
    const chain = new MasterChain(context);
    const [gain] = context.gains;
    gain.gain.calls.length = 0;
    chain.setVolume(0.3, 5);
    expect(gain.gain.calls[gain.gain.calls.length - 1]).toEqual({ method: "linearRamp", value: 0.3, time: 5.02 });
  });

  it("refuses a negative volume", () => {
    const context = new FakeContext();
    const chain = new MasterChain(context);
    const [gain] = context.gains;
    gain.gain.calls.length = 0;
    chain.setVolume(-2, 0);
    expect(gain.gain.calls[gain.gain.calls.length - 1]?.value).toBe(0);
  });

  it("mutes without a step", () => {
    const context = new FakeContext();
    const chain = new MasterChain(context);
    const [gain] = context.gains;
    gain.gain.calls.length = 0;
    chain.mute(1);
    const last = gain.gain.calls[gain.gain.calls.length - 1];
    expect(last?.method).toBe("linearRamp");
    expect(last?.value).toBe(0);
    expect(last?.time).toBeGreaterThan(1);
  });

  it("reports gain reduction for a meter", () => {
    const context = new FakeContext();
    const chain = new MasterChain(context);
    expect(chain.reductionDb).toBe(-3);
  });

  it("disposes once, idempotently", () => {
    const context = new FakeContext();
    const chain = new MasterChain(context);
    chain.dispose();
    chain.dispose();
    expect(context.gains[0].disconnected).toBe(1);
    expect(context.compressors[0].disconnected).toBe(1);
  });
});
