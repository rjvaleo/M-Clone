// The Pattern Editor's 1-bit iconography, drawn as SVG on a 16x16 pixel grid.
//
// These replace the Unicode stand-ins the first pass used. The originals were
// hand-drawn Mac bitmaps, so everything here sits on integer coordinates and
// renders with `crispEdges` — no anti-aliased half-pixels, no font fallback
// roulette. All shapes paint in `currentColor`, which is what lets a selected
// tool invert cleanly (white glyph on a black button).

type IconProps = { size?: number; className?: string };

function Glyph({ size = 16, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/* ===== Step Editing Tools ===== */

/** Selector — the marching-ants rectangle. */
export function IconSelector(props: IconProps) {
  // Dashes are laid out by hand rather than with stroke-dasharray so the
  // corners always land on a mark, the way the bitmap did.
  const h = [1, 4, 7, 10, 13];
  const v = [2, 5, 8, 11];
  return (
    <Glyph {...props}>
      {h.map((x) => (
        <rect key={`t${x}`} x={x} y={1} width={2} height={1} />
      ))}
      {h.map((x) => (
        <rect key={`b${x}`} x={x} y={14} width={2} height={1} />
      ))}
      {v.map((y) => (
        <rect key={`l${y}`} x={1} y={y} width={1} height={2} />
      ))}
      {v.map((y) => (
        <rect key={`r${y}`} x={14} y={y} width={1} height={2} />
      ))}
    </Glyph>
  );
}

/** Eraser — the pearl block seen in three-quarter view. */
export function IconEraser(props: IconProps) {
  return (
    <Glyph {...props}>
      {/* Outline of the block: top face then front face. */}
      <path
        d="M4 5 L11 2 L15 5 L8 8 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path
        d="M4 5 L4 10 L8 13 L8 8 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path
        d="M8 8 L15 5 L15 10 L8 13 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      {/* The felt band across the working end. */}
      <path d="M6 6.2 L13 3.2" stroke="currentColor" strokeWidth="1" fill="none" />
      {/* Eraser crumbs. */}
      <rect x={1} y={12} width={1} height={1} />
      <rect x={3} y={14} width={1} height={1} />
    </Glyph>
  );
}

/** Plunger — inserts a blank step. Cup, shaft, and crossbar handle. */
export function IconPlunger(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x={4} y={1} width={8} height={2} />
      <rect x={7} y={3} width={2} height={6} />
      <path
        d="M3 15 L5 9 L11 9 L13 15 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <rect x={5} y={9} width={6} height={1} />
    </Glyph>
  );
}

/** Scissors — deletes steps. Rings up-left, blades crossing down-right. */
export function IconScissors(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx={3} cy={3} r={2} fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx={3} cy={9} r={2} fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M5 4 L14 12" stroke="currentColor" strokeWidth="1" fill="none" />
      <path d="M5 8 L14 3" stroke="currentColor" strokeWidth="1" fill="none" />
      <rect x={7} y={6} width={1} height={1} />
    </Glyph>
  );
}

/* ===== Footer controls ===== */

/** Editor Sound Enable. */
export function IconSpeaker(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M2 6 L5 6 L9 2 L9 14 L5 10 L2 10 Z" />
      <path d="M11 5 Q13 8 11 11" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M13 3 Q16 8 13 13" fill="none" stroke="currentColor" strokeWidth="1" />
    </Glyph>
  );
}

/** The window Size Box — two offset rectangles, as on every classic Mac window. */
export function IconSizeBox(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x={1} y={5} width={9} height={9} fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x={6} y={2} width={8} height={8} fill="var(--pe-paper, #fff)" />
      <rect x={6} y={2} width={8} height={8} fill="none" stroke="currentColor" strokeWidth="1" />
    </Glyph>
  );
}

/* ===== Mode Selector Picture Matrices ===== */
// Chord Mode ("Chd"): how MIDI input becomes steps.

/** Single Note — one note per step. */
export function IconSingleNote(props: IconProps) {
  return (
    <Glyph {...props}>
      <ellipse cx={6} cy={12} rx={3} ry={2} />
      <rect x={8} y={2} width={1} height={10} />
      <path d="M9 2 Q13 4 12 8" fill="none" stroke="currentColor" strokeWidth="1" />
    </Glyph>
  );
}

/** Chord — a played chord lands in one step. */
export function IconChord(props: IconProps) {
  return (
    <Glyph {...props}>
      <ellipse cx={5} cy={13} rx={2.5} ry={1.8} />
      <ellipse cx={5} cy={9} rx={2.5} ry={1.8} />
      <ellipse cx={5} cy={5} rx={2.5} ry={1.8} />
      <rect x={7} y={3} width={1} height={10} />
    </Glyph>
  );
}

