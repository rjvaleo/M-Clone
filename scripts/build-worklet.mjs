/**
 * Bundles the rack AudioWorklet into `public/`.
 *
 * Uses esbuild's JavaScript API rather than its CLI: the `node_modules/.bin`
 * shim in this checkout is the wrong architecture and exits with "cannot
 * execute binary file", while the library itself works — which is also why the
 * ordinary Vite build has never had a problem.
 *
 * A worklet has to be a self-contained script at a URL. `addModule` does no
 * module resolution, so `WasmRack` is bundled in rather than imported.
 */
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

await mkdir("public", { recursive: true });

await build({
  entryPoints: ["src/modular/audio/wasm/rackWorklet.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: "public/idmlab-rack.js",
  logLevel: "info",
});
