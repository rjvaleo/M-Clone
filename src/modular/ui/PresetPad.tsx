/**
 * The preset pad: sixteen slots, one component, every module.
 *
 * Every Variable in this app carries stored positions, and until now each one
 * drew them itself — a row of letters here, a row with values underneath
 * there, a grid of cells somewhere else. Same idea, four appearances, four
 * places to fix anything. This is the single control they all use.
 *
 * Two rows of eight, numbered 1–16, which reads as a bank rather than as a
 * sentence: you learn where 11 is by position, the way you learn a numeric
 * keypad, and that is not true of a row of sixteen letters.
 *
 * ## What a preset captures
 *
 * The only thing that differs between modules is *which* parameters a slot
 * stores, so that is the one thing passed in. A single captured parameter is
 * stored as a bare value and several are stored as an object keyed by
 * parameter id — which is the shape the existing documents already use, so
 * nothing has to be migrated.
 *
 * ## Click and shift-click
 *
 * Click recalls, shift-click stores. Kept from the strips this replaces,
 * because it is the convention every hardware sequencer with a bank of pads
 * uses and because recall is the common action by a wide margin.
 */

import { useEffect, useRef, useState } from "react";
import type { JsonValue, NodeInstance, ParameterId } from "../model/graph";
import { PRESET_SLOTS } from "../registry/descriptorKit";

export { PRESET_SLOTS };

/** Slot geometry, in pixels — the stylesheet and the fit test must agree. */
export const SLOT_PX = 22;
export const SLOT_GAP_PX = 3;

/**
 * One row of sixteen, or two of eight — never anything between.
 *
 * A bank that wraps wherever it happens to run out reads as an accident: eleven
 * on one line and five on the next tells you nothing about which slot is which.
 * So there are exactly two shapes, and the only question is whether the wide one
 * fits.
 */
export function presetColumns(availableWidth: number): number {
  const needed = PRESET_SLOTS * SLOT_PX + (PRESET_SLOTS - 1) * SLOT_GAP_PX;
  return Number.isFinite(availableWidth) && availableWidth >= needed ? PRESET_SLOTS : PRESET_SLOTS / 2;
}

export type PresetPlacement = "top" | "bottom" | "left" | "right";

const isHorizontal = (placement: PresetPlacement): boolean =>
  placement === "top" || placement === "bottom";

/** What one slot holds: a bare value, or one value per captured parameter. */
export type PresetSlot = JsonValue;

const readSlots = (source: JsonValue | undefined): PresetSlot[] =>
  Array.from({ length: PRESET_SLOTS }, (_, index) =>
    (Array.isArray(source) && source[index] !== undefined ? source[index] as PresetSlot : null));

/** The live value of the captured parameters, in storage shape. */
export function captureFrom(
  node: NodeInstance,
  captures: readonly ParameterId[],
): PresetSlot {
  if (captures.length === 0) return null;
  if (captures.length === 1) return node.parameters[captures[0]] ?? null;
  const stored: Record<string, JsonValue> = {};
  for (const id of captures) stored[id] = node.parameters[id] ?? null;
  return stored;
}

/** The parameter updates that recalling a slot performs. */
export function restoreFrom(
  slot: PresetSlot,
  captures: readonly ParameterId[],
): Record<string, JsonValue> {
  if (slot === null || slot === undefined || captures.length === 0) return {};
  if (captures.length === 1) return { [captures[0]]: slot as JsonValue };
  if (typeof slot !== "object" || Array.isArray(slot)) return {};
  const values: Record<string, JsonValue> = {};
  for (const id of captures) {
    const value = (slot as Record<string, JsonValue>)[id];
    if (value !== undefined) values[id] = value;
  }
  return values;
}

/** A slot's contents as a sentence, for the tooltip. */
export function describeSlot(slot: PresetSlot, captures: readonly ParameterId[]): string {
  if (slot === null || slot === undefined) return "empty";
  if (captures.length === 1) return String(slot);
  if (typeof slot !== "object" || Array.isArray(slot)) return String(slot);
  return captures
    .map((id) => `${id} ${String((slot as Record<string, JsonValue>)[id] ?? "—")}`)
    .join(", ");
}

export function PresetPad({
  node,
  label,
  captures,
  placement = "bottom",
  storageId = "preset-values",
  activeId = "active-position",
  setParameters,
}: {
  node: NodeInstance;
  label: string;
  captures: readonly ParameterId[];
  placement?: PresetPlacement;
  storageId?: ParameterId;
  activeId?: ParameterId;
  setParameters: (values: Record<string, JsonValue>) => void;
}) {
  const slots = readSlots(node.parameters[storageId]);
  const active = Number(node.parameters[activeId] ?? 0);
  const padRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(PRESET_SLOTS);

  // Measured from the space the pad is given rather than from the pad itself,
  // which would be circular: the module is as wide as its widest child.
  useEffect(() => {
    const parent = padRef.current?.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;
    const measure = () => setColumns(presetColumns(parent.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  const press = (event: React.MouseEvent<HTMLButtonElement>, index: number) => {
    // A pad with nothing to capture is a selector: the module's presets *are*
    // its stored value — a grid, a pattern — and the slot chooses which one is
    // being edited. Shift-clicking one would overwrite it with nothing.
    if (captures.length === 0) {
      setParameters({ [activeId]: index });
      return;
    }
    if (event.shiftKey) {
      const next = [...slots];
      next[index] = captureFrom(node, captures);
      setParameters({ [storageId]: next as JsonValue, [activeId]: index });
      return;
    }
    setParameters({ ...restoreFrom(slots[index], captures), [activeId]: index });
  };

  return (
    <div
      ref={padRef}
      className={`mm-preset-pad mm-preset-pad--${isHorizontal(placement) ? "horizontal" : "vertical"}`}
      data-placement={placement}
      style={isHorizontal(placement)
        ? { gridTemplateColumns: `repeat(${columns}, ${SLOT_PX}px)` }
        : undefined}
      role="group"
      aria-label={label}
    >
      {slots.map((slot, index) => (
        <button
          type="button"
          key={index}
          className={`mm-preset-pad__slot${active === index ? " is-active" : ""}${slot === null ? " is-empty" : ""}`}
          aria-pressed={active === index}
          aria-label={`Preset ${index + 1}`}
          // The pad has no heading, so the tooltip carries what it is as well
          // as what is in it.
          title={captures.length === 0
            ? `${label} ${index + 1}: ${describeSlot(slot, captures)}`
            : `${label} ${index + 1}: ${describeSlot(slot, captures)}. Click to recall, shift-click to store.`}
          onClick={(event) => press(event, index)}
        >
          {index + 1}
        </button>
      ))}
    </div>
  );
}
