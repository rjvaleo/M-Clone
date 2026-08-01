// The Unified M interface — a single-screen recreation faithful to the classic
// six-window layout, wired to the live engine. Everything here binds to the
// same store the Studio view uses, so no functionality is lost.

import { useEffect, useState } from "react";
import { useM } from "../state/store";
import { getRuntime } from "./runtime";
import { PatternEditor } from "./PatternEditor";
import { VarThumb } from "./VarThumb";
import { TimeDistortEditor } from "./TimeDistortEditor";
import { SnapshotWindow } from "./SnapshotWindow";
import { TransposeEditor } from "./TransposeEditor";
import { useDraggable } from "./useDraggable";
import { NOTE_NAMES, type ScaleName } from "../engine/music";
import type { CyclicVariable, NoteOrderMix, VelocityRange } from "../engine/types";
import {
  noteOrderHandleLayout,
  setNoteOrderBoundary,
} from "../engine/transform";
import {
  POSITION_LABELS,
  type PositionVarId,
  type PositionValue,
} from "../engine/variables";
import type { ArrowState } from "../engine/snapshot";
import { ConductingArrow } from "./ConductingArrow";
import { ConductorWindow } from "./ConductorWindow";
import { useContextMenu, type MenuItem } from "./WindowMenu";
import { CyclicEditor } from "./CyclicEditor";
import { ensureCyclicSelection, type CyclicSelection } from "./cyclicselection";
import { normalizeCyclicStep } from "../engine/cyclic";
import { MidiView } from "./MidiView";
import { SynthWindow } from "./SynthWindow";
import { transportDocumentTitle } from "./documenttitle";
import { APP_WINDOWS, closeAppWindow, openAppWindow, type AppWindowId } from "../engine/windows";
import {
  cycleChordMode,
  cycleInputUse,
  cycleInsertMode,
  cycleSourceChannel,
  TIME_BASE_DENOMINATORS,
  type InputUse,
  type SourceChannel,
} from "../engine/patternwindow";
import {
  IconBuild,
  IconChord,
  IconDrumOff,
  IconDrumOn,
  IconInsert,
  IconOverdub,
  IconReplace,
  IconSingleNote,
  IconSpeaker,
} from "./icons";

const SCALES: ScaleName[] = [
  "chromatic", "major", "minor", "dorian", "mixolydian", "lydian",
  "phrygian", "harmonicMinor", "majorPentatonic", "minorPentatonic", "blues",
];

// The Variables Window's contents and order, per chapter 16 of the manual.
// Names are split over two lines the way the original labels them.
const VAR_ROWS: { id: PositionVarId; name: string; lines: [string, string] }[] = [
  { id: "density", name: "Note Density", lines: ["Note", "Density"] },
  { id: "velocityRange", name: "Vel Range", lines: ["Vel", "Range"] },
  { id: "noteOrderMix", name: "Note Order", lines: ["Note", "Order"] },
  { id: "transposition", name: "Transposition", lines: ["Trans-", "position"] },
  { id: "timeDistort", name: "Time Distortion", lines: ["Time", "Distort"] },
];

const DEFAULT_ARROW: ArrowState = { on: false, dir: "right" };

const CYCLIC: { id: CyclicVariable; name: string }[] = [
  { id: "accent", name: "Accent" },
  { id: "legato", name: "Legato" },
  { id: "rhythm", name: "Rhythm" },
];

