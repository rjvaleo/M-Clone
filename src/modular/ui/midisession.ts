import type { JsonValue, NodeInstance } from "../model/graph";
import type { ModularRuntime } from "../runtime/engine";
import { MidiOutputAdapter, type MidiPort } from "../runtime/midiadapter";
import type { PresentationClock } from "../runtime/skew";

export type MidiDeviceOption = {
  id: string;
  label: string;
  connected: boolean;
};

export interface MidiAccessLike {
  readonly outputs: ReadonlyMap<string, MidiPort & {
    readonly name?: string | null;
    readonly manufacturer?: string | null;
    readonly connection?: string;
  }>;
  onstatechange: ((event: Event) => void) | null;
}

export type RequestMidiAccess = () => Promise<MidiAccessLike>;

type MidiBinding = {
  nodeId: string;
  deviceId: string;
  latencyMs: number;
};

const asNumber = (value: JsonValue | undefined, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const bindingsFromNodes = (nodes: readonly NodeInstance[]): MidiBinding[] =>
  nodes.filter((node) => node.moduleType === "m.midi-output").map((node) => ({
    nodeId: node.id,
    deviceId: typeof node.parameters["device-id"] === "string"
      ? node.parameters["device-id"] as string
      : "",
    latencyMs: asNumber(node.parameters["latency-ms"], 0),
  }));

/** Owns browser MIDI permission and one output adapter per MIDI Output node. */
export class BrowserMidiSession {
  private readonly runtime: ModularRuntime;
  private readonly clock: PresentationClock;
  private readonly requestAccess: RequestMidiAccess | null;
  private access: MidiAccessLike | null = null;
  private adapters = new Map<string, MidiOutputAdapter>();
  private bindings: MidiBinding[] = [];
  private error = "";

  constructor(runtime: ModularRuntime, clock: PresentationClock, requestAccess: RequestMidiAccess | null) {
    this.runtime = runtime;
    this.clock = clock;
    this.requestAccess = requestAccess;
  }

  get enabled(): boolean {
    return this.access !== null;
  }

  async enable(): Promise<void> {
    if (!this.requestAccess) {
      this.error = "Web MIDI unavailable";
      throw new Error(this.error);
    }
    try {
      this.access = await this.requestAccess();
      this.error = "";
      this.access.onstatechange = () => this.reconcile();
      this.reconcile();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "MIDI permission denied";
      throw error;
    }
  }

  sync(nodes: readonly NodeInstance[]): void {
    this.bindings = bindingsFromNodes(nodes);
    this.reconcile();
  }

  devices(): MidiDeviceOption[] {
    if (!this.access) return [];
    return [...this.access.outputs.values()].map((port) => ({
      id: port.id,
      label: [port.manufacturer, port.name].filter(Boolean).join(" ") || port.id,
      connected: port.state !== "disconnected",
    })).sort((a, b) => a.label.localeCompare(b.label));
  }

  status(nodeId: string): string {
    if (this.error) return this.error;
    if (!this.access) return this.requestAccess ? "Permission required" : "Web MIDI unavailable";
    if (this.access.outputs.size === 0) return "No MIDI outputs";
    const binding = this.bindings.find((item) => item.nodeId === nodeId);
    if (!binding?.deviceId) return "Select a device";
    const port = this.access.outputs.get(binding.deviceId);
    if (!port || port.state === "disconnected") return "Device disconnected";
    const name = [port.manufacturer, port.name].filter(Boolean).join(" ") || port.id;
    return `Connected · ${name}`;
  }

  dispose(): void {
    if (this.access) this.access.onstatechange = null;
    for (const adapter of this.adapters.values()) this.runtime.removeAdapter(adapter);
    this.adapters.clear();
    this.access = null;
  }

  private reconcile(): void {
    const liveIds = new Set(this.bindings.map((binding) => binding.nodeId));
    for (const [nodeId, adapter] of this.adapters) {
      if (liveIds.has(nodeId)) continue;
      this.runtime.removeAdapter(adapter);
      this.adapters.delete(nodeId);
    }
    if (!this.access) return;
    for (const binding of this.bindings) {
      let adapter = this.adapters.get(binding.nodeId);
      if (!adapter) {
        adapter = new MidiOutputAdapter({ id: binding.nodeId, clock: this.clock });
        this.adapters.set(binding.nodeId, adapter);
        this.runtime.addAdapter(adapter);
      }
      adapter.setLatency(binding.latencyMs);
      const port = binding.deviceId ? this.access.outputs.get(binding.deviceId) : undefined;
      adapter.setPorts(port && port.state !== "disconnected" ? [port] : []);
    }
  }
}
