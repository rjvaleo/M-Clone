import { describe, expect, it } from "vitest";
import {
  nextStepBoundary,
  ParameterQueue,
  scheduleParameterEdit,
  scheduledTickFor,
} from "./parameters";
import { PPQN } from "./time";

describe("Step boundary quantization", () => {
  it("finds the next boundary at or after a position", () => {
    const step = PPQN / 4;
    expect(nextStepBoundary(0, step)).toBe(0);
    expect(nextStepBoundary(1, step)).toBe(step);
    expect(nextStepBoundary(step, step)).toBe(step);
    expect(nextStepBoundary(step + 1, step)).toBe(step * 2);
  });

  it("respects a stream whose steps started late", () => {
    const step = PPQN / 4;
    expect(nextStepBoundary(100, step, 100)).toBe(100);
    expect(nextStepBoundary(101, step, 100)).toBe(100 + step);
    expect(nextStepBoundary(50, step, 100)).toBe(100);
  });

  it("never divides by a degenerate step length", () => {
    expect(nextStepBoundary(10, 0)).toBe(10);
    expect(nextStepBoundary(10, -5)).toBe(10);
  });
});

describe("Morph-driven scheduling", () => {
  it("lands continuous parameters as soon as they can be scheduled", () => {
    expect(scheduledTickFor("immediate", 100, 480)).toBe(100);
    expect(scheduledTickFor("linear", 100, 480)).toBe(100);
    expect(scheduledTickFor("exponential", 100, 480)).toBe(100);
  });

  it("holds step-locked parameters until the boundary", () => {
    expect(scheduledTickFor("step-start", 100, 480)).toBe(480);
    expect(scheduledTickFor("step-end", 100, 480)).toBe(480);
    // A boundary already behind the scheduling horizon cannot pull time back.
    expect(scheduledTickFor("step-end", 500, 480)).toBe(500);
  });
});

describe("Parameter queue", () => {
  it("delivers edits in musical then submission order", () => {
    const queue = new ParameterQueue();
    queue.push("a", "density", 0.5, 960);
    queue.push("b", "tempo", 130, 480);
    queue.push("c", "density", 0.7, 480);
    const due = queue.drainThrough(960);
    expect(due.map((edit) => [edit.nodeId, edit.applyAtTick]))
      .toEqual([["b", 480], ["c", 480], ["a", 960]]);
    expect(queue.size).toBe(0);
  });

  it("leaves future edits queued for a later window", () => {
    const queue = new ParameterQueue();
    queue.push("a", "density", 0.5, 480);
    queue.push("a", "density", 0.9, 1920);
    expect(queue.drainThrough(960).map((edit) => edit.value)).toEqual([0.5]);
    expect(queue.size).toBe(1);
    expect(queue.drainThrough(1920).map((edit) => edit.value)).toEqual([0.9]);
    expect(queue.drainThrough(9999)).toEqual([]);
  });

  it("coalesces a knob drag into one pending edit", () => {
    const queue = new ParameterQueue();
    for (let i = 0; i <= 600; i++) queue.push("a", "density", i / 600, 960);
    expect(queue.size).toBe(1);
    expect(queue.coalesced).toBe(600);
    const due = queue.drainThrough(960);
    expect(due).toHaveLength(1);
    expect(due[0].value).toBe(1);
  });

  it("keeps edits for different targets distinct", () => {
    const queue = new ParameterQueue();
    queue.push("a", "density", 0.1, 480);
    queue.push("a", "density", 0.2, 960);
    queue.push("a", "velocity", 0.3, 480);
    queue.push("b", "density", 0.4, 480);
    expect(queue.size).toBe(4);
    expect(queue.coalesced).toBe(0);
  });

  it("reports overflow rather than silently losing a control", () => {
    const queue = new ParameterQueue(3);
    for (let i = 0; i < 5; i++) queue.push("a", `p${i}`, i, 480);
    expect(queue.size).toBe(3);
    expect(queue.dropped).toBe(2);
    expect(queue.drainThrough(480).map((edit) => edit.parameterId))
      .toEqual(["p2", "p3", "p4"]);
    // An evicted edit is forgotten by the coalescing index too, so re-sending
    // it queues a fresh entry rather than mutating a dropped one.
    queue.push("a", "p0", 99, 480);
    expect(queue.size).toBe(1);
    queue.resetCounters();
    expect(queue.dropped).toBe(0);
    expect(queue.coalesced).toBe(0);
  });

  it("floors fractional and negative target positions", () => {
    const queue = new ParameterQueue();
    const edit = queue.push("a", "density", 1, -5.7);
    expect(edit.applyAtTick).toBe(0);
    expect(queue.push("a", "velocity", 1, 480.9).applyAtTick).toBe(480);
  });

  it("clears on stop", () => {
    const queue = new ParameterQueue();
    queue.push("a", "density", 1, 480);
    queue.clear();
    expect(queue.size).toBe(0);
    expect(queue.drainThrough(9999)).toEqual([]);
  });

  it("routes a gesture through the parameter's declared policy", () => {
    const queue = new ParameterQueue();
    const immediate = scheduleParameterEdit(
      queue, { id: "tempo", morph: "linear" }, "clock", 130, 100, 480,
    );
    const stepped = scheduleParameterEdit(
      queue, { id: "order", morph: "step-end" }, "order-1", 0.25, 100, 480,
    );
    expect(immediate.applyAtTick).toBe(100);
    expect(stepped.applyAtTick).toBe(480);
  });
});
