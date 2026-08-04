/**
 * The theme picker and the Theme Studio door.
 *
 * Fifty themes is too many for a toggle and too many for a flat list, so the
 * menu groups them the way the roster is ordered: the three built-ins first,
 * then the palette cards sorted by colour rather than by name — neighbouring
 * entries look alike, which is the only way a list this long is scannable.
 *
 * Every row shows its own colours. A theme's name tells you almost nothing;
 * its swatch tells you everything, so the swatch is the primary content and
 * the label is the caption.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ThemeStudio, type StudioPalette } from "../../lib/theme-studio";
import { useCustomPalettes } from "../theme/customPalettes";
import { PALETTES } from "../theme/palettes";
import { allThemes, applyTheme, themeMeta, type ThemeId, type ThemeMeta } from "../theme/themes";

const GROUP_LABEL: Record<ThemeMeta["group"], string> = {
  base: "Built in",
  custom: "Yours",
  palette: "Palettes",
};

/** Built-ins, then anything the user made, then the shipped palette cards. */
const GROUP_ORDER: ThemeMeta["group"][] = ["base", "custom", "palette"];

function Swatch({ theme }: { theme: ThemeMeta }) {
  const colors = theme.source ?? [theme.swatch.surface, theme.swatch.accent, theme.swatch.ink];
  return (
    <span className="mm-theme-swatch" aria-hidden="true">
      {colors.slice(0, 6).map((color, index) => (
        <i key={`${color}-${index}`} style={{ background: color }} />
      ))}
    </span>
  );
}

export function ThemePicker({
  themeId,
  onSelect,
}: {
  themeId: ThemeId;
  onSelect: (id: ThemeId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const { palettes, setPalettes } = useCustomPalettes();
  const rootRef = useRef<HTMLDivElement>(null);

  const themes = useMemo(() => allThemes(), [palettes]);
  const active = themeMeta(themeId);

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matching = needle
      ? themes.filter((theme) => theme.label.toLowerCase().includes(needle))
      : themes;
    return GROUP_ORDER.map((group) => ({
      group,
      items: matching.filter((theme) => theme.group === group),
    })).filter((entry) => entry.items.length > 0);
  }, [themes, filter]);

  // Close on an outside click or Escape, like the canvas module menu.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  /**
   * The studio edits the user's own palettes but previews against the shipped
   * ones too, so the roster is passed in read-only alongside them.
   */
  const studioPalettes: StudioPalette[] = useMemo(
    () => [...palettes, ...PALETTES.map((palette) => ({ ...palette, readOnly: true }))],
    [palettes],
  );

  return (
    <div className="mm-theme" ref={rootRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <Swatch theme={active} />
        <span>{active.label}</span>
      </button>

      {open && (
        <div className="mm-theme-menu" role="menu" onClick={(event) => event.stopPropagation()}>
          <div className="mm-theme-menu__tools">
            <input
              type="search"
              value={filter}
              placeholder={`Search ${themes.length} themes`}
              aria-label="Search themes"
              onChange={(event) => setFilter(event.target.value)}
            />
            <button
              type="button"
              onClick={() => {
                setStudioOpen(true);
                setOpen(false);
              }}
            >
              Theme Studio
            </button>
          </div>

          <div className="mm-theme-menu__list">
            {groups.map((entry) => (
              <div key={entry.group}>
                <b>{GROUP_LABEL[entry.group]}</b>
                {entry.items.map((theme) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={theme.id === themeId}
                    key={theme.id}
                    className={theme.id === themeId ? "is-active" : ""}
                    title={theme.blurb}
                    onClick={() => {
                      onSelect(theme.id);
                      setOpen(false);
                    }}
                  >
                    <Swatch theme={theme} />
                    <span>{theme.label}</span>
                    <small>{theme.blurb}</small>
                  </button>
                ))}
              </div>
            ))}
            {groups.length === 0 && <p className="mm-theme-menu__empty">No theme matches “{filter}”.</p>}
          </div>
        </div>
      )}

      {studioOpen && (
        <div className="mm-theme-studio" role="dialog" aria-label="Theme Studio">
          <header>
            <strong>Theme Studio</strong>
            <button type="button" aria-label="Close Theme Studio" onClick={() => setStudioOpen(false)}>
              ×
            </button>
          </header>
          <div className="mm-theme-studio__body">
            <ThemeStudio
              palettes={studioPalettes}
              onChange={setPalettes}
              activeId={themeId}
              applyLabel="Use in Modular"
              onApply={(palette) => {
                // The palette is already in the roster by the time it can be
                // applied, so this is an ordinary theme selection.
                onSelect(palette.id);
                applyTheme(palette.id);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
