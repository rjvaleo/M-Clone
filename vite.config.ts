import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { libraryRoute } from "./vite.library";

export default defineConfig({
  // The library route serves the gitignored sample library to the dev app,
  // so a drum kit loads with one click (see vite.library.ts).
  plugins: [react(), libraryRoute(__dirname)],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    rollupOptions: {
      input: {
        // The app itself, and the kit gallery bench — kept as a second real
        // entry rather than left to only work under `npm run dev`, the way
        // `public/engine-test.html` stays static-served-only because it
        // never needs React. This one imports the app's own modules, so
        // Vite has to actually build it.
        main: resolve(__dirname, "index.html"),
        kitGallery: resolve(__dirname, "kit-gallery.html"),
      },
    },
  },
});
