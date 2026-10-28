import { describe, expect, it, vi } from "vitest";
import { StatusStore } from "./statusStore";

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
