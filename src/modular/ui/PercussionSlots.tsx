/**
 * The Percussion module's face: eight note-to-sample slots.
 *
 * This is where the pool's draggable rows finally land. Dragging a sample onto
 * a slot assigns it **by id**, never by name — which is the whole reason asset
 * ids are content hashes: the assignment survives a rename, survives reopening
 * the project, and cannot silently point at different audio than it did when it
 * was made.
 *
 * The choke column is the part worth understanding. Slots sharing a non-zero
 * group silence each other, so an open and a closed hihat on the same group
 * behave the way they do on a real kit — striking one stops the other. Group
 * zero means no choking, which is what a kick and a snare want.
 */

import { createContext, useContext, useRef, useState } from "react";
import type { JsonValue, NodeInstance } from "../model/graph";
import type { AssetEntry } from "../audio/assets";
import { DRUM_KITS } from "../drums/drumKits";

/**
 * The pool, as node faces see it.
 *
 * A context rather than props threaded through every card: the pool changes
 * when a file is dropped, which has nothing to do with the graph, and passing
 * it down by hand would mean every node re-rendering for a sample it does not
 * use.
 */
export const SoundPoolContext = createContext<{
  assets: AssetEntry[];
  preview: (assetId: string) => void;
  /**
   * Load a drum kit into the pool and onto a Percussion module's slots (every
   * Percussion module when no node is named): from the dev server's sample
   * library, or from the files of a folder the user picked.
   */
  loadKit?: (kitId: string, source: "library" | File[], nodeId?: string) => void;
}>({ assets: [], preview: () => {} });

export const useSoundPool = () => useContext(SoundPoolContext);

const SLOT_COUNT = 8;

/** Drag payload from the sound pool. Also read by the Looper and Granular faces. */
export const ASSET_DRAG_TYPE = "application/x-modular-asset";

export type Slot = {
  note: number;
  assetId: string;
  chokeGroup: number;
  gain: number;
  /** Not edited here, but carried through every edit so a kit's placement survives. */
  pan: number;
};

const asSlot = (value: unknown, index: number): Slot => {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const number = (candidate: unknown, fallback: number) =>
    typeof candidate === "number" && Number.isFinite(candidate) ? candidate : fallback;
  return {
    note: Math.trunc(number(raw.note, 36 + index)),
    assetId: typeof raw.assetId === "string" ? raw.assetId : "",
    chokeGroup: Math.trunc(number(raw.chokeGroup, 0)),
    gain: number(raw.gain, 1),
    pan: number(raw.pan, 0),
  };
};

/** At least eight rows, and every slot a kit brought beyond them. */
export const readSlots = (value: JsonValue | undefined): Slot[] => {
  const list = Array.isArray(value) ? value : [];
  return Array.from({ length: Math.max(SLOT_COUNT, list.length) }, (_, index) => asSlot(list[index], index));
};

/** Middle C is C3 here, matching the note numbering Classic M shows. */
export const noteName = (note: number): string => {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(note / 12) - 2;
  return `${names[((note % 12) + 12) % 12]}${octave}`;
};

/**
 * One sample, for the modules that play exactly one.
 *
 * The same drop target as a percussion slot, without the note mapping — so
 * assigning a loop is the same gesture as assigning a drum.
 */
export function AssetSlot({
  node,
  parameterId,
  setParameter,
}: {
  node: NodeInstance;
  parameterId: string;
  setParameter: (id: string, value: JsonValue) => void;
}) {
  const { assets, preview } = useSoundPool();
  const [over, setOver] = useState(false);
  const assetId = typeof node.parameters[parameterId] === "string"
    ? (node.parameters[parameterId] as string) : "";
  const asset = assets.find((entry) => entry.id === assetId);
  const label = assetId === "" ? "Drag a sample here" : asset?.name ?? "missing sample";

  return (
    <div
      className={`mm-asset-slot${over ? " is-drop-target" : ""}${assetId && !asset ? " is-missing" : ""}`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const dropped = event.dataTransfer.getData(ASSET_DRAG_TYPE);
        if (dropped) setParameter(parameterId, dropped);
      }}
    >
      <button
        type="button"
        disabled={!assetId || !asset}
        aria-label={assetId ? `Preview ${label}` : "No sample assigned"}
        onClick={() => assetId && preview(assetId)}
      >▶</button>
      <span>{label}</span>
      {assetId ? <button type="button" aria-label="Clear sample"
        onClick={() => setParameter(parameterId, "")}>×</button> : null}
    </div>
  );
}

