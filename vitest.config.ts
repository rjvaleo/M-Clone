import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      // Keep coverage temp/report files off the mounted project folder.
      reportsDirectory: "/tmp/m-clone-coverage",
      // The engine logic is pure and must stay fully covered. Browser-only
      // wiring (AudioContext / Web MIDI / React) and type-only files are
      // excluded — they can't run under node and are kept deliberately thin.
      include: ["src/engine/**/*.ts", "src/state/**/*.ts"],
      exclude: [
        "src/engine/**/*.test.ts",
        "src/state/**/*.test.ts",
        "src/engine/types.ts",
        "src/engine/outputs/types.ts",
        "src/engine/runtime.ts",
        "src/engine/outputs/synth.ts",
        "src/engine/outputs/webmidi.ts",
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
