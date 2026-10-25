/**
 * The sample library, served to the dev app at `/__library/<folder>/<file>`.
 *
 * The library (`Audio - Archival LIBRARY/`) is gitignored source material, so
 * nothing in the repository holds the audio; this route lets the app fetch a
 * kit's one-shots straight from where they already sit on disk. It serves
 * audio files only, one folder deep, and refuses any path that could leave the
 * library (the checks are `libraryRequestPath` in src/modular/drums/drumKits.ts,
 * tested there).
 *
 * Where it looks, first found wins: `$IDMLAB_LIBRARY`, this checkout's own
 * library folder, then — in a git worktree — the main checkout's.
 *
 * Dev server only: a built app has no route, and loads a kit with the
 * Percussion face's "From folder…" instead.
 */

import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { LIBRARY_ROUTE, libraryRequestPath, libraryRoots } from "./src/modular/drums/drumKits";

const CONTENT_TYPES: Record<string, string> = {
  wav: "audio/wav", aif: "audio/aiff", aiff: "audio/aiff", flac: "audio/flac", mp3: "audio/mpeg", ogg: "audio/ogg",
};

const gitFile = (root: string): string | undefined => {
  const path = join(root, ".git");
  return existsSync(path) && statSync(path).isFile() ? readFileSync(path, "utf8") : undefined;
};

export function libraryRoute(projectRoot: string): Plugin {
  return {
    name: "idmlab-library",
    apply: "serve",
    configureServer(server) {
      const roots = libraryRoots(projectRoot, process.env.IDMLAB_LIBRARY, gitFile(projectRoot)).filter((root) => existsSync(root));
      server.middlewares.use(LIBRARY_ROUTE, (request, response) => {
        const wanted = libraryRequestPath(request.url ?? "");
        const found = wanted && roots.map((root) => join(root, wanted.folder, wanted.file)).find((path) => existsSync(path) && statSync(path).isFile());
        if (!wanted || !found) {
          response.statusCode = 404;
          response.setHeader("Content-Type", "text/plain");
          response.end(roots.length === 0
            ? "No sample library found: set IDMLAB_LIBRARY, or put \"Audio - Archival LIBRARY\" beside the checkout."
            : "Not in the sample library.");
          return;
        }
        response.setHeader("Content-Type", CONTENT_TYPES[wanted.file.split(".").pop()!.toLowerCase()] ?? "application/octet-stream");
        response.setHeader("Content-Length", String(statSync(found).size));
        createReadStream(found).pipe(response);
      });
    },
  };
}
