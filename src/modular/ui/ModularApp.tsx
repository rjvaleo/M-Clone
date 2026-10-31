import { Profiler, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ProfilerOnRenderCallback } from "react";
import { perf } from "../perf/recorder";
import { StatusStore, StatusStoreContext, useNodeStatus } from "./statusStore";
import { GraphStore, GraphStoreContext } from "./graphStore";
import { PerfPanel } from "./PerfPanel";
import { noteOrderHandleLayout, setNoteOrderBoundary } from "../../engine/transform";
import { createModularDocument, decodeModularDocument } from "../document/document";
import { decodeModularPack, encodeModularPack, isModularPack } from "../document/pack";
import { PlanPublisher } from "../compiler/compileGraph";
import { isPlayerModule } from "../audio/players";
import { connectionError } from "../model/connections";
import { executeGraphCommand, type GraphCommand } from "../model/commands";
import { expandStreamNode } from "../model/stream";
import { CANVAS_SIZE, canvasExtent, centeringOffset } from "./viewport";
import { MAX_ZOOM, MIN_ZOOM, centerOn, clampCameraZoom, fitToBoxes, panBy, screenToCanvas, wheelZoomFactor, zoomAround, type Camera } from "./camera";
import { isDragSurface, menuPlacement, placeNode, visibleRegion } from "./nodePlacement";
import { buildMenu, soleMatch } from "./moduleMenu";
import { parameterControlKind } from "./parameterControl";
import { isLiveStatus } from "./nodeStatus";
import { preferredEngine, type RackEngineChoice } from "../audio/wasm/rackNode";
import type { RackReport } from "../audio/wasm/rackProtocol";
import { KitContext } from "../theme/kits/KitContext";
import { KIT_IDS, KIT_META, type KitId } from "../theme/kits/types";
import { Jack } from "../theme/kits/controls/Jack";
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
import { createNode, withDeclaredParameters, moduleRegistry } from "../registry/registry";
import { applyTheme, DEFAULT_THEME_ID, themeMeta, type ThemeId } from "../theme/themes";
import { ThemePicker } from "./ThemePicker";
import { MenuBar, type MenuActions } from "./MenuBar";
import { MFaceHostContext, MNodeFace, readMNodeSize } from "./MNodeFace";
import { M_NODE_TYPE, findMNode, routedTracks, trackTargets } from "./mNode";
import { canAddModule } from "../model/limits";
import { M_LAB_TYPES } from "../registry/mLabModules";
import { quantizeMorph, variableLinkUpdates } from "../mlab/links";
import { buildMRack } from "../mlab/rack";
import { buildDrumRack } from "../drums/drumRack";
import { findKit, kitFileUrl, kitSlots, pickKitFiles } from "../drums/drumKits";
import { MLAB_FACES, MLabHostContext, N4_TITLES } from "./mlab";
import { DrumSeqFace } from "./mlab/DrumSeqFace";
import type { MLabHost } from "./mlab/common";
import { N4Header } from "./n4/N4Header";
import { Panel } from "./panels/Panel";
import { panelForNode } from "./panels/layouts";
import "./panels/panels.css";
import { N4Button, N4Knob, N4Spinner, N4Stepper } from "./n4/kit";
import { formatValue } from "./n4/format";
import { presetHandlers } from "./n4/PresetManager";
import { NOT_IN_PRESETS, snapshotOf } from "../mlab/presets";
import { setRuntimeHost } from "../../ui/runtime";
import { useM } from "../../state/store";
import { shareMidiAccess } from "./midisession";
import { CyclicGrid } from "./CyclicGrid";
import { LfoMapFace } from "./LfoFace";
import { ModulationContext, type ModulationApi } from "./modulationContext";
import { ModTarget } from "./ModTarget";
import { ModulationAnimator } from "./modulationAnimator";
import { MeterAnimator } from "./panels/meters";
import { CloudAnimator } from "./panels/cloudHeads";
import {
  isModulator,
  lfoStates,
  mappingsByTarget,
  nextLfoColor,
  targetsOf,
  withTarget,
  withoutTarget,
  type Mapping,
} from "../modulation";
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
 * The order the add menu offers modules in.
 *
 * Reached-for first, not wired-first. This used to run the length of the
 * signal chain, clock through to output, which reads well as a description of
 * the system and puts the three things most often added — an effect, an
 * instrument, a pattern source — at the bottom of a forty-plus item list.
 *
 * Audio, instruments and sequencers lead. The rest keep their signal-flow
 * order behind them, since that is still the best way to read the remainder.
 */
const MODULE_GROUPS: { family: string; label: string }[] = [
  { family: "audio", label: "Audio" },
  { family: "instrument", label: "Instruments" },
  { family: "source", label: "Sequencers" },
  { family: "clock", label: "Clock and transport" },
  { family: "transform", label: "Note transforms" },
  { family: "control", label: "Control and conducting" },
  { family: "routing", label: "Routing and output" },
  { family: "m", label: "M" },
];

/**
 * Modules whose "voices" status is a live count from the audio engine.
 *
 * Asked of the audio layer rather than listed here: a second copy of the list
 * is a second thing to forget, and forgetting it shows up as an instrument
 * that plays perfectly and reports "Idle" for ever.
 */
const hasVoiceCount = (moduleType: string): boolean => isPlayerModule(moduleType);


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

/** One MIDI access for the canvas and for M, so the browser is asked once. */
const browserMidiAccess = typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function"
  ? shareMidiAccess(() => navigator.requestMIDIAccess({ sysex: false }))
  : null;

const FACE_SIZES = {
  compact: { width: 520, height: 330 },
  editor: { width: 900, height: 650 },
  utility: { width: 360, height: 390 },
} as const;

// `height` above is an *estimate*, used only for placing a new module and for
// working out how much canvas the patch occupies. Modules render to their
// content, so the real height is whatever the face comes to.

const nodeSize = (moduleType: string) => moduleType === M_NODE_TYPE
  ? readMNodeSize()
  : FACE_SIZES[moduleRegistry.get(moduleType)?.layout ?? "utility"];

