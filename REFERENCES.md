# References

One index for every piece of source material in the repository, grouped by
what it is *for* rather than where it happens to sit on disk. Audited against
the working tree on 2026-08-06.

Three folders already have proper catalogues, written when the material was
ingested. This file does not repeat them — it says what each covers and points
at it. Everything else is indexed here for the first time.

| Catalogue | Covers | Depth |
| --- | --- | --- |
| [`reference/README.md`](reference/README.md) | The `reference/` root — the M screenshots and the two manuals sitting beside them | Per-file table |
| [`reference/panels/CATALOG.md`](reference/panels/CATALOG.md) | `panels/`, `drum machines/`, `samplers/` — 31 images, 29 entries | Per-entry, with a 29-item component taxonomy |
| [`fonts/CATALOG.md`](fonts/CATALOG.md) | `fonts/` | Per-family, with licences read from each font's own name table |

**Not yet catalogued:** `reference/details/`, `reference/ui components/`,
`reference/machines/`, `reference/theory/`, `reference/emulate/`. Listed below,
flagged in [Gaps](#gaps).

---

## 1. Behavioural authorities

Documents that decide how something must *work*. When code and one of these
disagree, the document wins — this is the group worth quoting in tests.

| Source | Authority over | Size | Tracked |
| --- | --- | ---: | :-: |
| `reference/M27.pdf` | **M 2.7 manual, 194 pages.** The behaviour spec for the whole M rebuild: Variables, Conducting, Snapshots, and the six menus in chapters 19–22 | 2.5 MB | ✓ |
| `reference/eventide-h90-manual-v1.12.5.pdf` | The Blackhole and DP/4 ports in `src/modular/audio/`; source of the shelf-resonance and inverse-Gravity descriptions quoted in `rust/README.md` | 10 MB | ✓ |
| `reference/dp4/parameters.json` | **Machine-readable.** DP/4+ algorithm parameter names, indices and ranges, extracted from the manual — see commit `b741376` | 48 KB | ✓ |
| `reference/emulate/Pluggo31PlugInsRef.pdf` | Cycling '74 Pluggo 3.1 plug-in reference — the same house as M, and the closest thing to a spec for the effects vocabulary being emulated | 6.6 MB | ✗ |

### Hardware manuals — `reference/machines/`

Instrument documentation, for architecture and parameter naming rather than
exact emulation. Three files, 7.3 MB, none tracked.

| File | What it is |
| --- | --- |
| `Yamaha DX7 Operating Manual.pdf` | FM architecture, operator/algorithm layout, the 6-operator parameter set (5.3 MB) |
| `Ensoniq TS12.pdf` | TS-12 workstation — sample-plus-synthesis voice architecture (716 KB) |
| `Ensoniq TS12 V3.pdf` | V3 OS revision of the same (1.4 MB) |

### Theory — `reference/theory/`

| File | What it is |
| --- | --- |
| `Music Synthesizers - A Manual of Design and Construction`, Delton T. Horn | Ground-up synthesis design text. Circuit-level, so it explains *why* a module behaves as it does rather than specifying any product. **53 MB — the single largest file in the repository.** Untracked |

---

## 2. The original M — visual source

Fifteen screenshots at the root of `reference/`, itemised per-file in
[`reference/README.md`](reference/README.md). These define presentation only;
`M27.pdf` above defines behaviour.

Grouped by what they show:

- **Whole application** — `color-app.gif` (four Voice colours),
  `b&w-open-window.jpg` (monochrome treatment),
  `all-windows-open-overlapping.png` (window stacking)
- **Permanent windows** — `patterns module.png`,
  `transport and conductor.png`, `variables.png`, `snapshot window.png`
- **Edit windows** — `pattern-editor.png`, `cyclic editor.png`,
  `note density.png`, `velocity range.png`, `note order.png`,
  `note-order.png` (single-state detail), `transposition.png`,
  `time-distortion.png`

`reference/M-Unified-mockup.html` sits alongside them but is **an early rebuild
mockup, not original M material** — don't cite it as evidence of how M looked.

---

## 3. UI look and feel

### Catalogued — `panels/`, `drum machines/`, `samplers/`

31 images across 29 entries, all tracked, fully written up in
[`reference/panels/CATALOG.md`](reference/panels/CATALOG.md). That document is
the most developed reference asset in the repo: each entry records what was
actually visible in the image, and it builds a **29-item component taxonomy**
that any themeable UI kit is measured against.

| Folder | Files | Entries | What it adds |
| --- | ---: | --- | --- |
| `panels/` | 19 | 1–18 | 7 hardware/Eurorack panels, 11 softsynth GUIs |
| `drum machines/` | 7 | 19–25 | Readouts and step-grid layout grammar |
| `samplers/` | 5 | 26–29 | Waveform displays, region editing, browsers |

### Uncatalogued — `reference/ui components/`

Thirteen files, 1.8 MB, untracked. Stock and skin artwork for control
*primitives*, as opposed to the whole-panel shots above — the raw vocabulary
for a themeable kit.

- **Vector control sets** — flat audio controls (buttons, switchers, faders,
  sliders, crossfaders); two retro/analog control-panel sets (sensors, sliders,
  switches); a slider-bar set with adjustable knobs
- **Knobs** — `audioknobs.jpg`
- **Skins** — `lennard_digitals_sylenth1_skin`, `stealthTheme.jpg`,
  `SK_Analog.jpg`
- **Readouts** — retro oscilloscope, 70s/80s dashboard with measurement
  indicators and volume-level displays
- **General UI kits** — `Tablet_Phone User Interface Pro Set` (two versions),
  `tabletProSetV7Freebie.jpg`. Not audio-specific; general widget grammar

### Uncatalogued — `reference/details/`

Eight files, 1.4 MB, untracked. Close-up interface crops, for texture and
detail rather than layout.

- **O3 interface** — four crops (`O3-interface-02`, `-07`, `-08`, `-23`)
- **Sugar Bytes** — Consequence, Egoist, Looperator
- `1702997443_IMG_2150259.jpg` — unidentified; needs a look

---

## 4. Type — `fonts/`

Eighteen font files plus the DS-Digital licence text, 480 KB. Only
`CATALOG.md` is tracked; **no font binary is committed and none is embedded in
the app.**

Two kinds, both matching what the panel catalogue found on real hardware:
**segment/LCD numerals** (DS-Digital, Digital-7, Seven Segment) for readouts,
and **bitmap/pixel type** (1Bit, BitMap, BitPap, bitfont, OPN BitFUUL,
ARCADECLASSIC, Gameplay, game_over, bit1) for labels.

> **Licensing is the constraint, not availability.**
> [`fonts/CATALOG.md`](fonts/CATALOG.md) reads each licence out of the font's
> own `name` table rather than guessing, and **most cannot ship**: DS-Digital
> is $45/typeface commercial, Digital-7 is personal-use only, Seven Segment
> states no licence at all. Read that table before embedding anything.

---

## 5. Project documents

Written by this project rather than gathered for it.

| Document | What it is | Size |
| --- | --- | ---: |
| `README.md` | Project entry point | 20 KB |
| `IDMLAB_TECH_SPEC.md` | Technical specification — "audits itself" per commit `af69fe9` | 74 KB |
| `IDMLAB_MASTER_PLAN.md` | Product and build plan | 65 KB |
| `CHANGELOG.md` | Release history | 8 KB |
| `rust/README.md` | Rust DSP core; quotes the H90 manual for Blackhole/DP-4 behaviour | — |
| `docs/screenshots/` | Two theme captures: `m-clone-classic-theme.png`, `m-clone-red-theme.png` | — |
| `kit-gallery.html` | UI kit gallery harness | 319 B |
| `M-Clone-preview.html` | Standalone single-file build output, regenerable via `npm run build:single` | 198 KB |

---

## 6. Weight and git hygiene

`reference/` is **91 MB**, and four PDFs are 77 MB of that. `.git` is 92 MB.

| Item | Size | Tracked |
| --- | ---: | :-: |
| `reference/theory/` (Horn) | 53 MB | ✗ |
| `reference/eventide-h90-manual` | 10 MB | ✓ |
| `reference/machines/` | 7.3 MB | ✗ |
| `reference/emulate/` | 6.6 MB | ✗ |
| `reference/M27.pdf` | 2.5 MB | ✓ |

`reference/README.md` already records why the H90 manual was kept after being
committed to the root: rewriting history to reclaim the space would invalidate
every existing clone. That reasoning applies with more force now.

> ### Untracked and unignored
>
> `reference/details/`, `reference/ui components/`, `reference/machines/`,
> `reference/theory/`, `reference/emulate/` and `fonts/` (fonts excepting its
> catalogue) are **untracked but not gitignored**. A `git add -A` sweeps 69 MB
> of PDFs and unlicensed font binaries into a commit, and the Horn text alone
> would more than double the repository.
>
> Decide deliberately: either add them to `.gitignore` so the decision is made
> once, or commit the ones that are genuinely needed. Leaving them in the
> current state means the outcome depends on which `git add` someone types.

---

## Gaps

Honest list of what this index cannot tell you.

1. **`reference/ui components/` and `reference/details/` have no catalogue.**
   Section 3 describes them from filenames and a quick look, not from the
   per-entry reading that `panels/CATALOG.md` gave its 29 images. The panel
   catalogue's 29-item taxonomy is the obvious frame to extend over them —
   these two folders are precisely the control-primitive and detail-texture
   material that taxonomy is short of.
2. **`1702997443_IMG_2150259.jpg` is unidentified.** Filename carries no
   product name.
3. **The three hardware manuals and the Horn text have not been mined.** They
   are listed as authorities, but unlike `M27.pdf` — quoted throughout the test
   suite — and the DP/4+ manual — extracted into `dp4/parameters.json` —
   nothing has been pulled out of them yet.
4. **`reference/README.md` is scoped to the `reference/` root.** Its audit date
   of 2026-08-04 does not cover the subfolders added since.
