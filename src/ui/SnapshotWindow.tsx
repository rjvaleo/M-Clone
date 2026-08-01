// The Snapshot Window — the tall strip down the far right of M's screen.
//
// Chapter 18 lays it out top to bottom: the Drag Area, then Hold/Do (the camera
// and slides), the Snapshot Conducting Arrow and the Snapshot Quantization
// numerical, the 26 Snapshot locations A-Z in two columns with the Slideshow
// controls beside them, and at the foot Edit Snapshot, Restore From Snapshot
// and Blink Everything — the globe.
//
// Every control carries a tooltip naming what it does and its keyboard
// equivalent, because the icons are 1988 pictograms and nothing else explains
// them. Controls whose underlying system isn't built yet say so in the tooltip
// rather than pretending to work.

import { useEffect } from "react";
import { useM } from "../state/store";
import { QUANTIZE_VALUES, SNAPSHOT_LETTERS } from "../engine/snapshot";
import {
  IconCamera,
  IconEditSnapshot,
  IconGlobe,
  IconRestore,
  IconSlideLoop,
  IconSlidePause,
  IconSlideStop,
  IconSlides,
  IconWave,
} from "./icons";

/** The Picture Numerical's faces. Index 0 is the wave: no quantization. */
const QUANTIZE_GLYPH: Record<number, string> = {
  1: "\u{1D15D}", // whole
  2: "\u{1D15E}", // half
  4: "♩", // quarter
  8: "♪", // eighth
  16: "♬", // sixteenth
};

const SLIDESHOWS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Not-yet-built controls all get the same honest suffix. */
const PENDING = " — not yet wired up";

