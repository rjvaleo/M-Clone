import { useRef } from "react";
import { ARROW_DIRS, type ArrowDir, type ArrowState } from "../engine/snapshot";

const ARROW_GLYPH: Record<ArrowDir, string> = {
  right: "M3 8 L11 8 M8 5 L11 8 L8 11",
  down: "M8 3 L8 11 M5 8 L8 11 L11 8",
  left: "M13 8 L5 8 M8 5 L5 8 L8 11",
  up: "M8 13 L8 5 M5 8 L8 5 L11 8",
};

/** Click toggles conducting; press and hold rotates through the four axes. */
export function ConductingArrow({ label, state, onChange, className = "" }: {
  label: string;
  state: ArrowState;
  onChange: (next: ArrowState) => void;
  className?: string;
}) {
  const held = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rotate = () => {
    held.current = true;
    onChange({
      ...state,
      dir: ARROW_DIRS[(ARROW_DIRS.indexOf(state.dir) + 1) % ARROW_DIRS.length],
    });
  };

  return (
    <button
      type="button"
      className={"uarrow " + className + (state.on ? " uarrow--on" : "")}
      aria-pressed={state.on}
      aria-label={`Conduct ${label} (${state.dir}); hold to rotate`}
      title={`Conduct ${label} - click to enable, hold to rotate`}
      onPointerDown={() => {
        held.current = false;
        timer.current = setTimeout(rotate, 350);
      }}
      onPointerUp={() => {
        if (timer.current) clearTimeout(timer.current);
        if (!held.current) onChange({ ...state, on: !state.on });
      }}
      onPointerLeave={() => {
        if (timer.current) clearTimeout(timer.current);
      }}
    >
      <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true"
        fill="none" stroke="currentColor" strokeWidth={2}>
        <path d={ARROW_GLYPH[state.dir]} />
      </svg>
    </button>
  );
}
