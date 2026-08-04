import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json"],
      // Keep coverage temp/report files off the mounted project folder.
      reportsDirectory: "/tmp/m-clone-coverage",
      /*
       * What is measured.
       *
       * Classic's engine and store, and the whole of idMLab except its React
       * components. Everything here runs under Node, so a gap in it is a gap
       * somebody chose to leave rather than one the environment forced.
       *
       * The React faces (`src/modular/ui/*.tsx`, `src/ui/**`) are the one
       * deliberate hole: testing them needs a DOM, which this project does not
       * yet install. Their logic is deliberately pushed out into the plain
       * modules beside them — `noteRoll.ts`, `viewport.ts`, `cyclicSequence.ts`,
       * `nodePlacement.ts`, `portGeometry.ts` — and those are all covered here.
       */
      include: [
        "src/engine/**/*.ts",
        "src/state/**/*.ts",
        "src/modular/**/*.ts",
      ],
      exclude: [
        "**/*.test.ts",
        // Type-only files: nothing to execute.
        "src/engine/types.ts",
        "src/engine/outputs/types.ts",
        "src/modular/audio/nodes.ts",
        // Browser-only wiring that cannot run under Node.
        "src/engine/runtime.ts",
        "src/engine/outputs/synth.ts",
        "src/engine/outputs/webmidi.ts",
        // Runs inside an AudioWorkletGlobalScope, which Node cannot construct.
        // Kept deliberately thin for exactly that reason — every decision it
        // would otherwise make lives in `wasm/engineBridge.ts`, which is
        // covered, and the WASM below it is covered by `cargo test` plus
        // `rust/wasm/verify.mjs`.
        "src/modular/audio/wasm/rackWorklet.ts",
      ],
      thresholds: {
        /*
         * A ratchet, not an aspiration. Statements, lines and functions are at
         * 100 and stay there. Branches sit a little below because a handful of
         * `catch` blocks and `?? 0` fallbacks exist for browser behaviour that
         * cannot be provoked from Node — a source that refuses to stop, a
         * limiter that reports nothing. Raise this number as those are reached;
         * never lower it.
         */
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 98.5,
      },
    },
  },
});
