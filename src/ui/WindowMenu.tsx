// Per-window pull-down menus.
//
// M kept its commands in the global menu bar at the top of the screen. The
// browser build also exposes commands from the owning module by right-click.
//
// The same item list serves two ways in: a pull-down title in the window's
// chrome, and a right-click anywhere the commands apply.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWorkspaceScale } from "./WorkspaceScale";

export type MenuItem =
  | "separator"
  | {
      label: string;
      run: () => void;
      enabled?: boolean;
      hint?: string;
      /**
       * Options-menu items carry a tick: "An Option is on when the menu item
       * shows a check mark and off when there's no check mark." Leave it
       * undefined for ordinary commands, which reserve no room for one.
       */
      checked?: boolean;
    };

export function shouldCloseMenu(isInsideList: boolean, isOnTitle: boolean): boolean {
  return !isInsideList && !isOnTitle;
}

/** Shared popup body, positioned by whoever opened it. */
function MenuList({ items, onClose, style, title }: {
  items: MenuItem[];
  onClose: () => void;
  style: React.CSSProperties;
  title?: HTMLElement | null;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      if (shouldCloseMenu(
        ref.current?.contains(target) ?? false,
        title?.contains(target) ?? false,
      )) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Deferred so the click that opened the menu doesn't immediately close it.
    const id = setTimeout(() => document.addEventListener("mousedown", away));
    document.addEventListener("keydown", esc);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose, title]);

  return (
    <div className="umenu__list" ref={ref} style={style} role="menu">
      {items.map((item, i) =>
        item === "separator" ? (
          <hr key={i} className="umenu__sep" />
        ) : (
          <button
            key={i}
            type="button"
            role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={item.checked}
            className={"umenu__item"
              + (item.checked === undefined ? "" : " umenu__item--checkable")}
            disabled={item.enabled === false}
            title={item.hint}
            onClick={() => {
              item.run();
              onClose();
            }}
          >
            {item.checked !== undefined && (
              <span className="umenu__check" aria-hidden="true">
                {item.checked ? "✓" : ""}
              </span>
            )}
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

/** A pull-down title used by the global application menu bar. */
export function WindowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const titleRef = useRef<HTMLButtonElement>(null);
  return (
    <span className="umenu">
      <button
        ref={titleRef}
        type="button"
        className={"umenu__title" + (open ? " umenu__title--on" : "")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${label} menu`}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <MenuList
          items={items}
          onClose={() => setOpen(false)}
          title={titleRef.current}
          style={{ position: "absolute", top: "100%", left: 0 }}
        />
      )}
    </span>
  );
}

/**
 * Right-click access to the same commands. Returns the handler to attach and
 * the popup to render.
 */
export function useContextMenu(items: MenuItem[]) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const scale = useWorkspaceScale();

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setAt({ x: e.clientX, y: e.clientY });
  };

  const menu = at ? createPortal(
    <MenuList
      items={items}
      onClose={() => setAt(null)}
      style={{
        position: "fixed", left: at.x, top: at.y, zIndex: 10000,
        transform: `scale(${scale})`, transformOrigin: "top left",
      }}
    />,
    document.body,
  ) : null;

  return { onContextMenu, menu };
}