export function PercussionSlots({
  node,
  setParameter,
}: {
  node: NodeInstance;
  setParameter: (id: string, value: JsonValue) => void;
}) {
  const { assets, preview: onPreview, loadKit } = useSoundPool();
  const slots = readSlots(node.parameters.slots);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const [kitId, setKitId] = useState(DRUM_KITS[0].id);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const byId = new Map(assets.map((entry) => [entry.id, entry]));

  const update = (index: number, changes: Partial<Slot>) => {
    const next = slots.map((slot, i) => (i === index ? { ...slot, ...changes } : slot));
    setParameter("slots", next as unknown as JsonValue);
  };

  return (
    <div className="mm-slots" role="group" aria-label="Percussion slots">
      {loadKit ? (
        <div className="mm-slots__kit">
          <select value={kitId} aria-label="Drum kit" onChange={(event) => setKitId(event.currentTarget.value)}>
            {DRUM_KITS.map((kit) => <option key={kit.id} value={kit.id}>{kit.name}</option>)}
          </select>
          <button type="button" title="Load this kit from the sample library onto these slots (dev server)"
            onClick={() => loadKit(kitId, "library", node.id)}>Load kit</button>
          <button type="button" title="Pick the kit's folder: every file the kit names is loaded onto these slots"
            onClick={() => folderInput.current?.click()}>From folder…</button>
          <input
            ref={(element) => {
              folderInput.current = element;
              // A whole folder, not single files: not in React's attribute types.
              element?.setAttribute("webkitdirectory", "");
            }}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(event) => {
              const files = [...(event.currentTarget.files ?? [])];
              event.currentTarget.value = "";
              if (files.length > 0) loadKit(kitId, files, node.id);
            }}
          />
        </div>
      ) : null}
      <div className="mm-slots__head">
        <span>Note</span><span>Sample</span><span>Choke</span><span>Gain</span><span />
      </div>
      {slots.map((slot, index) => {
        const asset = byId.get(slot.assetId);
        const label = slot.assetId === ""
          ? "empty"
          : asset?.name ?? "missing sample";
        return (
          <div
            key={index}
            className={`mm-slots__row${dropTarget === index ? " is-drop-target" : ""}${slot.assetId && !asset ? " is-missing" : ""}`}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return;
              // Without preventDefault the browser refuses the drop entirely.
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setDropTarget(index);
            }}
            onDragLeave={() => setDropTarget((current) => (current === index ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              setDropTarget(null);
              const assetId = event.dataTransfer.getData(ASSET_DRAG_TYPE);
              if (assetId) update(index, { assetId });
            }}
          >
            <input
              type="number"
              min={0}
              max={127}
              value={slot.note}
              aria-label={`Slot ${index + 1} note`}
              onChange={(event) => update(index, { note: Number(event.currentTarget.value) })}
            />
            <button
              type="button"
              className="mm-slots__sample"
              title={slot.assetId ? `${label} — click to preview` : "Drag a sample here"}
              disabled={!slot.assetId}
              onClick={() => slot.assetId && onPreview?.(slot.assetId)}
            >
              <span>{noteName(slot.note)}</span>
              <em>{label}</em>
            </button>
            <input
              type="number"
              min={0}
              max={8}
              value={slot.chokeGroup}
              aria-label={`Slot ${index + 1} choke group`}
              onChange={(event) => update(index, { chokeGroup: Number(event.currentTarget.value) })}
            />
            <input
              type="number"
              min={0}
              max={2}
              step={0.05}
              value={slot.gain}
              aria-label={`Slot ${index + 1} gain`}
              onChange={(event) => update(index, { gain: Number(event.currentTarget.value) })}
            />
            <button
              type="button"
              className="mm-slots__clear"
              aria-label={`Clear slot ${index + 1}`}
              disabled={!slot.assetId}
              onClick={() => update(index, { assetId: "" })}
            >×</button>
          </div>
        );
      })}
      <p className="mm-slots__hint">
        Drag a sample from the sound pool onto a row. Rows sharing a choke group
        silence each other.
      </p>
    </div>
  );
}
