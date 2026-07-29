// Patterns window (subset): a piano-roll editor for the selected voice's
// pattern. Click cells to toggle notes. Two octaves, C3–C5.

import { useM } from "../state/store";
import { midiToName } from "../engine/music";

const LOW = 48; // C3
const HIGH = 72; // C5
const PITCHES: number[] = [];
for (let n = HIGH; n >= LOW; n--) PITCHES.push(n);

export function PatternGrid() {
  const selectedVoice = useM((s) => s.selectedVoice);
  const patternIndex = useM((s) => s.project.voices[selectedVoice].patternIndex);
  const pattern = useM((s) => s.project.patterns[patternIndex]);
  const toggle = useM((s) => s.toggleStepPitch);

  const stepCount = pattern.steps.length;

  return (
    <section className="window window--wide">
      <h2 className="window__title">
        Patterns — editing Pattern {patternIndex + 1} (Voice {selectedVoice + 1})
      </h2>
      <div className="window__body">
        <div className="grid" role="grid" aria-label="pattern editor">
          {PITCHES.map((pitch) => {
            const isC = pitch % 12 === 0;
            return (
              <div className="grid__row" key={pitch}>
                <div className={"grid__label" + (isC ? " grid__label--c" : "")}>
                  {midiToName(pitch)}
                </div>
                {Array.from({ length: stepCount }, (_, step) => {
                  const on = pattern.steps[step].pitches.includes(pitch);
                  const within = step < pattern.outputLength;
                  return (
                    <button
                      key={step}
                      className={
                        "cell" +
                        (on ? " cell--on" : "") +
                        (within ? "" : " cell--muted") +
                        (step % 4 === 0 ? " cell--beat" : "")
                      }
                      aria-label={`${midiToName(pitch)} step ${step + 1}`}
                      aria-pressed={on}
                      onClick={() => toggle(patternIndex, step, pitch)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
