import { describe, expect, it } from "vitest";
import {
  ClockInput,
  decodeClockInputMessage,
  mapExternalClockTempo,
} from "./clockinput";

const CLOCK_SETTINGS = { enabled: true, syncRatio: 4 };
const PULSE_MS_120_BPM = 60_000 / (120 * 24);

describe("external MIDI clock input", () => {
  it("decodes realtime clock transport bytes and ignores others", () => {
    expect(decodeClockInputMessage([0xf8])).toBe(0xf8);
    expect(decodeClockInputMessage([0xfa])).toBe(0xfa);
    expect(decodeClockInputMessage([0xfb])).toBe(0xfb);
    expect(decodeClockInputMessage([0xfc])).toBe(0xfc);
    expect(decodeClockInputMessage([0x90, 60, 100])).toBeNull();
    expect(decodeClockInputMessage([])).toBeNull();
  });

  it("counts 24 pulses as one quarter note between Start and Stop", () => {
    const clock = new ClockInput();
    expect(clock.handle(0xfa, 0, CLOCK_SETTINGS).transport).toBe("start");
    let update = clock.diagnostics();
    expect(update.pulseCount).toBe(0);
    for (let pulse = 1; pulse <= 24; pulse++) {
      update = clock.handle(0xf8, pulse * PULSE_MS_120_BPM, CLOCK_SETTINGS).diagnostics;
    }
    expect(update.pulseCount).toBe(24);
    expect(update.quarterNotes).toBe(1);
    expect(update.phasePulse).toBe(0);
    clock.handle(0xfc, 600, CLOCK_SETTINGS);
    const stopped = clock.handle(0xf8, 620, CLOCK_SETTINGS).diagnostics;
    expect(stopped.pulseCount).toBe(24);
  });

  it("infers external tempo from pulse intervals and maps Sync Ratio deterministically", () => {
    const clock = new ClockInput();
    clock.handle(0xf8, PULSE_MS_120_BPM, CLOCK_SETTINGS);
    const update = clock.handle(0xf8, PULSE_MS_120_BPM * 2, CLOCK_SETTINGS);
    expect(update.diagnostics.inferredBpm).toBeCloseTo(120, 6);
    expect(update.inferredTempo).toBeCloseTo(120, 6);
    expect(mapExternalClockTempo(120, 4)).toBeCloseTo(120, 6);
    expect(mapExternalClockTempo(120, 8)).toBeCloseTo(60, 6);
    expect(mapExternalClockTempo(120, 2)).toBeCloseTo(240, 6);
    expect(mapExternalClockTempo(120, 1)).toBeCloseTo(480, 6);
  });

  it("handles Start, Stop, Continue, and repeated Start idempotently", () => {
    const clock = new ClockInput();
    expect(clock.handle(0xfb, 0, CLOCK_SETTINGS).transport).toBe("continue");
    expect(clock.handle(0xfc, 0.5, CLOCK_SETTINGS).transport).toBe("stop");
    expect(clock.handle(0xfc, 0.75, CLOCK_SETTINGS).transport).toBeUndefined();
    expect(clock.handle(0xfa, 0, CLOCK_SETTINGS).transport).toBe("start");
    expect(clock.handle(0xfa, 1, CLOCK_SETTINGS).transport).toBeUndefined();
    expect(clock.handle(0xfc, 2, CLOCK_SETTINGS).transport).toBe("stop");
    expect(clock.handle(0xfb, 3, CLOCK_SETTINGS).transport).toBe("continue");
    expect(clock.handle(0xfb, 4, CLOCK_SETTINGS).transport).toBeUndefined();
  });

  it("smooths ±15% pulse jitter without drifting far from the source tempo", () => {
    const clock = new ClockInput();
    const jitters = [0, 0.1, -0.15, 0.15, -0.08, 0.12, -0.05, 0.07];
    let at = 0;
    let update = clock.handle(0xf8, at, CLOCK_SETTINGS);
    for (const skew of jitters) {
      at += PULSE_MS_120_BPM * (1 + skew);
      update = clock.handle(0xf8, at, CLOCK_SETTINGS);
    }
    expect(update.diagnostics.inferredBpm).toBeGreaterThan(114);
    expect(update.diagnostics.inferredBpm).toBeLessThan(126);
    expect(update.diagnostics.clockJitter).toBeGreaterThan(0);
    expect(update.diagnostics.clockStatus).toBe("locked");
  });

  it("reports loss after 200 ms and recovery on the next pulse", () => {
    const clock = new ClockInput();
    clock.handle(0xf8, 0, CLOCK_SETTINGS);
    clock.handle(0xf8, PULSE_MS_120_BPM, CLOCK_SETTINGS);
    const lost = clock.observeTimeout(250, CLOCK_SETTINGS);
    expect(lost?.lostClock).toBe(true);
    expect(lost?.diagnostics.clockStatus).toBe("lost");
    expect(lost?.diagnostics.lostClockCount).toBe(1);
    const recovered = clock.handle(0xf8, 260, CLOCK_SETTINGS);
    expect(recovered.recoveredClock).toBe(true);
    expect(recovered.diagnostics.clockStatus).toBe("locked");
    expect(recovered.diagnostics.recoveredClockCount).toBe(1);
    expect(clock.observeTimeout(300, CLOCK_SETTINGS)).toBeNull();
  });

  it("disables cleanly and exposes a reset diagnostics snapshot", () => {
    const clock = new ClockInput();
    clock.handle(0xfa, 0, CLOCK_SETTINGS);
    clock.handle(0xf8, 10, CLOCK_SETTINGS);
    const disabled = clock.handle(0xf8, 20, { enabled: false, syncRatio: 4 });
    expect(disabled.diagnostics).toMatchObject({
      inferredBpm: 0,
      clockJitter: 0,
      clockStatus: "disabled",
      pulseCount: 0,
      quarterNotes: 0,
      phasePulse: 0,
    });
    expect(clock.diagnostics().clockStatus).toBe("disabled");
  });
});
