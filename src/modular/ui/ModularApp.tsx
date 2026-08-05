import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { noteOrderHandleLayout, setNoteOrderBoundary } from "../../engine/transform";
import { createModularDocument, decodeModularDocument } from "../document/document";
import { decodeModularPack, encodeModularPack, isModularPack } from "../document/pack";
import { PlanPublisher } from "../compiler/compileGraph";
import { isPlayerModule } from "../audio/players";
import { connectionError } from "../model/connections";
import { executeGraphCommand, type GraphCommand } from "../model/commands";
import { expandStreamNode } from "../model/stream";
import { CANVAS_SIZE, canvasExtent, centeringOffset, clampZoom, scrollToCenter, stageSize, clampFramePixels, easeZoom, wheelDeltaPixels, zoomByWheel, zoomScrollPosition } from "./viewport";
import { isDragSurface, menuPlacement, placeNode, visibleRegion } from "./nodePlacement";
import { moduleMenuGroups } from "./moduleMenu";
import { parameterControlKind, selectorVariant } from "./parameterControl";
import { isLiveStatus, statusLevel } from "./nodeStatus";
import { preferredEngine, type RackEngineChoice } from "../audio/wasm/rackNode";
import { KitContext } from "../theme/kits/KitContext";
import { KIT_IDS, KIT_META, type KitId } from "../theme/kits/types";
import { Knob } from "../theme/kits/controls/Knob";
import { Slider } from "../theme/kits/controls/Slider";
import { Fader } from "../theme/kits/controls/Fader";
import { Toggle } from "../theme/kits/controls/Toggle";
import { Button } from "../theme/kits/controls/Button";
import { Selector } from "../theme/kits/controls/Selector";
import { Stepper } from "../theme/kits/controls/Stepper";
import { Jack } from "../theme/kits/controls/Jack";
import { Led } from "../theme/kits/controls/Led";
import { Meter } from "../theme/kits/controls/Meter";
import { Display } from "../theme/kits/controls/Display";
import {
  centreOn, EMPTY_VIEW, openingScrollTop, ROLL_PITCH_COUNT, viewWindow, type RollView,
} from "./noteRoll";
import {
  anchorInCanvas,
  cablePath,
  canInteractAtZoom,
  draggingCablePath,
  fallbackAnchor,
  pointerInCanvas,
  portAnchorKey,
  type Point,
} from "./portGeometry";
import { AudioEngine, type EngineContext } from "../audio/audioEngine";
import type { AssetEntry } from "../audio/assets";
import { SoundPool } from "./SoundPool";
import { AssetSlot, PercussionSlots, SoundPoolContext } from "./PercussionSlots";
import { PRESET_SLOTS, PresetPad } from "./PresetPad";
import { TimerSchedulerDriver } from "../runtime/clock";
import { ModularRuntime } from "../runtime/engine";
import type { MorphPolicy } from "../runtime/parameters";
import { PresentationClock } from "../runtime/skew";
import type {
  GraphDocument,
  JsonValue,
  NodeFaceElement,
  NodeFaceSection,
  NodeInstance,
  ParameterDescriptor,
  PortRef,
} from "../model/graph";
import { createNode, moduleRegistry } from "../registry/registry";
import { applyTheme, DEFAULT_THEME_ID, themeMeta, type ThemeId } from "../theme/themes";
import { ThemePicker } from "./ThemePicker";
import { CyclicGrid } from "./CyclicGrid";
import { executeRuntimeCommand, queueRuntimeParameter } from "./runtimebridge";
import {
  BrowserMidiSession,
  type MidiAccessLike,
  type MidiDeviceOption,
} from "./midisession";

/**
 * A module family's identity colour comes from the theme, not from here.
 *
 * The node points `--mm-accent` at its family's identity token and the active
 * theme decides what that token holds, so switching themes re-tints every node
 * without a re-render. `--mm-module-density` is the fallback for a family the
 * theme does not define.
 */
/**
 * Modules whose "voices" status is a live count from the audio engine.
 *
 * Asked of the audio layer rather than listed here: a second copy of the list
 * is a second thing to forget, and forgetting it shows up as an instrument
 * that plays perfectly and reports "Idle" for ever.
 */
const hasVoiceCount = (moduleType: string): boolean => isPlayerModule(moduleType);

/**
 * What a full voice meter means.
 *
 * The voice pool's own ceiling, not a per-module polyphony setting — the
 * meter answers "how close is this to using everything available", which is
 * the question worth a meter rather than a number.
 */
const VOICE_METER_CEILING = 16;

const accentVar = (colorToken: string): string =>
  `var(--mm-module-${colorToken}, var(--mm-module-density))`;

/** Marks the port a dragged cable would land on if released now. */
const portTarget = (nodeId: string, portId: string, target: PortRef | null): string =>
  target && target.nodeId === nodeId && target.portId === portId ? " is-drop-target" : "";

/**
 * Whether two measurements agree.
 *
 * Measuring runs on every animation frame of a node drag, and handing React a
 * new object each time would re-render every cable for no visible change. Half
 * a pixel is below what any cable can show.
 */
function sameAnchors(a: Record<string, Point>, b: Record<string, Point>): boolean {
  const keys = Object.keys(b);
  if (Object.keys(a).length !== keys.length) return false;
  for (const key of keys) {
    const previous = a[key];
    if (!previous) return false;
    if (Math.abs(previous.x - b[key].x) > 0.5 || Math.abs(previous.y - b[key].y) > 0.5) return false;
  }
  return true;
}

const FACE_SIZES = {
  compact: { width: 520, height: 330 },
  editor: { width: 900, height: 650 },
  utility: { width: 360, height: 390 },
} as const;

// `height` above is an *estimate*, used only for placing a new module and for
// working out how much canvas the patch occupies. Modules render to their
// content, so the real height is whatever the face comes to.

const nodeSize = (moduleType: string) =>
  FACE_SIZES[moduleRegistry.get(moduleType)?.layout ?? "utility"];

const STORAGE_KEYS = {
  theme: "m.modular.theme",
  zoom: "m.modular.zoom",
  handMode: "m.modular.hand-mode",
  panLeft: "m.modular.pan-left",
  panTop: "m.modular.pan-top",
} as const;

const readStoredBoolean = (key: string, fallback: boolean): boolean => {
  if (typeof window === "undefined") return fallback;
  const value = window.localStorage.getItem(key);
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
};

/**
 * The stored theme, validated against the roster.
 *
 * A theme id can disappear between sessions — a custom palette deleted, a
 * shipped palette renamed — and an unknown id must fall back rather than leave
 * the app with no tokens at all.
 */
const readStoredTheme = (): ThemeId => {
  if (typeof window === "undefined") return DEFAULT_THEME_ID;
  const stored = window.localStorage.getItem(STORAGE_KEYS.theme);
  if (!stored) return DEFAULT_THEME_ID;
  return themeMeta(stored).id === stored ? stored : DEFAULT_THEME_ID;
};

