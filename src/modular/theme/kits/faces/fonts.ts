/**
 * The font stacks the kits use, and why they are stacks rather than fonts.
 *
 * `fonts/CATALOG.md` catalogues twenty display-font files sitting in the
 * repo's `fonts/` folder — segment/LCD numerals and bitmap type, exactly the
 * kind of face the reference hardware in `reference/panels/CATALOG.md` uses
 * for its readouts. Almost none of them can be shipped: DS-Digital is
 * shareware at $45 commercial, Digital-7 is personal-use-only, BitMap is
 * All Rights Reserved, and the rest carry no licence at all — which is the
 * absence of permission, not the presence of it.
 *
 * So nothing is embedded. Each stack names those families first, then an
 * SIL Open Font Licence face that *could* be embedded later, then the system
 * monospace that is always there. A machine with one of them installed
 * renders the panels as the hardware does; every other machine gets clean
 * tabular monospace. No licence is exercised either way, and if the OFL
 * faces are ever added as `@font-face` rules they slot in without a single
 * change here or in any kit.
 */

/**
 * Segment numerals, for a readout that should look like an LCD.
 *
 * Order: the local-only faces, then DSEG (OFL, embeddable), then monospace.
 */
export const SEGMENT_STACK =
  '"DSEG7 Classic", "Seven Segment", "DS-Digital", "digital-7 mono", "digital-7", ui-monospace, "SF Mono", Menlo, monospace';

/** Pixel type, for labels on a low-resolution panel. */
export const BITMAP_STACK =
  '"Silkscreen", "Pixelify Sans", "BitPap", "bitfont", "1Bit", ui-monospace, "SF Mono", Menlo, monospace';

/** Plain monospace, for kits whose readouts are precise rather than period. */
export const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, monospace';
