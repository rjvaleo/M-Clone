# Current Technical Stack

**Verified:** 2026-08-02 against `package-lock.json`, the resolved local install,
the Vite/Vitest/TypeScript configuration, and the production builds.  
**Application version:** 0.8.0-alpha

This page describes the software that exists now. Native shells, plug-in hosts,
mobile targets, and third-party Web Audio Module hosting are roadmap candidates,
not dependencies of the browser application.

## Application

| Layer | Current implementation |
| --- | --- |
| Language | TypeScript 5.9.3, strict, ES2021 target, ES modules |
| UI | React 18.3.1 + React DOM 18.3.1 |
| State | Zustand 4.5.7 |
| Styling | Hand-authored CSS, SVG/CSS one-bit controls, light/dark themes, channel palettes |
| Musical core | Framework-independent TypeScript planner, transforms, events, documents, MIDI and conducting models |
| Browser audio | Web Audio API with timestamped synthesis and four independent monitor patches |
| Browser MIDI | Web MIDI API for timestamped output, live input, device/channel assignment, controller conducting, metronome and MIDI Clock output |
| Project format | Versioned JSON stored as `.mclone`; defensive v2 decoding with v1 migration and legacy `.json`/`.mclone.json` import |
| Performance export | Deterministic format-1 Standard MIDI File at 960 PPQN |

## Build and verification

| Tool | Resolved version / role |
| --- | --- |
| Vite | 5.4.21 development server and production bundler |
| `@vitejs/plugin-react` | 4.7.0 React transform |
| `vite-plugin-singlefile` | 2.3.3 self-contained `dist-single/index.html` build |
| GitHub Pages | Static `/M-Clone/` production build in `dist-pages`; Actions deployment after tests on every push to `master` |
| GitHub Releases | `.github/workflows/release.yml` on `v*` tags; version/tag agreement check, full gates, then a published standalone HTML, static zip, and checksums |
| Vitest | 2.1.9 unit and executable manual-conformance suites |
| V8 coverage | 2.1.9 provider; included engine/state surface held at 100% |
| Local verification runtime | Node 24.18.0 and npm 11.16.0; these are the current development environment, not a published minimum-support promise |

Current gates are `npm test`, `npm run test:manual`, `npm run coverage`,
`npm run typecheck`, `npm run build`, `npm run build:pages`, and
`npm run build:single`.

## Architecture boundaries

- `src/engine` owns deterministic musical and document behavior and does not
  depend on React or Zustand.
- `src/state/store.ts` binds project/runtime state to the interface.
- `src/ui` owns React presentation, pointer/keyboard gestures, windows, menus,
  themes, and browser orchestration.
- `src/engine/outputs` and `src/ui/runtime.ts` are platform adapters around the
  explicit event protocol.
- `src/manual` is an executable 180-capability M 2.7 inventory, separate from
  the 758-test product suite.

## Roadmap technologies, not current stack

- Tauri and Rust are candidates for a native shell, timing, MIDI, and audio
  adapter prototype; no native framework has been selected.
- VST3 is a required desktop investigation. Audio Unit remains an evaluated
  Apple target rather than a committed implementation.
- Web Audio Modules hosting is exploratory and does not block M Classic Web.
- macOS/Windows desktop, mobile, Studio, and Modular editions are product
  targets described in `PRODUCT_RELEASE_ROADMAP.md`, not shipped platforms.