const readStoredNumber = (key: string, fallback: number): number => {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

/**
 * Put a patch in the middle of the canvas.
 *
 * Templates are authored from the origin because that is the readable way to
 * write them; nobody wants to read coordinates with a four-thousand-pixel
 * offset baked into every one. Centring is applied once, here, on the way out.
 */
const centred = (graph: GraphDocument): GraphDocument => {
  const { dx, dy } = centeringOffset(
    Object.values(graph.nodes).map((node) => ({
      x: node.position.x,
      y: node.position.y,
      ...nodeSize(node.moduleType),
    })),
    CANVAS_SIZE,
  );
  for (const node of Object.values(graph.nodes)) {
    node.position = { x: node.position.x + dx, y: node.position.y + dy };
  }
  return graph;
};

const starterGraph = (): GraphDocument => centred(buildStarterGraph());

const buildStarterGraph = (): GraphDocument => {
  const nodes = [
    createNode("m.transport-clock", "transport-1", { x: 70, y: 400 }),
    createNode("m.time-base", "time-base-1", { x: 420, y: 380 }),
    createNode("m.phase", "phase-1", { x: 980, y: 380 }),
    createNode("m.cyclic-rhythm", "cyclic-rhythm-1", { x: 1540, y: 370 }),
    createNode("m.cyclic-accent", "cyclic-accent-1", { x: 1540, y: 50 }),
    createNode("m.cyclic-legato", "cyclic-legato-1", { x: 1540, y: 720 }),
    createNode("m.note-editor", "notes-1", { x: 2080, y: 780 }),
    createNode("m.note-order", "note-order-1", { x: 2640, y: 380 }),
    createNode("m.step-to-notes", "step-notes-1", { x: 3200, y: 420 }),
    createNode("m.note-density", "density-1", { x: 3600, y: 420 }),
    createNode("m.transposition", "transposition-1", { x: 4160, y: 420 }),
    createNode("m.velocity-range", "velocity-range-1", { x: 4720, y: 420 }),
    createNode("m.legato-processor", "legato-processor-1", { x: 5280, y: 420 }),
    createNode("m.play-enable", "play-enable-1", { x: 5840, y: 420 }),
    createNode("m.midi-output", "midi-out-1", { x: 6420, y: 430 }),
  ];
  return {
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    edges: {
      "transport-time-base": {
        id: "transport-time-base",
        from: { nodeId: "transport-1", portId: "transport-out" },
        to: { nodeId: "time-base-1", portId: "transport-in" },
        enabled: true,
      },
      "reset-time-base": {
        id: "reset-time-base",
        from: { nodeId: "transport-1", portId: "reset-out" },
        to: { nodeId: "time-base-1", portId: "reset-in" },
        enabled: true,
      },
      "reset-phase": {
        id: "reset-phase",
        from: { nodeId: "transport-1", portId: "reset-out" },
        to: { nodeId: "phase-1", portId: "reset-in" },
        enabled: true,
      },
      "reset-cyclic-rhythm": {
        id: "reset-cyclic-rhythm",
        from: { nodeId: "transport-1", portId: "reset-out" },
        to: { nodeId: "cyclic-rhythm-1", portId: "reset-in" },
        enabled: true,
      },
      "reset-note-order": {
        id: "reset-note-order",
        from: { nodeId: "transport-1", portId: "reset-out" },
        to: { nodeId: "note-order-1", portId: "reset-in" },
        enabled: true,
      },
      "time-base-phase": {
        id: "time-base-phase",
        from: { nodeId: "time-base-1", portId: "clock-out" },
        to: { nodeId: "phase-1", portId: "clock-in" },
        enabled: true,
      },
      "phase-cyclic-rhythm": {
        id: "phase-cyclic-rhythm",
        from: { nodeId: "phase-1", portId: "clock-out" },
        to: { nodeId: "cyclic-rhythm-1", portId: "clock-in" },
        enabled: true,
      },
      "rhythm-note-order": {
        id: "rhythm-note-order",
        from: { nodeId: "cyclic-rhythm-1", portId: "clock-out" },
        to: { nodeId: "note-order-1", portId: "clock-in" },
        enabled: true,
      },
      "rhythm-accent": {
        id: "rhythm-accent",
        from: { nodeId: "cyclic-rhythm-1", portId: "clock-out" },
        to: { nodeId: "cyclic-accent-1", portId: "clock-in" },
        enabled: true,
      },
      "rhythm-legato": {
        id: "rhythm-legato",
        from: { nodeId: "cyclic-rhythm-1", portId: "clock-out" },
        to: { nodeId: "cyclic-legato-1", portId: "clock-in" },
        enabled: true,
      },
      "pattern-order": {
        id: "pattern-order",
        from: { nodeId: "notes-1", portId: "pattern-out" },
        to: { nodeId: "note-order-1", portId: "pattern-in" },
        enabled: true,
      },
      "steps-notes": {
        id: "steps-notes",
        from: { nodeId: "note-order-1", portId: "steps-out" },
        to: { nodeId: "step-notes-1", portId: "steps-in" },
        enabled: true,
      },
      "notes-density": {
        id: "notes-density",
        from: { nodeId: "step-notes-1", portId: "notes-out" },
        to: { nodeId: "density-1", portId: "notes-in" },
        enabled: true,
      },
      "density-transposition": {
        id: "density-transposition",
        from: { nodeId: "density-1", portId: "notes-out" },
        to: { nodeId: "transposition-1", portId: "notes-in" },
        enabled: true,
      },
      "transposition-velocity": {
        id: "transposition-velocity",
        from: { nodeId: "transposition-1", portId: "notes-out" },
        to: { nodeId: "velocity-range-1", portId: "notes-in" },
        enabled: true,
      },
      "velocity-legato": {
        id: "velocity-legato",
        from: { nodeId: "velocity-range-1", portId: "notes-out" },
        to: { nodeId: "legato-processor-1", portId: "notes-in" },
        enabled: true,
      },
      "legato-play-enable": {
        id: "legato-play-enable",
        from: { nodeId: "legato-processor-1", portId: "notes-out" },
        to: { nodeId: "play-enable-1", portId: "notes-in" },
        enabled: true,
      },
      "play-enable-midi": {
        id: "play-enable-midi",
        from: { nodeId: "play-enable-1", portId: "notes-out" },
        to: { nodeId: "midi-out-1", portId: "notes-in" },
        enabled: true,
      },
      "accent-velocity": {
        id: "accent-velocity",
        from: { nodeId: "cyclic-accent-1", portId: "accent-out" },
        to: { nodeId: "velocity-range-1", portId: "accent-in" },
        enabled: true,
      },
      "legato-legato": {
        id: "legato-legato",
        from: { nodeId: "cyclic-legato-1", portId: "legato-out" },
        to: { nodeId: "legato-processor-1", portId: "legato-in" },
        enabled: true,
      },
    },
  };
};

const streamTemplate = (streamCount: 1 | 4 | 8 | 16): GraphDocument =>
  centred(buildStreamTemplate(streamCount));

const buildStreamTemplate = (streamCount: 1 | 4 | 8 | 16): GraphDocument => {
  const transport = createNode("m.transport-clock", "transport-1", { x: 60, y: 380 });
  const nodes: NodeInstance[] = [transport];
  const edges: GraphDocument["edges"] = {};

  for (let i = 0; i < streamCount; i++) {
    const row = i % 4;
    const col = Math.floor(i / 4);
    const y = 120 + row * 440;
    const xOffset = col * 1700;
    const editorId = `note-editor-${i + 1}`;
    const streamId = `stream-${i + 1}`;
    const midiId = `midi-out-${i + 1}`;

    nodes.push(createNode("m.note-editor", editorId, { x: 420 + xOffset, y }));
    nodes.push(createNode("m.stream", streamId, { x: 1500 + xOffset, y: y + 40 }));
    nodes.push(createNode("m.midi-output", midiId, { x: 2500 + xOffset, y: y + 90 }));

    edges[`transport-${i + 1}`] = {
      id: `transport-${i + 1}`,
      from: { nodeId: transport.id, portId: "transport-out" },
      to: { nodeId: streamId, portId: "transport-in" },
      enabled: true,
    };
    edges[`reset-${i + 1}`] = {
      id: `reset-${i + 1}`,
      from: { nodeId: transport.id, portId: "reset-out" },
      to: { nodeId: streamId, portId: "reset-in" },
      enabled: true,
    };
    edges[`pattern-${i + 1}`] = {
      id: `pattern-${i + 1}`,
      from: { nodeId: editorId, portId: "pattern-out" },
      to: { nodeId: streamId, portId: "pattern-in" },
      enabled: true,
    };
    edges[`notes-${i + 1}`] = {
      id: `notes-${i + 1}`,
      from: { nodeId: streamId, portId: "notes-out" },
      to: { nodeId: midiId, portId: "notes-in" },
      enabled: true,
    };
  }

  return {
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    edges,
  };
};

/** Highest pitch first, the way a piano roll reads. */
const ROLL_PITCHES = Array.from({ length: ROLL_PITCH_COUNT },
  (_, index) => ROLL_PITCH_COUNT - 1 - index);

const asSteps = (value: JsonValue): number[][] =>
  Array.isArray(value)
    ? value.map((step) => Array.isArray(step)
      ? step.filter((pitch): pitch is number => typeof pitch === "number") : [])
    : [];

function ParameterControl({
  descriptor,
  value,
  onChange,
}: {
  descriptor: ParameterDescriptor;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
}) {
  const kind = parameterControlKind(descriptor);
  if (kind === "none") return null;

  // Everything below this point is a kit control — the same fourteen-widget
  // vocabulary the Kit Gallery demonstrates, drawn by whichever kit the app
  // is wearing. See ui/parameterControl.ts for which control a parameter
  // gets and why, and theme/kits/ for what each one looks like.
  const number = typeof value === "number" ? value : 0;
  const minimum = descriptor.minimum ?? 0;
  const maximum = descriptor.maximum ?? 1;

  if (kind === "toggle") {
    return <div className="mm-field mm-field--kit">
      <span>{descriptor.label}</span>
      <Toggle value={value === true} onChange={(next) => onChange(next)} />
    </div>;
  }

  if (kind === "button") {
    return <div className="mm-field mm-field--kit">
      <span>{descriptor.label}</span>
      <Button label={value === true ? "On" : "Off"} pressed={value === true}
        onClick={() => onChange(!(value === true))} />
    </div>;
  }

  if (kind === "selector") {
    const options = descriptor.options ?? [];
    return <div className="mm-field mm-field--kit">
      <span>{descriptor.label}</span>
      <Selector
        options={options.map((option) => ({ value: option, label: option }))}
        value={String(value)}
        variant={selectorVariant(options)}
        label={descriptor.label}
        onChange={(next) => onChange(next)}
      />
    </div>;
  }

  if (kind === "stepper") {
    return <div className="mm-field mm-field--kit">
      <span>{descriptor.label}</span>
      <Stepper value={number} min={minimum} max={maximum} step={descriptor.step}
        onChange={(next) => onChange(next)} />
    </div>;
  }

  if (kind === "knob" || kind === "slider" || kind === "fader") {
    // A readout beside the control, because every panel in the catalogue puts
    // one there: a knob with no number is unreadable the moment you let go.
    const readout = <Display value={number} unit={descriptor.unit} variant="chip"
      decimals={descriptor.step !== undefined && descriptor.step < 1 ? 2 : 0} />;
    return <div className="mm-field mm-field--kit mm-field--continuous">
      <span>{descriptor.label}</span>
      <span className="mm-field__control">
        {kind === "knob" && <Knob value={number} min={minimum} max={maximum} step={descriptor.step}
          size={34} onChange={(next) => onChange(next)} />}
        {kind === "slider" && <Slider value={number} min={minimum} max={maximum} step={descriptor.step}
          orientation="horizontal" length={78} onChange={(next) => onChange(next)} />}
        {kind === "fader" && <Fader value={number} min={minimum} max={maximum} step={descriptor.step}
          length={64} onChange={(next) => onChange(next)} />}
        {readout}
      </span>
    </div>;
  }

  if (kind === "number") {
    return <label className="mm-field">
      <span>{descriptor.label}</span>
      <span className="mm-number">
        <input type="number" value={number}
          min={descriptor.minimum} max={descriptor.maximum} step={descriptor.step}
          onChange={(event) => onChange(Number(event.currentTarget.value))} />
        {descriptor.unit && <small>{descriptor.unit}</small>}
      </span>
    </label>;
  }

  return <label className="mm-field">
    <span>{descriptor.label}</span>
    <input value={String(value)} onChange={(event) => onChange(event.currentTarget.value)} />
  </label>;
}

function MidiDeviceControl({ value, devices, onChange }: {
  value: JsonValue;
  devices: readonly MidiDeviceOption[];
  onChange: (value: JsonValue) => void;
}) {
  const selected = typeof value === "string" ? value : "";
  const missing = selected && !devices.some((device) => device.id === selected);
  return <label className="mm-field">
    <span>Device</span>
    <select aria-label="MIDI output device" value={selected}
      onChange={(event) => onChange(event.currentTarget.value)}>
      <option value="">Select output…</option>
      {missing && <option value={selected}>Unavailable · {selected}</option>}
      {devices.map((device) => <option key={device.id} value={device.id}>
        {device.connected ? device.label : `Disconnected · ${device.label}`}
      </option>)}
    </select>
  </label>;
}

function NoteGrid({ node, setParameter, roll = false }: {
  node: NodeInstance;
  setParameter: (id: string, value: JsonValue) => void;
  /**
   * True on a face with no room for the whole range.
   *
   * The Note Editor is a big module and shows a plain octave of rows. The
   * Pattern Editor stacks six sections, so its notes get a small window with a
   * scrollbar and an overview instead — same grid, same edits, less height.
   */
  roll?: boolean;
}) {
  const active = Math.max(0, Math.min(PRESET_SLOTS - 1, Number(node.parameters["active-position"] ?? 0)));
  const source = node.parameters["preset-values"];
  const presets = Array.from({ length: PRESET_SLOTS }, (_, position) =>
    asSteps(Array.isArray(source) ? source[position] : []));
  const steps = presets[active];
  const count = Math.max(16, steps.length);
  const toggle = (stepIndex: number, pitch: number) => {
    const next = Array.from({ length: count }, (_, index) => [...(steps[index] ?? [])]);
    const at = next[stepIndex];
    next[stepIndex] = at.includes(pitch) ? at.filter((value) => value !== pitch) : [...at, pitch].sort((a, b) => a - b);
    const nextPresets = presets.map((pattern) => pattern.map((step) => [...step]));
    nextPresets[active] = next;
    setParameter("preset-values", nextPresets);
  };
  if (roll) return <NoteRoll steps={steps} count={count} toggle={toggle} />;

  const pitches = Array.from({ length: 12 }, (_, index) => 71 - index);
  return <div className="mm-piano-roll" role="grid" aria-label="Note grid">
    {pitches.map((pitch) => <div className="mm-piano-row" key={pitch} role="row">
      <span className="mm-piano-key">{pitch}</span>
      {Array.from({ length: 16 }, (_, step) => <button type="button" key={step}
        className={steps[step]?.includes(pitch) ? "is-note" : ""}
        aria-label={`Step ${step + 1}, MIDI note ${pitch}`}
        aria-pressed={Boolean(steps[step]?.includes(pitch))}
        onClick={() => toggle(step, pitch)} />)}
    </div>)}
  </div>;
}

/**
 * A small window onto the whole grid, with an overview above it.
 *
 * Every pitch and every step is rendered — a note is scrolled away, never
 * dropped — and the overview draws the entire pattern in one strip so you can
 * see where the music is while looking at a dozen rows of it. Dragging on the
 * overview moves the window, which is the fastest way to get from a bass line
 * to a melody two octaves up.
 */
function NoteRoll({ steps, count, toggle }: {
  steps: readonly number[][];
  count: number;
  toggle: (step: number, pitch: number) => void;
}) {
  const viewRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<RollView>(EMPTY_VIEW);
  // A hundred and twenty-eight rows is a lot of buttons to rebuild, and a node
  // being dragged re-renders on every pointer move. The rows are therefore
  // memoised on the pattern, and reach the current `toggle` through a ref so
  // that memoising them cannot capture a stale one.
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  const measure = useCallback(() => {
    const element = viewRef.current;
    if (!element) return;
    setView({
      scrollTop: element.scrollTop, scrollLeft: element.scrollLeft,
      clientWidth: element.clientWidth, clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight,
    });
  }, []);

  // Opened once, on the notes rather than on pitch 127. Re-centring on every
  // edit would fight the user the moment they scrolled somewhere deliberately.
  useLayoutEffect(() => {
    const element = viewRef.current;
    if (!element) return;
    element.scrollTop = openingScrollTop(steps, {
      scrollTop: 0, scrollLeft: 0,
      clientWidth: element.clientWidth, clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight,
    });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => ROLL_PITCHES.map((pitch) => <div className="mm-piano-row" key={pitch} role="row"
    style={{ gridTemplateColumns: `34px repeat(${count}, minmax(20px, 1fr))` }}>
    <span className="mm-piano-key">{pitch}</span>
    {Array.from({ length: count }, (_, step) => <button type="button" key={step}
      className={steps[step]?.includes(pitch) ? "is-note" : ""}
      aria-label={`Step ${step + 1}, MIDI note ${pitch}`}
      aria-pressed={Boolean(steps[step]?.includes(pitch))}
      onClick={() => toggleRef.current(step, pitch)} />)}
  </div>), [steps, count]);

  const notes = useMemo(() => steps.flatMap((step, index) => step.map((pitch) => <rect
    key={`${index}-${pitch}`}
    x={index} y={ROLL_PITCH_COUNT - 1 - pitch} width={1} height={1} />)), [steps]);

  const window_ = viewWindow(view);
  const drag = (event: React.PointerEvent<SVGSVGElement>) => {
    const element = viewRef.current;
    if (!element) return;
    const box = event.currentTarget.getBoundingClientRect();
    const next = centreOn(view,
      (event.clientX - box.left) / box.width,
      (event.clientY - box.top) / box.height);
    element.scrollLeft = next.scrollLeft;
    element.scrollTop = next.scrollTop;
    measure();
  };

  return <div className="mm-note-roll">
    {/*
      * The overview is one rect per note over the whole range, so a pattern
      * that fits in an octave still draws in its true place — the point is to
      * show where the music sits, and a rescaled strip would hide exactly that.
      */}
    <svg className="mm-note-roll__overview" viewBox={`0 0 ${count} ${ROLL_PITCH_COUNT}`}
      preserveAspectRatio="none" role="img"
      aria-label={`Pattern overview, ${steps.flat().length} notes`}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) drag(event);
      }}>
      {notes}
      <rect className="mm-note-roll__window" vectorEffect="non-scaling-stroke"
        x={window_.x * count} y={window_.y * ROLL_PITCH_COUNT}
        width={Math.max(window_.width * count, 0.5)}
        height={Math.max(window_.height * ROLL_PITCH_COUNT, 1)} />
    </svg>

    <div className="mm-note-roll__view" ref={viewRef} onScroll={measure}>
      <div className="mm-piano-roll" role="grid" aria-label="Note grid">{rows}</div>
    </div>
  </div>;
}

