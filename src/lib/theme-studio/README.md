# Theme Studio

A palette editor and token-derivation engine, packaged so it can be lifted into
another application by copying this folder.

It depends on **React and nothing else** — no CSS framework, no icon library, no
state manager, and no import from the application it happens to be sitting in.
Styles are injected at runtime from a string, scoped under `.ts-studio`, so there
is no stylesheet to wire into a bundler and no class names that can collide with
the host's.

## Using it

```tsx
import { ThemeStudio, type StudioPalette } from './lib/theme-studio';

const [palettes, setPalettes] = useState<StudioPalette[]>(stored);

<ThemeStudio
  palettes={palettes}
  onChange={setPalettes}
  activeId={currentThemeId}
  applyLabel="Apply to app"
  onApply={(palette, derived) => {
    for (const [key, value] of Object.entries(derived.tokens)) {
      document.documentElement.style.setProperty(key, value);
    }
  }}
/>
```

The component is fully controlled: it owns no palettes and persists nothing.
Where palettes are stored — localStorage, a file, an API — is the host's
decision, which is what makes the component portable.

A palette is just:

```ts
interface StudioPalette {
  id: string;
  name: string;
  colors: string[];      // '#rrggbb' or '#rgb'
  note?: string;
  readOnly?: boolean;    // host-owned: previewable and duplicable, never edited
}
```

Pass shipped palettes in with `readOnly: true` alongside the user's own, and the
studio will show them, preview them and duplicate them without ever letting them
be edited or deleted.

## What derivation guarantees

`deriveTheme(colors)` turns a handful of brand colours into roughly sixty UI
tokens. Two rules do the work, and they are the reason a random palette produces
a usable interface rather than a pretty mess:

1. **Direction is read, not imposed.** A palette that averages light becomes a
   light theme; one that averages dark becomes a dark theme. Forcing every
   palette into one direction misrepresents half of them.

2. **Hue is borrowed, lightness is not.** Surfaces take the palette's hue and a
   damped share of its saturation, but their lightness comes from a fixed
   ladder. A palette of five near-identical mid-tones still yields legible text,
   because the steps belong to the engine and only the colour belongs to the
   palette.

Status colours — green done, amber risk, red blocked, violet proposed — are
never taken from the palette. They carry meaning, so no theme is allowed to
repaint them; only their pitch moves, to sit correctly on that theme's surfaces.
The live preview shows them for exactly this reason.

## Adopting the token vocabulary

The derived tokens are CSS custom properties (`--s-card`, `--tx-800`, `--ac-on`,
`--sel-fill`, `--status-done-bg`, …). A host application consumes them in one of
two ways:

- **Write them onto `:root`** and reference `var(--s-card)` in your own CSS. This
  is the portable route and needs no build tooling.
- **Remap an existing utility vocabulary onto them**, which is what the CTIO
  board does — one block of CSS points Tailwind's `bg-white`, `text-slate-500`
  and friends at the tokens, so a theme change re-skins the whole app without
  touching a component. See `src/index.css` there for the pattern.

Tokens whose names carry alpha are stored as `"R G B"` triplets for use as
`rgb(var(--s-page) / .95)`; the rest are plain hex. The preview panel inside the
studio is a working example of consuming both forms.

## Files

| File | Purpose |
| --- | --- |
| `derive.ts` | The derivation engine. Pure, no React. |
| `types.ts` | `StudioPalette`, plus hex and id normalisation. |
| `styles.ts` | The injected stylesheet. |
| `ThemeStudio.tsx` | The editor component and its live preview. |
| `index.ts` | Public API. |
