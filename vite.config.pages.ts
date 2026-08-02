import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { githubPagesBase } from "./src/pages";

export default defineConfig({
  base: githubPagesBase,
  plugins: [react()],
  build: {
    outDir: "dist-pages",
    emptyOutDir: true,
  },
});
