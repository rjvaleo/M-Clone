/**
 * The application menu bar.
 *
 * Deliberately not M-Clone's `WindowMenu`: that one is drawn to look like a
 * 1985 Macintosh, which is right for the M rebuild and wrong beside fifty
 * themeable palettes. This is the same interaction in the `mm-` design system,
 * so it takes its colours from whichever theme and kit are active.
 *
 * The bar renders a structure it is handed and looks each id up in a table of
 * handlers. An id with no handler is drawn disabled rather than skipped, which
 * makes an unimplemented command a visible state instead of a silent gap.
 */

import { useEffect, useRef, useState } from "react";
import { APP_MENUS, CHECKABLE_ITEMS, type MenuItemSpec } from "./appMenus";

export type MenuAction = {
  run: () => void;
  /** Omit for an always-available command. */
  enabled?: boolean;
  /** Only read for ids in `CHECKABLE_ITEMS`. */
  checked?: boolean;
  /** Overrides the spec's hint when the reason depends on state. */
  hint?: string;
};

export type MenuActions = Readonly<Record<string, MenuAction>>;

function MenuList({ items, actions, onClose }: {
  items: readonly MenuItemSpec[];
  actions: MenuActions;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // Deferred by a tick, or the click that opened this menu closes it again.
    const id = setTimeout(() => document.addEventListener("mousedown", away));
    document.addEventListener("keydown", escape);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [onClose]);

  return (
    <div className="mm-menu__list" ref={ref} role="menu">
      {items.map((item, index) => {
        if (item === "separator") {
          return <hr className="mm-menu__separator" key={`separator-${index}`} />;
        }
        const action = actions[item.id];
        const checkable = CHECKABLE_ITEMS.has(item.id);
        const disabled = !action || action.enabled === false;
        return (
          <button
            type="button"
            key={item.id}
            role={checkable ? "menuitemcheckbox" : "menuitem"}
            aria-checked={checkable ? Boolean(action?.checked) : undefined}
            className="mm-menu__item"
            disabled={disabled}
            title={action?.hint ?? (action ? item.hint : `${item.label} — not wired up yet`)}
            onClick={() => {
              action?.run();
              onClose();
            }}
          >
            {/* Every item in a menu holding toggles reserves the tick column,
                so the labels stay in one line whether or not one is on. */}
            {checkable && (
              <span className="mm-menu__check" aria-hidden="true">
                {action?.checked ? "✓" : ""}
              </span>
            )}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function MenuBar({ actions }: { actions: MenuActions }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <nav className="mm-menu" aria-label="Application menu bar">
      {APP_MENUS.map((menu) => (
        <span className="mm-menu__slot" key={menu.title}>
          <button
            type="button"
            className={"mm-menu__title" + (open === menu.title ? " is-open" : "")}
            aria-haspopup="menu"
            aria-expanded={open === menu.title}
            onClick={() => setOpen((current) => (current === menu.title ? null : menu.title))}
            // Once one menu is open the others open on hover, the way a real
            // menu bar behaves — without it, browsing the bar is all clicks.
            onPointerEnter={() => setOpen((current) => (current === null ? current : menu.title))}
          >
            {menu.title}
          </button>
          {open === menu.title && (
            <MenuList items={menu.items} actions={actions} onClose={() => setOpen(null)} />
          )}
        </span>
      ))}
    </nav>
  );
}
