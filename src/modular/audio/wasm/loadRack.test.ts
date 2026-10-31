import { describe, expect, it, vi } from "vitest";
import { DEFAULT_WASM_URL, DEFAULT_WORKLET_URL, loadRackNode } from "./loadRack";
import { WasmRackNode } from "./rackNode";

const fakeModule = {} as WebAssembly.Module;

const host = (addModule = vi.fn().mockResolvedValue(undefined)) => ({
  audioWorklet: { addModule },
});

const workingNode = () => ({
  port: { postMessage: vi.fn() },
  connect: vi.fn(),
  disconnect: vi.fn(),
});

describe("loadRackNode", () => {
  it("returns a connected rack when everything works", async () => {
    const node = workingNode();
    const destination = {} as never;
    const rack = await loadRackNode(host(), destination, {
      compileModule: vi.fn().mockResolvedValue(fakeModule),
      createNode: () => node,
    });
    expect(rack).toBeInstanceOf(WasmRackNode);
    expect(node.connect).toHaveBeenCalledWith(destination);
  });

  it("compiles the engine and registers the worklet from the default URLs", async () => {
    const addModule = vi.fn().mockResolvedValue(undefined);
    const compileModule = vi.fn().mockResolvedValue(fakeModule);
    await loadRackNode(host(addModule), {} as never, { compileModule, createNode: workingNode });
    expect(compileModule).toHaveBeenCalledWith(DEFAULT_WASM_URL);
    expect(addModule).toHaveBeenCalledWith(DEFAULT_WORKLET_URL);
  });

  it("honours overridden URLs", async () => {
    const addModule = vi.fn().mockResolvedValue(undefined);
    const compileModule = vi.fn().mockResolvedValue(fakeModule);
    await loadRackNode(host(addModule), {} as never, {
      wasmUrl: "/custom.wasm",
      workletUrl: "/custom.js",
      compileModule,
      createNode: workingNode,
    });
    expect(compileModule).toHaveBeenCalledWith("/custom.wasm");
    expect(addModule).toHaveBeenCalledWith("/custom.js");
  });

  it("hands the compiled module to the node, since a worklet cannot await one", async () => {
    const createNode = vi.fn().mockReturnValue(workingNode());
    await loadRackNode(host(), {} as never, {
      compileModule: vi.fn().mockResolvedValue(fakeModule),
      createNode,
    });
    expect(createNode).toHaveBeenCalledWith(fakeModule);
  });

  // Every failure below returns null rather than throwing, so the caller falls
  // back to Web Audio. A browser without worklets, a missing artifact and a
  // build that never ran all have to degrade the same way — silence with a
  // working fallback beats an exception on the audio path.
  it("returns null when the context has no worklet support", async () => {
    const rack = await loadRackNode({}, {} as never, {
      compileModule: vi.fn().mockResolvedValue(fakeModule),
      createNode: workingNode,
    });
    expect(rack).toBeNull();
  });

  it("returns null when the engine cannot be fetched or compiled", async () => {
    const rack = await loadRackNode(host(), {} as never, {
      compileModule: vi.fn().mockRejectedValue(new Error("404")),
      createNode: workingNode,
    });
    expect(rack).toBeNull();
  });

  it("returns null when the worklet module fails to register", async () => {
    const rack = await loadRackNode(host(vi.fn().mockRejectedValue(new Error("bad script"))), {} as never, {
      compileModule: vi.fn().mockResolvedValue(fakeModule),
      createNode: workingNode,
    });
    expect(rack).toBeNull();
  });

  it("returns null when the node cannot be constructed", async () => {
    const rack = await loadRackNode(host(), {} as never, {
      compileModule: vi.fn().mockResolvedValue(fakeModule),
      createNode: () => null,
    });
    expect(rack).toBeNull();
  });

  it("returns null when constructing the node throws", async () => {
    const rack = await loadRackNode(host(), {} as never, {
      compileModule: vi.fn().mockResolvedValue(fakeModule),
      createNode: () => {
        throw new Error("no such processor");
      },
    });
    expect(rack).toBeNull();
  });
});

describe("The Grain Engine's build worker, started with the rack", () => {
  const fakeWorker = () => ({ postMessage: vi.fn(), terminate: vi.fn(), onmessage: null });
  const withRate = { ...host(), sampleRate: 48000 };

  it("hands the worker the compiled engine and the rack's rate", async () => {
    const worker = fakeWorker();
    const rack = await loadRackNode(withRate, {} as never, {
      compileModule: vi.fn().mockResolvedValue(fakeModule),
      createNode: workingNode,
      createBuilder: () => worker,
    });
    expect(rack).toBeInstanceOf(WasmRackNode);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "init", module: fakeModule, sampleRate: 48000 });
  });

  it("still plays when no worker can be made", async () => {
    for (const createBuilder of [() => null, () => { throw new Error("no workers here"); }]) {
      const rack = await loadRackNode(withRate, {} as never, {
        compileModule: vi.fn().mockResolvedValue(fakeModule),
        createNode: workingNode,
        createBuilder,
      });
      expect(rack).toBeInstanceOf(WasmRackNode);
    }
  });

  it("starts no worker without the rack's rate to start it at", async () => {
    const worker = fakeWorker();
    await loadRackNode(host(), {} as never, {
      compileModule: vi.fn().mockResolvedValue(fakeModule),
      createNode: workingNode,
      createBuilder: () => worker,
    });
    expect(worker.postMessage).not.toHaveBeenCalled();
  });
});

describe("loadRackNode with nothing injected", () => {
  it("fetches the engine itself, and gives up when the fetch fails", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    try {
      expect(await loadRackNode(host(), {} as never)).toBeNull();
      expect(fetch).toHaveBeenCalledWith(DEFAULT_WASM_URL);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("builds a real worklet node, which a context without AudioWorkletNode cannot", async () => {
    const addModule = vi.fn().mockResolvedValue(undefined);
    const rack = await loadRackNode(host(addModule), {} as never, { compileModule: vi.fn().mockResolvedValue(fakeModule) });
    expect(addModule).toHaveBeenCalledWith(DEFAULT_WORKLET_URL);
    expect(rack).toBeNull();
  });
});
