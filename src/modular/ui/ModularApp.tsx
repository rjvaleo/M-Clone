import { useEffect, useMemo, useRef, useState } from "react";
import { noteOrderHandleLayout, setNoteOrderBoundary } from "../../engine/transform";
import { createModularDocument, decodeModularDocument } from "../document/document";
import { PlanPublisher } from "../compiler/compileGraph";
import { connectionError } from "../model/connections";
import { executeGraphCommand, type GraphCommand } from "../model/commands";
import { expandStreamNode } from "../model/stream";
import { clampZoom, zoomScrollPosition } from "./viewport";
import { TimerSchedulerDriver } from "../runtime/clock";
import { ModularRuntime } from "../runtime/engine";
import type { MorphPolicy } from "../runtime/parameters";
import type {
  GraphDocument,
  JsonValue,
  NodeFaceElement,
  NodeInstance,
  ParameterDescriptor,
  PortRef,
} from "../model/graph";
import { createNode, moduleRegistry } from "../registry/registry";
import { executeRuntimeCommand, queueRuntimeParameter } from "./runtimebridge";

const MODULE_COLORS: Record<string, string> = {
  clock: "#ffb703",
  pattern: "#4cc9f0",
  order: "#f15bb5",
  density: "#00d4a6",
  midi: "#9b5de5",
};

const FACE_SIZES = {
  compact: { width: 520, height: 330 },
  editor: { width: 900, height: 650 },
  utility: { width: 360, height: 390 },
} as const;

const nodeSize = (moduleType: string) =>
  FACE_SIZES[moduleRegistry.get(moduleType)?.layout ?? "utility"];

