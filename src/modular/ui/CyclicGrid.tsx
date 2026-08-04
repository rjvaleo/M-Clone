/**
 * The Cyclic editor face: sixteen steps, five levels, eight presets.
 *
 * One component serves Accent, Legato and Rhythm, because they are one
 * sequence with three destinations. The module only supplies a legend saying
 * what a level turns into.
 *
 * Editing has no modes and no modifier keys. Press a cell and the step takes
 * that level; drag up or down within the step and it becomes a range, playing
 * somewhere between the two ends on every pass; drag sideways and the level
 * paints across the steps you cross.
 */

import { PresetPad } from "./PresetPad";
import { useRef, useState } from "react";
import type { JsonValue, NodeInstance } from "../model/graph";
import {
  applyDrag,
  cellCoversLevel,
  cellSpan,
  CYCLIC_MAX_LEVEL,
  CYCLIC_PRESET_COUNT,
  CYCLIC_STEPS,
  fillPreset,
  isRangedCell,
  legendFor,
  readPresets,
  withCell,
  type CyclicPreset,
} from "./cyclicSequence";

const LEVELS = [4, 3, 2, 1, 0];
export function CyclicGrid({
  node,
  setParameter,
  setParameters,
  currentStep,
  storageId = "preset-values",
  lengthId = "sequence-length",
  showPresets = true,
}: {
  node: NodeInstance;
  setParameter: (id: string, value: JsonValue) => void;
  setParameters: (values: Record<string, JsonValue>) => void;
  /** One-based playing step from the runtime, or null when stopped. */
  currentStep: number | null;
  /**
   * Which parameter holds the grids.
   *
   * A standalone Cyclic module keeps them in `preset-values`; the Pattern
   * Editor holds three sets at once, so each names its own.
   */
  storageId?: string;
  /**
   * Which parameter holds the sequence length.
   *
   * A standalone Cyclic module has one, so it is `sequence-length`. The Pattern
   * Editor holds three sequences and names each one — `accent-length` and its
   * siblings — because they run at different lengths against each other.
   */
  lengthId?: string;
  /**
   * False inside the Pattern Editor.
   *
   * Its three grids share the compound's single bank — a slot there stores the
   * whole idea. A pad per grid would be three more banks that move
   * independently, which is the thing merging them was meant to end.
   */
  showPresets?: boolean;
}) {
  const presets = readPresets(node.parameters[storageId]);
  const position = Math.min(
    CYCLIC_PRESET_COUNT - 1,
    Math.max(0, Math.round(Number(node.parameters["active-position"] ?? 0))),
  );
  const preset = presets[position];
  const legend = legendFor(node.moduleType);
  const dragRef = useRef<{ step: number; level: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ step: number; level: number } | null>(null);

  const commit = (next: CyclicPreset[]) =>
    setParameter(storageId, next as unknown as JsonValue);

  const beginEdit = (step: number, level: number) => (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    // The face is a drag handle for the whole module, so an edit here must not
    // also start moving the node.
    event.stopPropagation();
    event.preventDefault();
    dragRef.current = { step, level };
    commit(withCell(presets, position, step, level));

    const finish = () => {
      dragRef.current = null;
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointerup", finish);
  };

  const extendEdit = (step: number, level: number) => () => {
    setHover({ step, level });
    const anchor = dragRef.current;
    if (!anchor) return;
    commit(applyDrag(presets, position, anchor, { step, level }));
  };

  const length = Math.max(1, Math.min(CYCLIC_STEPS,
    Math.round(Number(node.parameters[lengthId] ?? CYCLIC_STEPS))));

  const fillAll = (level: number) => commit(fillPreset(presets, position, level));
  const randomiseAll = () => commit(presets.map((entry, index) =>
    index === position
      ? entry.map(() => [0, CYCLIC_MAX_LEVEL] as [number, number])
      : entry));

  return (
    <div className="mm-cyclic" onPointerLeave={() => { setHover(null); setMenu(null); }}>
      {/*
        * The same pad as every other module. A Cyclic module's presets *are*
        * its grids, so the pad selects which one is being edited rather than
        * capturing parameters into it.
        */}
      {showPresets ? <PresetPad node={node} label="Preset" captures={[]} placement="top"
        setParameters={setParameters} /> : null}

      {/*
        * Each step is one vertical bar of five segments rather than a cell in a
        * five-row grid. The information is identical and it costs a quarter of
        * the height, which matters because the Pattern Editor stacks three of
        * these. The level legend and the editing note are tooltips for the same
        * reason — a row of prose per grid is three rows of prose.
        */}
      <div
        className="mm-cyclic__bars"
        role="group"
        aria-label="Sixteen step level grid"
        title={`${legend.caption}. Drag up or down in a step for a random range. Right-click for fill commands.`}
        onContextMenu={(event) => {
          event.preventDefault();
          const bounds = event.currentTarget.getBoundingClientRect();
          setMenu({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
        }}
      >
        {preset.map((cell, step) => {
          const span = cellSpan(cell);
          const ranged = isRangedCell(cell);
          return (
            <div
              key={step}
              className={[
                "mm-cyclic__bar",
                currentStep === step + 1 ? "is-playing" : "",
                step >= length ? "is-beyond" : "",
                hover?.step === step ? "is-column-hover" : "",
              ].filter(Boolean).join(" ")}
              title={`Step ${step + 1}: ${ranged ? `${span.low}–${span.high} (random)` : span.low}`}
            >
              {/* Top level first, so the bar fills from the bottom up. */}
              {[...LEVELS].reverse().map((level) => (
                <button
                  type="button"
                  key={level}
                  className={[
                    "mm-cyclic__seg",
                    cellCoversLevel(cell, level) ? "is-on" : "",
                    cellCoversLevel(cell, level) && ranged ? "is-ranged" : "",
                    span.high === level && cellCoversLevel(cell, level) ? "is-cap" : "",
                  ].filter(Boolean).join(" ")}
                  aria-label={`Step ${step + 1} level ${level}`}
                  aria-pressed={cellCoversLevel(cell, level)}
                  onPointerDown={beginEdit(step, level)}
                  onPointerEnter={extendEdit(step, level)}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/*
        * The ruler sets the length: clicking a number is saying "wrap here",
        * which is the only thing anyone wants from a step number. Steps past it
        * stay visible and dimmed rather than disappearing, so shortening a
        * sequence does not destroy what is beyond the end.
        */}
      <div className="mm-cyclic__ruler" role="group" aria-label="Sequence length">
        {preset.map((_, step) => (
          <button
            type="button"
            key={step}
            className={[
              currentStep === step + 1 ? "is-playing" : "",
              step + 1 === length ? "is-length" : "",
              step >= length ? "is-beyond" : "",
            ].filter(Boolean).join(" ")}
            aria-label={`Set length to ${step + 1} steps`}
            aria-pressed={step + 1 === length}
            title={`Length ${step + 1} step${step === 0 ? "" : "s"}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setParameters({ [lengthId]: step + 1 })}
          >
            {step + 1}
          </button>
        ))}
      </div>

      {menu ? (
        <div className="mm-cyclic__menu" style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => { fillAll(0); setMenu(null); }}>Clear</button>
          <button type="button" onClick={() => { fillAll(2); setMenu(null); }}>Flat</button>
          <button type="button" onClick={() => { randomiseAll(); setMenu(null); }}>All random</button>
        </div>
      ) : null}
    </div>
  );
}
