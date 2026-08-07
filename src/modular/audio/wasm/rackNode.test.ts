import { describe, expect, it } from "vitest";
import { WasmRackNode, preferredEngine, type RackNodeLike } from "./rackNode";
import type { RackMessage } from "./rackWorklet";
import type { RackReport } from "./rackProtocol";
import type { AudioPlan } from "../audioPlan";

/**
 * The main thread's half of the worklet conversation.
 *
 * Everything that decides *what* the engine does lives inside the worklet now,
 * so what is left out here is a protocol: when to post, what to post, and when
 * to stop. Small, and worth pinning anyway — a plan posted on every render
 * would put message traffic back on the audio path, and a plan never posted
 * leaves a rack that is built, wired and playing the previous patch.
 */

class FakePort {
  readonly sent: RackMessage[] = [];
  readonly transferred: Transferable[][] = [];
  onmessage: ((event: { data: RackReport }) => void) | null = null;
  postMessage(message: RackMessage, transfer?: Transferable[]): void {
    this.sent.push(message);
    if (transfer) this.transferred.push(transfer);
  }
}

class FakeNode implements RackNodeLike {
  readonly port = new FakePort();
  disconnected = 0;
  disconnect(): void {
    this.disconnected += 1;
  }
}

const plan = (generation: number): AudioPlan => ({
  generation,
  nodes: {},
  connections: [],
});

describe("Choosing an engine", () => {
  it("stays on Web Audio unless asked", () => {
    // The Rust path is opt-in for as long as it is the newer of the two.
    expect(preferredEngine("")).toBe("web-audio");
    expect(preferredEngine("?theme=dark")).toBe("web-audio");
  });

  it("switches to Rust when the query string says so", () => {
    expect(preferredEngine("?engine=rust")).toBe("rust");
    expect(preferredEngine("?theme=dark&engine=rust")).toBe("rust");
  });

  it("ignores a value it does not recognise", () => {
    // A typo has to land on the path that works, not on neither.
    expect(preferredEngine("?engine=rustt")).toBe("web-audio");
    expect(preferredEngine("?engine=")).toBe("web-audio");
  });
});

describe("The rack node", () => {
  it("sends the first plan it is given", () => {
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    rack.update(plan(1));
    expect(node.port.sent).toEqual([{ type: "plan", plan: plan(1) }]);
  });

  it("does not resend a plan that has not changed", () => {
    // `update` is called from an effect that cannot cheaply know whether
    // anything moved, so the filter has to be here.
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    rack.update(plan(1));
    rack.update(plan(1));
    expect(node.port.sent).toHaveLength(1);
  });

  it("sends each new generation", () => {
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    rack.update(plan(1));
    rack.update(plan(2));
    expect(node.port.sent).toHaveLength(2);
  });

  it("forwards a transport reset", () => {
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    rack.reset();
    expect(node.port.sent).toEqual([{ type: "reset" }]);
  });

  it("goes quiet and lets go of the node once disposed", () => {
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    rack.update(plan(1));
    rack.dispose();

    rack.update(plan(2));
    rack.reset();
    expect(node.port.sent).toHaveLength(1);
    expect(node.disconnected).toBe(1);
  });

  it("disposes only once however often it is asked", () => {
    // Teardown runs from an effect cleanup and from an explicit stop, and both
    // can happen.
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    rack.dispose();
    rack.dispose();
    expect(node.disconnected).toBe(1);
  });
});

describe("What the audio thread says back", () => {
  const report = (samples: number): RackReport => ({
    type: "report",
    modules: 4,
    cables: 3,
    samples,
    peak: 0.25,
    quanta: 16,
  });

  it("has nothing to report before the worklet has spoken", () => {
    expect(new WasmRackNode(new FakeNode()).report).toBeNull();
  });

  it("keeps the last report the worklet sent", () => {
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    node.port.onmessage?.({ data: report(2) });
    expect(rack.report?.samples).toBe(2);
  });

  it("keeps the newest rather than the first", () => {
    // Reports arrive about six times a second; a stale one would make a meter
    // freeze at whatever the first quantum happened to contain.
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    node.port.onmessage?.({ data: report(1) });
    node.port.onmessage?.({ data: report(5) });
    expect(rack.report?.samples).toBe(5);
  });

  it("ignores anything that is not a report", () => {
    // The port is shared, and a message the main thread does not understand
    // must not become a report full of undefined counts.
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    node.port.onmessage?.({ data: { type: "something-else" } as unknown as RackReport });
    expect(rack.report).toBeNull();
  });
});