const STORAGE_KEYS = {
  theme: "m.modular.theme",
  zoom: "m.modular.zoom",
  // The hand tool: a left drag pans even over modules, as holding Space does.
  // A new key, because the old "hand mode" meant panning the empty canvas,
  // which is now simply what a drag on the empty canvas does.
  handMode: "m.modular.hand-tool",
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

/** A face's control, which an LFO can move if it is a mappable knob. */
function ParameterControl(props: {
  descriptor: ParameterDescriptor;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  nodeId?: string;
  moduleType?: string;
}) {
  const { descriptor, value, nodeId, moduleType } = props;
  if (!nodeId || !moduleType) return <PlainParameterControl {...props} />;
  return <ModTarget nodeId={nodeId} moduleType={moduleType} parameterId={descriptor.id}
    value={typeof value === "number" ? value : 0}>
    {(modulated) => <PlainParameterControl {...props} modulated={modulated} />}
  </ModTarget>;
}

function PlainParameterControl({
  descriptor,
  value,
  onChange,
  modulated = false,
}: {
  descriptor: ParameterDescriptor;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  modulated?: boolean;
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

  // The tight instrument's controls, the same ones the M modules use: a
  // small knob with its value printed under it, a ⇕ menu, a lit key.
  if (kind === "toggle" || kind === "button") {
    return <div className="mm-field mm-field--n4">
      <span>{descriptor.label}</span>
      <N4Button small on={value === true} onClick={() => onChange(!(value === true))}>{value === true ? "On" : "Off"}</N4Button>
    </div>;
  }

  if (kind === "selector") {
    const options = descriptor.options ?? [];
    return <div className="mm-field mm-field--n4">
      <span>{descriptor.label}</span>
      <N4Spinner value={String(value)} options={options.map((option) => ({ value: option, label: option }))}
        onChange={(next) => onChange(next)} />
    </div>;
  }

  if (kind === "stepper") {
    return <N4Stepper label={descriptor.label} value={number} min={minimum} max={maximum}
      format={(next) => formatValue(next, descriptor)} onChange={(next) => onChange(next)} />;
  }

  if (kind === "knob" || kind === "slider" || kind === "fader") {
    return <N4Knob label={descriptor.label} value={number} min={minimum} max={maximum} step={descriptor.step}
      format={(next) => formatValue(next, descriptor)} onChange={(next) => onChange(next)} modulated={modulated} />;
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

function CustomFace({ element, node, setParameter, setParameters }: {
  element: Extract<NodeFaceElement, { kind: "custom" }>;
  node: NodeInstance;
  setParameter: (id: string, value: JsonValue) => void;
  setParameters: (values: Record<string, JsonValue>) => void;
}) {
  // Subscribes to its own module's status, so a status tick renders this face
  // and not the module around it.
  const status = useNodeStatus(node.id);
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
  if (element.id === "m-app") return <MNodeFace />;
  if (element.id === "lfo-map") return <LfoMapFace node={node} setParameter={setParameter} />;
  // The Drum Sequencer is drawn with the same Numerology kit as the M faces.
  if (element.id === "m-drum-seq") {
    return <DrumSeqFace node={node} setParameter={setParameter} setParameters={setParameters} status={status} />;
  }
  const MLabFace = MLAB_FACES[element.id];
  if (MLabFace) {
    return <MLabFace node={node} setParameter={setParameter} setParameters={setParameters} status={status} />;
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

/** A face re-renders only when its own props change: its node, its status, its selection. */
const NodeFaceMemo = memo(NodeFace);

/** One status line, subscribed to its own module: a tick renders this and nothing else. */
function StatusReadout({ nodeId, id, label }: { nodeId: string; id: string; label: string }) {
  const text = useNodeStatus(nodeId)[id] ?? "Idle";
  const live = isLiveStatus(text);
  return <output className={`n4-status${live ? " is-live" : ""}`}>
    <span className="n4-status__led" aria-hidden="true" />
    <span className="n4-status__label">{label}</span>
    <span className="n4-status__value">{text}</span>
  </output>;
}

/** React's own measure of each render, filed under the module type that rendered. */
const recordRender: ProfilerOnRenderCallback = (id, _phase, actualDuration) => perf.record(id, actualDuration);

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
  onSelect: (nodeId: string) => void;
  onPortClick: (port: PortRef) => void;
  onPortPointerDown: (event: React.PointerEvent, port: PortRef, direction: "input" | "output") => void;
  /** Moves this node's cables with it while it is dragged; null when it lands. */
  onDragMove: (nodeId: string, offset: { x: number; y: number } | null) => void;
  /** Raises this node above the others. */
  onRaise: (nodeId: string) => void;
  stackIndex: number;
  dropTarget: PortRef | null;
  onClose: (nodeId: string) => void;
  midiDevices: readonly MidiDeviceOption[];
  /** `"nodeId:portId"` for every port with a cable on it, so a jack can show
   * itself as connected. Computed once for the whole graph rather than per
   * port, which would rescan every edge for every jack on every render. */
  connectedPorts: ReadonlySet<string>;
}) {
  const descriptor = moduleRegistry.get(node.moduleType);
  // A drag moves the module on the compositor, with no render: the article is
  // translated directly and its cables follow, and the graph learns the new
  // position once, when it lands. Rendering on every move put the module a
  // frame or two behind the pointer.
  const articleRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const parameterMap = useMemo(() => new Map((descriptor?.parameters ?? []).map((item) => [item.id, item])), [descriptor]);
  // Modules without a stored "collapsed" fold for this session only.
  const [folded, setFolded] = useState(false);
  // Stable for the life of the node, so a memoised face body (the NoteSeq's)
  // is not re-rendered just because its node's status ticked.
  const nodeId = node.id;
  const setParameter = useCallback((parameterId: string, value: JsonValue) => {
    const morph = (parameterMap.get(parameterId)?.morph ?? "immediate") as MorphPolicy;
    onParameterChange(nodeId, parameterId, value, morph);
    dispatch({ type: "set-parameter", nodeId, parameterId, value });
  }, [parameterMap, onParameterChange, dispatch, nodeId]);
  const setParameters = useCallback((values: Record<string, JsonValue>) => {
    for (const [parameterId, value] of Object.entries(values)) {
      const morph = (parameterMap.get(parameterId)?.morph ?? "immediate") as MorphPolicy;
      onParameterChange(nodeId, parameterId, value, morph);
    }
    dispatch({ type: "set-parameters", nodeId, values });
  }, [parameterMap, onParameterChange, dispatch, nodeId]);
  const beginDrag = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    // The whole face is a drag handle, so the drag has to stand aside for every
    // control living on it — otherwise turning a knob would move the module.
    if (!isDragSurface(event.target as Element)) return;
    onRaise(node.id);
    dragRef.current = { x: event.clientX, y: event.clientY };
    const move = (moveEvent: PointerEvent) => {
      const start = dragRef.current;
      if (!start) return;
      perf.time("drag move", () => {
        const offset = { x: (moveEvent.clientX - start.x) / zoom, y: (moveEvent.clientY - start.y) / zoom };
        if (articleRef.current) articleRef.current.style.translate = `${offset.x}px ${offset.y}px`;
        onDragMove(node.id, offset);
      });
    };
    const finish = (upEvent: PointerEvent) => {
      const start = dragRef.current;
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      if (!start) return;
      const delta = { x: (upEvent.clientX - start.x) / zoom, y: (upEvent.clientY - start.y) / zoom };
      if (articleRef.current) articleRef.current.style.translate = "";
      onDragMove(node.id, null);
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
      ref={articleRef}
      onClick={(event) => { event.stopPropagation(); onRaise(node.id); onSelect(node.id); }}
      style={{ left: node.position.x, top: node.position.y, width: 360, minHeight: 150, zIndex: stackIndex, "--mm-accent": "var(--rd-bd-300)" } as React.CSSProperties}>
      <header className="mm-node__header">
        <span>Unknown module</span><small>{node.moduleType}</small>
        <CloseNodeButton label="Unknown module" onClose={() => onClose(node.id)} />
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
  // Every module wears the Numerology header and the tight chassis. The M
  // modules store their minimize and comment; the rest fold for the session.
  const stored = "collapsed" in node.parameters;
  const collapsed = stored ? node.parameters.collapsed === true : folded;
  // A module with a panel layout is drawn as that panel, at its one width.
  const panel = panelForNode(node);
  return <article className={`mm-node mm-node--n4 mm-node--${descriptor.family} mm-node--layout-${descriptor.layout}${panel ? " mm-node--panel" : ""}${selected ? " is-selected" : ""}${node.enabled ? "" : " is-bypassed"}`}
    aria-label={`${node.label} module`}
    // Lets the stylesheet make an exception for one module without inventing a
    // layout class that means "the Note Editor".
    data-module-type={node.moduleType}
    data-node-box={node.id}
    onPointerDown={beginDrag}
    ref={articleRef}
    onClick={(event) => { event.stopPropagation(); onRaise(node.id); onSelect(node.id); }}
    // Neither dimension is declared any more. A layout class used to pin both,
    // so every module was padded out to the largest thing that class might ever
    // hold — a Play Enable, which is a checkbox and a preset strip, was given
    // the same 520 × 330 as a module with a full control panel. The face is the
    // size of what is on it, bounded by the layout's range in the stylesheet.
    style={{ left: node.position.x, top: node.position.y,
      zIndex: stackIndex, "--mm-accent": accent,
      ...(panel ? { "--mm-width": `${panel.width}px` } : {}) } as React.CSSProperties}>
    {<N4Header name={node.label} title={N4_TITLES[node.moduleType] ?? descriptor.label}
        comment={"comment" in node.parameters ? String(node.parameters.comment ?? "...") : undefined}
        collapsed={collapsed} enabled={node.enabled}
        onCollapse={() => stored ? setParameter("collapsed", !collapsed) : setFolded(!folded)}
        onBypass={() => dispatch({ type: "set-node-details", nodeId: node.id, enabled: !node.enabled })}
        onRename={(label) => dispatch({ type: "set-node-details", nodeId: node.id, label })}
        onComment={(comment) => setParameter("comment", comment)}
        onReset={() => setParameters(Object.fromEntries(descriptor.parameters
          // Resetting the module keeps its name, comment, view and presets.
          .filter((parameter) => !NOT_IN_PRESETS.has(parameter.id))
          .map((parameter) => [parameter.id, structuredClone(parameter.defaultValue)])))}
        onClose={() => onClose(node.id)}
        presets={"presets" in node.parameters
          ? presetHandlers(node.parameters, () => snapshotOf(node.parameters), setParameters as (values: Record<string, unknown>) => void)
          : undefined} />}
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
    {!collapsed && panel && <div className="mm-node__face mm-node__face--panel">
      <Panel layout={panel} node={node} setParameter={setParameter} />
    </div>}
    {!collapsed && !panel && <div className="mm-node__face">
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
                nodeId={node.id} moduleType={node.moduleType}
                onChange={(value) => setParameter(parameter.id, value)} />;
            }
            if (element.kind === "command") return <button type="button" className="mm-command"
              key={`${element.kind}-${element.id}`}
              onClick={() => onCommand(node, element.id, element.label)}>{element.label}</button>;
            if (element.kind === "status") {
              // A readout in the tight instrument's terms: a lit dot for "is
              // this doing anything", the label small, the value in the pixel face.
              return <StatusReadout key={`${element.kind}-${element.id}`} nodeId={node.id} id={element.id} label={element.label} />;
            }
            return <CustomFace key={`${element.kind}-${element.id}-${index}`}
              element={element} node={node} setParameter={setParameter}
              setParameters={setParameters} />;
          })}
        </div>
      </section>)}
    </div>}
  </article>;
}

