import { useEffect, useState } from "react";
import { Unified } from "./Unified";
import {
  CHANNEL_THEME_PRESETS,
  channelThemeVariables,
  makeCustomChannelTheme,
  type ChannelColors,
  type ChannelThemePresetId,
} from "../engine/theme";
import {
  clampWorkspaceZoom,
  fitWorkspaceZoom,
  scaledWorkspaceSize,
} from "../engine/workspace";
import { WorkspaceScaleProvider } from "./WorkspaceScale";
import { useM } from "../state/store";
import { newProject, openProject, saveProject } from "./fileCommands";
import { WindowMenu, type MenuItem } from "./WindowMenu";
import { APP_WINDOWS, type AppWindowId } from "../engine/windows";

type Theme = "light" | "dark";

export function App() {
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
  const windowItems: MenuItem[] = APP_WINDOWS.map((item) => ({
    label: item.label,
    run: () => openWindow(item.id),
  }));
  const variableItems: MenuItem[] = APP_WINDOWS
    .filter((item) => ["density", "velocityRange", "noteOrderMix", "transposition", "timeDistort", "outputChannels"].includes(item.id))
    .map((item) => ({ label: item.label, run: () => openWindow(item.id) }));

  return (
    <div className={"app" + (theme === "dark" ? " theme-dark" : "")}
      style={channelThemeVariables(channelTheme) as React.CSSProperties}>
      <nav className="app__menubar" aria-label="Application menu bar">
        <span className="app__apple" aria-hidden="true">◆</span>
        <WindowMenu label="File" items={[
          { label: "New", run: newProject, hint: "Start an empty project" },
          { label: "Open\u2026", run: openProject, hint: "Open a saved .mclone.json project" },
          "separator",
          { label: "Save", run: () => saveProject(false), hint: "Save the project" },
          { label: "Save As\u2026", run: () => saveProject(true), hint: "Save under a new name" },
        ]} />
        <WindowMenu label="Edit" items={[
          { label: "Open Pattern Editor", run: () => openWindow("pattern-editor") },
        ]} />
        <WindowMenu label="Variables" items={variableItems} />
        <WindowMenu label="Pattern" items={[
          { label: "Open Pattern Editor", run: () => openWindow("pattern-editor") },
          { label: "Open Cyclic Editor", run: () => openWindow("cyclic-editor") },
        ]} />
        <WindowMenu label="Windows" items={windowItems} />
        <WindowMenu label="Options" items={[
          { label: "Zoom Out", run: () => setWorkspaceZoom((value) => clampWorkspaceZoom(value - 10)) },
          { label: "Zoom In", run: () => setWorkspaceZoom((value) => clampWorkspaceZoom(value + 10)) },
          { label: "Actual Size (100%)", run: () => setWorkspaceZoom(100) },
          "separator",
          { label: "Light Theme", run: () => setTheme("light") },
          { label: "Dark Theme", run: () => setTheme("dark") },
        ]} />
      </nav>
      <header className="app__header">
        <h1>
          M<span className="app__sub">-Clone</span>
        </h1>
        <p className="app__tag">An Intelligent Musical Instrument — reborn</p>
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
            <button type="button" onClick={() => setWorkspaceZoom(100)}>100%</button>
            <button type="button" onClick={() => setWorkspaceZoom(fitWorkspaceZoom(
              Math.max(0, window.innerWidth - 32), Math.max(0, window.innerHeight - 112),
            ))}>Fit</button>
          </div>
          <label className="theme-picker">
            Channels
            <select aria-label="Channel color preset" value={channelPreset}
              onChange={(event) =>
                setChannelPreset(event.target.value as ChannelThemePresetId | "custom")}>
              {Object.values(CHANNEL_THEME_PRESETS).map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name}</option>
              ))}
              {channelPreset === "custom" && <option value="custom">Custom</option>}
            </select>
          </label>
          <div className="channel-palette" aria-label="Channel color palette">
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
      </header>

      <div className="workspace-viewport">
        <div className="workspace-scaled" style={scaledWorkspaceSize(workspaceZoom)}>
          <div className="workspace-logical" style={{ transform: `scale(${workspaceZoom / 100})` }}>
            <WorkspaceScaleProvider value={workspaceZoom / 100}>
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
