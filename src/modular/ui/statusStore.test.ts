import { describe, expect, it, vi } from "vitest";
import { StatusStore, useNodeStatus } from "./statusStore";

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

describe("the module status store", () => {
  it("tells only the modules whose status changed, and keeps an unchanged status the same object", () => {
    const store = new StatusStore();
    store.set({ a: { index: "1" }, b: { bar: "1" } });
    const a = vi.fn(), b = vi.fn();
    store.subscribe("a", a);
    store.subscribe("b", b);
    const before = store.get("b");
    store.set({ a: { index: "2" }, b: { bar: "1" } });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(store.get("b")).toBe(before);
    expect(store.get("a")).toEqual({ index: "2" });
  });

  it("forgets a module that is gone, and answers an unknown one with one shared empty status", () => {
    const store = new StatusStore();
    store.set({ a: { index: "1" } });
    const a = vi.fn();
    store.subscribe("a", a);
    store.set({});
    expect(a).toHaveBeenCalledTimes(1);
    expect(store.get("a")).toBe(store.get("zzz"));
    expect(store.get("a")).toEqual({});
  });

  it("stops telling a listener once it unsubscribes", () => {
    const store = new StatusStore();
    const a = vi.fn();
    const off = store.subscribe("a", a);
    off();
    store.set({ a: { index: "1" } });
    expect(a).not.toHaveBeenCalled();
  });
});

describe("a module's status in its face", () => {
  it("reads its own module's status, and hears only that module's changes", () => {
    const store = new StatusStore();
    store.set({ a: { index: "3" }, b: { bar: "1" } });
    hooks.provided = store;
    hooks.heard = 0;
    expect(useNodeStatus("a")).toEqual({ index: "3" });
    store.set({ a: { index: "3" }, b: { bar: "2" } });
    expect(hooks.heard).toBe(0);
    store.set({ a: { index: "4" }, b: { bar: "2" } });
    expect(hooks.heard).toBe(1);
  });
});