function Win({ id, defX, defY, title, note, menuItems, children, className, onClose }: {
  id: string;
  defX: number;
  defY: number;
  title: string;
  note?: string;
  menuItems?: MenuItem[];
  className?: string;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  const { ref, pos, z, onPointerDown, bringToFront } = useDraggable(
    id, { x: defX, y: defY }, { autoPlace: Boolean(onClose) },
  );
  const context = useContextMenu(menuItems ?? []);
  return (
    <section ref={ref} className={"uwin movable " + (className ?? "")}
      style={{ left: pos.x, top: pos.y, zIndex: z }}
      onPointerDownCapture={bringToFront}
      onContextMenu={menuItems?.length ? context.onContextMenu : undefined}>
      {context.menu}
      <div className="uwin__title movable__handle" onPointerDown={onPointerDown}>
        <span className="uwin__name">{title}</span>
        <span className="uwin__slash">/</span>
        {note && <span className="uwin__note">{note}</span>}
        {onClose && <button className="uwin__close" onClick={onClose}
          aria-label={`Close ${title}`}>×</button>}
      </div>
      <div className="uwin__body">{children}</div>
    </section>
  );
}

function VariableWindowHost({ id, index, children }: {
  id: PositionVarId;
  index: number;
  children: (titleDrag: (event: React.PointerEvent) => void) => React.ReactNode;
}) {
  const { ref, pos, z, onPointerDown, bringToFront } = useDraggable(
    `variable-editor-${id}`, { x: 34 + index * 22, y: 72 + index * 20 },
    { autoPlace: true },
  );
  return <div ref={ref} className="movable uvarpop-host" style={{ left: pos.x, top: pos.y, zIndex: z }}
    onPointerDownCapture={bringToFront}>{children(onPointerDown)}</div>;
}

export function Unified({ openVoiceColor }: { openVoiceColor?: (voice: number) => void }) {
  const [cyclicEditor, setCyclicEditor] = useState<CyclicSelection | null>(null);
  const [midiSetupOpen, setMidiSetupOpen] = useState(false);
  const [patternSources, setPatternSources] = useState<SourceChannel[]>(["all", "all", "all", "all"]);
  const [patternUses, setPatternUses] = useState<InputUse[]>(["disabled", "disabled", "disabled", "disabled"]);
  const [patternEcho, setPatternEcho] = useState([false, false, false, false]);
  const [patternMouseAdvance, setPatternMouseAdvance] = useState([false, false, false, false]);
  const [openWindows, setOpenWindows] = useState<Set<string>>(() => new Set([
    ...APP_WINDOWS.filter((window) => window.permanent).map((window) => window.id),
    "pattern-editor", "midi-view", "synth",
  ]));
  const project = useM((s) => s.project);
  const documentName = useM((s) => s.documentName);
  const selectedVoice = useM((s) => s.selectedVoice);
  const positions = useM((s) => s.positions);
  const arrows = useM((s) => s.arrows);
  const setArrow = useM((s) => s.setArrow);
  const group = useM((s) => s.patternGroup);
  const setGroup = useM((s) => s.setPatternGroup);
  const midiConduct = useM((s) => s.midiConduct);

  const selectVoice = useM((s) => s.selectVoice);
  const toggleVoiceEnabled = useM((s) => s.toggleVoiceEnabled);
  const setVoiceParam = useM((s) => s.setVoiceParam);
  const setOutputLength = useM((s) => s.setOutputLength);
  const setPatternMode = useM((s) => s.setPatternMode);
  const setRoot = useM((s) => s.setRoot);
  const setScale = useM((s) => s.setScale);
  const setScaleSnap = useM((s) => s.setScaleSnap);
  const setSeed = useM((s) => s.setSeed);
  const setDiatonic = useM((s) => s.setDiatonicTranspose);
  const setSecondOrder = useM((s) => s.setSecondOrderTranspose);
  const setChordTones = useM((s) => s.setChordTones);
  const activeCyclicPositions = useM((s) => s.activeCyclicPositions);
  const activateCyclicPosition = useM((s) => s.activateCyclicPosition);
  const cyclicPositions = useM((s) => s.cyclicPositions);
  const activatePosition = useM((s) => s.activatePosition);
  const setSlotValue = useM((s) => s.setSlotValue);
  const setMidiConduct = useM((s) => s.setMidiConduct);

  const showWindow = (id: AppWindowId) => {
    if (id === "cyclic-editor") {
      setCyclicEditor((current) => ensureCyclicSelection(
        current, activeCyclicPositions.accent,
      ));
    }
    setOpenWindows((current) => openAppWindow(current, id));
  };
  const hideWindow = (id: AppWindowId) => setOpenWindows((current) => closeAppWindow(current, id));

  useEffect(() => {
    const openRequestedWindow = (event: Event) => {
      const id = (event as CustomEvent<AppWindowId>).detail;
      if (APP_WINDOWS.some((window) => window.id === id)) showWindow(id);
    };
    // "Close Edit Windows merely closes any edit windows you have open." The
    // six permanent windows are not edit windows, and closeAppWindow already
    // refuses to close them.
    const closeEditWindows = () =>
      setOpenWindows((current) =>
        APP_WINDOWS.reduce(
          (open, window) => (window.permanent ? open : closeAppWindow(open, window.id)),
          current,
        ));
    window.addEventListener("mclone:open-window", openRequestedWindow);
    window.addEventListener("mclone:close-edit-windows", closeEditWindows);
    return () => {
      window.removeEventListener("mclone:open-window", openRequestedWindow);
      window.removeEventListener("mclone:close-edit-windows", closeEditWindows);
    };
  });
  const showVariableEditor = (id: PositionVarId) => showWindow(id);
  const canvasMenu = useContextMenu(APP_WINDOWS.flatMap((window, index) => [
    ...(index === 6 ? ["separator" as const] : []),
    {
      label: window.label,
      enabled: !openWindows.has(window.id),
      run: () => showWindow(window.id),
    },
  ]));

  // Which Voice's Time Map the Time Distortion window is editing.
  const [tdVoice, setTdVoice] = useState(0);
  const [midiOuts, setMidiOuts] = useState<MIDIOutput[]>([]);
  const [midiIds, setMidiIds] = useState<string[]>([]);
  const enableMidi = async () => {
    const registry = getRuntime().midiPorts();
    const list = await registry.enable();
    setMidiOuts(list);
    registry.subscribe(setMidiOuts);
  };
  const chooseMidi = (id: string) => {
    const next = id === "" ? [] : midiIds.includes(id)
      ? midiIds.filter((item) => item !== id)
      : [...midiIds, id];
    setMidiIds(next);
    getRuntime().midiPorts().select(next);
  };

  const editSlot = (id: PositionVarId, voice: number, value: PositionValue) =>
    setSlotValue(id, positions[id].active, voice, value);

  const startNoteOrderBoundaryDrag = (
    voice: number,
    boundary: "originalEnd" | "utterlyStart",
    pointerId: number,
    handle: HTMLButtonElement,
  ) => {
    const bar = handle.parentElement!.getBoundingClientRect();
    let latestX = 0;
    let frame: number | null = null;
    const apply = () => {
      frame = null;
      const store = useM.getState();
      const active = store.positions.noteOrderMix.active;
      const mix = store.positions.noteOrderMix.slots[active][voice] as NoteOrderMix;
      const position = ((latestX - bar.left) / bar.width) * 100;
      store.setSlotValue(
        "noteOrderMix",
        active,
        voice,
        setNoteOrderBoundary(mix, boundary, position),
      );
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      latestX = event.clientX;
      if (frame === null) frame = requestAnimationFrame(apply);
    };
    const finish = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      latestX = event.clientX;
      if (frame !== null) cancelAnimationFrame(frame);
      apply();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const setVelocityEnd = (
    voice: number,
    end: "low" | "high",
    rawValue: number,
  ) => {
    const active = useM.getState().positions.velocityRange.active;
    const current = useM.getState().positions.velocityRange
      .slots[active][voice] as VelocityRange;
    const value = Math.max(0, Math.min(127, Math.round(rawValue)));
    const next = end === "low"
      ? { low: Math.min(value, current.high), high: current.high }
      : { low: current.low, high: Math.max(value, current.low) };
    useM.getState().setSlotValue("velocityRange", active, voice, next);
  };

  const setVelocityRange = (voice: number, a: number, b: number) => {
    const active = useM.getState().positions.velocityRange.active;
    const lo = Math.max(0, Math.min(127, Math.round(Math.min(a, b))));
    const hi = Math.max(0, Math.min(127, Math.round(Math.max(a, b))));
    useM.getState().setSlotValue("velocityRange", active, voice, { low: lo, high: hi });
  };

  // Note Density is stored 0..1 but presented as M's percentage, so the two
  // conversions live here rather than being spelled out at each call site.
  const setDensityPercent = (voice: number, percent: number) => {
    const active = useM.getState().positions.density.active;
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    useM.getState().setSlotValue("density", active, voice, clamped / 100);
  };

  // Press anywhere on the line to jump the bar there, then drag. rAF-batched so
  // a fast drag doesn't queue a store write per pointer event.
  const startDensityDrag = (voice: number, pointerId: number, track: HTMLElement) => {
    const rect = track.getBoundingClientRect();
    const toPercent = (clientX: number) => ((clientX - rect.left) / rect.width) * 100;
    let latestX = 0;
    let frame: number | null = null;
    const apply = () => {
      frame = null;
      setDensityPercent(voice, toPercent(latestX));
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      latestX = event.clientX;
      if (frame === null) frame = requestAnimationFrame(apply);
    };
    const finish = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      latestX = event.clientX;
      if (frame !== null) cancelAnimationFrame(frame);
      apply();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  // The gray range block is "drawn" on the line: press at one velocity, drag to
  // the other, release to set. Anchored at the press point; rAF-batched.
  const startVelocityPaint = (
    voice: number,
    pointerId: number,
    track: HTMLElement,
    anchorClientX: number,
  ) => {
    const rect = track.getBoundingClientRect();
    const toVel = (clientX: number) => ((clientX - rect.left) / rect.width) * 127;
    const anchor = toVel(anchorClientX);
    let latestX = anchorClientX;
    let frame: number | null = null;
    const apply = () => {
      frame = null;
      setVelocityRange(voice, anchor, toVel(latestX));
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      latestX = event.clientX;
      if (frame === null) frame = requestAnimationFrame(apply);
    };
    const finish = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      latestX = event.clientX;
      if (frame !== null) cancelAnimationFrame(frame);
      apply();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    setVelocityRange(voice, anchor, anchor);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const conductorOptions: MenuItem[] = [
    {
      label: `${midiConduct ? "✓ " : ""}Midi Conduct`,
      run: () => setMidiConduct(!midiConduct),
    },
    {
      label: `${project.scaleSnap ? "✓ " : ""}Scale Snap`,
      run: () => setScaleSnap(!project.scaleSnap),
    },
    {
      label: `${project.diatonicTranspose ? "✓ " : ""}Diatonic Transpose`,
      run: () => setDiatonic(!project.diatonicTranspose),
    },
    {
      label: `${project.secondOrderTranspose ? "✓ " : ""}Second-Order Transpose`,
      run: () => setSecondOrder(!project.secondOrderTranspose),
    },
    {
      label: `${project.chordTones ? "✓ " : ""}Chord-Tone Targeting`,
      run: () => setChordTones(!project.chordTones),
    },
  ];
  const conductorHarmony: MenuItem[] = [
    {
      label: `Root: ${NOTE_NAMES[project.root]} →`,
      run: () => setRoot((project.root + 1) % NOTE_NAMES.length),
    },
    {
      label: `Scale: ${project.scale} →`,
      run: () => {
        const at = SCALES.indexOf(project.scale);
        setScale(SCALES[(at + 1) % SCALES.length]);
      },
    },
    { label: `Seed: ${project.seed} (+1)`, run: () => setSeed(project.seed + 1) },
    { label: "Reset Seed to 1", run: () => setSeed(1) },
  ];
  const conductorMidi: MenuItem[] = midiOuts.length === 0
    ? [{ label: "Enable Web MIDI…", run: () => void enableMidi() }]
    : [
        { label: `${midiIds.length === 0 ? "✓ " : ""}No MIDI Output`, run: () => chooseMidi("") },
        "separator",
        ...midiOuts.map((output) => ({
          label: `${midiIds.includes(output.id) ? "✓ " : ""}${output.name ?? output.id}`,
          run: () => chooseMidi(output.id),
        })),
      ];
  const variablesMenu: MenuItem[] = [
    ...VAR_ROWS.map(({ id, name }) => ({
      label: `Edit ${name}…`,
      run: () => showVariableEditor(id),
    })),
    { label: "Edit Orchestration…", run: () => showVariableEditor("outputChannels") },
    "separator",
    ...Array.from({ length: 4 }, (_, voice) => ({
      label: `Voice ${voice + 1} Color…`,
      run: () => openVoiceColor?.(voice),
      enabled: Boolean(openVoiceColor),
    })),
  ];
  const patternGroupMenu: MenuItem[] = POSITION_LABELS.map((label, i) => ({
    label: `Pattern Group ${label}`, run: () => setGroup(i),
  }));
  const conductingMenu: MenuItem[] = [
    ...conductorOptions, "separator", ...conductorHarmony, "separator", ...conductorMidi,
  ];
  const midiMenu: MenuItem[] = [{
    label: midiSetupOpen ? "Hide Setup" : "Setup",
    run: () => setMidiSetupOpen((open) => !open),
  }];

  return (
    <div className="uroot">
      <div
        className="ustage"
        onContextMenu={(event) => {
          if ((event.target as HTMLElement).closest(".movable")) return;
          canvasMenu.onContextMenu(event);
        }}
      >
        {canvasMenu.menu}
        {/* Row 1 */}
        <div className="urow">
          <Win id="patterns" defX={4} defY={4} title="Patterns" className="u-patterns"
            menuItems={patternGroupMenu}>
            <div className="pwin__channel-head" aria-label="M Input Channels 1 through 16">
              <span className="pwin__input-icon" aria-hidden="true">⌁</span>
              <span>{Array.from({ length: 8 }, (_, i) => <i key={i}>{i + 1}</i>)}</span>
              <span>{Array.from({ length: 8 }, (_, i) => <i key={i}>{i + 9}</i>)}</span>
            </div>
            <div className="pwin__labels" aria-hidden="true">
              <b>Src</b><b>Use</b><b className="pwin__speaker-head"><IconSpeaker size={12} /></b>
              <b className="pwin__echo-head"><i>↔</i><span><i /><i /><i /><i /></span></b>
              <b className="pwin__mouse-head"><i /><span /></b>
              <b>Select</b><b>▔▁</b><b>◯</b><b>〰</b>
            </div>
            <div className="pwin__rows">
              {project.voices.map((voice, i) => {
                const pattern = project.patterns[voice.patternIndex];
                const chordIcon = pattern.chordMode === "single" ? <IconSingleNote size={11} />
                  : pattern.chordMode === "chord" ? <IconChord size={11} /> : <IconBuild size={11} />;
                const insertIcon = pattern.insertMode === "insert" ? <IconInsert size={11} />
                  : pattern.insertMode === "replace" ? <IconReplace size={11} /> : <IconOverdub size={11} />;
                return <div key={i} className={`pwin__row uvoice uvoice--${i + 1}${i === selectedVoice ? " is-selected" : ""}`}>
                  <button className="pwin__src" onClick={() => setPatternSources((values) =>
                    values.map((value, at) => at === i ? cycleSourceChannel(value) : value))}
                    aria-label={`Voice ${i + 1} Source Channel: ${patternSources[i] === "all" ? "All" : patternSources[i]}`}>
                    {patternSources[i] === "all" ? "All" : patternSources[i]}
                  </button>
                  <button className="pwin__use" onClick={() => setPatternUses((values) =>
                    values.map((value, at) => at === i ? cycleInputUse(value) : value))}
                    aria-label={`Voice ${i + 1} Use: ${patternUses[i]}`}>
                    {patternUses[i] === "record" ? "R" : "-"}
                  </button>
                  <button className="pwin__play" onClick={() => toggleVoiceEnabled(i)}
                    aria-pressed={voice.playEnabled} aria-label={`Play Voice ${i + 1}`}>
                    {voice.playEnabled && <IconSpeaker size={12} />}
                  </button>
                  <button className="pwin__echo" onClick={() => setPatternEcho((values) =>
                    values.map((value, at) => at === i ? !value : value))}
                    aria-pressed={patternEcho[i]} aria-label={`Echo-Thru-Orchestration Voice ${i + 1}`}>
                    {patternEcho[i] ? "✓" : ""}
                  </button>
                  <button className="pwin__mouse" onClick={() => setPatternMouseAdvance((values) =>
                    values.map((value, at) => at === i ? !value : value))}
                    aria-pressed={patternMouseAdvance[i]} aria-label={`Mouse Advance Voice ${i + 1}`}>
                    {patternMouseAdvance[i] ? "✓" : ""}
                  </button>
                  <div className="pwin__select" onClick={() => selectVoice(i)}
                    onDoubleClick={() => { selectVoice(i); showWindow("pattern-editor"); }}>
                    <button aria-label={`Voice ${i + 1} Chord Mode: ${pattern.chordMode}`}
                      title="Option-click to change Chord Mode"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (event.altKey) setPatternMode(voice.patternIndex, "chordMode", cycleChordMode(pattern.chordMode));
                        else selectVoice(i);
                      }}>
                      {chordIcon}
                    </button>
                    <button aria-label={`Voice ${i + 1} Insertion Mode: ${pattern.insertMode}`}
                      title="Option-click to change Insertion Mode"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (event.altKey) setPatternMode(voice.patternIndex, "insertMode", cycleInsertMode(pattern.insertMode));
                        else selectVoice(i);
                      }}>
                      {insertIcon}
                    </button>
                    <button aria-label={`Voice ${i + 1} Drum Machine: ${pattern.drumMachine ? "Enabled" : "Disabled"}`}
                      title="Option-click to toggle Drum Machine Record"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (event.altKey) setPatternMode(voice.patternIndex, "drumMachine", !pattern.drumMachine);
                        else selectVoice(i);
                      }}>
                      {pattern.drumMachine ? <IconDrumOn size={11} /> : <IconDrumOff size={11} />}
                    </button>
                  </div>
                  <input className="pwin__length" type="number" min={0} max={pattern.steps.length}
                    value={pattern.outputLength} aria-label={`Voice ${i + 1} Output Length`}
                    onChange={(event) => setOutputLength(voice.patternIndex, Number(event.target.value))} />
                  <span className="pwin__base">
                    <input type="number" min={1} max={24} value={voice.timeBaseNumerator}
                      aria-label={`Voice ${i + 1} Time Base Numerator`}
                      onChange={(event) => setVoiceParam(i, "timeBaseNumerator", Number(event.target.value))} />
                    <i>|</i>
                    <select value={voice.timeBaseDenominator} aria-label={`Voice ${i + 1} Time Base Denominator`}
                      onChange={(event) => setVoiceParam(i, "timeBaseDenominator", Number(event.target.value))}>
                      {TIME_BASE_DENOMINATORS.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </span>
                  <input className="pwin__phase" type="number" min={0} max={999}
                    value={voice.phase} aria-label={`Voice ${i + 1} Phase`}
                    onChange={(event) => setVoiceParam(i, "phase", Number(event.target.value))} />
                </div>;
              })}
            </div>
          </Win>

          <Win id="untitled" defX={232} defY={4} title={transportDocumentTitle(documentName)}
            className="u-conductor-win"
            menuItems={conductingMenu}>
            <ConductorWindow />
          </Win>

          <Win id="snapshot" defX={468} defY={4} title="Snapshot" className="u-flexsnap">
            <SnapshotWindow />
          </Win>
        </div>

        {/* Row 2 */}
        <div className="urow">
          <Win id="variables" defX={4} defY={120}
            title="Variables" note="click name to edit · click cell to activate"
            menuItems={variablesMenu}
            className="u-variables">
            {/* Pattern Group leads the window, then the five transform
                Variables. Click a Position to make it active; double-click to
                open its edit window. */}
            <div className="uvars">
              <div className="uvars__row">
                <div className="uvars__label"><span>Pattern</span><span>Group</span></div>
                <ConductingArrow label="Pattern Group"
                  state={arrows.patternGroup ?? DEFAULT_ARROW}
                  onChange={(next) => setArrow("patternGroup", next)} />
                <div className="uvars__cells">
                  {POSITION_LABELS.map((label, p) => (
                    <button key={label} type="button"
                      className={"umini umini--group" + (group === p ? " umini--on" : "")}
                      aria-pressed={group === p}
                      aria-label={`Pattern Group ${label}`}
                      onClick={() => setGroup(p)}>
                      <span className="umini__letter">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {VAR_ROWS.map(({ id, name, lines }) => (
                <div className="uvars__row" key={id}>
                  <div className="uvars__label">
                    <span>{lines[0]}</span><span>{lines[1]}</span>
                  </div>
                  <ConductingArrow label={name}
                    state={arrows[id] ?? DEFAULT_ARROW}
                    onChange={(next) => setArrow(id, next)} />
                  <div className="uvars__cells">
                    {positions[id].slots.map((slot, p) => (
                      <button key={p} type="button"
                        className={"umini" + (positions[id].active === p ? " umini--on" : "")}
                        aria-pressed={positions[id].active === p}
                        aria-label={`${name} position ${POSITION_LABELS[p]}`}
                        title={`${name} ${POSITION_LABELS[p]} — double-click to edit`}
                        onClick={() => activatePosition(id, p)}
                        onDoubleClick={() => showVariableEditor(id)}>
                        <VarThumb id={id} slot={slot} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Win>

          <Win id="cyclic" defX={232} defY={120}
            title="Cyclic Variables" note="five levels" className="u-cyclic-vars">
            <div className="ucyclics">
              {CYCLIC.map(({ id, name }) => (
                <div key={id} className="ucyc">
                  <div className="ucyc__head">
                    <div className="b ucyc__name">{name}</div>
                    <ConductingArrow label={name}
                      state={arrows[id] ?? DEFAULT_ARROW}
                      onChange={(next) => setArrow(id, next)} />
                  </div>
                  {POSITION_LABELS.map((label, position) => (
                    <button key={label} className={"ucycpos" + (activeCyclicPositions[id] === position ? " is-on" : "")}
                      aria-pressed={activeCyclicPositions[id] === position}
                      aria-label={`${name} position ${label}`}
                      onClick={() => activateCyclicPosition(id, position)}
                      onDoubleClick={() => {
                        setCyclicEditor({ kind: id, position });
                        showWindow("cyclic-editor");
                      }}
                      title={`${name} ${label} — double-click to edit`}>
                      <b>{label}</b>
                      {cyclicPositions[id][position].map((voice, vi) => (
                        <i key={vi} className={`uvoice uvoice--${vi + 1}`}
                          style={{ width: `${Math.max(2, (voice.reduce<number>(
                            (sum, step) => sum + normalizeCyclicStep(step).max, 0,
                          ) / 64) * 28)}px` }} />
                      ))}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </Win>
        </div>

        {/* Row 3 — Midi */}
        <Win id="midi" defX={4} defY={280} title="Midi" note="output"
          className={midiSetupOpen ? "u-midi u-midi--open" : "u-midi"}
          menuItems={midiMenu}>
          {/* Orchestration lives here rather than in the Variables Window —
              chapter 16 lists the Variables Window's six rows, and routing
              belongs with the other MIDI output controls. */}
          <div className="uvars uvars--inline">
            <div className="uvars__row">
              <div className="uvars__label"><span>Orch-</span><span>estration</span></div>
              <ConductingArrow label="Orchestration"
                state={arrows.outputChannels ?? DEFAULT_ARROW}
                onChange={(next) => setArrow("outputChannels", next)} />
              <div className="uvars__cells">
                {positions.outputChannels.slots.map((slot, p) => (
                  <button key={p} type="button"
                    className={"umini"
                      + (positions.outputChannels.active === p ? " umini--on" : "")}
                    aria-pressed={positions.outputChannels.active === p}
                    aria-label={`Orchestration position ${POSITION_LABELS[p]}`}
                    title={`Orchestration ${POSITION_LABELS[p]} — double-click to edit`}
                    onClick={() => activatePosition("outputChannels", p)}
                    onDoubleClick={() => showVariableEditor("outputChannels")}>
                    <VarThumb id="outputChannels" slot={slot} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {midiSetupOpen && <table className="utable umidi">
            <thead>
              <tr>
                <th>V</th><th>Channel</th><th>Program</th><th>Transpose</th>
                <th>Velocity</th><th>Density</th><th>Legato</th>
              </tr>
            </thead>
            <tbody>
              {project.voices.map((v, i) => (
                <tr key={i} className={`uvoice uvoice--${i + 1}`}>
                  <td className="b">{i + 1}</td>
                  <td><input type="number" min={1} max={16} value={v.channel} className="unum"
                    title="Sets a single-channel Orchestration assignment"
                    onChange={(e) => {
                      const channel = Number(e.target.value);
                      setVoiceParam(i, "channel", channel);
                      setVoiceParam(i, "outputChannels", [channel]);
                    }} /></td>
                  <td><input type="number" min={0} max={127} value={v.program} className="unum"
                    onChange={(e) => setVoiceParam(i, "program", Number(e.target.value))} /></td>
                  <td><input type="number" min={-24} max={24} value={v.transposition} className="unum"
                    onChange={(e) => setVoiceParam(i, "transposition", Number(e.target.value))} /></td>
                  <td className="umidi__velocity">
                    {v.velocityRange.low}–{v.velocityRange.high}
                  </td>
                  <td><input type="range" min={0} max={1} step={0.05} value={v.density}
                    onChange={(e) => setVoiceParam(i, "density", Number(e.target.value))} /></td>
                  <td><input type="range" min={0.1} max={1.5} step={0.05} value={v.legato}
                    onChange={(e) => setVoiceParam(i, "legato", Number(e.target.value))} /></td>
                </tr>
              ))}
            </tbody>
          </table>}
        </Win>

        {openWindows.has("midi-view") && <Win id="midi-view" defX={80} defY={180} title="Midi View"
          note="generated output tracker" className="u-midiview-win"
          onClose={() => hideWindow("midi-view")}><MidiView /></Win>}

        {openWindows.has("synth") && <Win id="synth" defX={90} defY={200} title="Synth"
          note="built-in subtractive instrument" className="u-synth-win"
          onClose={() => hideWindow("synth")}><SynthWindow /></Win>}

        {/* Pattern Editor — M-style editor window with a resizable grid */}
        {openWindows.has("pattern-editor") &&
          <PatternEditor onClose={() => hideWindow("pattern-editor")} />}
      </div>
      {openWindows.has("cyclic-editor") && cyclicEditor &&
        <CyclicEditor kind={cyclicEditor.kind} position={cyclicEditor.position}
          onSelect={(kind, position) => setCyclicEditor({ kind, position })}
          onClose={() => hideWindow("cyclic-editor")} />
      }

      {(["density", "velocityRange", "noteOrderMix", "transposition", "timeDistort", "outputChannels"] as PositionVarId[])
        .filter((id) => openWindows.has(id)).map((editingVar, editorIndex) => (
        <VariableWindowHost id={editingVar} index={editorIndex} key={editingVar}>{(titleDrag) => (
          <section
            className={"uvarpop" + (editingVar === "timeDistort" || editingVar === "transposition"
              ? " uvarpop--tight" : "")}
            role="region" aria-label={`${VAR_ROWS.find((r) => r.id === editingVar)?.name ?? "Orchestration"} Editor`}>
            <div className="uwin__title movable__handle" onPointerDown={titleDrag}>
              <span className="uwin__name">
                {VAR_ROWS.find((r) => r.id === editingVar)?.name ?? "Orchestration"}
              </span>
              <span className="uwin__slash">/</span>
              <span className="uwin__note">Editor</span>
              <div className="uposbox" role="group" aria-label="Variable position">
                {POSITION_LABELS.map((label, position) => (
                  <button key={label}
                    className={"uposcell" + (positions[editingVar].active === position ? " uposcell--on" : "")}
                    onClick={() => activatePosition(editingVar, position)}
                    aria-pressed={positions[editingVar].active === position}
                    aria-label={`Position ${label}`}
                    title={`Position ${label}`} />
                ))}
              </div>
              <button className="uvarpop__close" onClick={() => hideWindow(editingVar)} aria-label="Close variable editor">
                ×
              </button>
            </div>

            <div className="uvarpop__scaled-body">

            {editingVar === "density" && (
              <div className="udens__head" aria-hidden="true">
                <span className="udens__voice" />
                <span className="udens__pct">%</span>
                <span className="udens__scale">
                  {[0, 25, 50, 75, 100].map((tick) => (
                    <span key={tick} className="udens__tick" style={{ left: `${tick}%` }}>
                      {tick}
                    </span>
                  ))}
                </span>
              </div>
            )}

            {/* The one edit window that isn't four sets of controls: a single
                graph carrying all four Voices' maps. */}
            {editingVar === "timeDistort" && (
              <TimeDistortEditor editVoice={tdVoice} onEditVoice={setTdVoice} />
            )}
            {editingVar === "transposition" && (
              <TransposeEditor
                slot={
                  positions.transposition.slots[
                    positions.transposition.active
                  ] as number[]
                }
                onChange={(voice, semitones) =>
                  editSlot("transposition", voice, semitones)}
              />
            )}

            {editingVar === "outputChannels" && (
              <div className="uorch__head" aria-hidden="true">
                <span>MIDI Channel</span>
                <b>{Array.from({ length: 16 }, (_, channel) =>
                  <i key={channel}>{channel + 1}</i>)}</b>
              </div>
            )}

            <div className="uvarpop__voices">
              {editingVar !== "timeDistort" && editingVar !== "transposition" &&
                positions[editingVar].slots[positions[editingVar].active].map((val, voice) => (
                <label
                  className={"uvarcontrol"
                    + (editingVar === "velocityRange" ? " uvarcontrol--vel" : "")
                    + (editingVar === "density" ? " uvarcontrol--dens" : "")
                    + ` uvoice uvoice--${voice + 1}`}
                  key={voice}>
                  <span className="uvarcontrol__voice">
                    {editingVar === "outputChannels" || editingVar === "noteOrderMix"
                      ? voice + 1 : `Voice ${voice + 1}`}
                  </span>
                  {editingVar === "noteOrderMix" && (
                    <div className="unoteorder">
                      <div className="unoteorder__bar">
                        <span className="unoteorder__original"
                          style={{ width: `${(val as NoteOrderMix).original}%` }} />
                        <span className="unoteorder__cyclic"
                          style={{ width: `${(val as NoteOrderMix).cyclic}%` }} />
                        <span className="unoteorder__utterly"
                          style={{ width: `${(val as NoteOrderMix).utterly}%` }} />
                        <button type="button"
                          className="unoteorder__handle unoteorder__handle--original"
                          style={{ left: `clamp(24px, ${noteOrderHandleLayout(val as NoteOrderMix).originalEnd}%, calc(100% - 24px))` }}
                          role="slider" aria-valuemin={0} aria-valuemax={100}
                          aria-valuenow={(val as NoteOrderMix).original}
                          aria-label={`Voice ${voice + 1} Original/Cyclic boundary`}
                          onPointerDown={(e) => {
                            e.preventDefault();
                            startNoteOrderBoundaryDrag(
                              voice, "originalEnd", e.pointerId, e.currentTarget,
                            );
                          }}>
                          {(val as NoteOrderMix).original}
                        </button>
                        <button type="button"
                          className="unoteorder__handle unoteorder__handle--utterly"
                          style={{ left: `clamp(24px, ${noteOrderHandleLayout(val as NoteOrderMix).utterlyStart}%, calc(100% - 24px))` }}
                          role="slider" aria-valuemin={0} aria-valuemax={100}
                          aria-valuenow={100 - (val as NoteOrderMix).utterly}
                          aria-label={`Voice ${voice + 1} Cyclic/Utterly boundary`}
                          onPointerDown={(e) => {
                            e.preventDefault();
                            startNoteOrderBoundaryDrag(
                              voice, "utterlyStart", e.pointerId, e.currentTarget,
                            );
                          }}>
                          {(val as NoteOrderMix).cyclic}
                        </button>
                      </div>
                      <div className="unoteorder__values">
                        <output>{(val as NoteOrderMix).original}</output>
                        <output>{(val as NoteOrderMix).cyclic}</output>
                        <output>{(val as NoteOrderMix).utterly}</output>
                      </div>
                    </div>
                  )}
                  {editingVar === "density" && (() => {
                    const percent = Math.round(Number(val) * 100);
                    return (
                      <div className="udens">
                        <span className="udens__voice">{voice + 1}</span>
                        <input className="udens__num" type="number" min={0} max={100}
                          value={percent}
                          aria-label={`Voice ${voice + 1} note density percent`}
                          onChange={(e) => setDensityPercent(voice, Number(e.target.value))} />
                        <div className="udens__track"
                          title="Click or drag on the line to set the density"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            setDensityPercent(
                              voice,
                              ((e.clientX - e.currentTarget.getBoundingClientRect().left) /
                                e.currentTarget.getBoundingClientRect().width) * 100,
                            );
                            startDensityDrag(voice, e.pointerId, e.currentTarget);
                          }}>
                          {/* The bar runs from 0 to the value and ends in the handle. */}
                          <span className="udens__bar" style={{ width: `${percent}%` }} />
                          <button type="button" className="udens__handle"
                            style={{ left: `${percent}%` }}
                            role="slider" aria-valuemin={0} aria-valuemax={100}
                            aria-valuenow={percent}
                            aria-label={`Voice ${voice + 1} note density`}
                            onPointerDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              startDensityDrag(
                                voice, e.pointerId,
                                e.currentTarget.parentElement as HTMLElement,
                              );
                            }} />
                        </div>
                      </div>
                    );
                  })()}
                  {editingVar === "velocityRange" && (
                    <div className="uvel">
                      <span className="uvel__num">{voice + 1}</span>
                      <input className="uvel__box" type="number" min={0} max={127}
                        value={(val as VelocityRange).low}
                        aria-label={`Voice ${voice + 1} low velocity`}
                        onChange={(e) => setVelocityEnd(voice, "low", Number(e.target.value))} />
                      <div className="uvel__track"
                        title="Click and drag to draw the velocity range"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          startVelocityPaint(voice, e.pointerId, e.currentTarget, e.clientX);
                        }}>
                        <span className="uvel__band" style={{
                          left: `${((val as VelocityRange).low / 127) * 100}%`,
                          width: `${(((val as VelocityRange).high - (val as VelocityRange).low) / 127) * 100}%`,
                        }} />
                      </div>
                      <input className="uvel__box" type="number" min={0} max={127}
                        value={(val as VelocityRange).high}
                        aria-label={`Voice ${voice + 1} high velocity`}
                        onChange={(e) => setVelocityEnd(voice, "high", Number(e.target.value))} />
                    </div>
                  )}
                  {editingVar === "outputChannels" && (
                    <div className="uorch" role="group"
                      aria-label={`Voice ${voice + 1} output channels`}>
                      {Array.from({ length: 16 }, (_, channelIndex) => {
                        const channel = channelIndex + 1;
                        const channels = val as number[];
                        const assigned = channels.includes(channel);
                        return (
                          <button type="button" key={channel}
                            className={"uorch__channel" + (assigned ? " uorch__channel--on" : "")}
                            aria-pressed={assigned}
                            aria-label={`Voice ${voice + 1} output channel ${channel}`}
                            onClick={() => editSlot(
                              "outputChannels",
                              voice,
                              assigned
                                ? channels.filter((item) => item !== channel)
                                : [...channels, channel].sort((a, b) => a - b),
                            )}>
                            {channel}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </label>
              ))}
            </div>
            {editingVar === "noteOrderMix" && (
              <div className="unoteorder__legend">
                <span><i className="unoteorder__swatch unoteorder__original" />Original Order</span>
                <span><i className="unoteorder__swatch unoteorder__cyclic" />Cyclic Random</span>
                <span><i className="unoteorder__swatch unoteorder__utterly" />Utterly Random</span>
              </div>
            )}
            <p className="uvarpop__hint">
              Changes apply immediately to the active position and are heard during playback.
            </p>
            </div>
          </section>
        )}</VariableWindowHost>
      ))}
    </div>
  );
}
