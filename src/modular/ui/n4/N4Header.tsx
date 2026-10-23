/**
 * The module header every Numerology module has (manual p22), left to right:
 * minimize, bypass, the action menu, the move handle, the module's name, its
 * comment in the middle, and its type at the far right — plus the canvas's
 * own close button. Double-click the name or the comment to edit it.
 */

import { useState } from "react";
import { PresetButton, type PresetHandlers } from "./PresetManager";

export type N4HeaderProps = {
  name: string;
  comment: string;
  title: string;
  collapsed: boolean;
  enabled: boolean;
  onCollapse: () => void;
  onBypass: () => void;
  onRename: (name: string) => void;
  onComment: (comment: string) => void;
  onReset: () => void;
  onClose: () => void;
  /** The module's preset manager, behind Numerology's preset button. */
  presets?: PresetHandlers;
};

export function N4Header(props: N4HeaderProps) {
  const [editing, setEditing] = useState<"name" | "comment" | null>(null);
  const [menu, setMenu] = useState(false);
  const commit = (field: "name" | "comment", value: string) => {
    setEditing(null);
    const text = value.trim();
    if (field === "name" && text) props.onRename(text);
    if (field === "comment") props.onComment(text || "...");
  };
  const editor = (field: "name" | "comment", value: string) => (
    <input autoFocus defaultValue={value} aria-label={field === "name" ? "Module name" : "Module comment"}
      onPointerDown={(event) => event.stopPropagation()}
      onBlur={(event) => commit(field, event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit(field, event.currentTarget.value);
        if (event.key === "Escape") setEditing(null);
      }} />
  );
  return (
    <header className="n4-header mm-node__header">
      <button type="button" aria-label={props.collapsed ? "Show module" : "Minimize module"} aria-expanded={!props.collapsed}
        onClick={(event) => { event.stopPropagation(); props.onCollapse(); }}>{props.collapsed ? "▶" : "▼"}</button>
      <button type="button" className={`n4-header__power${props.enabled ? "" : " is-off"}`}
        aria-label={props.enabled ? "Bypass module" : "Turn module back on"} aria-pressed={!props.enabled}
        onClick={(event) => { event.stopPropagation(); props.onBypass(); }}>⏻</button>
      {props.presets && <PresetButton handlers={props.presets} />}
      <span className="n4-header__menu">
        <button type="button" aria-label="Module actions" aria-expanded={menu}
          onClick={(event) => { event.stopPropagation(); setMenu(!menu); }}>⚙▾</button>
        {menu && (
          <div className="n4-popup" role="menu" onClick={(event) => event.stopPropagation()}>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); setEditing("name"); }}>Rename / Edit Details</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); props.onReset(); }}>Reset All Param Values</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); props.onClose(); }}>Delete Module</button>
          </div>
        )}
      </span>
      <span aria-hidden="true" title="Drag to move">⇕</span>
      <span className="n4-header__name" onDoubleClick={(event) => { event.stopPropagation(); setEditing("name"); }}>
        {editing === "name" ? editor("name", props.name) : props.name}
      </span>
      <span className="n4-header__comment" onDoubleClick={(event) => { event.stopPropagation(); setEditing("comment"); }}>
        {editing === "comment" ? editor("comment", props.comment) : props.comment}
      </span>
      <span className="n4-header__title">{props.title}</span>
      <button type="button" className="n4-header__close" aria-label={`Close ${props.name}`}
        onClick={(event) => { event.stopPropagation(); props.onClose(); }}>×</button>
    </header>
  );
}
