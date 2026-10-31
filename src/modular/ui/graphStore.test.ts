import { describe, expect, it, vi } from "vitest";
import { GraphStore, cachedSelection, sameItems, useGraphSelection } from "./graphStore";
import { emptyGraph } from "../model/graph";

// The hooks run outside a renderer: the face's context is whatever the test
// provides, and the external store is read once and subscribed to as React would.
const hooks = vi.hoisted(() => ({ provided: undefined as unknown, heard: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useContext: () => hooks.provided,
  useMemo: <T,>(make: () => T) => make(),
  useSyncExternalStore: <T,>(subscribe: (listener: () => void) => () => void, read: () => T) => {
    subscribe(() => { hooks.heard += 1; });
    return read();
  },
}));

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

describe("a face's selection from the patch", () => {
  it("reads what the face selects from the provided store, and hears that store's edits", () => {
    const graph = emptyGraph();
    const store = new GraphStore(graph);
    hooks.provided = store;
    hooks.heard = 0;
    const select = vi.fn((g: typeof graph) => [g]);
    expect(useGraphSelection(select, sameItems)).toEqual([graph]);
    expect(select).toHaveBeenCalledWith(graph);
    store.set(emptyGraph());
    expect(hooks.heard).toBe(1);
  });
});
