import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Unified } from "./Unified";
import {
  CHANNEL_THEME_PRESETS,
  channelThemeVariables,
  makeCustomChannelTheme,
  type ChannelColors,
  type ChannelThemePresetId,
} from "../engine/theme";
import { clampWorkspaceZoom, workspaceLayout } from "../engine/workspace";
import { WorkspaceScaleProvider } from "./WorkspaceScale";
import { useM } from "../state/store";
import {
  needsDownloadName,
  newProject,
  openProject,
  saveMovieAsMidiFile,
  saveProject,
  loadStartupState,
  saveStartupState,
} from "./fileCommands";
import { WindowMenu, type MenuItem } from "./WindowMenu";
import { APP_WINDOWS, type AppWindowId } from "../engine/windows";
import {
  FILE_MENU_ITEMS,
  VARIABLES_MENU_ITEMS,
  WINDOWS_MENU_ITEMS,
  type MenuItemSpec,
} from "../engine/menus";
import { optionEntries } from "../engine/options";
import { usePatternMenus } from "./patternMenus";
import { draggableIdForMainWindow, windowBackShortcut } from "./windowstack";
import {
  copiedNumericalValue, draggedNumericalValue, setNumericalInput,
} from "./numericalgesture";

type Theme = "light" | "dark";

type Handler = { run: () => void; enabled?: boolean; hint?: string };

/**
 * Turn a manual-defined menu spec into renderable items.
 *
 * Ids without a handler render disabled rather than disappearing, so a command
 * the manual documents but this build hasn't implemented still occupies its
 * proper place in the menu and says so on hover.
 */
function buildMenu(
  spec: readonly MenuItemSpec[],
  handlers: Record<string, Handler>,
): MenuItem[] {
  return spec.map((item) => {
    if (item === "separator") return "separator";
    const handler = handlers[item.id];
    if (!handler) {
      return {
        label: item.label,
        hint: `${item.hint ?? item.label} — not yet wired up`,
        enabled: false,
        run: () => {},
      };
    }
    return {
      label: item.label,
      hint: handler.hint ?? item.hint,
      enabled: handler.enabled,
      run: handler.run,
    };
  });
}

/** Which built edit window each Variables-menu command opens. */
const VARIABLE_WINDOWS: Record<string, AppWindowId> = {
  "var.noteDensity": "density",
  "var.velocityRange": "velocityRange",
  "var.noteOrder": "noteOrderMix",
  "var.transposition": "transposition",
  "var.timeDistortion": "timeDistort",
  "var.orchestration": "outputChannels",
  "var.rhythm": "cyclic-editor",
  "var.accents": "cyclic-editor",
};

/**
 * Track an element's own box, so the desktop can size itself to whatever the
 * browser window leaves after the menu bar rather than to a fixed constant.
 */
function useElementSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    // ResizeObserver is missing in jsdom and in a few older browsers; the
    // window listener keeps the desktop responsive either way.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return [ref, size] as const;
}