function DensitySlider({ node, setParameter }: {
  node: NodeInstance;
  setParameter: (id: string, value: JsonValue) => void;
}) {
  const value = Number(node.parameters.density ?? 100);
  return <label className="mm-density-slider">
    <span>Note density</span>
    <input type="range" min="0" max="100" step="1" value={value}
      aria-label="Note density probability"
      onChange={(event) => setParameter("density", Number(event.currentTarget.value))} />
    <output>{value}%</output>
  </label>;
}


type OrderMix = { original: number; cyclic: number; utterly: number };

function NoteOrderMix({ node, setParameters }: {
  node: NodeInstance;
  setParameters: (values: Record<string, JsonValue>) => void;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const mix: OrderMix = {
    original: Number(node.parameters.original ?? 0),
    cyclic: Number(node.parameters.cyclic ?? 0),
    utterly: Number(node.parameters.utterly ?? 0),
  };
  const layout = noteOrderHandleLayout(mix);
  const applyBoundary = (boundary: "originalEnd" | "utterlyStart", clientX: number) => {
    const bar = barRef.current?.getBoundingClientRect();
    if (!bar) return;
    const next = setNoteOrderBoundary(mix, boundary, ((clientX - bar.left) / bar.width) * 100);
    setParameters(next);
  };
  const beginBoundary = (
    event: React.PointerEvent<HTMLButtonElement>,
    boundary: "originalEnd" | "utterlyStart",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId === pointerId) applyBoundary(boundary, moveEvent.clientX);
    };
    const finish = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      applyBoundary(boundary, upEvent.clientX);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  };
  const keyBoundary = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    boundary: "originalEnd" | "utterlyStart",
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = boundary === "originalEnd" ? layout.originalEnd : layout.utterlyStart;
    const next = current + (event.key === "ArrowRight" ? 1 : -1);
    const changed = setNoteOrderBoundary(mix, boundary, next);
    setParameters(changed);
  };
  return <div className="mm-order-mix">
    <div className="mm-order-mix__bar" ref={barRef}>
      <span className="mm-order-mix__original" style={{ width: `${mix.original}%` }} />
      <span className="mm-order-mix__cyclic" style={{ width: `${mix.cyclic}%` }} />
      <span className="mm-order-mix__utterly" style={{ width: `${mix.utterly}%` }} />
      <button type="button" className="mm-order-mix__handle mm-order-mix__handle--first"
        style={{ left: `${layout.originalEnd}%` }} role="slider"
        aria-label="Original and Cyclic boundary" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={layout.originalEnd}
        onKeyDown={(event) => keyBoundary(event, "originalEnd")}
        onPointerDown={(event) => beginBoundary(event, "originalEnd")} />
      <button type="button" className="mm-order-mix__handle mm-order-mix__handle--second"
        style={{ left: `${layout.utterlyStart}%` }} role="slider"
        aria-label="Cyclic and Utterly boundary" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={layout.utterlyStart}
        onKeyDown={(event) => keyBoundary(event, "utterlyStart")}
        onPointerDown={(event) => beginBoundary(event, "utterlyStart")} />
    </div>
    <div className="mm-order-mix__values">
      <output><span>Original</span><b>{mix.original}%</b></output>
      <output><span>Cyclic</span><b>{mix.cyclic}%</b></output>
      <output><span>Utterly</span><b>{mix.utterly}%</b></output>
    </div>
  </div>;
}


/** The playing step from a processor's status line, or null when stopped. */
function playingStep(cursor: string | undefined): number | null {
  const match = /Step\s+(\d+)/.exec(cursor ?? "");
  return match ? Number(match[1]) : null;
}

/**
 * Collapse each run of consecutive commands into one group.
 *
 * Face elements stack one per row so every label sits above its field. Buttons
 * are the exception: they are actions rather than values, and stacking them
 * full-width turns a row of four into something that reads as a menu.
 */
/** A section whose only content is the preset pad. */
const isPresetOnly = (section: NodeFaceSection): boolean =>
  section.elements.length === 1
  && section.elements[0].kind === "custom"
  && section.elements[0].captures !== undefined;

function groupCommands(
  elements: readonly NodeFaceElement[],
): (NodeFaceElement | { kind: "command"; id: string; label: string }[])[] {
  const out: (NodeFaceElement | { kind: "command"; id: string; label: string }[])[] = [];
  let run: { kind: "command"; id: string; label: string }[] | null = null;
  for (const element of elements) {
    if (element.kind === "command") {
      run = run ?? [];
      run.push(element);
      continue;
    }
    if (run) {
      out.push(run);
      run = null;
    }
    out.push(element);
  }
  if (run) out.push(run);
  return out;
}

function CustomFace({ element, node, setParameter, setParameters, status }: {
  element: Extract<NodeFaceElement, { kind: "custom" }>;
  node: NodeInstance;
  setParameter: (id: string, value: JsonValue) => void;
  setParameters: (values: Record<string, JsonValue>) => void;
  status: Readonly<Record<string, string>>;
}) {
  // The Pattern Editor's three grids are the same editor as the standalone
  // Cyclic modules, pointed at a different parameter.
  if (element.id.startsWith("embedded-") && element.id.endsWith("-grid")) {
    const storage = element.parameterIds?.[0] ?? "preset-values";
    // `embedded-accent-grid` holds `accent-grid` and `accent-length`: the name
    // in the middle is the sequence, and both parameters are named after it.
    const sequence = element.id.slice("embedded-".length, -"-grid".length);
    return <CyclicGrid node={node} setParameter={setParameter}
      setParameters={setParameters} currentStep={playingStep(status.cursor)}
      storageId={storage} lengthId={`${sequence}-length`} showPresets={false} />;
  }
  if (element.id === "cyclic-grid") {
    return <CyclicGrid node={node} setParameter={setParameter}
      setParameters={setParameters} currentStep={playingStep(status.cursor)} />;
  }
  if (element.id === "piano-roll") return <NoteGrid node={node} setParameter={setParameter} />;
  // The windowed variant: same editor, sized for a face that has no room for
  // twelve fixed rows.
  if (element.id === "note-roll") {
    return <NoteGrid node={node} setParameter={setParameter} roll />;
  }
  if (element.id === "density-slider") {
    return <DensitySlider node={node} setParameter={setParameter} />;
  }

  if (element.id === "note-order-mix") {
    return <NoteOrderMix node={node} setParameters={setParameters} />;
  }

  if (element.id === "percussion-slots") {
    return <PercussionSlots node={node} setParameter={setParameter} />;
  }
  if (element.id === "asset-slot") {
    return <AssetSlot node={node} parameterId={element.parameterIds?.[0] ?? "asset-id"}
      setParameter={setParameter} />;
  }
  // Every preset element is the same control. The only thing that differs is
  // what a slot captures, and that is declared on the element.
  if (element.captures) {
    return <PresetPad node={node} label={element.label} captures={element.captures}
      placement={element.placement} setParameters={setParameters} />;
  }
  if (element.id === "position-cells") {
    const active = Number(node.parameters["active-position"] ?? 0);
    const labels = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    return <div className="mm-positions" role="group" aria-label="Pattern positions">
      {labels.map((label, index) => <button type="button"
        key={label} className={active === index ? "is-active" : ""}
        aria-pressed={active === index}
        onClick={() => setParameter("active-position", index)}>{label}</button>)}
    </div>;
  }
  return <div className="mm-custom-placeholder">{element.label}</div>;
}