/** Build — a step keeps accruing notes while one is held. */
export function IconBuild(props: IconProps) {
  return (
    <Glyph {...props}>
      <ellipse cx={5} cy={12} rx={2.5} ry={1.8} />
      <rect x={7} y={4} width={1} height={8} />
      <rect x={11} y={4} width={4} height={1} />
      <rect x={12} y={2} width={1} height={5} />
      <path d="M2 3 Q5 1 8 3" fill="none" stroke="currentColor" strokeWidth="1" />
    </Glyph>
  );
}

// Insertion Mode ("Ins"): white circle is the incoming note, black the existing
// ones — the mnemonic the manual itself gives.

/** Insert — the new note is pushed in as its own step. */
export function IconInsert(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx={3} cy={8} r={2.5} />
      <circle cx={13} cy={8} r={2.5} />
      <circle cx={8} cy={8} r={2.5} fill="none" stroke="currentColor" strokeWidth="1" />
    </Glyph>
  );
}

/** Replace — the new note overwrites the step under the counter. */
export function IconReplace(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx={6} cy={9} r={3} />
      <circle cx={10} cy={6} r={3} fill="var(--pe-paper, #fff)" />
      <circle cx={10} cy={6} r={3} fill="none" stroke="currentColor" strokeWidth="1" />
    </Glyph>
  );
}

/** Overdub — the new note joins the notes already in the step. */
export function IconOverdub(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx={8} cy={12} r={2.5} />
      <circle cx={8} cy={4} r={2.5} fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x={7} y={7} width={2} height={2} />
    </Glyph>
  );
}

// Drum Machine Mode ("Dr").

/** Enabled — the repeat sign. */
export function IconDrumOn(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x={3} y={2} width={2} height={12} />
      <rect x={6} y={2} width={1} height={12} />
      <circle cx={11} cy={6} r={1.5} />
      <circle cx={11} cy={10} r={1.5} />
    </Glyph>
  );
}

/** Disabled — the dash of the Picture Matrix. */
export function IconDrumOff(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x={5} y={7} width={6} height={2} />
    </Glyph>
  );
}

/* ===== Scroll and octave controls ===== */

export function IconTriangle({ dir, size = 12, className }: IconProps & {
  dir: "up" | "down" | "left" | "right";
}) {
  const paths = {
    up: "M8 3 L14 13 L2 13 Z",
    down: "M8 13 L2 3 L14 3 Z",
    left: "M3 8 L13 2 L13 14 Z",
    right: "M13 8 L3 2 L3 14 Z",
  };
  return (
    <Glyph size={size} className={className}>
      <path d={paths[dir]} />
    </Glyph>
  );
}

/** The 8va / 8vb octave-scroll icons, set in the music-engraving italic. */
export function IconOctave({ dir }: { dir: "up" | "down" }) {
  return (
    <svg
      width={22}
      height={12}
      viewBox="0 0 22 12"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <text
        x={0}
        y={10}
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize={11}
        fontStyle="italic"
        fontWeight={700}
      >
        {dir === "up" ? "8va" : "8vb"}
      </text>
    </svg>
  );
}

/* ===== Snapshot Window ===== */

/**
 * Hold/Do — "the button with the camera and slide icons at the top of the
 * Snapshot Window". A camera taking the picture, and the slides it produces.
 */
export function IconCamera({ size = 30 }: { size?: number }) {
  return (
    <svg width={size * 1.6} height={size} viewBox="0 0 48 30"
      shapeRendering="crispEdges" fill="currentColor"
      aria-hidden="true" focusable="false">
      {/* Flash on its stalk. */}
      <circle cx={20} cy={5} r={3.5} fill="none" stroke="currentColor" strokeWidth={1.5} />
      <path d="M20 9 L20 12" stroke="currentColor" strokeWidth={1.5} />
      <path d="M13 12 L27 12 L29 15 L11 15 Z" />
      {/* Body, dithered the way the original's was. */}
      <rect x={2} y={15} width={34} height={13} fill="none"
        stroke="currentColor" strokeWidth={1.5} />
      <rect x={4} y={17} width={30} height={9}
        fill="url(#m-dither-camera)" />
      <circle cx={19} cy={21.5} r={4.5} />
      <defs>
        <pattern id="m-dither-camera" width={2} height={2} patternUnits="userSpaceOnUse">
          <rect width={1} height={1} fill="currentColor" />
          <rect x={1} y={1} width={1} height={1} fill="currentColor" />
        </pattern>
      </defs>
    </svg>
  );
}

