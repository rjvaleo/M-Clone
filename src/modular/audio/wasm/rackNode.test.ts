import { describe, expect, it } from "vitest";
import { WasmRackNode, preferredEngine, type RackNodeLike } from "./rackNode";
import type { RackMessage } from "./rackWorklet";
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
  postMessage(message: RackMessage): void {
    this.sent.push(message);
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