/**
 * Removes a node from the canvas.
 *
 * `pointerdown` is stopped as well as `click`: the header is the drag handle,
 * so without that a press on the button would start dragging the node it is
 * about to remove.
 */
function CloseNodeButton({ label, onClose }: { label: string; onClose: () => void }) {
  return <button type="button" className="mm-node__close" aria-label={`Remove ${label}`}
    title={`Remove ${label} (undo with Cmd+Z)`}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => { event.stopPropagation(); onClose(); }}>×</button>;
}

function NodeFace({
  node,
  zoom,
  selected,
  pendingConnection,
  dispatch,
  onCommand,
  onParameterChange,
  onSelect,
  onPortClick,
  onPortPointerDown,
  onDragMove,
  onRaise,
  stackIndex,
  dropTarget,
  onClose,
  status,
  midiDevices,
  connectedPorts,
}: {
  node: NodeInstance;
  zoom: number;
  selected: boolean;
  pendingConnection: PortRef | null;
  dispatch: (command: GraphCommand) => void;
  onCommand: (node: NodeInstance, commandId: string, label: string) => void;
  onParameterChange: (nodeId: string, parameterId: string, value: JsonValue, morph: MorphPolicy) => void;
  onSelect: () => void;
  onPortClick: (port: PortRef) => void;
  onPortPointerDown: (event: React.PointerEvent, port: PortRef, direction: "input" | "output") => void;
  /** Tells the cable layer to re-measure while this node is being dragged. */
  onDragMove: () => void;
  /** Raises this node above the others. */
  onRaise: () => void;
  stackIndex: number;
  dropTarget: PortRef | null;
  onClose: () => void;
  status: Readonly<Record<string, string>>;
  midiDevices: readonly MidiDeviceOption[];
  /** `"nodeId:portId"` for every port with a cable on it, so a jack can show
   * itself as connected. Computed once for the whole graph rather than per
   * port, which would rescan every edge for every jack on every render. */
  connectedPorts: ReadonlySet<string>;
}) {
  const descriptor = moduleRegistry.get(node.moduleType);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const parameterMap = useMemo(() => new Map((descriptor?.parameters ?? []).map((item) => [item.id, item])), [descriptor]);
  const setParameter = (parameterId: string, value: JsonValue) => {
    const morph = (parameterMap.get(parameterId)?.morph ?? "immediate") as MorphPolicy;
    onParameterChange(node.id, parameterId, value, morph);
    dispatch({ type: "set-parameter", nodeId: node.id, parameterId, value });
  };
  const setParameters = (values: Record<string, JsonValue>) => {
    for (const [parameterId, value] of Object.entries(values)) {
      const morph = (parameterMap.get(parameterId)?.morph ?? "immediate") as MorphPolicy;
      onParameterChange(node.id, parameterId, value, morph);
    }
    dispatch({ type: "set-parameters", nodeId: node.id, values });
  };
  const beginDrag = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    // The whole face is a drag handle, so the drag has to stand aside for every
    // control living on it — otherwise turning a knob would move the module.
    if (!isDragSurface(event.target as Element)) return;
    onRaise();
    dragRef.current = { x: event.clientX, y: event.clientY };
    const move = (moveEvent: PointerEvent) => {
      const start = dragRef.current;
      if (!start) return;
      setDrag({ x: (moveEvent.clientX - start.x) / zoom, y: (moveEvent.clientY - start.y) / zoom });
      // Cables are measured from the DOM, so a node moving under them has to
      // ask for a re-measure or they stay pinned where the node used to be.
      onDragMove();
    };
    const finish = (upEvent: PointerEvent) => {
      const start = dragRef.current;
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      if (!start) return;
      const delta = { x: (upEvent.clientX - start.x) / zoom, y: (upEvent.clientY - start.y) / zoom };
      setDrag({ x: 0, y: 0 });
      dispatch({ type: "move-nodes", positions: {
        [node.id]: { x: node.position.x + delta.x, y: node.position.y + delta.y },
      } });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  };
  if (!descriptor) {
    return <article className={`mm-node mm-node--unknown${selected ? " is-selected" : ""}`}
      aria-label={`Unknown ${node.moduleType} module`}
      onPointerDown={beginDrag}
      onClick={(event) => { event.stopPropagation(); onRaise(); onSelect(); }}
      style={{ left: node.position.x + drag.x, top: node.position.y + drag.y, width: 360, minHeight: 150, zIndex: stackIndex, "--mm-accent": "var(--rd-bd-300)" } as React.CSSProperties}>
      <header className="mm-node__header">
        <span>Unknown module</span><small>{node.moduleType}</small>
        <CloseNodeButton label="Unknown module" onClose={onClose} />
      </header>
      <div className="mm-node__face">
        <section className="mm-node-section">
          <h2>Recovery required</h2>
          <div className="mm-node-section__content">This module type is unavailable. Select and delete it, or migrate the document.</div>
        </section>
      </div>
    </article>;
  }
  const accent = accentVar(descriptor.colorToken);
  return <article className={`mm-node mm-node--${descriptor.family} mm-node--layout-${descriptor.layout}${selected ? " is-selected" : ""}`}
    aria-label={`${node.label} module`}
    // Lets the stylesheet make an exception for one module without inventing a
    // layout class that means "the Note Editor".
    data-module-type={node.moduleType}
    onPointerDown={beginDrag}
    onClick={(event) => { event.stopPropagation(); onRaise(); onSelect(); }}
    // Neither dimension is declared any more. A layout class used to pin both,
    // so every module was padded out to the largest thing that class might ever
    // hold — a Play Enable, which is a checkbox and a preset strip, was given
    // the same 520 × 330 as a module with a full control panel. The face is the
    // size of what is on it, bounded by the layout's range in the stylesheet.
    style={{ left: node.position.x + drag.x, top: node.position.y + drag.y,
      zIndex: stackIndex, "--mm-accent": accent } as React.CSSProperties}>
    <header className="mm-node__header">
      <span>{node.label}</span>
      <CloseNodeButton label={node.label} onClose={onClose} />
    </header>
    <div className="mm-node__ports mm-node__ports--input">
      {descriptor.ports.filter((port) => port.direction === "input").map((port) =>
        <button type="button" key={port.id}
          className={`mm-port mm-port--${port.signal.kind}${portTarget(node.id, port.id, dropTarget)}`}
          // Measured by the cable layer, which needs to find this exact port.
          data-node-id={node.id} data-port-id={port.id} data-port-direction="input"
          aria-label={`${node.label} input ${port.label}`}
          onPointerDown={(event) => onPortPointerDown(event, { nodeId: node.id, portId: port.id }, "input")}
          onClick={(event) => { event.stopPropagation(); onPortClick({ nodeId: node.id, portId: port.id }); }}>
          <Jack direction="in" connected={connectedPorts.has(`${node.id}:${port.id}`)} />
          <span className="mm-port__label">{port.label}</span>
        </button>)}
    </div>
    <div className="mm-node__ports mm-node__ports--output">
      {descriptor.ports.filter((port) => port.direction === "output").map((port) =>
        <button type="button" key={port.id}
          className={`mm-port mm-port--${port.signal.kind}${pendingConnection?.nodeId === node.id && pendingConnection.portId === port.id ? " is-patching" : ""}${portTarget(node.id, port.id, dropTarget)}`}
          data-node-id={node.id} data-port-id={port.id} data-port-direction="output"
          aria-label={`${node.label} output ${port.label}`}
          aria-pressed={pendingConnection?.nodeId === node.id && pendingConnection.portId === port.id}
          onPointerDown={(event) => onPortPointerDown(event, { nodeId: node.id, portId: port.id }, "output")}
          onClick={(event) => { event.stopPropagation(); onPortClick({ nodeId: node.id, portId: port.id }); }}>
          <span className="mm-port__label">{port.label}</span>
          <Jack direction="out" connected={connectedPorts.has(`${node.id}:${port.id}`)} />
        </button>)}
    </div>
    <div className="mm-node__face">
      {descriptor.face.map((section) => <section className="mm-node-section" key={section.id}
        aria-label={section.label}>
        {/*
          * A section of nothing but a preset pad needs no heading. Sixteen
          * numbered keys are self-evident, and "PRESETS" above them is a row of
          * chrome on a face where vertical space is the scarce thing. What the
          * pad stores is on each slot's tooltip instead. A face can waive its
          * headings the same way — see `showHeading`.
          */}
        {isPresetOnly(section) || section.showHeading === false
          ? null
          : <h2>{section.label}</h2>}
        <div className="mm-node-section__content">
          {groupCommands(section.elements).map((element, index) => {
            // A run of buttons is one row. Fields stack, actions do not: four
            // stacked full-width buttons is a menu, not a control panel.
            if (Array.isArray(element)) {
              return <div className="mm-node-section__commands" key={`commands-${index}`}>
                {element.map((command) => <button type="button" className="mm-command"
                  key={command.id}
                  onClick={() => onCommand(node, command.id, command.label)}>{command.label}</button>)}
              </div>;
            }
            if (element.kind === "parameter") {
              const parameter = parameterMap.get(element.parameterId)!;
              if (node.moduleType === "m.midi-output" && parameter.id === "device-id") {
                return <MidiDeviceControl key={`${element.kind}-${element.parameterId}`}
                  value={node.parameters[parameter.id]} devices={midiDevices}
                  onChange={(value) => setParameter(parameter.id, value)} />;
              }
              return <ParameterControl key={`${element.kind}-${element.parameterId}`}
                descriptor={parameter} value={node.parameters[parameter.id]}
                onChange={(value) => setParameter(parameter.id, value)} />;
            }
            if (element.kind === "command") return <button type="button" className="mm-command"
              key={`${element.kind}-${element.id}`}
              onClick={() => onCommand(node, element.id, element.label)}>{element.label}</button>;
            if (element.kind === "status") {
              // A status is a readout, so it gets the kit's readout controls:
              // an LED for "is this doing anything", the text itself as a
              // Display, and — where the status is a count of something with
              // a known ceiling — a Meter, which is the difference between
              // reading "6" and seeing that six is nearly all of them.
              const text = status[element.id] ?? "Idle";
              const live = isLiveStatus(text);
              return <output className="mm-status mm-status--kit"
                key={`${element.kind}-${element.id}`}>
                <Led on={live} tone="accent" />
                <Display label={element.label} value={text} variant="inline"
                  tone={live ? "accent" : "normal"} />
                {hasVoiceCount(node.moduleType) && element.id === "voices" && <Meter
                  levels={[statusLevel(text, VOICE_METER_CEILING)]}
                  orientation="horizontal" length={46} segments={8}
                  label={`${element.label} level`} />}
              </output>;
            }
            return <CustomFace key={`${element.kind}-${element.id}-${index}`}
              element={element} node={node} setParameter={setParameter}
              setParameters={setParameters} status={status} />;
          })}
        </div>
      </section>)}
    </div>
  </article>;
}

