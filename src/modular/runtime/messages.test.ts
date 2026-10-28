import { describe, expect, it } from "vitest";
import { MessageBus, MessagePool, portKey } from "./messages";

describe("Message pool", () => {
  it("reuses objects and returns them blank", () => {
    const pool = new MessagePool(4);
    expect(pool.created).toBe(4);
    const message = pool.acquire();
    message.kind = "note-event";
    message.atTick = 999;
    message.note = 42;
    pool.release(message);
    const again = pool.acquire();
    expect(again).toBe(message);
    expect(again.kind).toBe("reset");
    expect(again.atTick).toBe(0);
    expect(again.note).toBe(60);
    expect(pool.created).toBe(4);
  });

  it("grows only when the pool is empty", () => {
    const pool = new MessagePool();
    const held = [pool.acquire(), pool.acquire()];
    expect(pool.created).toBe(2);
    for (const message of held) pool.release(message);
    pool.acquire();
    pool.acquire();
    expect(pool.created).toBe(2);
    expect(pool.available).toBe(0);
  });
});

describe("Message bus", () => {
  const wired = () => {
    const bus = new MessageBus();
    bus.connect("a", "out", "b", "in");
    return bus;
  };

  it("routes an output to the input it was connected to", () => {
    const bus = wired();
    bus.beginNode("a", 8);
    const message = bus.acquire();
    expect(message).not.toBeNull();
    if (!message) return;
    message.kind = "step-clock";
    message.atTick = 480;
    bus.publish("out", message);

    const inbox = bus.read("b", "in");
    expect(inbox.count).toBe(1);
    expect(inbox.items[0].atTick).toBe(480);
    expect(inbox.items[0].sourceNodeId).toBe("a");
  });

  it("fans one output out to every connected input", () => {
    const bus = new MessageBus();
    bus.connect("a", "out", "b", "in");
    bus.connect("a", "out", "c", "in");
    bus.beginNode("a", 8);
    const message = bus.acquire();
    if (!message) return;
    message.atTick = 240;
    bus.publish("out", message);
    // Fan-out shares one object; readers must treat it as immutable.
    expect(bus.read("b", "in").items[0]).toBe(bus.read("c", "in").items[0]);
    expect(bus.read("c", "in").count).toBe(1);
  });

  it("does not duplicate an edge wired twice", () => {
    const bus = new MessageBus();
    bus.connect("a", "out", "b", "in");
    bus.connect("a", "out", "b", "in");
    bus.beginNode("a", 8);
    const message = bus.acquire();
    if (!message) return;
    bus.publish("out", message);
    expect(bus.read("b", "in").count).toBe(1);
  });

  it("discards output nobody is listening to", () => {
    const bus = wired();
    bus.beginNode("a", 8);
    const message = bus.acquire();
    if (!message) return;
    bus.publish("unconnected", message);
    expect(bus.read("b", "in").count).toBe(0);
  });

  it("reports an unconnected input and an empty inbox", () => {
    const bus = wired();
    expect(bus.isConnected("b", "in")).toBe(true);
    expect(bus.isConnected("b", "other")).toBe(false);
    expect(bus.read("b", "other")).toEqual({ items: [], count: 0 });
  });

  it("stops a runaway node at its budget without touching the rest", () => {
    const bus = new MessageBus();
    bus.connect("greedy", "out", "sink", "in");
    bus.connect("polite", "out", "sink", "in");

    bus.beginNode("greedy", 3);
    let issued = 0;
    for (let i = 0; i < 100; i++) {
      const message = bus.acquire();
      if (!message) break;
      issued += 1;
      bus.publish("out", message);
    }
    expect(issued).toBe(3);
    expect(bus.withinBudget).toBe(false);
    expect(bus.overrunCount).toBe(1);
    expect(bus.overruns).toEqual(["greedy"]);

    // The next node gets its own full budget.
    bus.beginNode("polite", 3);
    expect(bus.withinBudget).toBe(true);
    expect(bus.acquire()).not.toBeNull();
  });

  it("empties inboxes and clears overruns at the end of a window", () => {
    const bus = wired();
    bus.beginNode("a", 1);
    const message = bus.acquire();
    if (!message) return;
    bus.publish("out", message);
    bus.acquire();
    expect(bus.overrunCount).toBe(1);

    bus.endWindow();
    expect(bus.read("b", "in").count).toBe(0);
    expect(bus.overrunCount).toBe(0);

    // The window's messages went back to the pool for reuse.
    bus.beginNode("a", 4);
    expect(bus.acquire()).toBe(message);
  });

  it("drops routing on a recompile", () => {
    const bus = wired();
    bus.clearRoutes();
    expect(bus.isConnected("b", "in")).toBe(false);
    bus.beginNode("a", 4);
    const message = bus.acquire();
    if (!message) return;
    bus.publish("out", message);
    expect(bus.read("b", "in").count).toBe(0);
  });

  it("keys ports so no pair of ids can collide", () => {
    expect(portKey("node", "port")).toBe(portKey("node", "port"));
    // A separator that cannot appear in an id, so "a|b" + "" never collides
    // with "a" + "b" however a user names a node.
    expect(portKey("a", "b")).not.toBe(portKey("ab", ""));
    expect(portKey("a b", "c")).not.toBe(portKey("a", "b c"));
  });
});