describe("Notes", () => {
  it("posts a note-on with the note and velocity", () => {
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    rack.noteOn(60, 0.8, 0);
    expect(node.port.sent).toEqual([
      { type: "note-on", note: 60, velocity: 0.8, detuneCents: 0 },
    ]);
  });

  it("posts a note-off with the note", () => {
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    rack.noteOff(60);
    expect(node.port.sent).toEqual([{ type: "note-off", note: 60 }]);
  });

  it("posts all-notes-off with no payload", () => {
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    rack.allNotesOff();
    expect(node.port.sent).toEqual([{ type: "all-notes-off" }]);
  });

  it("does not deduplicate repeated notes", () => {
    // update() filters by generation because it is called from an effect that
    // cannot cheaply know whether the plan moved. A note is not a plan: two
    // identical noteOn(60, 1) calls are two notes, and swallowing the second
    // would break a repeated note.
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    rack.noteOn(60, 1, 0);
    rack.noteOn(60, 1, 0);
    expect(node.port.sent).toEqual([
      { type: "note-on", note: 60, velocity: 1, detuneCents: 0 },
      { type: "note-on", note: 60, velocity: 1, detuneCents: 0 },
    ]);
  });

  it("posts a scheduled batch with the time the score asked for", () => {
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    rack.schedule("n1", 12.5, [
      { type: "note-on", note: 60, velocity: 1, detuneCents: 0 },
      { type: "note-on", note: 64, velocity: 1, detuneCents: 0 },
    ]);
    expect(node.port.sent).toEqual([
      {
        type: "schedule",
        nodeId: "n1",
        atSec: 12.5,
        events: [
          { type: "note-on", note: 60, velocity: 1, detuneCents: 0 },
          { type: "note-on", note: 64, velocity: 1, detuneCents: 0 },
        ],
      },
    ]);
  });

  it("does not post an empty batch", () => {
    // The adapter can call with nothing to send; a message per empty tick is
    // pure traffic on the path this whole migration exists to keep clear.
    const node = new FakeNode();
    new WasmRackNode(node).schedule("n1", 12.5, []);
    expect(node.port.sent).toHaveLength(0);
  });

  it("goes quiet for scheduled events once disposed", () => {
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    rack.dispose();
    rack.schedule("n1", 12.5, [{ type: "note-on", note: 60, velocity: 1, detuneCents: 0 }]);
    expect(node.port.sent).toHaveLength(0);
  });

  it("posts a modulation message with the node id and routing unchanged", () => {
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    rack.setModulation("synth-1", 0, 6, 0.6);
    expect(node.port.sent).toEqual([
      { type: "modulation", nodeId: "synth-1", source: 0, dest: 6, amount: 0.6 },
    ]);
  });

  it("goes quiet for every note method once disposed", () => {
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    rack.dispose();

    rack.noteOn(60, 1, 0);
    rack.noteOff(60);
    rack.allNotesOff();
    rack.setModulation("synth-1", 0, 6, 0.6);

    expect(node.port.sent).toHaveLength(0);
  });
});

describe("Loading samples", () => {
  it("sends a sample's audio with its rate", () => {
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    rack.loadSample(2, { channels: [Float32Array.from([1, 2])], sampleRate: 44100 });
    expect(node.port.sent[0]).toMatchObject({ type: "sample", slot: 2, sampleRate: 44100 });
  });

  it("transfers the buffers rather than copying them", () => {
    // A two-minute stereo file is forty megabytes; structured-cloning that per
    // sample stalls the main thread visibly.
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    const channel = Float32Array.from([1, 2, 3]);
    rack.loadSample(0, { channels: [channel], sampleRate: 48000 });
    expect(node.port.transferred[0]).toEqual([channel.buffer]);
  });

  it("sends the asset-to-slot table", () => {
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    rack.setSampleMap({ kick: 0 });
    expect(node.port.sent[0]).toEqual({ type: "sample-map", map: { kick: 0 } });
  });

  it("sends nothing at all once disposed", () => {
    // Posting into a disposed node's port is a message nobody reads, and for
    // a sample it is a transferred buffer nobody frees.
    const node = new FakeNode();
    const rack = new WasmRackNode(node);
    rack.dispose();
    rack.loadSample(0, { channels: [Float32Array.from([1])], sampleRate: 48000 });
    rack.setSampleMap({ kick: 0 });
    expect(node.port.sent).toHaveLength(0);
  });
});