export function ModularApp() {
  const [graph, setGraph] = useState(starterGraph);
  const [undo, setUndo] = useState<GraphCommand[]>([]);
  const [redo, setRedo] = useState<GraphCommand[]>([]);
  const zoomRef = useRef(1);
  const [zoom, setZoom] = useState(() => clampZoom(readStoredNumber(STORAGE_KEYS.zoom, 0.72)));
  zoomRef.current = zoom;
  const [handMode, setHandMode] = useState(() => readStoredBoolean(STORAGE_KEYS.handMode, true));
  const [panning, setPanning] = useState(false);
  const [themeId, setThemeId] = useState<ThemeId>(() => readStoredTheme());
  /** Which kit draws the controls. The theme's other half — see the picker
   * beside the theme picker, and `theme/kits/` for what a kit is. */
  const [kitId, setKitId] = useState<KitId>("thinRing");
  /** Which audio backend is actually rendering, for the status bar. */
  const [engineKind, setEngineKind] = useState<RackEngineChoice>("web-audio");
  const [message, setMessage] = useState("idMLab graph ready");
  const [menu, setMenu] = useState<{ x: number; y: number; graphX: number; graphY: number } | null>(null);
  /** Every port with a cable on it, as `"nodeId:portId"`. Built once per edge
   * change so each jack is a set lookup rather than a scan of every edge. */
  const connectedPorts = useMemo(() => {
    const ports = new Set<string>();
    for (const edge of Object.values(graph.edges)) {
      ports.add(`${edge.from.nodeId}:${edge.from.portId}`);
      ports.add(`${edge.to.nodeId}:${edge.to.portId}`);
    }
    return ports;
  }, [graph.edges]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [pendingConnection, setPendingConnection] = useState<PortRef | null>(null);
  /** Measured port centres in canvas coordinates, keyed by node and port. */
  const [portAnchors, setPortAnchors] = useState<Record<string, Point>>({});
  const [cableDrag, setCableDrag] = useState<
    { from: PortRef; direction: "input" | "output"; pointer: Point } | null
  >(null);
  const [dropTarget, setDropTarget] = useState<PortRef | null>(null);
  /** Stacking order. A node touched most recently sits in front of the rest. */
  const [stacking, setStacking] = useState<Record<string, number>>({});
  const stackCounter = useRef(1);
  const [runtimeStatuses, setRuntimeStatuses] = useState<Record<string, Readonly<Record<string, string>>>>({});
  const [midiDevices, setMidiDevices] = useState<MidiDeviceOption[]>([]);
  const nextId = useRef(2);
  const nextEdgeId = useRef(2);
  const runtimeRef = useRef<ModularRuntime | null>(null);
  const midiSessionRef = useRef<BrowserMidiSession | null>(null);
  const audioRef = useRef<AudioEngine | null>(null);
  const [audioOn, setAudioOn] = useState(false);
  const [poolOpen, setPoolOpen] = useState(false);
  const [assets, setAssets] = useState<AssetEntry[]>([]);
  const [playingAsset, setPlayingAsset] = useState<string | null>(null);
  /** Live audio node count. A stale "when it started" figure explains nothing. */
  const [audioNodes, setAudioNodes] = useState(0);
  /** Manifest of a document opened before audio started, replayed on start. */
  const pendingAssetsRef = useRef<AssetEntry[] | null>(null);
  const publisherRef = useRef(new PlanPublisher());
  const openInputRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  /**
   * Bumped when a *new stage* is created, and by the Center command.
   *
   * Not on open, and not on edit: the view belongs to the user from the moment
   * the stage exists. Auto-centring past that point is the app deciding where
   * you are looking.
   */
  const [recenterToken, setRecenterToken] = useState(0);
  /**
   * The canvas grows to hold the patch.
   *
   * A fixed extent is a wall: drag a module toward the edge and it stops being
   * reachable, because there is nothing past it to scroll to.
   */
  const canvasSize = useMemo(() => canvasExtent(
    Object.values(graph.nodes).map((node) => ({
      x: node.position.x,
      y: node.position.y,
      ...nodeSize(node.moduleType),
    })),
  ), [graph.nodes]);
  const measureFrameRef = useRef<number | null>(null);
  const panRef = useRef<{ clientX: number; clientY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const didPanRef = useRef(false);
  const wheelFrameRef = useRef<number | null>(null);
  const dispatch = (command: GraphCommand) => {
    const result = executeGraphCommand(graph, command);
    setGraph(result.graph);
    setUndo((history) => [...history, result.inverse]);
    setRedo([]);
  };
  const reseedIdsFromGraph = (nextGraph: GraphDocument) => {
    const extractMax = (ids: string[]) => ids.reduce((max, id) => {
      const match = id.match(/-(\d+)$/);
      if (!match) return max;
      const value = Number(match[1]);
      return Number.isFinite(value) ? Math.max(max, value) : max;
    }, 1);
    nextId.current = extractMax(Object.keys(nextGraph.nodes)) + 1;
    nextEdgeId.current = extractMax(Object.keys(nextGraph.edges)) + 1;
  };
  const undoLast = () => {
    const command = undo[undo.length - 1];
    if (!command) return;
    const result = executeGraphCommand(graph, command);
    setGraph(result.graph);
    setUndo((history) => history.slice(0, -1));
    setRedo((history) => [...history, result.inverse]);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  };
  const redoLast = () => {
    const command = redo[redo.length - 1];
    if (!command) return;
    const result = executeGraphCommand(graph, command);
    setGraph(result.graph);
    setRedo((history) => history.slice(0, -1));
    setUndo((history) => [...history, result.inverse]);
  };
  /**
   * Remove one node and everything that referenced it: the selection, and a
   * half-finished patch that started from one of its ports.
   */
  const removeNode = (nodeId: string) => {
    dispatch({ type: "remove-nodes", nodeIds: [nodeId] });
    setMessage(`Deleted ${graph.nodes[nodeId]?.label ?? "node"}`);
    setSelectedNodeId((current) => (current === nodeId ? null : current));
    setPendingConnection((pending) => (pending?.nodeId === nodeId ? null : pending));
  };
  const deleteSelection = () => {
    if (selectedNodeId) {
      removeNode(selectedNodeId);
      return;
    }
    if (selectedEdgeId) {
      dispatch({ type: "remove-edge", edgeId: selectedEdgeId });
      setMessage("Disconnected cable");
      setSelectedEdgeId(null);
    }
  };
  const duplicateSelection = () => {
    if (!selectedNodeId) return;
    const source = graph.nodes[selectedNodeId];
    if (!source) return;
    const id = `${source.moduleType.split('.').pop()}-${nextId.current++}`;
    const duplicate = structuredClone(source);
    duplicate.id = id;
    duplicate.label = `${source.label} Copy`;
    duplicate.position = { x: source.position.x + 45, y: source.position.y + 45 };
    dispatch({ type: "add-node", node: duplicate });
    setSelectedNodeId(id);
    setMessage(`Duplicated ${source.label}`);
  };
  /**
   * Re-measure every port and record its centre in canvas coordinates.
   *
   * Coalesced onto an animation frame: node dragging fires this on every
   * pointer move, and one layout read per frame is the most that can usefully
   * reach the screen.
   */
  const measureNow = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const next: Record<string, Point> = {};
    for (const element of canvas.querySelectorAll<HTMLElement>(".mm-port")) {
      const nodeId = element.dataset.nodeId;
      const portId = element.dataset.portId;
      if (!nodeId || !portId) continue;
      next[portAnchorKey(nodeId, portId)] = anchorInCanvas(
        element.getBoundingClientRect(),
        canvasRect,
        zoom,
      );
    }
    setPortAnchors((current) => (sameAnchors(current, next) ? current : next));
  }, [zoom]);

  /**
   * Coalesced re-measure, for the one caller that fires continuously: node
   * dragging. One layout read per frame is the most that can reach the screen.
   *
   * Only the drag path goes through a frame. The measurement that matters for
   * correctness — the one after every render — runs synchronously in the layout
   * effect below, because a backgrounded tab never runs an animation frame and
   * cables would sit on their fallback geometry until it was foregrounded.
   */
  const measurePorts = useCallback(() => {
    if (measureFrameRef.current !== null) cancelAnimationFrame(measureFrameRef.current);
    measureFrameRef.current = requestAnimationFrame(() => {
      measureFrameRef.current = null;
      measureNow();
    });
  }, [measureNow]);

  // Ports move when the graph changes, when zoom changes, and when a node is
  // dragged; the first two are renders, and the third calls `measurePorts`.
  useLayoutEffect(() => {
    measureNow();
  }, [graph, zoom, measureNow]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const remeasure = () => measureNow();
    window.addEventListener("resize", remeasure);
    // Only the listener is torn down here. Cancelling the pending measurement
    // as well would kill the frame the layout effect had just scheduled —
    // React's development double-mount re-runs these in an order where that
    // leaves nothing scheduled at all, and no cable is ever measured. The
    // frame is harmless if it outlives the mount: it re-reads the canvas ref
    // and does nothing when it is gone.
    return () => window.removeEventListener("resize", remeasure);
  }, [measureNow]);

  /** The measured centre of a port, or the old approximation until it exists. */
  const anchorFor = (ref: PortRef, direction: "input" | "output"): Point => {
    const measured = portAnchors[portAnchorKey(ref.nodeId, ref.portId)];
    if (measured) return measured;
    const node = graph.nodes[ref.nodeId];
    if (!node) return { x: 0, y: 0 };
    return fallbackAnchor(node.position, nodeSize(node.moduleType), direction);
  };

  /**
   * Start dragging a cable from a port.
   *
   * Click-to-patch stays: this only takes over once the pointer actually
   * moves, so a plain click still runs the existing two-step flow and nobody's
   * muscle memory breaks.
   */
  const beginCableDrag = (
    event: React.PointerEvent,
    port: PortRef,
    direction: "input" | "output",
  ) => {
    if (event.button !== 0 || !canInteractAtZoom(zoom)) return;
    event.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    let dragging = false;

    const move = (moveEvent: PointerEvent) => {
      const canvasRect = canvas.getBoundingClientRect();
      const pointer = pointerInCanvas(moveEvent.clientX, moveEvent.clientY, canvasRect, zoom);
      if (!dragging) {
        // A few pixels of slop, so a click that trembles is still a click.
        const anchor = anchorFor(port, direction);
        if (Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y) < 6) return;
        dragging = true;
      }
      setCableDrag({ from: port, direction, pointer });

      const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const target = element?.closest<HTMLElement>(".mm-port");
      const nodeId = target?.dataset.nodeId;
      const portId = target?.dataset.portId;
      const targetDirection = target?.dataset.portDirection;
      setDropTarget(
        nodeId && portId && targetDirection && targetDirection !== direction
          ? { nodeId, portId }
          : null,
      );
    };

    const finish = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      const wasDragging = dragging;
      setCableDrag(null);
      setDropTarget(null);
      if (!wasDragging) return;

      const element = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
      const target = element?.closest<HTMLElement>(".mm-port");
      const nodeId = target?.dataset.nodeId;
      const portId = target?.dataset.portId;
      const targetDirection = target?.dataset.portDirection;
      if (!nodeId || !portId || !targetDirection) {
        setMessage("Cable released on empty canvas");
        return;
      }
      if (targetDirection === direction) {
        setMessage(direction === "output" ? "Connect an output to an input" : "Connect an input to an output");
        return;
      }
      // Dragging backwards from an input is the same connection stated in the
      // other order, so the edge is normalised here rather than downstream.
      const from = direction === "output" ? port : { nodeId, portId };
      const to = direction === "output" ? { nodeId, portId } : port;
      connectPorts(from, to);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  };

  /** The one place an edge is created, whether by click or by drag. */
  const connectPorts = (from: PortRef, to: PortRef) => {
    const error = connectionError(graph, moduleRegistry, from, to);
    if (error) {
      setMessage(error);
      return false;
    }
    const edgeId = `cable-${nextEdgeId.current++}`;
    dispatch({ type: "add-edge", edge: { id: edgeId, from, to, enabled: true } });
    setPendingConnection(null);
    setMessage(`Connected ${graph.nodes[from.nodeId]?.label} to ${graph.nodes[to.nodeId]?.label}`);
    return true;
  };

  const handlePortClick = (ref: PortRef) => {
    const node = graph.nodes[ref.nodeId];
    const descriptor = node ? moduleRegistry.get(node.moduleType) : undefined;
    const port = descriptor?.ports.find((candidate) => candidate.id === ref.portId);
    if (!port) return;
    if (port.direction === "output") {
      const cancel = pendingConnection?.nodeId === ref.nodeId && pendingConnection.portId === ref.portId;
      setPendingConnection(cancel ? null : ref);
      setMessage(cancel ? "Connection cancelled" : `Patching from ${node.label}: ${port.label} — choose an input`);
      return;
    }
    if (!pendingConnection) {
      setMessage("Choose an output port first, then an input port");
      return;
    }
    if (connectPorts(pendingConnection, ref)) {
      setSelectedNodeId(null);
      setMessage(`Connected to ${node.label}: ${port.label}`);
    }
  };
  const handleNodeCommand = (node: NodeInstance, _commandId: string, label: string) => {
    if (node.moduleType === "m.stream" && _commandId === "expand-stream") {
      const expanded = expandStreamNode(graph, node.id);
      setGraph(expanded);
      setUndo([]);
      setRedo([]);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setPendingConnection(null);
      setMessage(`${node.label}: expanded to stream modules`);
      return;
    }
    if (node.moduleType === "m.midi-output" && _commandId === "enable-midi") {
      const session = midiSessionRef.current;
      if (!session) {
        setMessage(`${node.label}: MIDI session unavailable`);
        return;
      }
      void session.enable().then(() => {
        setMidiDevices(session.devices());
        setMessage(`${node.label}: MIDI enabled`);
      }).catch((error: unknown) => {
        setMessage(`${node.label}: ${error instanceof Error ? error.message : "MIDI permission denied"}`);
      });
      return;
    }
    const result = executeRuntimeCommand(runtimeRef.current, node, _commandId, label);
    if (result.updates) {
      for (const update of result.updates) {
        dispatch({
          type: "set-parameter",
          nodeId: node.id,
          parameterId: update.parameterId,
          value: update.value,
        });
      }
    }
    setMessage(result.message);
  };
  const handleParameterChange = (
    nodeId: string,
    parameterId: string,
    value: JsonValue,
    morph: MorphPolicy,
  ) => {
    queueRuntimeParameter(runtimeRef.current, nodeId, parameterId, value, morph);
  };
  /** Raise a node above the others. Called whenever one is touched. */
  const bringToFront = (nodeId: string) => {
    stackCounter.current += 1;
    const top = stackCounter.current;
    setStacking((current) => (current[nodeId] === top ? current : { ...current, [nodeId]: top }));
  };

  const addNode = (moduleType: string) => {
    if (!menu) return;
    const moduleTypeParts = moduleType.split('.');
    const id = `${moduleTypeParts[moduleTypeParts.length - 1]}-${nextId.current++}`;
    const viewport = viewportRef.current;
    // A new module is placed where it can actually be seen and worked on:
    // fully inside the view, clear of the chrome, and not under anything.
    const position = placeNode({
      desired: { x: menu.graphX, y: menu.graphY },
      size: nodeSize(moduleType),
      existing: Object.values(graph.nodes).map((node) => ({
        x: node.position.x,
        y: node.position.y,
        ...nodeSize(node.moduleType),
      })),
      visible: viewport
        ? visibleRegion(
          {
            left: viewport.scrollLeft,
            top: viewport.scrollTop,
            width: viewport.clientWidth,
            height: viewport.clientHeight,
          },
          zoom,
        )
        : { x: 0, y: 0, width: canvasSize.width, height: canvasSize.height },
      canvas: canvasSize,
    });
    dispatch({ type: "add-node", node: createNode(moduleType, id, position) });
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    bringToFront(id);
    setMenu(null);
  };
  const save = () => {
    // The manifest, never the audio: identity and a thumbnail are what make a
    // reopened project honest about what it is missing.
    const manifest = audioRef.current?.library.manifest() ?? [];
    const content = JSON.stringify(createModularDocument(graph, manifest), null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "Untitled.idmlab";
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Saved Untitled.idmlab");
  };

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Save the project with its samples inside it.
   *
   * Kept as a separate action rather than folded into Save: a working file
   * should not rewrite every megabyte of audio each time it is saved, and a
   * project handed to someone else should not arrive with holes in it.
   */
  const savePack = () => {
    const engine = audioRef.current;
    if (!engine) {
      setMessage("Start audio first — there are no samples to bundle yet");
      return;
    }
    const manifest = engine.library.manifest();
    const blobs = engine.packBlobs();
    const orphaned = engine.library.unbundlable();
    const bytes = encodeModularPack(createModularDocument(graph, manifest), blobs);
    download(new Blob([bytes as BlobPart], { type: "application/octet-stream" }), "Untitled.idmlabpack");
    const size = `${(bytes.length / 1_048_576).toFixed(2)} MB`;
    setMessage(orphaned.length === 0
      ? `Saved Untitled.idmlabpack · ${blobs.length} sample bundled · ${size}`
      // Said plainly, because a bundle that quietly omits audio is worse than
      // no bundle: the recipient finds out when they open it.
      : `Saved Untitled.idmlabpack · ${size} · ${orphaned.length} sample still missing its audio: ${orphaned.map((entry) => entry.name).join(", ")}`);
  };

  const applyOpenedDocument = (
    documentGraph: GraphDocument,
    assets: AssetEntry[],
    hydrate: (engine: AudioEngine) => void,
  ) => {
    setGraph(documentGraph);
    setUndo([]);
    setRedo([]);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setPendingConnection(null);
    // Deliberately no re-centring here. Opening a file is not a new stage, and
    // yanking the view to the patch would overrule wherever the user was.
    reseedIdsFromGraph(documentGraph);
    if (audioRef.current) {
      hydrate(audioRef.current);
      refreshAssets();
    } else if (assets.length > 0) {
      pendingAssetsRef.current = assets;
    }
  };

  const open = async (file: File) => {
    try {
      // Sniffed from the bytes rather than trusted from the extension: a
      // renamed file should still open as what it actually is.
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isModularPack(bytes)) {
        const decoded = decodeModularPack(bytes);
        if (!decoded.ok) {
          setMessage(`Open failed: ${decoded.error}`);
          return;
        }
        const { document: packDocument, blobs } = decoded.pack;
        // Carried into the final message rather than shown now: a rejected
        // checksum is the *explanation* for a sample being absent, and posting
        // it before the async load would let the success line overwrite it.
        const damage = decoded.warnings.length > 0 ? ` — ${decoded.warnings.join("; ")}` : "";
        applyOpenedDocument(
          packDocument.graph,
          packDocument.assets.map((record) => ({ ...record, status: "missing" as const })),
          (engine) => {
            void engine.loadPack(packDocument.assets, blobs).then((result) => {
              refreshAssets();
              const failures = result.failed.length > 0
                ? `; could not decode ${result.failed.map((entry) => entry.name).join(", ")}`
                : "";
              setMessage(`Opened ${file.name} · ${result.loaded} sample loaded, ${result.generated} generated${damage}${failures}`);
            });
          },
        );
        if (!audioRef.current) setMessage(`Opened ${file.name}${damage}`);
        return;
      }

      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      const decoded = decodeModularDocument(parsed);
      if (!decoded.ok) {
        setMessage(`Open failed: ${decoded.error}`);
        return;
      }
      applyOpenedDocument(
        decoded.document.graph,
        decoded.document.assets.map((record) => ({ ...record, status: "missing" as const })),
        (engine) => engine.hydrateAssets(decoded.document.assets),
      );
      setMessage(decoded.warnings.length > 0
        ? `Opened ${file.name} with ${decoded.warnings.length} migration warning(s)`
        : `Opened ${file.name}`);
    } catch {
      setMessage("Open failed: unreadable document");
    }
  };
  const beginCanvasPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!handMode || event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest(".mm-node, .mm-module-menu") || target.closest(".mm-cables path")) return;
    const viewport = event.currentTarget;
    panRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    didPanRef.current = false;
    setPanning(true);
    viewport.setPointerCapture(event.pointerId);
  };
  const moveCanvasPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = panRef.current;
    if (!start) return;
    const deltaX = event.clientX - start.clientX;
    const deltaY = event.clientY - start.clientY;
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) didPanRef.current = true;
    event.currentTarget.scrollLeft = start.scrollLeft - deltaX;
    event.currentTarget.scrollTop = start.scrollTop - deltaY;
  };
  const endCanvasPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!panRef.current) return;
    panRef.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // The wheel sets a *target*; the scale travels toward it a frame at a time.
    // A notch that jumps straight to the new scale reads as chunky however
    // small the jump, because nothing moved — the canvas was one size and then
    // it was another.
    let target = zoomRef.current;
    let pointer = { x: 0, y: 0 };

    const step = () => {
      const current = zoomRef.current;
      const next = easeZoom(current, target);
      if (next === current) {
        wheelFrameRef.current = null;
        return;
      }
      const scroll = zoomScrollPosition({
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
        pointerX: pointer.x,
        pointerY: pointer.y,
        oldZoom: current,
        newZoom: next,
      });
      // The ref leads the state, so the next frame starts from the scale this
      // one decided rather than from one React has yet to commit.
      zoomRef.current = next;
      setZoom(next);
      viewport.scrollLeft = scroll.left;
      viewport.scrollTop = scroll.top;
      wheelFrameRef.current = requestAnimationFrame(step);
    };

    const wheelZoom = (event: WheelEvent) => {
      // An overlay that scrolls owns its own wheel. Without this the canvas
      // zoom swallows every wheel event on the page, so a menu taller than the
      // window can be opened but never scrolled — and the groups at the bottom
      // of it become unreachable rather than merely awkward.
      const element = event.target as Element | null;
      if (element?.closest?.(
        ".mm-module-menu, .mm-pool, .mm-theme-menu, .mm-theme-studio, .mm-note-roll__view",
      )) return;
      event.preventDefault();
      event.stopPropagation();

      const bounds = viewport.getBoundingClientRect();
      pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      const pixels = clampFramePixels(
        wheelDeltaPixels(event.deltaY, event.deltaMode, viewport.clientHeight),
      );
      // Aimed from the target, not from the current scale: keep scrolling while
      // it is still travelling and the notches add up instead of fighting.
      target = zoomByWheel(target, pixels);
      if (wheelFrameRef.current === null) wheelFrameRef.current = requestAnimationFrame(step);
    };
    viewport.addEventListener("wheel", wheelZoom, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", wheelZoom);
      if (wheelFrameRef.current !== null) cancelAnimationFrame(wheelFrameRef.current);
    };
    // Subscribed once. Re-subscribing on every zoom change tore the listener
    // down and rebuilt it on each notch of the wheel.
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEYS.zoom, String(zoom));
  }, [zoom]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEYS.handMode, String(handMode));
  }, [handMode]);

  // Applying the theme is a document-level side effect, not a render output:
  // the tokens land on <html> so the page behind the app is themed too.
  useEffect(() => {
    applyTheme(themeId);
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEYS.theme, themeId);
  }, [themeId]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof window === "undefined") return;
    const left = readStoredNumber(STORAGE_KEYS.panLeft, 0);
    const top = readStoredNumber(STORAGE_KEYS.panTop, 0);
    requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, left);
      viewport.scrollTop = Math.max(0, top);
    });
    const storePan = () => {
      window.localStorage.setItem(STORAGE_KEYS.panLeft, String(viewport.scrollLeft));
      window.localStorage.setItem(STORAGE_KEYS.panTop, String(viewport.scrollTop));
    };
    viewport.addEventListener("scroll", storePan);
    return () => viewport.removeEventListener("scroll", storePan);
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, textarea")) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelection();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelection();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  useEffect(() => {
    const timingSource = {
      get currentTime() { return performance.now() / 1000; },
      outputLatency: 0,
    };
    const presentationClock = new PresentationClock(timingSource);
    const runtime = new ModularRuntime({
      registry: moduleRegistry,
      driver: new TimerSchedulerDriver(),
      clock: presentationClock,
      wakeIntervalMs: 25,
    });
    const requestAccess = typeof navigator.requestMIDIAccess === "function"
      ? async () => await navigator.requestMIDIAccess({ sysex: false }) as unknown as MidiAccessLike
      : null;
    const midiSession = new BrowserMidiSession(runtime, presentationClock, requestAccess);
    runtimeRef.current = runtime;
    midiSessionRef.current = midiSession;
    return () => {
      midiSession.dispose();
      runtime.dispose();
      midiSessionRef.current = null;
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const result = publisherRef.current.publish(graph, moduleRegistry, { seed: 7 });
    if (result.ok) {
      runtime.build(graph, result.plan);
      midiSessionRef.current?.sync(Object.values(graph.nodes));
      return;
    }
    if (result.diagnostics.length > 0) setMessage(result.diagnostics[0].message);
  }, [graph]);

  useEffect(() => {
    const update = () => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      const next = Object.fromEntries(
        Object.values(graph.nodes).map((node) => {
          const status = { ...runtime.nodeStatus(node.id) };
          if (node.moduleType === "m.midi-output") {
            status.connection = midiSessionRef.current?.status(node.id) ?? "MIDI session unavailable";
          }
          // Voice counts come from the audio engine, not the event runtime:
          // a sounding drum tail outlives the note that started it.
          if (audioRef.current && hasVoiceCount(node.moduleType)) {
            status.voices = audioOn ? String(audioRef.current.playerVoices(node.id)) : "Audio off";
          }
          return [node.id, status];
        }),
      );
      setRuntimeStatuses((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next);
      setAudioNodes(audioRef.current?.liveNodeCount ?? 0);
      const devices = midiSessionRef.current?.devices() ?? [];
      setMidiDevices((current) =>
        JSON.stringify(current) === JSON.stringify(devices) ? current : devices);
    };
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [graph, audioOn]);

  /**
   * Audio starts on a click and never before it.
   *
   * A context created at mount would be born suspended, and a suspended
   * context's clock does not advance — so every ramp the engine scheduled would
   * be scheduled into a moment that never arrives. Building it inside the
   * gesture is what makes the first sound work rather than the second.
   */
  const refreshAssets = useCallback(() => {
    setAssets(audioRef.current?.library.list() ?? []);
    setPlayingAsset(audioRef.current?.auditioningAssetId ?? null);
  }, []);

  const startAudio = useCallback((): AudioEngine | null => {
    if (audioRef.current) return audioRef.current;
    const Constructor = window.AudioContext;
    if (!Constructor) {
      setMessage("Web Audio is unavailable in this browser");
      return null;
    }
    const engine = new AudioEngine(new Constructor() as unknown as EngineContext, moduleRegistry, {
      // The same clock the runtime schedules against, so the note adapter can
      // measure the offset to audio time rather than guess it.
      runtimeNow: () => performance.now() / 1000,
    });
    audioRef.current = engine;
    // Registered here rather than at construction: until there is an audio
    // context there is nothing for note events to be played on.
    runtimeRef.current?.addAdapter(engine.notes);
    setAudioOn(true);
    // A project opened before audio started listed samples nobody could load
    // yet; replaying the manifest here is what makes those rows appear.
    if (pendingAssetsRef.current) {
      engine.hydrateAssets(pendingAssetsRef.current);
      pendingAssetsRef.current = null;
    }
    // Deliberately *not* building the graph here. Doing it inside this promise
    // raced with the effect below and left the engine holding whichever plan
    // resolved last — so turning audio on after building a patch produced an
    // engine with nothing in it, while turning it on first worked. One effect
    // owns synchronisation now, and it runs on both triggers.
    void engine.start().then(async () => {
      refreshAssets();
      // The Rust rack is opt-in via `?engine=rust` and deliberately not
      // persisted: someone who lands on a broken build gets the working
      // backend back by removing a parameter rather than by finding a
      // setting. Attached after `start()` because a worklet node on a
      // suspended context never pulls.
      if (preferredEngine(window.location.search) === "rust") {
        const attached = await engine.useRustEngine();
        setEngineKind(engine.engineKind);
        setMessage(attached
          ? "Audio running · Rust engine"
          : "Audio running · Rust engine unavailable, using Web Audio");
        return;
      }
      setMessage("Audio running");
    });
    return engine;
  }, [refreshAssets]);

  const toggleAudio = useCallback(() => {
    if (!audioRef.current) {
      startAudio();
      return;
    }
    runtimeRef.current?.removeAdapter(audioRef.current.notes);
    audioRef.current.dispose();
    audioRef.current = null;
    setAudioOn(false);
    setPlayingAsset(null);
    setAssets([]);
    setMessage("Audio stopped");
  }, [startAudio]);

  const addSoundFiles = useCallback((files: File[]) => {
    const engine = startAudio();
    if (!engine) return;
    void (async () => {
      const read = await Promise.all(files.map(async (file) => ({
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })));
      const result = await engine.addFiles(read);
      refreshAssets();
      setMessage(result.failed.length === 0
        ? `Added ${result.added.length} sample${result.added.length === 1 ? "" : "s"}`
        : `Added ${result.added.length}, could not decode: ${result.failed.map((entry) => entry.name).join(", ")}`);
    })();
  }, [refreshAssets, startAudio]);

  const playAsset = useCallback((assetId: string) => {
    const engine = audioRef.current;
    if (!engine) return;
    if (engine.playAsset(assetId, () => setPlayingAsset(null))) setPlayingAsset(assetId);
    else setMessage("That sample's audio is not loaded — drop the file to restore it");
  }, []);

  const stopAsset = useCallback(() => {
    audioRef.current?.stopAudition();
    setPlayingAsset(null);
  }, []);

  const removeAsset = useCallback((assetId: string) => {
    if (audioRef.current?.auditioningAssetId === assetId) stopAsset();
    audioRef.current?.library.remove(assetId);
    refreshAssets();
  }, [refreshAssets, stopAsset]);

  /**
   * The one place the audio graph is synchronised with the document.
   *
   * `audioOn` is a dependency as well as `graph`, because turning audio on is
   * every bit as much a reason to build the patch as editing it — and having
   * two code paths that both "sometimes" build it is what let one of them win
   * the race with an empty plan.
   */
  useEffect(() => {
    if (!audioOn) return;
    audioRef.current?.update(graph);
  }, [graph, audioOn]);

  useEffect(() => () => {
    audioRef.current?.dispose();
    audioRef.current = null;
  }, []);

  /**
   * Pull the menu back on screen once its real size is known.
   *
   * Measured rather than estimated, because the menu's height depends on how
   * many module families have entries and its width on the longest label — and
   * `useLayoutEffect` rather than `useEffect` so the correction happens before
   * the browser paints, instead of the menu visibly jumping.
   */
  useLayoutEffect(() => {
    const element = menuRef.current;
    const viewport = viewportRef.current;
    if (!menu || !element || !viewport) return;
    // Bounded by what is actually visible, not by `70vh`: the viewport is the
    // window minus the toolbar and status bar, so a vh-based cap overhangs both
    // and the last groups fall off the bottom.
    element.style.maxHeight = `${Math.max(120, viewport.clientHeight - 16)}px`;
    const placed = menuPlacement(
      { x: menu.x, y: menu.y },
      { width: element.offsetWidth, height: element.offsetHeight },
      {
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      },
    );
    if (Math.abs(placed.x - menu.x) < 0.5 && Math.abs(placed.y - menu.y) < 0.5) return;
    setMenu({ ...menu, x: placed.x, y: placed.y });
  }, [menu]);

  /**
   * Point the window at the patch.
   *
   * Runs on load and whenever the document is replaced. Without it a new
   * project opens on the world's empty top-left corner, because the patch is
   * centred in a canvas far larger than the window.
   */
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const boxes = Object.values(graph.nodes).map((node) => ({
      x: node.position.x,
      y: node.position.y,
      ...nodeSize(node.moduleType),
    }));
    const apply = () => {
      const { left, top } = scrollToCenter(
        boxes,
        { width: viewport.clientWidth, height: viewport.clientHeight },
        zoomRef.current,
      );
      viewport.scrollLeft = left;
      viewport.scrollTop = top;
    };
    // Twice: once now, and once after the browser has laid the stage out. The
    // first attempt happens while the stage may still be its old size, and a
    // scroll offset past the current extent is silently clamped to zero —
    // which is exactly how the patch ended up in the corner.
    apply();
    const frame = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(frame);
    // Deliberately not keyed on `graph` or `zoom`: this must not yank the view
    // back every time a node moves or the user zooms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterToken]);

  useEffect(() => () => runtimeRef.current?.stop(), []);
  return <SoundPoolContext.Provider value={{ assets, preview: playAsset }}>
  <KitContext.Provider value={kitId}>
  <main className="mm-app" onClick={() => setMenu(null)}>
    <input
      ref={openInputRef}
      type="file"
      accept=".idmlab,.idmlabpack,application/json,application/octet-stream"
      style={{ display: "none" }}
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) void open(file);
        event.currentTarget.value = "";
      }}
    />
    <header className="mm-project-bar">
      <div><strong>idMLab</strong><span>Untitled.idmlab</span></div>
      <nav aria-label="Project controls">
        <button type="button" onClick={() => {
          const next = starterGraph();
          setGraph(next); setUndo([]); setRedo([]); setSelectedNodeId(null); setSelectedEdgeId(null); setPendingConnection(null);
          reseedIdsFromGraph(next); setRecenterToken((value) => value + 1);
        }}>New</button>
        <button type="button" onClick={() => {
          const next = streamTemplate(1);
          setGraph(next); setUndo([]); setRedo([]); setSelectedNodeId(null); setSelectedEdgeId(null); setPendingConnection(null);
          reseedIdsFromGraph(next); setRecenterToken((value) => value + 1);
        }}>1 Stream</button>
        <button type="button" onClick={() => {
          const next = streamTemplate(4);
          setGraph(next); setUndo([]); setRedo([]); setSelectedNodeId(null); setSelectedEdgeId(null); setPendingConnection(null);
          reseedIdsFromGraph(next); setRecenterToken((value) => value + 1);
        }}>4 Streams</button>
        <button type="button" onClick={() => {
          const next = streamTemplate(8);
          setGraph(next); setUndo([]); setRedo([]); setSelectedNodeId(null); setSelectedEdgeId(null); setPendingConnection(null);
          reseedIdsFromGraph(next); setRecenterToken((value) => value + 1);
        }}>8 Streams</button>
        <button type="button" onClick={() => {
          const next = streamTemplate(16);
          setGraph(next); setUndo([]); setRedo([]); setSelectedNodeId(null); setSelectedEdgeId(null); setPendingConnection(null);
          reseedIdsFromGraph(next); setRecenterToken((value) => value + 1);
        }}>16 Streams</button>
        <button type="button" onClick={() => openInputRef.current?.click()}>Open</button>
        <button type="button" onClick={save}>Save</button>
        <button type="button" onClick={savePack} title="Save the project with its samples inside it">Save + samples</button>
        <button type="button" onClick={undoLast} disabled={!undo.length}>Undo</button>
        <button type="button" onClick={redoLast} disabled={!redo.length}>Redo</button>
        <button type="button" onClick={duplicateSelection} disabled={!selectedNodeId}>Duplicate</button>
        <button type="button" onClick={deleteSelection} disabled={!selectedNodeId && !selectedEdgeId}>Delete</button>
        <button type="button" className={handMode ? "is-active" : ""}
          aria-pressed={handMode} onClick={() => setHandMode((value) => !value)}>Hand</button>
        <button type="button" title="Bring the view back to the patch"
          onClick={() => setRecenterToken((value) => value + 1)}>Center</button>
        <button type="button" className={audioOn ? "is-active" : ""}
          aria-pressed={audioOn} onClick={toggleAudio}>Audio</button>
        <button type="button" className={poolOpen ? "is-active" : ""}
          aria-pressed={poolOpen} onClick={() => setPoolOpen((value) => !value)}>Sounds</button>
        <label>Zoom <input type="range" min="12" max="110" value={Math.round(zoom * 100)}
          onChange={(event) => setZoom(Number(event.currentTarget.value) / 100)} /></label>
        <ThemePicker themeId={themeId} onSelect={setThemeId} />
        {/* The kit sits beside the theme because they are the two halves of
            the same choice: the theme decides the colours, the kit decides
            the shapes, and neither constrains the other. */}
        <label className="mm-kit-picker">Kit <select value={kitId}
          onChange={(event) => setKitId(event.currentTarget.value as KitId)}>
          {KIT_IDS.map((id) => <option key={id} value={id}>{KIT_META[id].label}</option>)}
        </select></label>
      </nav>
    </header>
    <div ref={viewportRef} className={`mm-canvas-viewport${handMode ? " is-hand" : ""}${panning ? " is-panning" : ""}`}
      onPointerDown={beginCanvasPan} onPointerMove={moveCanvasPan}
      onPointerUp={endCanvasPan} onPointerCancel={endCanvasPan}
      onClick={() => {
      if (didPanRef.current) { didPanRef.current = false; return; }
      setSelectedNodeId(null); setSelectedEdgeId(null); setMenu(null);
    }} onContextMenu={(event) => {
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - bounds.left + event.currentTarget.scrollLeft;
      const y = event.clientY - bounds.top + event.currentTarget.scrollTop;
      setMenu({ x, y, graphX: x / zoom, graphY: y / zoom });
    }}>
      <div className="mm-canvas-stage"
        style={{
          // A fixed world, not the canvas times zoom. Pulling back shows more
          // of the patch; it never shrinks the surface out from under you.
          width: `max(100%, ${stageSize(canvasSize, zoom).width}px)`,
          height: `max(100%, ${stageSize(canvasSize, zoom).height}px)`,
        }}>
      <div ref={canvasRef} className={`mm-canvas${canInteractAtZoom(zoom) ? "" : " is-too-small"}`}
        style={{ width: canvasSize.width, height: canvasSize.height, transform: `scale(${zoom})` }}>
        <svg className="mm-cables" width={canvasSize.width} height={canvasSize.height}
          aria-label="Graph connections">
          {Object.values(graph.edges).map((edge) => {
            const from = graph.nodes[edge.from.nodeId];
            const to = graph.nodes[edge.to.nodeId];
            if (!from || !to) return null;
            // Both ends come from the ports themselves, so a cable lands on the
            // port it is actually connected to however many the node has.
            return <path key={edge.id} className={selectedEdgeId === edge.id ? "is-selected" : ""}
              aria-label={`Cable from ${from.label} to ${to.label}`}
              onClick={(event) => { event.stopPropagation(); setSelectedEdgeId(edge.id); setSelectedNodeId(null); }}
              d={cablePath(anchorFor(edge.from, "output"), anchorFor(edge.to, "input"))} />;
          })}
          {cableDrag && <path className="mm-cable-dragging" aria-label="Cable being connected"
            d={draggingCablePath(
              anchorFor(cableDrag.from, cableDrag.direction),
              cableDrag.pointer,
              cableDrag.direction,
            )} />}
        </svg>
        {Object.values(graph.nodes).map((node) => <NodeFace key={node.id} node={node}
          zoom={zoom} selected={selectedNodeId === node.id} pendingConnection={pendingConnection}
          dispatch={dispatch} onCommand={handleNodeCommand}
          onParameterChange={handleParameterChange}
          onSelect={() => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }}
          onPortClick={handlePortClick}
          onPortPointerDown={beginCableDrag}
          onDragMove={measurePorts}
          onRaise={() => bringToFront(node.id)}
          stackIndex={2 + (stacking[node.id] ?? 0)}
          dropTarget={dropTarget}
          status={runtimeStatuses[node.id] ?? {}}
          midiDevices={midiDevices}
          connectedPorts={connectedPorts}
          onClose={() => removeNode(node.id)} />)}
      </div>
      </div>
      {menu && <div ref={menuRef} className="mm-module-menu" style={{ left: menu.x, top: menu.y }}
        onClick={(event) => event.stopPropagation()}>
        <b>Add module</b>
        {moduleMenuGroups(moduleRegistry).map((group) => <div
          key={group.family} className="mm-module-menu__group">
          <b>{group.label}</b>
          {group.items.map((descriptor) => <button type="button"
            key={descriptor.type} onClick={() => addNode(descriptor.type)}>{descriptor.label}</button>)}
        </div>)}
      </div>}
    </div>
    {poolOpen ? <SoundPool
      entries={assets}
      ready={audioOn}
      playingAssetId={playingAsset}
      onStartAudio={() => startAudio()}
      onAddFiles={addSoundFiles}
      onPlay={playAsset}
      onStop={stopAsset}
      onRemove={removeAsset}
      onClose={() => setPoolOpen(false)}
    /> : null}
    <footer className="mm-status-bar"><span>{message}</span><span>{Object.keys(graph.nodes).length} nodes · {Object.keys(graph.edges).length} cable{audioOn ? ` · ${audioNodes} audio · ${engineKind === "rust" ? "Rust" : "Web Audio"}` : ""}</span></footer>
  </main>
  </KitContext.Provider>
  </SoundPoolContext.Provider>;
}
