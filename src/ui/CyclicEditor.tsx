import { useRef, useState } from "react";
import { POSITION_LABELS } from "../engine/variables";
import type { CyclicVariable } from "../engine/types";
import { useM } from "../state/store";
import { cyclicLengthFromStepIndex, normalizeCyclicStep } from "../engine/cyclic";
import { useContextMenu } from "./WindowMenu";
import { useDraggable } from "./useDraggable";

const KINDS: { id: CyclicVariable; name: string }[] = [
  { id: "rhythm", name: "Rhythm" },
  { id: "legato", name: "Legato" },
  { id: "accent", name: "Accent" },
];

const VOLUME_LEVELS = [0, 25, 50, 75, 100];

export function CyclicEditor({ kind, position, onSelect, onClose }: {
  kind: CyclicVariable;
  position: number;
  onSelect: (kind: CyclicVariable, position: number) => void;
  onClose: () => void;
}) {
  const banks = useM((s) => s.cyclicPositions);
  const lengths = useM((s) => s.cyclicLengths);
  const values = useM((s) => s.project.cyclicValues);
  const activePositions = useM((s) => s.activeCyclicPositions);
  const setLevel = useM((s) => s.setCyclicPositionLevel);
  const setRange = useM((s) => s.setCyclicPositionRange);
  const setLength = useM((s) => s.setCyclicLength);
  const setValue = useM((s) => s.setCyclicValue);
  const [view, setView] = useState<"classic" | "modern">("classic");
  const { pos, z, onPointerDown: onTitleDown, bringToFront } = useDraggable(
    "cyclic-editor", { x: 96, y: 54 },
  );
  const [modernPositions, setModernPositions] = useState<Record<CyclicVariable, number>>({
    rhythm: activePositions.rhythm,
    legato: activePositions.legato,
    accent: activePositions.accent,
  });
  const painting = useRef<{
    kind: CyclicVariable; position: number; voice: number; step: number; level: number;
  } | null>(null);

  const context = useContextMenu([
    { label: `${view === "classic" ? "✓ " : ""}Classic View`, run: () => setView("classic") },
    { label: `${view === "modern" ? "✓ " : ""}Modern View`, run: () => setView("modern") },
  ]);

  const paint = (editKind: CyclicVariable, editPosition: number, voice: number, step: number, level: number) => {
    if (step < lengths[editKind][editPosition][voice]) {
      setLevel(editKind, editPosition, voice, step, level);
    }
  };

  const voiceGrids = (editKind: CyclicVariable, editPosition: number, modern = false) => (
    <div className={modern ? "cyced__voices cyced__voices--modern" : "cyced__voices"}>
      {banks[editKind][editPosition].map((cycle, voice) => (
        <div className={`cyced__voice uvoice uvoice--${voice + 1}`} key={voice}>
          <b>{voice + 1}</b>
          <span className="cyced__levels">4<br />3<br />2<br />1<br />0</span>
          <div className="cyced__grid" onPointerLeave={() => { painting.current = null; }}>
            {Array.from({ length: 5 }, (_, row) => 4 - row).flatMap((level) =>
              cycle.map((selected, step) => {
                const range = normalizeCyclicStep(selected);
                const inRange = level >= range.min && level <= range.max;
                return (
                  <button key={`${level}-${step}`}
                    disabled={step >= lengths[editKind][editPosition][voice]}
                    className={inRange ? "is-on" : ""}
                    aria-label={`${editKind} Voice ${voice + 1} step ${step + 1} level ${level}`}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      painting.current = { kind: editKind, position: editPosition, voice, step, level };
                      paint(editKind, editPosition, voice, step, level);
                    }}
                    onPointerEnter={() => {
                      const anchor = painting.current;
                      if (!anchor || anchor.kind !== editKind || anchor.position !== editPosition || anchor.voice !== voice) return;
                      if (anchor.step === step) {
                        setRange(editKind, editPosition, voice, step, anchor.level, level);
                      } else {
                        paint(editKind, editPosition, voice, step, anchor.level);
                      }
                    }}
                    onPointerUp={() => { painting.current = null; }} />
                );
              }),
            )}
          </div>
          <span className="cyced__levels cyced__levels--right">4<br />3<br />2<br />1<br />0</span>
          <div className="cyced__steps">
            {Array.from({ length: 16 }, (_, step) => (
              <button key={step} className={lengths[editKind][editPosition][voice] === step + 1 ? "is-on" : ""}
                onClick={() => setLength(editKind, editPosition, voice, cyclicLengthFromStepIndex(step))}>{step + 1}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const modernValues = (editKind: CyclicVariable) => (
    <div className="cyced__modern-values" aria-label={`${KINDS.find(({ id }) => id === editKind)?.name} level values`}>
      {[0, 1, 2, 3, 4].map((level) => (
        <label key={level}>
          <b>{level}</b>
          {editKind === "accent" ? (
            <output>{VOLUME_LEVELS[level]}%</output>
          ) : (
            <input type="number" step={editKind === "rhythm" ? 0.1 : 1}
              value={values[editKind][level]}
              onChange={(event) => setValue(editKind, level, Number(event.target.value))} />
          )}
        </label>
      ))}
    </div>
  );

  return (
    <section className={`cyced uwin cyced--${view} movable`} aria-label="Cyclic Editor"
      style={{ left: pos.x, top: pos.y, zIndex: z }}
      onPointerDownCapture={bringToFront} onContextMenu={context.onContextMenu}>
      {context.menu}
      <header className="uwin__title movable__handle" onPointerDown={onTitleDown}>
        <span className="uwin__name">Cyclic Editor</span>
        <span className="uwin__slash">/</span>
        <span className="uwin__note">{view === "classic" ? "Classic" : "Modern"}</span>
        <button className="uwin__close" onClick={onClose} aria-label="Close Cyclic Editor">×</button>
      </header>
      {view === "classic" ? <div className="cyced__body">
        {voiceGrids(kind, position)}
        <aside className="cyced__side">
          <div className="cyced__descriptor">
            <b>NOTE</b>
            <span>Rhythm: steps</span>
            <span>Legato: 1–100%</span>
            <span>Accent: 1–100%</span>
          </div>
          {KINDS.map(({ id, name }) => (
            <div key={id} className={`cyced__control cyced__control--${id}`
              + (id === kind ? " is-current" : "") }>
              <div className="cyced__pick">
                <button className="cyced__kind" onClick={() => onSelect(id, position)}>{name}</button>
                <div className="cyced__positions">
                  {POSITION_LABELS.map((label, p) => (
                    <button key={label} aria-label={`${name} position ${label}`}
                      className={(activePositions[id] === p ? "is-on" : "")
                        + (id === kind && p === position ? " is-editing" : "")}
                      onClick={() => onSelect(id, p)} />
                  ))}
                </div>
              </div>
              {id !== "accent" ? (
                <div className="cyced__values">
                  {[4, 3, 2, 1, 0].map((level) => (
                    <label key={level}>{level} = <input type="number"
                      step={id === "rhythm" ? 0.1 : 1}
                      value={values[id][level]}
                      onChange={(event) => setValue(id, level, Number(event.target.value))} /></label>
                  ))}
                </div>
              ) : (
                <div className="cyced__accent-key" aria-label="Accent level reminder">
                  <span><b>1</b><b>2</b><b>3</b><b>4</b></span>
                  <i /><strong>♨</strong><strong>𝑻</strong>
                </div>
              )}
            </div>
          ))}
        </aside>
      </div> : (
        <div className="cyced__modern">
          {KINDS.map(({ id, name }) => {
            const editPosition = modernPositions[id];
            return (
              <section className={`cyced__modern-module cyced__modern-module--${id}`} key={id}>
                <h3>{name}</h3>
                <div className="cyced__modern-positions" aria-label={`${name} presets`}>
                  {POSITION_LABELS.map((label, preset) => (
                    <button key={label}
                      className={(activePositions[id] === preset ? "is-on " : "") + (editPosition === preset ? "is-editing" : "")}
                      onClick={() => {
                        setModernPositions((current) => ({ ...current, [id]: preset }));
                        onSelect(id, preset);
                      }}>{label}</button>
                  ))}
                </div>
                {modernValues(id)}
                {voiceGrids(id, editPosition, true)}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
