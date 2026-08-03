import { describe, expect, it, vi } from "vitest";
import { BrowserMidiSession, type MidiAccessLike } from "./midisession";
import { PresentationClock } from "../runtime/skew";
import { createNode, moduleRegistry } from "../registry/registry";
import { ModularRuntime } from "../runtime/engine";
import { ManualSchedulerDriver } from "../runtime/clock";
import type { MidiPort } from "../runtime/midiadapter";

const port = (id: string, name = id): MidiPort & { name: string; manufacturer: string; state: string } => ({
  id,
  name,
  manufacturer: "Maker",
  state: "connected",
  send: vi.fn(),
});

const setup = (outputs = new Map([["a", port("a", "Alpha")]])) => {
  const driver = new ManualSchedulerDriver();
  const runtime = new ModularRuntime({ registry: moduleRegistry, driver, clock: { nowSec: () => 0 } });
  const clock = new PresentationClock({ currentTime: 0 }, () => 0);
  const access: MidiAccessLike = { outputs, onstatechange: null };
  const session = new BrowserMidiSession(runtime, clock, vi.fn(async () => access));
  const node = createNode("m.midi-output", "out", { x: 0, y: 0 }, { "device-id": "a" });
  return { access, node, outputs, runtime, session };
};

describe("browser MIDI session", () => {
  it("requests permission, lists outputs, and reports the selected connection", async () => {
    const { node, session } = setup();
    session.sync([node]);
    expect(session.status(node.id)).toBe("Permission required");
    await session.enable();
    expect(session.devices()).toEqual([{ id: "a", label: "Maker Alpha", connected: true }]);
    expect(session.status(node.id)).toBe("Connected · Maker Alpha");
  });

  it("reports selection and device-loss states", async () => {
    const { access, node, outputs, session } = setup();
    node.parameters["device-id"] = "";
    session.sync([node]);
    await session.enable();
    expect(session.status(node.id)).toBe("Select a device");
    node.parameters["device-id"] = "missing";
    session.sync([node]);
    expect(session.status(node.id)).toBe("Device disconnected");
    outputs.clear();
    access.onstatechange?.(new Event("statechange"));
    expect(session.status(node.id)).toBe("No MIDI outputs");
  });

  it("surfaces unsupported and denied permission", async () => {
    const runtime = new ModularRuntime({ registry: moduleRegistry, driver: new ManualSchedulerDriver(), clock: { nowSec: () => 0 } });
    const clock = new PresentationClock({ currentTime: 0 }, () => 0);
    const unsupported = new BrowserMidiSession(runtime, clock, null);
    await expect(unsupported.enable()).rejects.toThrow("Web MIDI unavailable");
    const denied = new BrowserMidiSession(runtime, clock, vi.fn(async () => { throw new Error("Permission denied"); }));
    await expect(denied.enable()).rejects.toThrow("Permission denied");
  });

  it("detaches the browser and adapters on dispose", async () => {
    const { access, node, runtime, session } = setup();
    const remove = vi.spyOn(runtime, "removeAdapter");
    session.sync([node]);
    await session.enable();
    session.dispose();
    expect(access.onstatechange).toBeNull();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