const STORAGE_KEYS = {
  dark: "m.modular.dark",
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

const readStoredNumber = (key: string, fallback: number): number => {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const starterGraph = (): GraphDocument => {
  const nodes = [
    createNode("m.transport-clock", "transport-1", { x: 70, y: 100 }),
    createNode("m.time-base", "time-base-1", { x: 420, y: 80 }),
    createNode("m.phase", "phase-1", { x: 980, y: 80 }),
    createNode("m.cyclic-rhythm", "cyclic-rhythm-1", { x: 1540, y: 70 }),
    createNode("m.cyclic-accent", "cyclic-accent-1", { x: 1540, y: -250 }),
    createNode("m.cyclic-legato", "cyclic-legato-1", { x: 1540, y: 420 }),
    createNode("m.note-editor", "notes-1", { x: 2080, y: 480 }),
    createNode("m.note-order", "note-order-1", { x: 2640, y: 80 }),
    createNode("m.step-to-notes", "step-notes-1", { x: 3200, y: 120 }),
    createNode("m.note-density", "density-1", { x: 3600, y: 120 }),
    createNode("m.transposition", "transposition-1", { x: 4160, y: 120 }),
    createNode("m.velocity-range", "velocity-range-1", { x: 4720, y: 120 }),
    createNode("m.legato-processor", "legato-processor-1", { x: 5280, y: 120 }),
    createNode("m.play-enable", "play-enable-1", { x: 5840, y: 120 }),
    createNode("m.midi-output", "midi-out-1", { x: 6420, y: 130 }),
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

const streamTemplate = (streamCount: 1 | 4 | 8 | 16): GraphDocument => {
  const transport = createNode("m.transport-clock", "transport-1", { x: 60, y: 80 });
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
  if (descriptor.kind === "json") return null;
  if (descriptor.kind === "boolean") {
    return <label className="mm-field mm-field--check">
      <span>{descriptor.label}</span>
      <input type="checkbox" checked={value === true}
        onChange={(event) => onChange(event.currentTarget.checked)} />
    </label>;
  }
  if (descriptor.kind === "enum") {
    return <label className="mm-field">
      <span>{descriptor.label}</span>
      <select value={String(value)} onChange={(event) => onChange(event.currentTarget.value)}>
        {descriptor.options?.map((option) => <option key={option}>{option}</option>)}
      </select>
    </label>;
  }
  if (descriptor.kind === "number") {
    return <label className="mm-field">
      <span>{descriptor.label}</span>
      <span className="mm-number">
        <input type="number" value={typeof value === "number" ? value : 0}
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

function NoteGrid({ node, setParameter }: {
  node: NodeInstance;
  setParameter: (id: string, value: JsonValue) => void;
}) {
  const pitches = Array.from({ length: 12 }, (_, index) => 71 - index);
  const active = Math.max(0, Math.min(7, Number(node.parameters["active-position"] ?? 0)));
  const source = node.parameters["preset-values"];
  const presets = Array.from({ length: 8 }, (_, position) =>
    asSteps(Array.isArray(source) ? source[position] : []));
  const steps = presets[active];
  const toggle = (stepIndex: number, pitch: number) => {
    const next = Array.from({ length: Math.max(16, steps.length) }, (_, index) => [...(steps[index] ?? [])]);
    const at = next[stepIndex];
    next[stepIndex] = at.includes(pitch) ? at.filter((value) => value !== pitch) : [...at, pitch].sort((a, b) => a - b);
    const nextPresets = presets.map((pattern) => pattern.map((step) => [...step]));
    nextPresets[active] = next;
    setParameter("preset-values", nextPresets);
  };
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

function EmbeddedNumberPresets({ node, setParameters }: {
  node: NodeInstance;
  setParameters: (values: Record<string, JsonValue>) => void;
}) {
  const source = node.parameters["preset-values"];
  const values = Array.from({ length: 8 }, (_, index) =>
    Array.isArray(source) && typeof source[index] === "number" ? source[index] : 100);
  const active = Number(node.parameters["active-position"] ?? 0);
  const activate = (event: React.MouseEvent<HTMLButtonElement>, position: number) => {
    if (event.shiftKey) {
      const next = [...values];
      next[position] = Number(node.parameters.density ?? 100);
      setParameters({ "preset-values": next, "active-position": position });
      return;
    }
    setParameters({ density: values[position], "active-position": position });
  };
  return <div className="mm-embedded-presets" role="group" aria-label="Density presets a through h">
    {values.map((value, position) => {
      const label = String.fromCharCode(97 + position);
      return <div key={position} className={active === position ? "is-active" : ""}>
      <button type="button" aria-pressed={active === position}
        title={`Preset ${label.toUpperCase()}: ${value}%. Click to recall. Shift-click to overwrite.`}
        onClick={(event) => activate(event, position)}>
        {label}
      </button>
      <output>{value}%</output>
    </div>;
    })}
  </div>;
}

type OrderMix = { original: number; cyclic: number; utterly: number };

const asOrderMix = (value: JsonValue): OrderMix => {
  const source = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  return {
    original: typeof source.original === "number" ? source.original : 100,
    cyclic: typeof source.cyclic === "number" ? source.cyclic : 0,
    utterly: typeof source.utterly === "number" ? source.utterly : 0,
  };
};

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

function EmbeddedNoteOrderPresets({ node, setParameters }: {
  node: NodeInstance;
  setParameters: (values: Record<string, JsonValue>) => void;
}) {
  const source = node.parameters["preset-values"];
  const presets = Array.from({ length: 8 }, (_, index) =>
    asOrderMix(Array.isArray(source) ? source[index] : null));
  const active = Number(node.parameters["active-position"] ?? 0);
  const activate = (event: React.MouseEvent<HTMLButtonElement>, position: number) => {
    if (event.shiftKey) {
      const next = presets.map((preset) => ({ ...preset }));
      next[position] = {
        original: Number(node.parameters.original ?? 0),
        cyclic: Number(node.parameters.cyclic ?? 0),
        utterly: Number(node.parameters.utterly ?? 0),
      };
      setParameters({ "preset-values": next, "active-position": position });
      return;
    }
    const preset = presets[position];
    setParameters({ ...preset, "active-position": position });
  };
  return <div className="mm-embedded-presets mm-embedded-presets--order"
    role="group" aria-label="Note Order presets a through h">
    {presets.map((preset, position) => {
      const label = String.fromCharCode(97 + position);
      const summary = `O${preset.original} C${preset.cyclic} U${preset.utterly}`;
      return <div key={position} className={active === position ? "is-active" : ""}>
        <button type="button" aria-pressed={active === position}
          title={`Preset ${label.toUpperCase()}: ${summary}. Click to recall. Shift-click to overwrite.`}
          onClick={(event) => activate(event, position)}>{label}</button>
        <output>{summary}</output>
      </div>;
    })}
  </div>;
}

function CustomFace({ element, node, setParameter, setParameters }: {
  element: Extract<NodeFaceElement, { kind: "custom" }>;
  node: NodeInstance;
  setParameter: (id: string, value: JsonValue) => void;
  setParameters: (values: Record<string, JsonValue>) => void;
}) {
  if (element.id === "piano-roll") return <NoteGrid node={node} setParameter={setParameter} />;
  if (element.id === "density-slider") {
    return <DensitySlider node={node} setParameter={setParameter} />;
  }
  if (element.id === "embedded-number-presets") {
    return <EmbeddedNumberPresets node={node} setParameters={setParameters} />;
  }
  if (element.id === "note-order-mix") {
    return <NoteOrderMix node={node} setParameters={setParameters} />;
  }
  if (element.id === "embedded-note-order-presets") {
    return <EmbeddedNoteOrderPresets node={node} setParameters={setParameters} />;
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
  onClose,
  status,
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
  onClose: () => void;
  status: Readonly<Record<string, string>>;
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
    dragRef.current = { x: event.clientX, y: event.clientY };
    const move = (moveEvent: PointerEvent) => {
      const start = dragRef.current;
      if (start) setDrag({ x: (moveEvent.clientX - start.x) / zoom, y: (moveEvent.clientY - start.y) / zoom });
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
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
      style={{ left: node.position.x, top: node.position.y, width: 360, minHeight: 150, "--mm-accent": "#f45b69" } as React.CSSProperties}>
      <header className="mm-node__header" onPointerDown={beginDrag}>
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
  const size = nodeSize(node.moduleType);
  const accent = MODULE_COLORS[descriptor.colorToken] ?? "#00d4a6";
  return <article className={`mm-node mm-node--${descriptor.family} mm-node--layout-${descriptor.layout}${selected ? " is-selected" : ""}`}
    aria-label={`${node.label} module`} onClick={(event) => { event.stopPropagation(); onSelect(); }}
    style={{ left: node.position.x + drag.x, top: node.position.y + drag.y,
      width: size.width, height: size.height, "--mm-accent": accent } as React.CSSProperties}>
    <header className="mm-node__header" onPointerDown={beginDrag}>
      <span>{node.label}</span><small>{descriptor.type}</small>
      <CloseNodeButton label={node.label} onClose={onClose} />
    </header>
    <div className="mm-node__ports mm-node__ports--input">
      {descriptor.ports.filter((port) => port.direction === "input").map((port) =>
        <button type="button" key={port.id} className={`mm-port mm-port--${port.signal.kind}`}
          aria-label={`${node.label} input ${port.label}`}
          onClick={(event) => { event.stopPropagation(); onPortClick({ nodeId: node.id, portId: port.id }); }}>
          {port.label}
        </button>)}
    </div>
    <div className="mm-node__ports mm-node__ports--output">
      {descriptor.ports.filter((port) => port.direction === "output").map((port) =>
        <button type="button" key={port.id}
          className={`mm-port mm-port--${port.signal.kind}${pendingConnection?.nodeId === node.id && pendingConnection.portId === port.id ? " is-patching" : ""}`}
          aria-label={`${node.label} output ${port.label}`}
          aria-pressed={pendingConnection?.nodeId === node.id && pendingConnection.portId === port.id}
          onClick={(event) => { event.stopPropagation(); onPortClick({ nodeId: node.id, portId: port.id }); }}>
          {port.label}
        </button>)}
    </div>
    <div className="mm-node__face">
      {descriptor.face.map((section) => <section className="mm-node-section" key={section.id}>
        <h2>{section.label}</h2>
        <div className="mm-node-section__content">
          {section.elements.map((element, index) => {
            if (element.kind === "parameter") {
              const parameter = parameterMap.get(element.parameterId)!;
              return <ParameterControl key={`${element.kind}-${element.parameterId}`}
                descriptor={parameter} value={node.parameters[parameter.id]}
                onChange={(value) => setParameter(parameter.id, value)} />;
            }
            if (element.kind === "command") return <button type="button" className="mm-command"
              key={`${element.kind}-${element.id}`}
              onClick={() => onCommand(node, element.id, element.label)}>{element.label}</button>;
            if (element.kind === "status") return <output className="mm-status"
              key={`${element.kind}-${element.id}`}><span>{element.label}</span><b>{status[element.id] ?? "Idle"}</b></output>;
            return <CustomFace key={`${element.kind}-${element.id}-${index}`}
              element={element} node={node} setParameter={setParameter}
              setParameters={setParameters} />;
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
  const [zoom, setZoom] = useState(() => clampZoom(readStoredNumber(STORAGE_KEYS.zoom, 0.72)));
  const [handMode, setHandMode] = useState(() => readStoredBoolean(STORAGE_KEYS.handMode, true));
  const [panning, setPanning] = useState(false);
  const [dark, setDark] = useState(() => readStoredBoolean(STORAGE_KEYS.dark, true));
  const [message, setMessage] = useState("Modular graph ready");
  const [menu, setMenu] = useState<{ x: number; y: number; graphX: number; graphY: number } | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [pendingConnection, setPendingConnection] = useState<PortRef | null>(null);
  const [runtimeStatuses, setRuntimeStatuses] = useState<Record<string, Readonly<Record<string, string>>>>({});
  const nextId = useRef(2);
  const nextEdgeId = useRef(2);
  const runtimeRef = useRef<ModularRuntime | null>(null);
  const publisherRef = useRef(new PlanPublisher());
  const openInputRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
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
    const error = connectionError(graph, moduleRegistry, pendingConnection, ref);
    if (error) {
      setMessage(error);
      return;
    }
    const edgeId = `cable-${nextEdgeId.current++}`;
    dispatch({ type: "add-edge", edge: { id: edgeId, from: pendingConnection, to: ref, enabled: true } });
    setPendingConnection(null);
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
    setMessage(`Connected to ${node.label}: ${port.label}`);
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
  const addNode = (moduleType: string) => {
    if (!menu) return;
    const moduleTypeParts = moduleType.split('.');
    const id = `${moduleTypeParts[moduleTypeParts.length - 1]}-${nextId.current++}`;
    dispatch({ type: "add-node", node: createNode(moduleType, id, { x: menu.graphX, y: menu.graphY }) });
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setMenu(null);
  };
  const save = () => {
    const content = JSON.stringify(createModularDocument(graph), null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "Untitled.mmod";
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Saved Untitled.mmod");
  };
  const open = async (file: File) => {
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const decoded = decodeModularDocument(parsed);
      if (!decoded.ok) {
        setMessage(`Open failed: ${decoded.error}`);
        return;
      }
      setGraph(decoded.document.graph);
      setUndo([]);
      setRedo([]);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setPendingConnection(null);
      reseedIdsFromGraph(decoded.document.graph);
      setMessage(decoded.warnings.length > 0
        ? `Opened ${file.name} with ${decoded.warnings.length} migration warning(s)`
        : `Opened ${file.name}`);
    } catch {
      setMessage("Open failed: invalid JSON document");
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
    const wheelZoom = (event: WheelEvent) => {
      const startLeft = viewport.scrollLeft;
      const startTop = viewport.scrollTop;
      event.preventDefault();
      event.stopPropagation();
      const bounds = viewport.getBoundingClientRect();
      const nextZoom = clampZoom(zoom * Math.exp(-event.deltaY * 0.0015));
      const scroll = nextZoom === zoom
        ? { left: startLeft, top: startTop }
        : zoomScrollPosition({
          scrollLeft: startLeft,
          scrollTop: startTop,
          pointerX: event.clientX - bounds.left,
          pointerY: event.clientY - bounds.top,
          oldZoom: zoom,
          newZoom: nextZoom,
        });
      if (nextZoom !== zoom) setZoom(nextZoom);
      const applyZoomScroll = () => {
        viewport.scrollLeft = scroll.left;
        viewport.scrollTop = scroll.top;
      };
      applyZoomScroll();
      if (wheelFrameRef.current !== null) cancelAnimationFrame(wheelFrameRef.current);
      wheelFrameRef.current = requestAnimationFrame(() => {
        applyZoomScroll();
        wheelFrameRef.current = null;
      });
    };
    viewport.addEventListener("wheel", wheelZoom, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", wheelZoom);
      if (wheelFrameRef.current !== null) cancelAnimationFrame(wheelFrameRef.current);
    };
  }, [zoom]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEYS.zoom, String(zoom));
  }, [zoom]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEYS.handMode, String(handMode));
  }, [handMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEYS.dark, String(dark));
  }, [dark]);

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
    const runtime = new ModularRuntime({
      registry: moduleRegistry,
      driver: new TimerSchedulerDriver(),
      clock: { nowSec: () => performance.now() / 1000 },
      wakeIntervalMs: 25,
    });
    runtimeRef.current = runtime;
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const result = publisherRef.current.publish(graph, moduleRegistry, { seed: 7 });
    if (result.ok) {
      runtime.build(graph, result.plan);
      return;
    }
    if (result.diagnostics.length > 0) setMessage(result.diagnostics[0].message);
  }, [graph]);

  useEffect(() => {
    const update = () => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      const next = Object.fromEntries(
        Object.keys(graph.nodes).map((nodeId) => [nodeId, runtime.nodeStatus(nodeId)]),
      );
      setRuntimeStatuses((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [graph]);

  useEffect(() => () => runtimeRef.current?.stop(), []);
  return <main className={`mm-app ${dark ? "mm-app--dark" : ""}`} onClick={() => setMenu(null)}>
    <input
      ref={openInputRef}
      type="file"
      accept=".mmod,application/json"
      style={{ display: "none" }}
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) void open(file);
        event.currentTarget.value = "";
      }}
    />
    <header className="mm-project-bar">
      <div><strong>M MODULAR</strong><span>Untitled.mmod</span></div>
      <nav aria-label="Project controls">
        <button type="button" onClick={() => {
          const next = starterGraph();
          setGraph(next); setUndo([]); setRedo([]); setSelectedNodeId(null); setSelectedEdgeId(null); setPendingConnection(null);
          reseedIdsFromGraph(next);
        }}>New</button>
        <button type="button" onClick={() => {
          const next = streamTemplate(1);
          setGraph(next); setUndo([]); setRedo([]); setSelectedNodeId(null); setSelectedEdgeId(null); setPendingConnection(null);
          reseedIdsFromGraph(next);
        }}>1 Stream</button>
        <button type="button" onClick={() => {
          const next = streamTemplate(4);
          setGraph(next); setUndo([]); setRedo([]); setSelectedNodeId(null); setSelectedEdgeId(null); setPendingConnection(null);
          reseedIdsFromGraph(next);
        }}>4 Streams</button>
        <button type="button" onClick={() => {
          const next = streamTemplate(8);
          setGraph(next); setUndo([]); setRedo([]); setSelectedNodeId(null); setSelectedEdgeId(null); setPendingConnection(null);
          reseedIdsFromGraph(next);
        }}>8 Streams</button>
        <button type="button" onClick={() => {
          const next = streamTemplate(16);
          setGraph(next); setUndo([]); setRedo([]); setSelectedNodeId(null); setSelectedEdgeId(null); setPendingConnection(null);
          reseedIdsFromGraph(next);
        }}>16 Streams</button>
        <button type="button" onClick={() => openInputRef.current?.click()}>Open</button>
        <button type="button" onClick={save}>Save</button>
        <button type="button" onClick={undoLast} disabled={!undo.length}>Undo</button>
        <button type="button" onClick={redoLast} disabled={!redo.length}>Redo</button>
        <button type="button" onClick={duplicateSelection} disabled={!selectedNodeId}>Duplicate</button>
        <button type="button" onClick={deleteSelection} disabled={!selectedNodeId && !selectedEdgeId}>Delete</button>
        <button type="button" className={handMode ? "is-active" : ""}
          aria-pressed={handMode} onClick={() => setHandMode((value) => !value)}>Hand</button>
        <label>Zoom <input type="range" min="40" max="110" value={Math.round(zoom * 100)}
          onChange={(event) => setZoom(Number(event.currentTarget.value) / 100)} /></label>
        <button type="button" onClick={() => setDark((value) => !value)}>{dark ? "Light" : "Dark"}</button>
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
      <div className="mm-canvas" style={{ transform: `scale(${zoom})` }}>
        <svg className="mm-cables" width="2900" height="1200" aria-label="Graph connections">
          {Object.values(graph.edges).map((edge) => {
            const from = graph.nodes[edge.from.nodeId];
            const to = graph.nodes[edge.to.nodeId];
            if (!from || !to) return null;
            const fromSize = nodeSize(from.moduleType);
            const toSize = nodeSize(to.moduleType);
            const x1 = from.position.x + fromSize.width;
            const y1 = from.position.y + fromSize.height * 0.26;
            const x2 = to.position.x;
            const y2 = to.position.y + toSize.height * 0.35;
            const bend = Math.max(80, (x2 - x1) / 2);
            return <path key={edge.id} className={selectedEdgeId === edge.id ? "is-selected" : ""}
              aria-label={`Cable from ${from.label} to ${to.label}`}
              onClick={(event) => { event.stopPropagation(); setSelectedEdgeId(edge.id); setSelectedNodeId(null); }}
              d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} />;
          })}
        </svg>
        {Object.values(graph.nodes).map((node) => <NodeFace key={node.id} node={node}
          zoom={zoom} selected={selectedNodeId === node.id} pendingConnection={pendingConnection}
          dispatch={dispatch} onCommand={handleNodeCommand}
          onParameterChange={handleParameterChange}
          onSelect={() => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }}
          onPortClick={handlePortClick}
          status={runtimeStatuses[node.id] ?? {}}
          onClose={() => removeNode(node.id)} />)}
      </div>
      {menu && <div className="mm-module-menu" style={{ left: menu.x, top: menu.y }}
        onClick={(event) => event.stopPropagation()}>
        <b>Add module</b>
        {[...moduleRegistry.values()].map((descriptor) => <button type="button"
          key={descriptor.type} onClick={() => addNode(descriptor.type)}>{descriptor.label}</button>)}
      </div>}
    </div>
    <footer className="mm-status-bar"><span>{message}</span><span>{Object.keys(graph.nodes).length} nodes · {Object.keys(graph.edges).length} cable</span></footer>
  </main>;
}
