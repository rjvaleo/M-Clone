/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import {
  fadeParam,
  holdParam,
  rampParam,
  SMOOTHING_SEC,
  type AudioParamLike,
} from "./params";

type Call = [string, ...number[]];

/** Records automation instead of performing it. */
class FakeParam implements AudioParamLike {
  value: number;
  readonly calls: Call[] = [];

  constructor(value = 0) {
    this.value = value;
  }

  setValueAtTime(value: number, startTime: number): void {
    this.calls.push(["setValueAtTime", value, startTime]);
    this.value = value;
  }

  linearRampToValueAtTime(value: number, endTime: number): void {
    this.calls.push(["linearRampToValueAtTime", value, endTime]);
  }

  exponentialRampToValueAtTime(value: number, endTime: number): void {
    this.calls.push(["exponentialRampToValueAtTime", value, endTime]);
  }

  setTargetAtTime(target: number, startTime: number, timeConstant: number): void {
    this.calls.push(["setTargetAtTime", target, startTime, timeConstant]);
  }

  cancelScheduledValues(startTime: number): void {
    this.calls.push(["cancelScheduledValues", startTime]);
  }

  names(): string[] {
    return this.calls.map((call) => call[0]);
  }
}

describe("Scheduled parameter writes", () => {
  it("always cancels and pins the current value before ramping", () => {
    // Without the pin, a ramp scheduled over a running one interpolates from
    // the old ramp's target rather than from where the signal actually is.
    const param = new FakeParam(0.25);
    rampParam(param, 1, 5, "linear");
    expect(param.names().slice(0, 2)).toEqual(["cancelScheduledValues", "setValueAtTime"]);
    expect(param.calls[0]).toEqual(["cancelScheduledValues", 5]);
    expect(param.calls[1]).toEqual(["setValueAtTime", 0.25, 5]);
  });

  it("steps immediately when the policy is none", () => {
    const param = new FakeParam(0);
    rampParam(param, 0.5, 2, "none");
    expect(param.calls[param.calls.length - 1]).toEqual(["setValueAtTime", 0.5, 2]);
    expect(param.names()).not.toContain("linearRampToValueAtTime");
  });

  it("ramps linearly over the policy duration", () => {
    const param = new FakeParam(0);
    rampParam(param, 1, 10, "linear");
    expect(param.calls[param.calls.length - 1]).toEqual([
      "linearRampToValueAtTime", 1, 10 + SMOOTHING_SEC.linear,
    ]);
  });

  it("uses setTargetAtTime for exponential, so a target of zero is legal", () => {
    // `exponentialRampToValueAtTime` cannot reach zero, and gain targets are
    // zero constantly — using it would throw or silently misbehave.
    const param = new FakeParam(1);
    rampParam(param, 0, 3, "exponential");
    expect(param.calls[param.calls.length - 1]).toEqual([
      "setTargetAtTime", 0, 3, SMOOTHING_SEC.exponential,
    ]);
    expect(param.names()).not.toContain("exponentialRampToValueAtTime");
  });

  it("honours an explicit duration over the policy default", () => {
    const param = new FakeParam(0);
    rampParam(param, 1, 0, "linear", { durationSec: 0.5 });
    expect(param.calls[param.calls.length - 1]).toEqual(["linearRampToValueAtTime", 1, 0.5]);
  });

  it("degenerates to a step when the duration is zero", () => {
    const param = new FakeParam(0);
    rampParam(param, 1, 4, "linear", { durationSec: 0 });
    expect(param.calls[param.calls.length - 1]).toEqual(["setValueAtTime", 1, 4]);
  });

  it("refuses non-finite values and negative times", () => {
    const param = new FakeParam(0.5);
    rampParam(param, Number.NaN, -3, "none");
    expect(param.calls[param.calls.length - 1]).toEqual(["setValueAtTime", 0, 0]);
  });

  it("fades to an explicit level over an explicit window", () => {
    const param = new FakeParam(1);
    fadeParam(param, 0, 2, 0.015);
    expect(param.calls[param.calls.length - 1]).toEqual(["linearRampToValueAtTime", 0, 2.015]);
  });

  it("holds the current value without letting a scheduled ramp land", () => {
    const param = new FakeParam(0.4);
    holdParam(param, 7);
    expect(param.calls).toEqual([
      ["cancelScheduledValues", 7],
      ["setValueAtTime", 0.4, 7],
    ]);
  });
});

/** Lines that assign to a `.value`, ignoring anything inside a comment. */
function findDirectAssignments(source: string): number[] {
  const hits: number[] = [];
  let inBlockComment = false;
  source.split("\n").forEach((raw: string, index: number) => {
    let line = raw;
    if (inBlockComment) {
      const end = line.indexOf("*/");
      if (end === -1) return;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    const blockStart = line.indexOf("/*");
    if (blockStart !== -1) {
      const end = line.indexOf("*/", blockStart + 2);
      if (end === -1) {
        inBlockComment = true;
        line = line.slice(0, blockStart);
      } else line = line.slice(0, blockStart) + line.slice(end + 2);
    }
    const lineComment = line.indexOf("//");
    if (lineComment !== -1) line = line.slice(0, lineComment);
    if (/\.value\s*=(?!=)/.test(line)) hits.push(index + 1);
  });
  return hits;
}

describe("The direct-assignment detector", () => {
  it("catches the thing it is looking for", () => {
    // A guard that has never been shown to fail is not a guard.
    expect(findDirectAssignments("gain.gain.value = 0.5;")).toEqual([1]);
    expect(findDirectAssignments("node.frequency.value=440")).toEqual([1]);
    expect(findDirectAssignments("a();\nparam.value = 1;\nb();")).toEqual([2]);
  });

  it("does not flag comparisons or prose", () => {
    expect(findDirectAssignments("if (param.value === 1) return;")).toEqual([]);
    expect(findDirectAssignments("// never write param.value = x")).toEqual([]);
    expect(findDirectAssignments("/* param.value = x is banned */")).toEqual([]);
    expect(findDirectAssignments("/*\n * param.value = x\n */\nokay();")).toEqual([]);
  });
});

/**
 * Every non-test source in this folder, read as text.
 *
 * Vite's raw glob rather than `node:fs`: it needs no extra type package and it
 * resolves relative to this file however the suite is invoked.
 */
const AUDIO_SOURCES = import.meta.glob("./*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("The ban on direct parameter assignment", () => {
  /**
   * The rule only holds if it is checked. Assigning `param.value = x` steps the
   * signal inside a render quantum and is the usual source of zipper noise, so
   * no file in the audio layer may do it — `params.ts` is the one sanctioned
   * writer and it uses the scheduling methods.
   */
  it("no audio source assigns to a .value property", () => {
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(AUDIO_SOURCES)) {
      if (file.endsWith(".test.ts")) continue;
      for (const line of findDirectAssignments(source)) offenders.push(`${file}:${line}`);
    }
    expect(offenders, "use rampParam instead of assigning .value").toEqual([]);
  });

  it("checks files that actually exist, so the guard cannot pass vacuously", () => {
    const sources = Object.keys(AUDIO_SOURCES).filter((file) => !file.endsWith(".test.ts"));
    expect(sources.length).toBeGreaterThanOrEqual(5);
    expect(sources).toContain("./params.ts");
  });
});
