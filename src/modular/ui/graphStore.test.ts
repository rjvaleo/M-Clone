import { describe, expect, it, vi } from "vitest";
import { GraphStore, cachedSelection, sameItems } from "./graphStore";
import { emptyGraph } from "../model/graph";

describe("the graph store", () => {
  it("tells its listeners when the graph is replaced, and hands out the latest", () => {
    const store = new GraphStore(emptyGraph());
    const heard = vi.fn();
    const off = store.subscribe(heard);
    const next = emptyGraph();
    store.set(next);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(store.get()).toBe(next);
    store.set(next);
    expect(heard).toHaveBeenCalledTimes(1);
    off();
    store.set(emptyGraph());
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("keeps a face's selection the same object while what it selects is unchanged", () => {
    let graph = { value: [1, 2] };
    const read = cachedSelection(() => graph, (g) => g.value.map((v) => v * 10), sameItems);
    const first = read();
    graph = { value: [1, 2] };
    expect(read()).toBe(first);
    graph = { value: [1, 3] };
    expect(read()).toEqual([10, 30]);
  });

  it("compares selections item by item, by identity", () => {
    const a = {}, b = {};
    expect(sameItems([a, b], [a, b])).toBe(true);
    expect(sameItems([a, b], [a, {}])).toBe(false);
    expect(sameItems([a], [a, b])).toBe(false);
  });
});