/** The stack of slides beside the camera. */
export function IconSlides({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26"
      shapeRendering="crispEdges" fill="none" stroke="currentColor"
      aria-hidden="true" focusable="false">
      <rect x={1.5} y={1.5} width={17} height={17} strokeWidth={1.5} />
      <rect x={4.5} y={4.5} width={17} height={17} strokeWidth={1.5} fill="var(--pe-paper, #fff)" />
      <rect x={7.5} y={7.5} width={17} height={17} strokeWidth={1.5} fill="var(--pe-paper, #fff)" />
      <rect x={11} y={11} width={10} height={10} strokeWidth={1.5} />
    </svg>
  );
}

/** Restore From Snapshot — stepping back to the stack you came from. */
export function IconRestore({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26"
      shapeRendering="crispEdges" fill="none" stroke="currentColor"
      aria-hidden="true" focusable="false">
      <rect x={1.5} y={5.5} width={14} height={14} strokeWidth={1.5} />
      <rect x={8.5} y={2.5} width={15} height={15} strokeWidth={1.5} fill="var(--pe-paper, #fff)" />
      <rect x={11} y={9} width={2.5} height={2.5} fill="currentColor" stroke="none" />
      <rect x={16} y={9} width={2.5} height={2.5} fill="currentColor" stroke="none" />
      <rect x={11} y={13} width={2.5} height={2.5} fill="currentColor" stroke="none" />
      <rect x={16} y={13} width={2.5} height={2.5} fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Edit Snapshot — the pencil on its drawing board. */
export function IconEditSnapshot({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26"
      shapeRendering="crispEdges" fill="none" stroke="currentColor"
      aria-hidden="true" focusable="false">
      <rect x={2} y={4} width={19} height={14} strokeWidth={1.5} />
      <path d="M6 24 L9 18 M19 24 L16 18" strokeWidth={1.5} />
      <path d="M9 14 L17 3 L20 5 L12 16 L8 17 Z" strokeWidth={1.5}
        fill="var(--pe-paper, #fff)" />
      <path d="M8 17 L12 16" strokeWidth={1.5} />
    </svg>
  );
}

/** Blink Everything — "the button with the alluring globe icon". */
export function IconGlobe({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30"
      fill="none" stroke="currentColor"
      aria-hidden="true" focusable="false">
      <circle cx={15} cy={15} r={13} strokeWidth={1.5} fill="url(#m-dither-globe)" />
      <ellipse cx={15} cy={15} rx={5.5} ry={13} strokeWidth={1.2} />
      <path d="M2 15 L28 15 M4.5 8 L25.5 8 M4.5 22 L25.5 22" strokeWidth={1.2} />
      <defs>
        <pattern id="m-dither-globe" width={2} height={2} patternUnits="userSpaceOnUse">
          <rect width={1} height={1} fill="currentColor" />
          <rect x={1} y={1} width={1} height={1} fill="currentColor" />
        </pattern>
      </defs>
    </svg>
  );
}

/** Slideshow Stop. */
export function IconSlideStop({ size = 18 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <circle cx={8} cy={8} r={5.5} />
    </Glyph>
  );
}

/** Slideshow Pause. */
export function IconSlidePause({ size = 18 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <rect x={4} y={3} width={3} height={10} />
      <rect x={9} y={3} width={3} height={10} />
    </Glyph>
  );
}

/** Slideshow Loop — the repeat mark a looped Slideshow displays. */
export function IconSlideLoop({ size = 18 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <circle cx={4} cy={5.5} r={1.4} />
      <circle cx={4} cy={10.5} r={1.4} />
      <rect x={8} y={2} width={1.5} height={12} />
      <rect x={11} y={2} width={3} height={12} />
    </Glyph>
  );
}

/** Snapshot Quantization on the wave setting — no quantization. */
export function IconWave({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16"
      fill="none" stroke="currentColor" strokeWidth={1.6}
      aria-hidden="true" focusable="false">
      <path d="M1 9 Q4 3 8 8 T15 7" />
    </svg>
  );
}

/**
 * A stored Snapshot: "a picture of the letter A posing in the sun". The
 * Current Snapshot indicator is "a black mark in the sun".
 */
export function IconSnapshotSun({ letter, current }: { letter: string; current: boolean }) {
  return (
    <svg width={22} height={18} viewBox="0 0 22 18"
      aria-hidden="true" focusable="false">
      <circle cx={5.5} cy={5.5} r={3} fill="none" stroke="currentColor" strokeWidth={1} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <path key={a} d="M5.5 1 L5.5 -0.5" stroke="currentColor" strokeWidth={1}
          transform={`rotate(${a} 5.5 5.5)`} />
      ))}
      {current && <circle cx={5.5} cy={5.5} r={1.6} fill="currentColor" />}
      <text x={11} y={15} fontSize={13} fontWeight={800} fill="currentColor">
        {letter}
      </text>
    </svg>
  );
}