export function SnapshotWindow() {
  const snapshots = useM((s) => s.snapshots);
  const currentSnapshot = useM((s) => s.currentSnapshot);
  const restorePoint = useM((s) => s.restorePoint);
  const quantize = useM((s) => s.snapshotQuantize);
  const arrows = useM((s) => s.arrows);
  const storeSnapshot = useM((s) => s.storeSnapshot);
  const recallSnapshot = useM((s) => s.recallSnapshot);
  const eraseSnapshot = useM((s) => s.eraseSnapshot);
  const restoreFromSnapshot = useM((s) => s.restoreFromSnapshot);
  const setSnapshotQuantize = useM((s) => s.setSnapshotQuantize);
  const setArrow = useM((s) => s.setArrow);

  // "Clicking on a Snapshot location that exists ... or typing the letter of
  // the Snapshot will recall the stored screen control settings."
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const index = SNAPSHOT_LETTERS.indexOf(e.key.toUpperCase());
      if (index >= 0 && useM.getState().snapshots[index]) {
        e.preventDefault();
        useM.getState().recallSnapshot(index);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const snapArrow = arrows.snapshot ?? { on: false, dir: "right" };
  const nextQuantize =
    QUANTIZE_VALUES[
      (QUANTIZE_VALUES.indexOf(quantize as (typeof QUANTIZE_VALUES)[number]) + 1) %
        QUANTIZE_VALUES.length
    ];

  return (
    <div className="usnapwin">
      {/* Hold/Do — the camera and slides. */}
      <button type="button" className="usnapwin__holddo"
        title={
          "Hold/Do (Backspace) — collect screen settings, then click again to " +
          "apply them together, or click a Snapshot to store them" + PENDING
        }
        aria-label="Hold/Do">
        <IconCamera size={30} />
        <IconSlides size={26} />
      </button>

      <div className="usnapwin__row">
        <button type="button"
          className={"uarrow usnapwin__arrow" + (snapArrow.on ? " uarrow--on" : "")}
          aria-pressed={snapArrow.on}
          title="Snapshot Conducting Arrow — conduct the first six Snapshots from the Conducting Grid"
          aria-label="Snapshot Conducting Arrow"
          onClick={() => setArrow("snapshot", { ...snapArrow, on: !snapArrow.on })}>
          <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true"
            fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M3 8 L11 8 M8 5 L11 8 L8 11" />
          </svg>
        </button>

        <button type="button" className="usnapwin__quant"
          title={
            "Snapshot Quantization — rounds Snapshot execution off to this " +
            `rhythmic value. Currently: ${quantize === 0 ? "none (wave)" : QUANTIZE_GLYPH[quantize]}`
          }
          aria-label={`Snapshot Quantization: ${quantize === 0 ? "none" : quantize}`}
          onClick={() => setSnapshotQuantize(nextQuantize)}>
          {quantize === 0 ? <IconWave size={18} /> : <span>{QUANTIZE_GLYPH[quantize]}</span>}
        </button>

        <button type="button" className="usnapwin__slidebtn"
          title={"Slideshow Stop (0) — stops Slideshow recording or playback" + PENDING}
          aria-label="Slideshow Stop">
          <IconSlideStop size={18} />
        </button>
      </div>

      <div className="usnapwin__grid">
        {/* The 26 Snapshot locations, two to a row, with the Slideshow column
            running down beside them. */}
        <div className="usnapwin__snaps">
          {SNAPSHOT_LETTERS.map((letter, i) => {
            const stored = snapshots[i] !== null;
            return (
              <button key={letter} type="button"
                className={
                  "usnap" + (stored ? " usnap--full" : "") +
                  (currentSnapshot === i ? " usnap--current" : "")
                }
                aria-label={`Snapshot ${letter}${stored ? "" : " (empty)"}`}
                title={
                  stored
                    ? `Snapshot ${letter} — click or press ${letter} to execute · shift-click to overwrite · alt-click to erase`
                    : `Snapshot ${letter} (empty) — click to store the current screen`
                }
                onClick={(e) => {
                  if (e.altKey) eraseSnapshot(i);
                  else if (!stored || e.shiftKey) storeSnapshot(i);
                  else recallSnapshot(i);
                }}>
                {stored && (
                  <span className="usnap__art">
                    <span className="usnap__sun" aria-hidden="true">
                      {currentSnapshot === i && <span className="usnap__mark" />}
                    </span>
                    <span className="usnap__letter">{letter}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="usnapwin__shows">
          <button type="button" className="usnapwin__slidebtn"
            title={"Slideshow Pause (Option-Tab) — pause recording or playback without stopping the music" + PENDING}
            aria-label="Slideshow Pause">
            <IconSlidePause size={18} />
          </button>
          <button type="button" className="usnapwin__slidebtn"
            title={"Slideshow Loop (| or \\) — add a loop point to a recording or playing Slideshow" + PENDING}
            aria-label="Slideshow Loop">
            <IconSlideLoop size={18} />
          </button>
          {SLIDESHOWS.map((n) => (
            <button key={n} type="button" className="usnapwin__show"
              title={`Slideshow ${n} — click or press ${n} to play · option-click to record${PENDING}`}
              aria-label={`Slideshow ${n} (empty)`} />
          ))}
        </div>
      </div>

      <div className="usnapwin__foot">
        <button type="button" className="usnapwin__tool"
          title={"Edit Snapshot — blink the controls stored in the current Snapshot so they can be changed" + PENDING}
          aria-label="Edit Snapshot">
          <IconEditSnapshot size={26} />
        </button>
        <button type="button" className="usnapwin__tool"
          disabled={!restorePoint}
          title={
            restorePoint
              ? "Restore From Snapshot — undo the changes made by the most recently executed Snapshot"
              : "Restore From Snapshot — nothing to undo yet"
          }
          aria-label="Restore From Snapshot"
          onClick={restoreFromSnapshot}>
          <IconRestore size={26} />
        </button>
      </div>

      <button type="button" className="usnapwin__globe"
        title={"Blink Everything — blink every control that can go into a Snapshot, then click a location to store them all" + PENDING}
        aria-label="Blink Everything">
        <IconGlobe size={30} />
      </button>
    </div>
  );
}