export function App() {
  const lastNumerical = useRef<number | null>(null);
  const [workspaceZoom, setWorkspaceZoom] = useState(() => {
    try {
      return clampWorkspaceZoom(Number(localStorage.getItem("mclone.workspaceZoom") ?? 100));
    } catch {
      return 100;
    }
  });
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("mclone.theme") as Theme) ?? "light";
    } catch {
      return "light";
    }
  });

  useEffect(() => {
    const sendWindowBack = (event: KeyboardEvent) => {
      const id = windowBackShortcut(event);
      if (!id) return;
      event.preventDefault();
      window.dispatchEvent(new CustomEvent("mclone:send-window-back", {
        detail: draggableIdForMainWindow(id),
      }));
    };
    window.addEventListener("keydown", sendWindowBack);
    return () => window.removeEventListener("keydown", sendWindowBack);
  }, []);

  useEffect(() => {
    const state = useM.getState();
    if (state.documentEpoch === 0 && !state.isDirty && state.documentName === null) {
      state.newDocument(loadStartupState());
    }
  }, []);
  const [channelPreset, setChannelPreset] = useState<ChannelThemePresetId | "custom">(
    () => {
      try {
        const saved = localStorage.getItem("mclone.channelTheme");
        return saved && (saved === "custom" || saved in CHANNEL_THEME_PRESETS)
          ? saved as ChannelThemePresetId | "custom" : "classic";
      } catch {
        return "classic";
      }
    },
  );
  const [customColors, setCustomColors] = useState<ChannelColors>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("mclone.channelColors") ?? "null");
      return Array.isArray(saved) && saved.length === 4
        ? makeCustomChannelTheme(saved as unknown as ChannelColors).colors
        : [...CHANNEL_THEME_PRESETS.classic.colors];
    } catch {
      return [...CHANNEL_THEME_PRESETS.classic.colors];
    }
  });
  const [saveNameDialogOpen, setSaveNameDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("Untitled");
  const [fileActionAfterSave, setFileActionAfterSave] = useState<"new" | "open" | null>(null);

  useEffect(() => {
    document.body.classList.toggle("dark-bg", theme === "dark");
    try {
      localStorage.setItem("mclone.theme", theme);
    } catch {
      // ignore storage failures
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem("mclone.channelTheme", channelPreset);
      localStorage.setItem("mclone.channelColors", JSON.stringify(customColors));
    } catch {
      // ignore storage failures
    }
  }, [channelPreset, customColors]);

  useEffect(() => {
    try {
      localStorage.setItem("mclone.workspaceZoom", String(workspaceZoom));
    } catch {
      // ignore storage failures
    }
  }, [workspaceZoom]);

  const channelTheme = channelPreset === "custom"
    ? makeCustomChannelTheme(customColors)
    : CHANNEL_THEME_PRESETS[channelPreset];
  const setChannelColor = (index: number, color: string) => {
    const next = [...channelTheme.colors];
    next[index] = color;
    setCustomColors(makeCustomChannelTheme(next as unknown as ChannelColors).colors);
    setChannelPreset("custom");
  };
  const openWindow = (id: AppWindowId) => window.dispatchEvent(
    new CustomEvent<AppWindowId>("mclone:open-window", { detail: id }),
  );
  const documentName = useM((s) => s.documentName);
  const isDirty = useM((s) => s.isDirty);
  const movie = useM((s) => s.movieRecorder.movie);
  const options = useM((s) => s.options);
  const setOption = useM((s) => s.setOption);
  const { editMenu, patternMenu } = usePatternMenus();

  const showSaveNameDialog = () => {
    setSaveName(documentName ?? "Untitled");
    setSaveNameDialogOpen(true);
  };

  useEffect(() => {
    const requestName = (event: Event) => {
      setFileActionAfterSave((event as CustomEvent<"new" | "open">).detail);
      showSaveNameDialog();
    };
    window.addEventListener("mclone:save-before-file-action", requestName);
    return () => window.removeEventListener("mclone:save-before-file-action", requestName);
  });

  const runSave = async (saveAs: boolean) => {
    // Use the app-owned filename step for downloads. Some embedded browsers
    // expose a picker that resolves late and otherwise overwrites the title.
    if (needsDownloadName(saveAs, documentName, false)) {
      showSaveNameDialog();
      return;
    }
    if (await saveProject(false, documentName ?? undefined) === "needs-name") {
      showSaveNameDialog();
    }
  };

  const openVoiceColor = (voice: number) =>
    document.querySelector<HTMLInputElement>(
      `input[aria-label="Voice ${voice + 1} color"]`,
    )?.click();

  const fileItems = buildMenu(FILE_MENU_ITEMS, {
    new: { run: () => { void newProject(); } },
    open: { run: () => { void openProject(); } },
    save: { run: () => { void runSave(false); } },
    saveAs: { run: () => { void runSave(true); } },
    saveMovieAsMidiFile: {
      run: saveMovieAsMidiFile,
      enabled: movie !== null,
      hint: movie ? "Save the completed Movie as a Standard MIDI File" : "Record a Movie first",
    },
    saveStateAsStartup: {
      run: () => {
        if (!saveStartupState()) window.alert("The Startup State could not be saved locally.");
      },
      hint: "Save the current screen locally; Patterns and Time Maps remain fresh",
    },
    midiAssignment: {
      run: () => window.dispatchEvent(new CustomEvent("mclone:open-midi-assignment")),
      hint: "Open the sixteen-channel Web MIDI assignment matrix",
    },
  });

  const variableItems = buildMenu(VARIABLES_MENU_ITEMS, {
    ...Object.fromEntries(
      Object.entries(VARIABLE_WINDOWS).map(([id, window]) => [
        id, { run: () => openWindow(window) },
      ]),
    ),
    ...Object.fromEntries(
      [0, 1, 2, 3].map((voice) => [
        `voiceColor.${voice}`,
        { run: () => openVoiceColor(voice), hint: `Change Voice ${voice + 1}'s colour` },
      ]),
    ),
  });

  // "This menu manages M's many windows. The contents of the Windows Menu will
  // vary as you open and close edit windows."
  const windowItems: MenuItem[] = [
    ...buildMenu(WINDOWS_MENU_ITEMS, {
      closeEditWindows: {
        run: () => window.dispatchEvent(new CustomEvent("mclone:close-edit-windows")),
        hint: "Close every open edit window",
      },
    }),
    "separator",
    ...APP_WINDOWS.map((item) => ({
      label: item.label,
      run: () => openWindow(item.id),
    })),
  ];

  // Chapter 22: every item is a check mark that toggles.
  const optionItems: MenuItem[] = optionEntries(options).map((entry) => ({
    label: entry.label,
    checked: entry.checked,
    enabled: entry.available,
    hint: entry.available ? undefined : "Unavailable in this browser build",
    run: () => setOption(entry.id, !entry.checked),
  }));

  // Zoom and skin are this build's own, not M's, so they sit apart from the
  // manual's options rather than pretending to be among them.
  const viewItems: MenuItem[] = [
    { label: "Zoom Out", run: () => setWorkspaceZoom((v) => clampWorkspaceZoom(v - 10)) },
    { label: "Zoom In", run: () => setWorkspaceZoom((v) => clampWorkspaceZoom(v + 10)) },
    { label: "Actual Size", run: () => setWorkspaceZoom(100) },
    "separator",
    { label: "Light Theme", checked: theme === "light", run: () => setTheme("light") },
    { label: "Dark Theme", checked: theme === "dark", run: () => setTheme("dark") },
  ];

  const [viewportRef, viewport] = useElementSize();
  const layout = workspaceLayout(viewport.width, viewport.height, workspaceZoom);

  return (
    <div className={"app" + (theme === "dark" ? " theme-dark" : "")}
      onInputCapture={(event) => {
        const input = event.target as HTMLInputElement;
        if (input.tagName === "INPUT" && input.type === "number"
          && Number.isFinite(input.valueAsNumber)) lastNumerical.current = input.valueAsNumber;
      }}
      onPointerDownCapture={(event) => {
        const input = event.target as HTMLInputElement;
        if (input.tagName !== "INPUT" || input.type !== "number") return;
        event.preventDefault();
        const min = input.min === "" ? Number.NEGATIVE_INFINITY : Number(input.min);
        const max = input.max === "" ? Number.POSITIVE_INFINITY : Number(input.max);
        const step = input.step === "" || input.step === "any" ? 1 : Number(input.step);
        if (event.shiftKey && lastNumerical.current !== null) {
          setNumericalInput(input, copiedNumericalValue(lastNumerical.current, min, max, step));
          return;
        }
        const initial = input.valueAsNumber;
        if (!Number.isFinite(initial)) return;
        const startX = event.clientX;
        const upper = event.clientY < input.getBoundingClientRect().top
          + input.getBoundingClientRect().height / 2;
        let moved = false;
        const move = (pointer: PointerEvent) => {
          if (pointer.pointerId !== event.pointerId) return;
          const delta = pointer.clientX - startX;
          if (Math.abs(delta) >= 3) moved = true;
          if (moved) setNumericalInput(
            input, draggedNumericalValue(initial, delta, upper, min, max, step),
          );
        };
        const up = (pointer: PointerEvent) => {
          if (pointer.pointerId !== event.pointerId) return;
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          if (!moved) setNumericalInput(
            input, draggedNumericalValue(initial, 0, upper, min, max, step),
          );
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      style={channelThemeVariables(channelTheme) as React.CSSProperties}>
      <nav className="app__menubar" aria-label="Application menu bar">
        <span className="app__apple" aria-hidden="true">◆</span>
        <WindowMenu label="File" items={fileItems} />
        <WindowMenu label="Edit" items={editMenu} />
        <WindowMenu label="Variables" items={variableItems} />
        <WindowMenu label="Pattern" items={patternMenu} />
        <WindowMenu label="Windows" items={windowItems} />
        <WindowMenu label="Options" items={optionItems} />
        <WindowMenu label="View" items={viewItems} />
        <p className="app__doc" aria-live="polite">
          {documentName ?? "Untitled"}{isDirty ? " •" : ""}
        </p>
        <div className="app__views">
          <div className="zoom-control" role="group" aria-label="Application zoom">
            <button type="button" onClick={() => setWorkspaceZoom((value) => clampWorkspaceZoom(value - 10))}
              aria-label="Zoom out">−</button>
            <output aria-label="Application zoom level">{workspaceZoom}%</output>
            <button type="button" onClick={() => setWorkspaceZoom((value) => clampWorkspaceZoom(value + 10))}
              aria-label="Zoom in">+</button>
            <button type="button" onClick={() => setWorkspaceZoom(100)}
              title="Actual size">1:1</button>
          </div>
          <label className="theme-picker">
            <span className="visually-hidden">Channels</span>
            <select aria-label="Channel color preset" value={channelPreset}
              onChange={(event) =>
                setChannelPreset(event.target.value as ChannelThemePresetId | "custom")}>
              {Object.values(CHANNEL_THEME_PRESETS).map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name}</option>
              ))}
              {channelPreset === "custom" && <option value="custom">Custom</option>}
            </select>
          </label>
          {/* Driven from Variables ▸ Voice N Color…, where the manual puts it. */}
          <div className="channel-palette visually-hidden" aria-label="Channel color palette">
            {channelTheme.colors.map((color, index) => (
              <input key={index} type="color" value={color}
                aria-label={`Voice ${index + 1} color`}
                onChange={(event) => setChannelColor(index, event.target.value)} />
            ))}
          </div>
          <button
            className={"vtab" + (theme === "light" ? " vtab--on" : "")}
            onClick={() => setTheme("light")}
          >
            Light
          </button>
          <button
            className={"vtab" + (theme === "dark" ? " vtab--on" : "")}
            onClick={() => setTheme("dark")}
          >
            Dark
          </button>
        </div>
      </nav>

      <a id="mclone-project-download" className="visually-hidden"
        aria-hidden="true" tabIndex={-1} />

      {saveNameDialogOpen && (
        <div className="save-name-backdrop" role="presentation">
          <form className="save-name-dialog" role="dialog" aria-modal="true"
            aria-labelledby="save-name-title"
            onSubmit={(event) => {
              event.preventDefault();
              if (!saveName.trim()) return;
              void (async () => {
                const result = await saveProject(true, saveName);
                if (result !== "saved") return;
                setSaveNameDialogOpen(false);
                const pending = fileActionAfterSave;
                setFileActionAfterSave(null);
                if (pending === "new") await newProject(true);
                else if (pending === "open") await openProject(true);
              })();
            }}>
            <h2 id="save-name-title">Save Project As</h2>
            <label>
              <span>File name</span>
              <input autoFocus value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                onFocus={(event) => event.currentTarget.select()} />
            </label>
            <div className="save-name-dialog__actions">
              <button type="button" onClick={() => {
                setSaveNameDialogOpen(false);
                setFileActionAfterSave(null);
              }}>Cancel</button>
              <button type="submit">Save</button>
            </div>
          </form>
        </div>
      )}

      <div className="workspace-viewport" ref={viewportRef}>
        <div className="workspace-scaled" style={{
          width: layout.physical.width,
          height: layout.physical.height,
        }}>
          <div className="workspace-logical" style={{
            width: layout.logical.width,
            height: layout.logical.height,
            transform: `scale(${layout.scale})`,
          }}>
            <WorkspaceScaleProvider value={layout.scale}>
              <Unified openVoiceColor={(voice) => {
                document.querySelector<HTMLInputElement>(
                  `input[aria-label="Voice ${voice + 1} color"]`,
                )?.click();
              }} />
            </WorkspaceScaleProvider>
          </div>
        </div>
      </div>

    </div>
  );
}
