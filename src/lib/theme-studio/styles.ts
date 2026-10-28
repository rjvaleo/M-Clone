/**
 * Theme Studio's styles, injected at runtime rather than shipped as a .css file.
 *
 * The point of this package is that it drops into an application without that
 * application having to arrange anything — no Tailwind config to match, no CSS
 * import to add to a bundler, no class names that collide with the host's. Every
 * rule below is scoped under `.ts-studio` and every class is `ts-` prefixed.
 *
 * The studio styles itself from its own `--ts-*` variables, so it inherits the
 * host's light or dark background without being told which it is.
 */

const STYLE_ID = 'theme-studio-styles';

export const STUDIO_CSS = `
.ts-studio {
  --ts-bd: color-mix(in srgb, currentColor 16%, transparent);
  --ts-bd-strong: color-mix(in srgb, currentColor 30%, transparent);
  --ts-mute: color-mix(in srgb, currentColor 60%, transparent);
  --ts-faint: color-mix(in srgb, currentColor 6%, transparent);
  display: grid;
  grid-template-columns: minmax(190px, 280px) 1fr;
  gap: 14px;
  font-size: 12px;
  line-height: 1.45;
}
@media (max-width: 760px) { .ts-studio { grid-template-columns: 1fr; } }

.ts-studio button, .ts-studio input, .ts-studio textarea { font: inherit; color: inherit; }
.ts-panel { border: 1px solid var(--ts-bd); border-radius: 10px; overflow: hidden; }
.ts-panel-head {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 9px; border-bottom: 1px solid var(--ts-bd); background: var(--ts-faint);
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
}
.ts-panel-body { padding: 10px; }

.ts-btn {
  border: 1px solid var(--ts-bd-strong); border-radius: 6px; background: transparent;
  padding: 4px 9px; font-size: 11px; font-weight: 600; cursor: pointer;
}
.ts-btn:hover { background: var(--ts-faint); }
.ts-btn:disabled { opacity: .45; cursor: default; }
.ts-btn-danger:hover { border-color: #d9534f; color: #d9534f; }

.ts-list { list-style: none; margin: 0; padding: 0; max-height: 460px; overflow: auto; }
.ts-item {
  display: block; width: 100%; text-align: left; cursor: pointer;
  border: 0; border-bottom: 1px solid var(--ts-bd); background: transparent; padding: 7px 9px;
}
.ts-item:hover { background: var(--ts-faint); }
.ts-item[aria-selected='true'] { background: var(--ts-faint); box-shadow: inset 3px 0 0 0 currentColor; }
.ts-item-name { display: block; font-weight: 700; font-size: 11.5px; }
.ts-item-note { display: block; font-size: 9.5px; color: var(--ts-mute); }
.ts-inline-note { font-size: 9.5px; font-weight: 400; color: var(--ts-mute); }
.ts-strip { display: flex; height: 6px; margin-top: 4px; border-radius: 2px; overflow: hidden; }
.ts-strip > span { flex: 1; }

.ts-field { display: block; margin-bottom: 9px; }
.ts-label { display: block; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--ts-mute); margin-bottom: 3px; }
.ts-input {
  width: 100%; box-sizing: border-box; border: 1px solid var(--ts-bd-strong);
  border-radius: 6px; padding: 5px 7px; background: transparent;
}
.ts-input:disabled { opacity: .6; }

.ts-swatches { display: flex; flex-wrap: wrap; gap: 7px; }
.ts-swatch { display: flex; align-items: center; gap: 5px; border: 1px solid var(--ts-bd); border-radius: 7px; padding: 4px 5px; }
.ts-swatch input[type='color'] { width: 26px; height: 26px; padding: 0; border: 0; background: none; cursor: pointer; }
.ts-swatch input[type='text'] { width: 74px; border: 0; background: transparent; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; }
.ts-swatch input[type='text']:focus { outline: 1px solid var(--ts-bd-strong); border-radius: 3px; }
.ts-x { border: 0; background: none; cursor: pointer; color: var(--ts-mute); font-size: 13px; line-height: 1; padding: 2px 3px; }
.ts-x:hover { color: #d9534f; }

.ts-row { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.ts-spacer { margin-left: auto; }
.ts-note { font-size: 10px; color: var(--ts-mute); line-height: 1.5; }
.ts-tag { border: 1px solid var(--ts-bd-strong); border-radius: 999px; padding: 1px 7px; font-size: 9.5px; font-weight: 700; }
.ts-error { border: 1px solid #d9534f; border-radius: 7px; padding: 6px 9px; font-size: 10.5px; color: #d9534f; margin-bottom: 9px; }
.ts-empty { padding: 26px 12px; text-align: center; color: var(--ts-mute); font-size: 11px; }

/* ---- live preview: painted entirely from the derived tokens ---- */
.ts-preview { border-radius: 9px; overflow: hidden; border: 1px solid var(--ts-bd); }
.ts-pv-nav { padding: 7px 10px; font-size: 10.5px; font-weight: 700; color: #fff; }
.ts-pv-body { padding: 10px; display: grid; gap: 8px; }
.ts-pv-card { border-radius: 8px; padding: 9px 10px; border: 1px solid; }
.ts-pv-title { font-size: 11px; font-weight: 700; margin-bottom: 5px; }
.ts-pv-pills { display: flex; flex-wrap: wrap; gap: 5px; }
.ts-pv-pill { border-radius: 999px; padding: 1px 7px; font-size: 9.5px; font-weight: 700; }
.ts-pv-bar { height: 7px; border-radius: 999px; overflow: hidden; display: flex; margin-top: 7px; }
.ts-pv-btn { border-radius: 6px; padding: 4px 10px; font-size: 10.5px; font-weight: 700; color: #fff; border: 0; }
.ts-tokens { max-height: 200px; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9.5px; }
.ts-tokens div { display: flex; gap: 6px; padding: 1px 0; }
.ts-tokens b { font-weight: 500; color: var(--ts-mute); min-width: 132px; }
.ts-chip { width: 11px; height: 11px; border-radius: 3px; border: 1px solid var(--ts-bd-strong); flex: none; margin-top: 2px; }
`;

/** Idempotent: called by every studio instance, injects once per document. */
export function ensureStudioStyles(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STUDIO_CSS;
  doc.head.appendChild(style);
}
