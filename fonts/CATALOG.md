# Font reference — ingested 2026-08-04

Twenty files, ten typeface families, all of them display faces of two kinds:
**segment/LCD numerals** and **bitmap/pixel type**. Both kinds are exactly
what `reference/panels/CATALOG.md` describes on real hardware — entry #21's
seven-segment readout on the K.O. II, entry #24's "segmented typeface" in
Nepheton 2's recessed LCD boxes — so the answer to "can these help the
panels" is yes, and specifically for the `lcd` kit's readouts.

**But most of them cannot be shipped.** Licences below were read out of each
font's own `name` table (ID 13), not guessed, plus `DIGITAL.TXT` which ships
alongside DS-Digital. Nothing in this folder is committed to the repo, and
nothing is embedded in the app.

## What is here

### Segment / LCD numerals — the ones the readouts want

| File(s) | Family | Licence as stated by the font | Shippable |
|---|---|---|:-:|
| `DS-DIGI.TTF`, `DS-DIGIB`, `DS-DIGII`, `DS-DIGIT` | DS-Digital | Shareware. `DIGITAL.TXT`: $20 personal, **$45 commercial**, per typeface | ✗ not without paying |
| `digital-7*.ttf` (4 cuts, inc. mono) | Digital-7 | "Freeware for personal use. For commercial use please contuct us." | ✗ not commercially |
| `Seven Segment.ttf` | Seven Segment | none embedded, none in folder | ✗ unknown |

### Bitmap / pixel type — labels and captions

| File | Family | Licence as stated by the font | Shippable |
|---|---|---|:-:|
| `BitMap.ttf` | BitMap | **All Rights Reserved** | ✗ explicitly not |
| `1Bit.ttf` | 1Bit | none embedded | ✗ unknown |
| `BitPap.ttf` | BitPap | none embedded | ✗ unknown |
| `OPN BitFUUL.ttf` | BitFUUL | none embedded | ✗ unknown |
| `bitfont.ttf` | bitfont | none embedded | ✗ unknown |
| `bit1.fon` | — | Windows `.fon` bitmap; not a web font format at all | ✗ unusable |

### Arcade display

| File | Family | Licence as stated by the font | Shippable |
|---|---|---|:-:|
| `Gameplay.ttf` | Gameplay | Creative Commons Attribution-ShareAlike | ✓ with attribution |
| `game_over.ttf` | Game Over | Creative Commons Attribution-ShareAlike | ✓ with attribution |
| `ARCADECLASSIC.TTF` | ArcadeClassic | none embedded | ✗ unknown |

## The awkward result

The two clearly-licensed fonts are arcade display faces, and the kits have
no use for an arcade display face — the kit vocabulary needs a *readout*
face, and every readout face here is either paid, personal-use-only, or
undocumented. "No embedded licence" is not permission; it is the absence of
information, and the safe reading of it is no.

## What was done about it

`src/modular/theme/kits/faces/fonts.ts` defines the font stacks the kits use
for readouts and labels. Each stack names these families **first** and falls
back to the system monospace, so:

- Nothing is embedded and nothing is committed — no licence is exercised.
- If you install or license one of them locally, the panels pick it up with
  no code change; the `lcd` kit in particular gets the seven-segment
  readouts its reference hardware actually has.
- Everyone else sees the tabular monospace the kits used before, which is
  legible and correct, just less characterful.

That is a progressive enhancement rather than a dependency, which is the
only honest way to use a font you do not have the right to distribute.

## If these should actually ship

There are metrically-similar faces under the SIL Open Font Licence that can
be embedded, attributed once, and forgotten about:

- **DSEG** (`DSEG7 Classic`, `DSEG14 Classic`) — seven- and fourteen-segment,
  purpose-built, OFL. The direct replacement for DS-Digital and Digital-7.
- **Silkscreen**, **Pixelify Sans**, **VT323** — bitmap/pixel faces, OFL. The
  replacement for the 1Bit/BitPap/bitfont group.

Both are already named in the fallback chains in `fonts.ts`, ahead of the
system monospace, so dropping the actual files in and adding an `@font-face`
is the only remaining step — no kit or face code has to change.
