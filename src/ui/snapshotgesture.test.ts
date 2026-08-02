import { describe, expect, it, vi } from "vitest";
import { runSnapshotGesture } from "./snapshotgesture";

describe("snapshot gestures", () => {
  it("delays recall to the configured quantization point", () => {
    vi.useFakeTimers();
    const recall = vi.fn();
    runSnapshotGesture({
      quantize: 4, tempo: 120, elapsedSec: 0.25, recall,
    });
    expect(recall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(249);
    expect(recall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(recall).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("forces Sync after a shifted or capital Snapshot execution", () => {
    const order: string[] = [];
    runSnapshotGesture({
      quantize: 0,
      tempo: 120,
      elapsedSec: 0,
      forceSync: true,
      recall: () => order.push("recall"),
      sync: () => order.push("sync"),
    });
    expect(order).toEqual(["recall", "sync"]);
  });
});