export function ModularApp() {
  const [graph, setGraph] = useState(starterGraph);
  const [undo, setUndo] = useState<GraphCommand[]>([]);
  const [redo, setRedo] = useState<GraphCommand[]>([]);
  // The camera: where the window sits on the canvas and how far in it is.
  // ComfyUI's model — one transform, no scrollbars, no edges. See camera.ts.
  const [camera, setCamera] = useState<Camera>(() => ({
    left: readStoredNumber(STORAGE_KEYS.panLeft, 0),
    top: readStoredNumber(STORAGE_KEYS.panTop, 0),
    zoom: clampCameraZoom(readStoredNumber(STORAGE_KEYS.zoom, 0.72)),
  }));
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const zoom = camera.zoom;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [handMode, setHandMode] = useState(() => readStoredBoolean(STORAGE_KEYS.handMode, false));
  const [panning, setPanning] = useState(false);
  /** The performance panel: what takes the time, ranked. */
  const [perfOpen, setPerfOpen] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceHeldRef = useRef(false);
  const [themeId, setThemeId] = useState<ThemeId>(() => readStoredTheme());
  /** Which kit draws the controls. The theme's other half — see the picker
   * beside the theme picker, and `theme/kits/` for what a kit is. */
  const [kitId, setKitId] = useState<KitId>("thinRing");
  /** Which audio backend is actually rendering, for the status bar. */
  const [engineKind, setEngineKind] = useState<RackEngineChoice>("web-audio");
  const [message, setMessage] = useState("idMLab graph ready");
  const [menu, setMenu] = useState<{ x: number; y: number; graphX: number; graphY: number } | null>(null);
  // The menu opens empty every time: a remembered query is a menu that
  // silently hides most of itself the next time it is opened.
  const [menuQuery, setMenuQuery] = useState("");
  const menuGroups = useMemo(() => buildMenu({
    modules: [...moduleRegistry.values()],
    groups: MODULE_GROUPS,
    query: menuQuery,
  }), [menuQuery]);

  /** Every port with a cable on it, as `"nodeId:portId"`. Built once per edge
   * change so each jack is a set lookup rather than a scan of every edge. */
  // Keyed by the endpoints, not the edges object: every command copies that
  // object, and a new Set each time re-rendered every module face.
  const edgeSignature = Object.values(graph.edges)
    .map((edge) => `${edge.from.nodeId}:${edge.from.portId}>${edge.to.nodeId}:${edge.to.portId}`).join("|");
  const connectedPorts = useMemo(() => {
    const ports = new Set<string>();
    for (const pair of edgeSignature ? edgeSignature.split("|") : []) {
      const [from, to] = pair.split(">");
      ports.add(from);
      ports.add(to);
    }
    return ports;
  }, [edgeSignature]);
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
  // Statuses live outside React state: see statusStore.ts.
  const statusStore = useMemo(() => new StatusStore(), []);
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
  // What the Rust rack says about itself, polled on the same 100 ms tick as
  // everything else in the status bar. Null on Web Audio, which reports
  // nothing — see `AudioEngine.rackReport`.
  const [rackReport, setRackReport] = useState<RackReport | null>(null);
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
  const panRef = useRef<{ clientX: number; clientY: number; camera: Camera } | null>(null);
  const didPanRef = useRef(false);
  // Read through a ref so two edits in one event — the baton writing to the
  // Conductor and to M Variables — build on each other instead of the second
  // starting from the graph the first replaced.
  const latestGraph = useRef(graph);
  latestGraph.current = graph;
  const dispatch = (command: GraphCommand) => {
    const result = executeGraphCommand(latestGraph.current, command);
    latestGraph.current = result.graph;
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
    if (!canAddModule(graph, source.moduleType)) {
      setMessage(`Only one ${source.label} per canvas`);
      return;
    }
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
    const started = performance.now();
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
    perf.record("measure ports", performance.now() - started);
    setPortAnchors((current) => (sameAnchors(current, next) ? current : next));
  }, [zoom]);


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
    if (!canAddModule(graph, moduleType)) {
      setMessage(`Only one ${moduleRegistry.get(moduleType)?.label ?? moduleType} per canvas`);
      setMenu(null);
      return;
    }
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
            left: cameraRef.current.left,
            top: cameraRef.current.top,
            width: viewport.clientWidth,
            height: viewport.clientHeight,
          },
          zoom,
        )
        : { x: 0, y: 0, width: canvasSize.width, height: canvasSize.height },
      canvas: canvasSize,
    });
    const added = createNode(moduleType, id, position);
    // Each new modulator wears a colour no other one does, so its rings stand apart.
    if (isModulator(moduleType)) added.parameters.color = nextLfoColor(graph);
    dispatch({ type: "add-node", node: added });
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
    documentGraph = withDeclaredParameters(documentGraph);
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
  /**
   * Panning, as ComfyUI does it: drag the empty canvas, or hold Space (or use
   * the hand tool) and drag anywhere, or drag with the middle button anywhere.
   */
  const startCanvasPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    panRef.current = { clientX: event.clientX, clientY: event.clientY, camera: cameraRef.current };
    didPanRef.current = false;
    setPanning(true);
    viewport.setPointerCapture(event.pointerId);
  };
  /** Space, the hand tool and the middle button pan even over a module, so they win the capture phase. */
  const captureCanvasPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const anywhere = event.button === 1 || (event.button === 0 && (spaceHeldRef.current || handMode));
    if (!anywhere) return;
    if ((event.target as Element).closest(".mm-module-menu")) return;
    event.preventDefault();
    event.stopPropagation();
    startCanvasPan(event);
  };
  const beginCanvasPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || panRef.current) return;
    const target = event.target as Element;
    if (target.closest(".mm-node, .mm-module-menu") || target.closest(".mm-cables path")) return;
    startCanvasPan(event);
  };
  const moveCanvasPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = panRef.current;
    if (!start) return;
    const deltaX = event.clientX - start.clientX;
    const deltaY = event.clientY - start.clientY;
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) didPanRef.current = true;
    setCamera(panBy(start.camera, deltaX, deltaY));
  };
  const endCanvasPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!panRef.current) return;
    panRef.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  /** Zoom about the middle of the window, for the menu, the slider and the keys. */
  const setZoom = (next: number) => {
    const viewport = viewportRef.current;
    const centre = { x: (viewport?.clientWidth ?? 0) / 2, y: (viewport?.clientHeight ?? 0) / 2 };
    setCamera((current) => zoomAround(current, centre, clampCameraZoom(next) / current.zoom));
  };
  /** "." — the whole patch, or the selected module, in view. */
  const fitView = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const nodes = selectedNodeId && graph.nodes[selectedNodeId]
      ? [graph.nodes[selectedNodeId]]
      : Object.values(graph.nodes);
    // Measured, not estimated: a module's face is the size of what is on it.
    const sizeOf = (node: NodeInstance) => {
      const element = viewport.querySelector<HTMLElement>(`[data-node-box="${CSS.escape(node.id)}"]`);
      return element ? { width: element.offsetWidth, height: element.offsetHeight } : nodeSize(node.moduleType);
    };
    setCamera(fitToBoxes(nodes.map((node) => ({ x: node.position.x, y: node.position.y, ...sizeOf(node) })),
      { width: viewport.clientWidth, height: viewport.clientHeight }));
  };
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // Every notch zooms at once, about the cursor — no easing, so the canvas
    // is always exactly where the wheel left it.
    const wheelZoom = (event: WheelEvent) => {
      // An overlay that scrolls owns its own wheel. Without this the canvas
      // zoom swallows every wheel event on the page, so a menu taller than the
      // window can be opened but never scrolled — and the groups at the bottom
      // of it become unreachable rather than merely awkward.
      const element = event.target as Element | null;
      if (element?.closest?.(
        ".mm-module-menu, .mm-pool, .mm-theme-menu, .mm-theme-studio, .mm-note-roll__view, .mm-m-face, .n4-scroll",
      )) return;
      event.preventDefault();
      event.stopPropagation();
      const bounds = viewport.getBoundingClientRect();
      const pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      const factor = wheelZoomFactor(event);
      setCamera((current) => zoomAround(current, pointer, factor));
    };
    viewport.addEventListener("wheel", wheelZoom, { passive: false });
    return () => viewport.removeEventListener("wheel", wheelZoom);
    // Subscribed once. Re-subscribing on every zoom change tore the listener
    // down and rebuilt it on each notch of the wheel.
  }, []);
  useEffect(() => {
    // Space held is the hand: drag anywhere to pan, as in ComfyUI.
    const isTyping = (event: KeyboardEvent) =>
      (event.target as HTMLElement | null)?.matches?.("input, select, textarea, [contenteditable]") ?? false;
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isTyping(event)) return;
      event.preventDefault();
      if (!spaceHeldRef.current) { spaceHeldRef.current = true; setSpaceHeld(true); }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      spaceHeldRef.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEYS.zoom, String(camera.zoom));
    window.localStorage.setItem(STORAGE_KEYS.panLeft, String(camera.left));
    window.localStorage.setItem(STORAGE_KEYS.panTop, String(camera.top));
  }, [camera]);

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
      if (event.key === "." && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        fitView();
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
    const requestAccess = browserMidiAccess
      ? async () => await browserMidiAccess() as unknown as MidiAccessLike
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

  // Position links: M Variables writes each variable's current position into
  // the M module that holds it. Derived from the Variables node, so it stays
  // out of the undo history; undoing a Variables change re-derives them.
  useEffect(() => {
    const updates = variableLinkUpdates(graph);
    if (updates.length === 0) return;
    const variables = Object.values(graph.nodes).find((node) => node.moduleType === M_LAB_TYPES.variables);
    const morph = quantizeMorph(variables?.parameters["snapshot-quantize"]);
    for (const { nodeId, values } of updates) {
      for (const [parameterId, value] of Object.entries(values)) {
        runtimeRef.current?.queueParameter(nodeId, parameterId, value, morph);
      }
    }
    setGraph((current) => updates.reduce(
      (next, update) => executeGraphCommand(next, { type: "set-parameters", nodeId: update.nodeId, values: update.values }).graph,
      current,
    ));
  }, [graph]);

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
      statusStore.set(next);
      setAudioNodes(audioRef.current?.liveNodeCount ?? 0);
      setRackReport((current) => {
        const next = audioRef.current?.rackReport ?? null;
        return JSON.stringify(current) === JSON.stringify(next) ? current : next;
      });
      const devices = midiSessionRef.current?.devices() ?? [];
      setMidiDevices((current) =>
        JSON.stringify(current) === JSON.stringify(devices) ? current : devices);
    };
    const timed = () => perf.time("status poll", update);
    timed();
    const timer = window.setInterval(timed, 100);
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

  /** The tempo the transport plays at now: M's, or the Conductor's as it moves it. */
  const transportTempo = useCallback((): number => {
    const runtime = runtimeRef.current;
    const bpm = runtime?.tempoMap.bpmAt(runtime.positionTick);
    return bpm !== undefined && Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  }, []);
  // A synced LFO follows the transport's tempo. Polled rather than pushed: the
  // Conductor and M's tempo both move it, from inside the runtime.
  useEffect(() => {
    const timer = window.setInterval(() => audioRef.current?.setTempo(transportTempo()), 100);
    return () => window.clearInterval(timer);
  }, [transportTempo]);

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
    engine.setTempo(transportTempo());
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
      // The Rust rack is the default; `?engine=web-audio` asks for the
      // browser's own nodes instead, and a build where the rack cannot load
      // falls back to them by itself. Attached after `start()` because a
      // worklet node on a suspended context never pulls.
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
  }, [refreshAssets, transportTempo]);

  // M plays through this canvas: its sound joins the mix, it shares the MIDI
  // access, and each track's notes go to the modules cabled to its output.
  // Set on first render, before M's face mounts and makes its runtime.
  const graphRef = useRef(graph);
  graphRef.current = graph;

  // ---- LFO mappings ----------------------------------------------------------
  // The LFO whose Map button is on, and every mapped knob. The map keeps its
  // identity while the mappings are unchanged, so turning an unrelated knob
  // does not re-render every knob that reads it.
  const [mappingFrom, setMappingFrom] = useState<string | null>(null);
  const mappingsMemo = useRef<{ key: string; map: Map<string, Mapping[]> }>({ key: "[]", map: new Map() });
  const mappings = useMemo(() => {
    const next = mappingsByTarget(graph);
    const key = JSON.stringify([...next]);
    if (key !== mappingsMemo.current.key) mappingsMemo.current = { key, map: next };
    return mappingsMemo.current.map;
  }, [graph]);
  const modulationApi = useMemo<ModulationApi>(() => {
    const describe: ModulationApi["describe"] = (target) => {
      const node = graphRef.current.nodes[target.nodeId];
      const parameter = node && moduleRegistry.get(node.moduleType)?.parameters.find((p) => p.id === target.parameterId);
      return `${node?.label ?? target.nodeId} · ${parameter?.label ?? target.parameterId}`;
    };
    const setTargets = (lfoNodeId: string, change: (targets: ReturnType<typeof targetsOf>) => ReturnType<typeof targetsOf>) => {
      const lfo = graphRef.current.nodes[lfoNodeId];
      if (!lfo) return;
      dispatch({ type: "set-parameter", nodeId: lfoNodeId, parameterId: "targets", value: change(targetsOf(lfo)) });
    };
    return {
      mappingFrom,
      mappings,
      describe,
      startMap: (lfoNodeId) => {
        setMappingFrom(lfoNodeId);
        setMessage(`Click the knob ${graphRef.current.nodes[lfoNodeId]?.label ?? "the modulator"} should move — Esc to stop`);
      },
      cancelMap: () => {
        setMappingFrom(null);
        setMessage("Mapping stopped");
      },
      finishMap: (target) => {
        if (mappingFrom === null) return;
        setTargets(mappingFrom, (targets) => withTarget(targets, target));
        setMappingFrom(null);
        setMessage(`${graphRef.current.nodes[mappingFrom]?.label ?? "LFO"} → ${describe(target)}`);
      },
      unmap: (lfoNodeId, target) => {
        setTargets(lfoNodeId, (targets) => withoutTarget(targets, target));
        setMessage(`Unmapped ${describe(target)}`);
      },
    };
    // `dispatch` reads the latest graph through its ref, so it does not need to be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappingFrom, mappings]);
  useEffect(() => {
    if (mappingFrom === null) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMappingFrom(null);
        setMessage("Mapping stopped");
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [mappingFrom]);
  // An LFO that is deleted while waiting stops waiting.
  useEffect(() => {
    if (mappingFrom !== null && !graph.nodes[mappingFrom]) setMappingFrom(null);
  }, [graph, mappingFrom]);
  useEffect(() => {
    const animator = new ModulationAnimator(() => viewportRef.current, () => ({
      report: audioRef.current?.rackReport ?? null,
      lfos: lfoStates(graphRef.current, transportTempo()),
    }));
    animator.start();
    return () => animator.stop();
  }, []);
  // The panels' level meters, from the same reports.
  useEffect(() => {
    const meters = new MeterAnimator(() => viewportRef.current, () => ({ report: audioRef.current?.rackReport ?? null }));
    const clouds = new CloudAnimator(() => viewportRef.current, () => ({ report: audioRef.current?.rackReport ?? null }));
    meters.start();
    clouds.start();
    return () => { meters.stop(); clouds.stop(); };
  }, []);
  const startAudioRef = useRef(startAudio);
  startAudioRef.current = startAudio;
  useState(() => {
    const mTargets = () => {
      const current = graphRef.current;
      const m = findMNode(current);
      return m ? trackTargets(current, m) : new Map<number, string[]>();
    };
    setRuntimeHost({
      audio: () => {
        const engine = startAudioRef.current();
        return engine ? {
          context: engine.audioContext as unknown as AudioContext,
          output: engine.input as unknown as AudioNode,
        } : null;
      },
      ...(browserMidiAccess ? { midiAccess: browserMidiAccess } : {}),
      canvas: {
        send: (events) => {
          const engine = audioRef.current;
          if (!engine) return;
          const targets = mTargets();
          for (const event of events) {
            if (event.type !== "note-on" && event.type !== "note-off") continue;
            for (const nodeId of targets.get(event.voice) ?? []) engine.playOnNode(nodeId, event);
          }
        },
        panic: () => {
          const engine = audioRef.current;
          if (!engine) return;
          for (const nodeIds of mTargets().values()) for (const nodeId of nodeIds) engine.silenceNode(nodeId);
        },
        routedVoices: () => {
          const current = graphRef.current;
          const m = findMNode(current);
          return m ? routedTracks(current, m) : new Set<number>();
        },
      },
    });
  });
  // One transport: M's Play and Stop run the canvas too, at M's tempo.
  useEffect(() => useM.subscribe((state, previous) => {
    const runtime = runtimeRef.current;
    if (!runtime || !findMNode(graphRef.current)) return;
    if (state.project.tempo !== previous.project.tempo || state.isPlaying !== previous.isPlaying) {
      runtime.setBaseTempo(state.project.tempo);
    }
    if (state.isPlaying === previous.isPlaying) return;
    if (state.isPlaying) runtime.start();
    else runtime.stop();
  }), []);

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

  /**
   * A drum kit into the pool and onto Percussion slots — the one named, or
   * every Percussion module. From the dev server's library route, or from the
   * files of a picked folder (see drums/drumKits.ts).
   */
  const loadKit = useCallback((kitId: string, source: "library" | File[], nodeId?: string) => {
    const kit = findKit(kitId);
    const engine = startAudio();
    if (!kit || !engine) return;
    void (async () => {
      let files: { name: string; bytes: Uint8Array }[];
      if (source === "library") {
        setMessage(`Loading the ${kit.name} kit…`);
        const fetched = await Promise.all(kit.files.map(async (file): Promise<{ name: string; bytes: Uint8Array } | null> => {
          try {
            const response = await fetch(kitFileUrl(kit, file));
            return response.ok ? { name: file, bytes: new Uint8Array(await response.arrayBuffer()) } : null;
          } catch {
            return null;
          }
        }));
        files = fetched.filter((file): file is { name: string; bytes: Uint8Array } => file !== null);
      } else {
        const picked = pickKitFiles(kit, source.map((file) => file.webkitRelativePath || file.name));
        files = await Promise.all(picked.map(async ({ index, file }) => ({
          name: file,
          bytes: new Uint8Array(await source[index].arrayBuffer()),
        })));
      }
      if (files.length === 0) {
        setMessage(source === "library"
          ? `The ${kit.name} kit is not in the sample library here — use From folder… on a Percussion module`
          : `None of the ${kit.name} kit's files are in that folder`);
        return;
      }
      const result = await engine.addFiles(files);
      refreshAssets();
      const slots = kitSlots(kit, new Map(result.added.map((record) => [record.name.toLowerCase(), record.id])));
      const targets = nodeId ? [nodeId] : Object.values(graphRef.current.nodes)
        .filter((node) => node.moduleType === "m.percussion").map((node) => node.id);
      for (const target of targets) {
        dispatch({ type: "set-parameter", nodeId: target, parameterId: "slots", value: slots as unknown as JsonValue });
      }
      const where = targets.length === 0 ? "into the pool"
        : `onto ${targets.length === 1 ? "Percussion" : `${targets.length} Percussion modules`}`;
      setMessage(`Loaded ${result.added.length} ${kit.name} samples ${where}`
        + (result.failed.length > 0 ? `; could not decode ${result.failed.map((entry) => entry.name).join(", ")}` : ""));
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
    perf.time("audio graph update", () => audioRef.current?.update(graph));
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
      // The menu sits in the window, which no longer scrolls.
      { left: 0, top: 0, width: viewport.clientWidth, height: viewport.clientHeight },
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
    if (boxes.length === 0) return;
    const left = Math.min(...boxes.map((box) => box.x));
    const top = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    const bottom = Math.max(...boxes.map((box) => box.y + box.height));
    setCamera(centerOn({ x: (left + right) / 2, y: (top + bottom) / 2 },
      { width: viewport.clientWidth, height: viewport.clientHeight }, zoomRef.current));
    // Deliberately not keyed on `graph` or `zoom`: this must not yank the view
    // back every time a node moves or the user zooms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterToken]);

  /** Load a whole graph, discarding the history that belonged to the old one. */
  const loadGraph = (next: ReturnType<typeof starterGraph>) => {
    setGraph(next);
    setUndo([]);
    setRedo([]);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setPendingConnection(null);
    reseedIdsFromGraph(next);
    setRecenterToken((value) => value + 1);
  };

  /**
   * Open the add-module menu in the middle of the view.
   *
   * The same menu the canvas opens on right-click, so the two routes cannot
   * drift apart — but reachable from the bar, which is where someone who has
   * not been told about right-click will look.
   */
  const openAddMenu = () => {
    const viewport = viewportRef.current;
    const x = viewport ? viewport.clientWidth / 2 : 0;
    const y = viewport ? viewport.clientHeight / 2 : 0;
    const at = screenToCanvas(cameraRef.current, x, y);
    setMenuQuery("");
    setMenu({ x, y, graphX: at.x, graphY: at.y });
  };

  /** View › Zoom In / Out: one wheel notch about the middle of the window. */
  const nudgeZoom = (direction: 1 | -1) => setZoom(zoomRef.current * 1.1 ** direction);

  // View › Classic M: go to the canvas's M, or put one on it.
  const showM = () => {
    const viewport = viewportRef.current;
    const reveal = (at: { x: number; y: number }) => requestAnimationFrame(() => {
      setCamera((current) => ({ ...current, left: at.x * current.zoom - 40, top: at.y * current.zoom - 40 }));
    });
    const existing = findMNode(graph);
    if (existing) {
      setSelectedNodeId(existing);
      setSelectedEdgeId(null);
      bringToFront(existing);
      reveal(graph.nodes[existing].position);
      return;
    }
    const visible = viewport
      ? visibleRegion({
        left: cameraRef.current.left,
        top: cameraRef.current.top,
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      }, zoom)
      : { x: 0, y: 0, width: canvasSize.width, height: canvasSize.height };
    const position = placeNode({
      desired: { x: visible.x + 40, y: visible.y + 40 },
      size: readMNodeSize(),
      existing: Object.values(graph.nodes).map((node) => ({
        x: node.position.x,
        y: node.position.y,
        ...nodeSize(node.moduleType),
      })),
      visible,
      canvas: canvasSize,
    });
    const id = `m-${nextId.current++}`;
    dispatch({ type: "add-node", node: createNode(M_NODE_TYPE, id, position) });
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    bringToFront(id);
    reveal(position);
  };
  const menuActions: MenuActions = {
    new: { run: () => loadGraph(starterGraph()) },
    template1: { run: () => loadGraph(streamTemplate(1)) },
    template4: { run: () => loadGraph(streamTemplate(4)) },
    template8: { run: () => loadGraph(streamTemplate(8)) },
    template16: { run: () => loadGraph(streamTemplate(16)) },
    templateM: { run: () => loadGraph(centred(buildMRack())) },
    templateDrums: { run: () => loadGraph(centred(buildDrumRack())) },
    open: { run: () => openInputRef.current?.click() },
    save: { run: save },
    savePack: { run: savePack },

    undo: { run: undoLast, enabled: undo.length > 0 },
    redo: { run: redoLast, enabled: redo.length > 0 },
    duplicate: { run: duplicateSelection, enabled: Boolean(selectedNodeId) },
    delete: {
      run: deleteSelection,
      enabled: Boolean(selectedNodeId) || Boolean(selectedEdgeId),
    },

    addModule: { run: openAddMenu },
    center: { run: () => setRecenterToken((value) => value + 1) },

    zoomIn: { run: () => nudgeZoom(1), enabled: zoom < MAX_ZOOM },
    zoomOut: { run: () => nudgeZoom(-1), enabled: zoom > MIN_ZOOM },
    zoomReset: { run: () => setZoom(1) },
    hand: { run: () => setHandMode((value) => !value), checked: handMode },
    sounds: { run: () => setPoolOpen((value) => !value), checked: poolOpen },
    performance: { run: () => setPerfOpen((value) => !value), checked: perfOpen },
    classicView: { run: showM, checked: findMNode(graph) !== null },
  };

  useEffect(() => () => runtimeRef.current?.stop(), []);

  // What the module faces call back into, read through the latest render so
  // the handlers themselves never change and a memoised face never re-renders
  // just because the app did.
  const latest = useRef({ dispatch, handleNodeCommand, handleParameterChange, handlePortClick, beginCableDrag,
    bringToFront, removeNode, anchorFor, graph });
  latest.current = { dispatch, handleNodeCommand, handleParameterChange, handlePortClick, beginCableDrag,
    bringToFront, removeNode, anchorFor, graph };
  const handlers = useMemo(() => ({
    dispatch: (command: GraphCommand) => latest.current.dispatch(command),
    onCommand: (node: NodeInstance, commandId: string, label: string) => latest.current.handleNodeCommand(node, commandId, label),
    onParameterChange: (nodeId: string, parameterId: string, value: JsonValue, morph: MorphPolicy) =>
      latest.current.handleParameterChange(nodeId, parameterId, value, morph),
    onSelect: (nodeId: string) => { setSelectedNodeId(nodeId); setSelectedEdgeId(null); },
    onPortClick: (port: PortRef) => latest.current.handlePortClick(port),
    onPortPointerDown: (event: React.PointerEvent, port: PortRef, direction: "input" | "output") =>
      latest.current.beginCableDrag(event, port, direction),
    onRaise: (nodeId: string) => latest.current.bringToFront(nodeId),
    onClose: (nodeId: string) => latest.current.removeNode(nodeId),
    // A dragged module's cables follow it directly, from the last measured
    // ports plus the drag offset: no render, no layout read.
    onDragMove: (nodeId: string, offset: { x: number; y: number } | null) => {
      if (!offset) return;
      const { graph: current, anchorFor: anchor } = latest.current;
      const svg = canvasRef.current?.querySelector("svg.mm-cables");
      if (!svg) return;
      const moved = (ref: PortRef, direction: "input" | "output") => {
        const at = anchor(ref, direction);
        return ref.nodeId === nodeId ? { x: at.x + offset.x, y: at.y + offset.y } : at;
      };
      for (const edge of Object.values(current.edges)) {
        if (edge.from.nodeId !== nodeId && edge.to.nodeId !== nodeId) continue;
        svg.querySelector(`path[data-edge-id="${CSS.escape(edge.id)}"]`)
          ?.setAttribute("d", cablePath(moved(edge.from, "output"), moved(edge.to, "input")));
      }
    },
  }), []);
  // Stable for the life of the app: faces read the patch through the graph
  // store (graphStore.ts), each selecting only what it shows.
  const mlabHost = useMemo<MLabHost>(() => ({
    getGraph: () => latest.current.graph,
    setNodeParameters: (nodeId, values) => {
      latest.current.dispatch({ type: "set-parameters", nodeId, values });
      for (const [parameterId, value] of Object.entries(values)) {
        runtimeRef.current?.queueParameter(nodeId, parameterId, value, "immediate");
      }
    },
    command: (nodeId, commandId) => { runtimeRef.current?.command(nodeId, commandId); },
    run: (nodeId, commandId, label) => {
      const node = latest.current.graph.nodes[nodeId];
      if (node) latest.current.handleNodeCommand(node, commandId, label);
    },
    readScope: (nodeId, into) => audioRef.current?.readScope(nodeId, into) ?? false,
  }), []);
  const graphStore = useMemo(() => new GraphStore(graph), []);
  useLayoutEffect(() => { graphStore.set(graph); }, [graph, graphStore]);

  return <SoundPoolContext.Provider value={{ assets, preview: playAsset, loadKit }}>
  <KitContext.Provider value={kitId}>
  <MFaceHostContext.Provider value={{ themeId, onSelectTheme: setThemeId, kitId, onSelectKit: setKitId, zoom }}>
  <StatusStoreContext.Provider value={statusStore}>
  <ModulationContext.Provider value={modulationApi}>
  <GraphStoreContext.Provider value={graphStore}>
  <MLabHostContext.Provider value={mlabHost}>
  <Profiler id="render whole app" onRender={recordRender}>
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
      <MenuBar actions={menuActions} />
      {/* The pickers stay as controls rather than becoming menu items: a
          continuous value and a fifty-entry swatch list are both things you
          steer, not commands you issue. */}
      <nav aria-label="View controls">
        {/* The engine toggle stays a button: it is the control reached for
            most often, and it reads at a glance whether sound is running. */}
        <button type="button" className={audioOn ? "is-active" : ""}
          aria-pressed={audioOn} onClick={toggleAudio}>Audio</button>
        {/* Logarithmic, so 10% to 1000% each get the same share of the slider. */}
        <label>Zoom <input type="range" min="-100" max="100" value={Math.round(Math.log10(zoom) * 100)}
          aria-valuetext={`${Math.round(zoom * 100)}%`}
          onChange={(event) => setZoom(10 ** (Number(event.currentTarget.value) / 100))} />
          <output>{Math.round(zoom * 100)}%</output></label>
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
    <div ref={viewportRef}
      className={`mm-canvas-viewport${handMode || spaceHeld ? " is-hand" : ""}${panning ? " is-panning" : ""}${mappingFrom ? " is-mapping" : ""}`}
      // The dot grid is the window's background, laid out by the camera, so it
      // runs on forever however far the canvas is panned.
      style={{
        backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
        backgroundPosition: `${-camera.left}px ${-camera.top}px`,
      }}
      // The camera does all the moving. A hidden-overflow box can still be
      // scrolled — focusing a control far out does it — so put it straight back.
      onScroll={(event) => { event.currentTarget.scrollLeft = 0; event.currentTarget.scrollTop = 0; }}
      onPointerDownCapture={captureCanvasPan}
      onPointerDown={beginCanvasPan} onPointerMove={moveCanvasPan}
      onPointerUp={endCanvasPan} onPointerCancel={endCanvasPan}
      // The middle button would otherwise start the browser's autoscroll.
      onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}
      // Double-click the empty canvas to search for a module, as in ComfyUI.
      onDoubleClick={(event) => {
        if ((event.target as Element).closest(".mm-node, .mm-module-menu, .mm-cables path")) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - bounds.left;
        const y = event.clientY - bounds.top;
        const at = screenToCanvas(cameraRef.current, x, y);
        setMenuQuery("");
        setMenu({ x, y, graphX: at.x, graphY: at.y });
      }}
      onClick={() => {
      if (didPanRef.current) { didPanRef.current = false; return; }
      setSelectedNodeId(null); setSelectedEdgeId(null); setMenu(null);
    }} onContextMenu={(event) => {
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const at = screenToCanvas(cameraRef.current, x, y);
      setMenuQuery("");
      setMenu({ x, y, graphX: at.x, graphY: at.y });
    }}>
      <div className="mm-canvas-stage">
      <div ref={canvasRef} className={`mm-canvas${canInteractAtZoom(zoom) ? "" : " is-too-small"}`}
        style={{ width: canvasSize.width, height: canvasSize.height,
          transform: `translate(${-camera.left}px, ${-camera.top}px) scale(${zoom})` }}>
        <svg className="mm-cables" width={canvasSize.width} height={canvasSize.height}
          aria-label="Graph connections">
          {Object.values(graph.edges).map((edge) => {
            const from = graph.nodes[edge.from.nodeId];
            const to = graph.nodes[edge.to.nodeId];
            if (!from || !to) return null;
            // Both ends come from the ports themselves, so a cable lands on the
            // port it is actually connected to however many the node has.
            return <path key={edge.id} data-edge-id={edge.id} className={selectedEdgeId === edge.id ? "is-selected" : ""}
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
        {Object.values(graph.nodes).map((node) => <Profiler key={node.id} id={`render ${node.moduleType}`} onRender={recordRender}><NodeFaceMemo node={node}
          zoom={zoom} selected={selectedNodeId === node.id} pendingConnection={pendingConnection}
          dispatch={handlers.dispatch} onCommand={handlers.onCommand}
          onParameterChange={handlers.onParameterChange}
          onSelect={handlers.onSelect}
          onPortClick={handlers.onPortClick}
          onPortPointerDown={handlers.onPortPointerDown}
          onDragMove={handlers.onDragMove}
          onRaise={handlers.onRaise}
          stackIndex={2 + (stacking[node.id] ?? 0)}
          dropTarget={dropTarget}
          midiDevices={midiDevices}
          connectedPorts={connectedPorts}
          onClose={handlers.onClose} /></Profiler>)}
      </div>
      </div>
      {menu && <div ref={menuRef} className="mm-module-menu" style={{ left: menu.x, top: menu.y }}
        onClick={(event) => event.stopPropagation()}>
        <b>Add module</b>
        <input
          className="mm-module-menu__search"
          type="search"
          autoFocus
          placeholder="Search modules…"
          value={menuQuery}
          onChange={(event) => setMenuQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // Only when the query means one thing; see `soleMatch`.
            const only = soleMatch(menuGroups);
            if (only) addNode(only.type);
          }}
        />
        {menuGroups.length === 0
          ? <p className="mm-module-menu__empty">No module matches “{menuQuery}”.</p>
          : menuGroups.map((group) => <div key={group.family} className="mm-module-menu__group">
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
      onLoadKit={(kitId) => loadKit(kitId, "library")}
    /> : null}
    <footer className="mm-status-bar"><span>{message}</span><span>{Object.keys(graph.nodes).length} nodes · {Object.keys(graph.edges).length} cable{audioOn ? ` · ${audioNodes} audio · ${engineKind === "rust" ? "Rust" : "Web Audio"}` : ""}{rackReport ? ` · ${rackReport.modules} in engine · ${rackReport.samples} sample${rackReport.samples === 1 ? "" : "s"}` : ""}</span></footer>
  {perfOpen && <PerfPanel onClose={() => setPerfOpen(false)} />}
  </main>
  </Profiler>
  </MLabHostContext.Provider>
  </GraphStoreContext.Provider>
  </ModulationContext.Provider>
  </StatusStoreContext.Provider>
  </MFaceHostContext.Provider>
  </KitContext.Provider>
  </SoundPoolContext.Provider>;
}
