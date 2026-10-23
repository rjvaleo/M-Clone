/**
 * A module's preset manager — Numerology's preset button in the header —
 * and the slots a–f on its face.
 *
 * Up to 99 named snapshots of the whole module. The first six places are the
 * slots a–f; drag a preset up or down (or use ▲ ▼) to choose what sits on
 * them. Click a row to recall it, Store to put the module's settings in that
 * place, double-click a name to rename it.
 */

import { useState } from "react";
import { MAX_PRESETS, PRESET_SLOTS, deletePreset, firstFree, movePreset, renamePreset, storePreset, type PresetList } from "../../mlab/presets";
import { POSITION_LABELS } from "../../mlab/model";
import { useDismiss } from "./kit";

export type PresetHandlers = {
  presets: PresetList;
  /** The slot a–f last recalled, or -1. */
  active: number;
  recall: (index: number) => void;
  /** Store the module's current settings at `index`. */
  store: (index: number, name?: string) => void;
  change: (presets: PresetList) => void;
};

export function PresetButton({ handlers }: { handlers: PresetHandlers }) {
  const [open, setOpen] = useState(false);
  const menu = useDismiss<HTMLSpanElement>(open, () => setOpen(false));
  return (
    <span className="n4-header__menu" ref={menu}>
      <button type="button" aria-label="Presets" aria-expanded={open} title="Presets"
        onClick={(event) => { event.stopPropagation(); setOpen(!open); }}>
        <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 2h9.5L14 4.5V14H2z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M5 2v4h5V2M5 14v-4h6v4" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
      {open && <PresetManager handlers={handlers} onClose={() => setOpen(false)} />}
    </span>
  );
}

function PresetManager({ handlers, onClose }: { handlers: PresetHandlers; onClose: () => void }) {
  const { presets, change, recall, store } = handlers;
  const [dragging, setDragging] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const shown = Math.min(MAX_PRESETS, Math.max(PRESET_SLOTS + 2, presets.length + 1));
  const free = firstFree(presets);
  return (
    <div className="n4-popup n4-presets" role="dialog" aria-label="Presets" onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}>
      <div className="n4-presets__head">
        <span className="n4-label">Presets</span>
        <span className="n4-muted">{presets.filter(Boolean).length} / {MAX_PRESETS}</span>
        {free >= 0 && <button type="button" className="n4-presets__new" onClick={() => store(free)}>Store new</button>}
        <button type="button" aria-label="Close presets" onClick={onClose}>×</button>
      </div>
      <div className="n4-presets__list" role="list">
        {Array.from({ length: shown }, (_, index) => {
          const preset = presets[index];
          return (
            <div key={index} role="listitem" draggable={Boolean(preset)}
              className={`n4-presets__row${index < PRESET_SLOTS ? " is-slot" : ""}${preset ? "" : " is-empty"}${dragging === index ? " is-dragging" : ""}`}
              onDragStart={() => setDragging(index)} onDragEnd={() => setDragging(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); if (dragging !== null) change(movePreset(presets, dragging, index)); setDragging(null); }}
              onClick={() => { if (preset) recall(index); }}>
              <span className="n4-presets__slot">{index < PRESET_SLOTS ? POSITION_LABELS[index] : ""}</span>
              <span className="n4-presets__num">{String(index + 1).padStart(2, "0")}</span>
              {renaming === index && preset
                ? <input autoFocus defaultValue={preset.name} className="n4-input" aria-label="Preset name"
                  onClick={(event) => event.stopPropagation()}
                  onBlur={(event) => { change(renamePreset(presets, index, event.currentTarget.value.trim() || preset.name)); setRenaming(null); }}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setRenaming(null); }} />
                : <span className="n4-presets__name" onDoubleClick={(event) => { event.stopPropagation(); if (preset) setRenaming(index); }}>
                  {preset?.name ?? "—"}
                </span>}
              <span className="n4-presets__actions" onClick={(event) => event.stopPropagation()}>
                <button type="button" title="Store the module here" onClick={() => store(index, preset?.name)}>Store</button>
                {preset && <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => change(movePreset(presets, index, index - 1))}>▲</button>}
                {preset && <button type="button" aria-label="Move down" onClick={() => change(movePreset(presets, index, index + 1))}>▼</button>}
                {preset && <button type="button" aria-label="Delete preset" onClick={() => change(deletePreset(presets, index))}>×</button>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Slots a–f on the face: the first six presets. Click to recall; Shift-click to store there. */
export function PresetSlots({ handlers }: { handlers: PresetHandlers }) {
  const { presets, active, recall, store } = handlers;
  return (
    <div className="n4-slots" role="group" aria-label="Presets a–f">
      <span className="n4-label">Preset</span>
      {POSITION_LABELS.map((label, slot) => {
        const preset = presets[slot];
        return (
          <button type="button" key={label}
            className={`n4-button n4-button--small${active === slot && preset ? " is-on" : ""}${preset ? "" : " is-empty"}`}
            title={preset ? `${preset.name} — click to recall, Shift-click to store` : "Empty — Shift-click to store here"}
            onClick={(event) => { event.stopPropagation(); if (event.shiftKey || !preset) store(slot, preset?.name); else recall(slot); }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Build the handlers from a module's parameters. */
export function presetHandlers(
  params: Readonly<Record<string, unknown>>,
  snapshot: () => Record<string, unknown>,
  apply: (values: Record<string, unknown>) => void,
): PresetHandlers {
  const presets = (params.presets as PresetList | undefined) ?? [];
  return {
    presets,
    active: Number(params["preset-slot"] ?? -1),
    recall: (index) => {
      const preset = presets[index];
      if (!preset) return;
      const known = Object.fromEntries(Object.entries(preset.values).filter(([id]) => id in params));
      apply({ ...known, "preset-slot": index < PRESET_SLOTS ? index : -1 });
    },
    store: (index, name) => apply({ presets: storePreset(presets, index, name ?? `Preset ${index + 1}`, snapshot() as never) }),
    change: (next) => apply({ presets: next }),
  };
}
