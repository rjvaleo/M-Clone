// Build config for a single, self-contained HTML file that runs by
// double-clicking (no server). Used for quick previews.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  base: "./",
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist-single",
    emptyOutDir: true,
  },
});
