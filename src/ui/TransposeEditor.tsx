// The Transposition Edit Window.
//
// Two numericals per Voice — Note and Octave — read against C3, which is no
// transposition. The legend says so out loud, because the whole scheme only
// makes sense once you know the reference point: "The note and octave in the
// Edit Window represent the note you have to play to get a particular
// transposition."
//
// M's Numericals step by clicking their upper or lower half, so that is what
// these do; the tooltip spells it out since nothing on screen can.

import {
  TRANSPOSE_NOTES,
  formatTranspose,
  stepNote,
  stepOctave,
  toNoteOctave,
} from "../engine/transpose";
import { voiceColorClass } from "./voicecolor";

/** A Numerical: click the top half to go up, the bottom half to go down. */
function Numerical({ value, label, title, onStep }: {
  value: string;
  label: string;
  title: string;
  onStep: (delta: number) => void;
}) {
  return (
    <button
      type="button"
      className="utr__num"
      aria-label={label}
      title={title}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onStep(e.clientY < r.top + r.height / 2 ? +1 : -1);
      }}
    >
      {value}
    </button>
  );
}

export function TransposeEditor({ slot, onChange, onTransfer }: {
  slot: number[];
  onChange: (voice: number, semitones: number) => void;
  onTransfer: (source: number, destination: number, copy: boolean) => void;
}) {
  return (
    <div className="utr">
      <div className="utr__table">
        <div className="utr__head">
          <span />
          <span>Note</span>
          <span>Octave</span>
        </div>
        {slot.map((semitones, voice) => {
          const { note, octave } = toNoteOctave(semitones);
          const reading = formatTranspose(semitones);
          return (
            <div className={`utr__row ${voiceColorClass("transposition", voice)}`} key={voice}>
              <span className="utr__voice" draggable
                onDragStart={(event) => event.dataTransfer.setData(
                  "application/x-mclone-voice", String(voice),
                )}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const source = Number(event.dataTransfer.getData("application/x-mclone-voice"));
                  if (Number.isInteger(source)) onTransfer(source, voice, event.altKey);
                }}>{voice + 1}</span>
              <Numerical
                value={TRANSPOSE_NOTES[note]}
                label={`Voice ${voice + 1} transposition note: ${reading}`}
                title={
                  `Voice ${voice + 1} Note — currently ${reading}. ` +
                  "Click the upper half to go up a half step, the lower half to " +
                  "go down; past B the octave carries."
                }
                onStep={(d) => onChange(voice, stepNote(semitones, d))}
              />
              <Numerical
                value={String(octave)}
                label={`Voice ${voice + 1} transposition octave: ${reading}`}
                title={
                  `Voice ${voice + 1} Octave — currently ${reading}. ` +
                  "Octave 3 is the octave the Pattern was made in; 4 is an " +
                  "octave up, 2 an octave down."
                }
                onStep={(d) => onChange(voice, stepOctave(semitones, d))}
              />
            </div>
          );
        })}
      </div>

      <p className="utr__legend">
        Middle C = <strong>C3</strong>
        <br />
        (No Transposition)
      </p>
    </div>
  );
}
