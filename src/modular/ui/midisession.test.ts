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

const setup = (outputs: Map<string, MidiPort & {
  name: string | null; manufacturer: string | null; state: string;
}> = new Map([["a", port("a", "Alpha")]])) => {
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

  it("knows whether it holds permission", async () => {
    const { session } = setup();
    expect(session.enabled).toBe(false);
    await session.enable();
    expect(session.enabled).toBe(true);
    session.dispose();
    expect(session.enabled).toBe(false);
  });

  it("drops the adapter for a MIDI Output that has been deleted", async () => {
    // Otherwise a removed node keeps sending, and its notes never stop.
    const { node, runtime, session } = setup();
    const remove = vi.spyOn(runtime, "removeAdapter");
    session.sync([node]);
    await session.enable();
    session.sync([]);
    expect(remove).toHaveBeenCalledTimes(1);
    // Disposing afterwards has nothing left to remove.
    session.dispose();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("falls back to the port id when the device has no name", async () => {
    const nameless: MidiPort & { name: null; manufacturer: null; state: string } = {
      id: "bare", name: null, manufacturer: null, state: "connected", send: vi.fn(),
    };
    const { node, session } = setup(new Map([["bare", nameless]]));
    node.parameters["device-id"] = "bare";
    session.sync([node]);
    await session.enable();
    expect(session.devices()).toEqual([{ id: "bare", label: "bare", connected: true }]);
    expect(session.status(node.id)).toBe("Connected · bare");
  });

  it("reads a missing or malformed device id and latency as unset", async () => {
    const { node, session } = setup();
    node.parameters["device-id"] = 7;
    node.parameters["latency-ms"] = "soon";
    session.sync([node]);
    await session.enable();
    expect(session.status(node.id)).toBe("Select a device");
  });

  it("reports a thrown non-Error as a denial", async () => {
    const runtime = new ModularRuntime({
      registry: moduleRegistry, driver: new ManualSchedulerDriver(), clock: { nowSec: () => 0 },
    });
    const clock = new PresentationClock({ currentTime: 0 }, () => 0);
    const session = new BrowserMidiSession(runtime, clock, vi.fn(async () => {
      throw "no";
    }));
    await expect(session.enable()).rejects.toBe("no");
    expect(session.status("any")).toBe("MIDI permission denied");
  });

  it("lists nothing before permission is granted", () => {
    expect(setup().session.devices()).toEqual([]);
  });

  it("says the browser has no MIDI before anyone asks it to enable", () => {
    // A browser without Web MIDI should say so on the face, not wait for the
    // user to press Enable and be told then.
    const runtime = new ModularRuntime({
      registry: moduleRegistry, driver: new ManualSchedulerDriver(), clock: { nowSec: () => 0 },
    });
    const clock = new PresentationClock({ currentTime: 0 }, () => 0);
    expect(new BrowserMidiSession(runtime, clock, null).status("any"))
      .toBe("Web MIDI unavailable");
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
